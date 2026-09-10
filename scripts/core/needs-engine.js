import { MODULE_ID, Events, Severity } from '../constants.js';
import { canEditNeed } from './access.js';

export class NeedsEngine {
  #store;
  #eventBus;
  #adapter;
  #pending = new Map();

  constructor(store, eventBus, adapter) {
    this.#store = store;
    this.#eventBus = eventBus;
    this.#adapter = adapter;
  }

  // --- Primary Operations ---

  async stressNeed(entityId, needId, amount, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config || !config.enabled) return null;

    const finalAmount = this.#resolveStressAmount(config, amount);
    const source = options.source || 'stress';
    let adjustedAmount = finalAmount;

    // Apply attribute modifier if configured
    if (config.attribute && !options.skipModifier) {
      const modifier = this.getAttributeModifier(entityId, config.attribute);
      adjustedAmount = Math.round(finalAmount * modifier);
    }

    // Apply scene modifier if applicable
    if (!options.skipSceneModifier) {
      const sceneMod = this.#getSceneStressMultiplier(needId);
      adjustedAmount = Math.round(adjustedAmount * sceneMod);
    }

    const signedAmount = NeedsEngine.isInvertedNeed(config) ? -adjustedAmount : adjustedAmount;
    return this.#commit(entityId, needId, current => current + signedAmount, Events.NEED_STRESSED, source, adjustedAmount);
  }

  async relieveNeed(entityId, needId, amount, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config || !config.enabled) return null;

    const finalAmount = this.#resolveStressAmount(config, amount);
    const source = options.source || 'relieve';
    const signedAmount = NeedsEngine.isInvertedNeed(config) ? finalAmount : -finalAmount;
    return this.#commit(entityId, needId, current => current + signedAmount, Events.NEED_RELIEVED, source, finalAmount);
  }

  async setNeed(entityId, needId, value, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config) return null;

    if (!Number.isFinite(Number(value))) return null;
    return this.#commit(entityId, needId, () => Number(value), Events.NEED_SET, options.source || 'manual');
  }

  async #commit(entityId, needId, calculate, event, source, amount) {
    if (!canEditNeed(entityId, needId, this.#store)) return null;
    const previous = this.#pending.get(entityId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      if (!canEditNeed(entityId, needId, this.#store)) return null;
      const config = this.#store.getNeedConfig(needId);
      const current = this.#store.getActorNeedState(entityId, needId)?.value ?? config.default ?? 0;
      const target = Math.max(config.min ?? 0, Math.min(config.max ?? 100, Math.round(calculate(current))));
      if (!Number.isFinite(target) || target === current) return null;
      const result = this.#store.setNeedValue(entityId, needId, target, source, { recordHistory: false });
      try {
        await this.#store.persistActor(entityId);
      } catch (error) {
        this.#store.setNeedValue(entityId, needId, current, 'rollback', { recordHistory: false });
        this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
        throw error;
      }
      this.#store.recordCommittedChange(entityId, needId, current, target, source, result);
      // Consequences have their own queue. Do not hold this write lock while a
      // macro or callback may itself adjust another need on this actor.
      this.#eventBus.emit(event, { entityId, needId, ...result, source, amount });
      this.#evaluateThresholds(entityId, needId, result.previousValue, result.value, result.max, source);
      return result;
    });
    this.#pending.set(entityId, operation);
    try { return await operation; }
    finally { if (this.#pending.get(entityId) === operation) this.#pending.delete(entityId); }
  }

  // Called only from Foundry's document hooks, never from an untrusted socket payload.
  async ingestActorNeeds(actor) {
    return this.ingestEntityNeeds(actor.id, () => this.#store.loadActorNeeds(actor));
  }

  async ingestEntityNeeds(entityId, load) {
    if (!this.#store.isTracked(entityId)) return;
    const before = this.#store.getActorAllNeeds(entityId) || {};
    await load();
    for (const config of this.#store.getAllNeedConfigs()) {
      const next = this.#store.getActorNeedState(entityId, config.id);
      const previousValue = before[config.id]?.value ?? config.default ?? 0;
      if (!next || next.value === previousValue) continue;
      this.#store.recordCommittedChange(entityId, config.id, previousValue, next.value, 'document', next);
      this.#eventBus.emit(Events.NEED_SET, {
        entityId, needId: config.id, ...next, previousValue, source: 'document',
      });
      this.#evaluateThresholds(entityId, config.id, previousValue, next.value, next.max, 'document');
    }
    this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
  }

  async resetNeed(entityId, needId) {
    const config = this.#store.getNeedConfig(needId);
    if (!config) return null;
    const result = await this.setNeed(entityId, needId, config.default ?? 0, { source: 'reset' });
    if (result) {
      this.#eventBus.emit(Events.NEED_RESET, { entityId, needId, value: result.value });
    }
    return result;
  }

  async resetAll(entityId) {
    const configs = this.#store.getEnabledNeedConfigs();
    for (const config of configs) {
      await this.resetNeed(entityId, config.id);
    }
  }

  // --- Batch Operations ---

  async stressAll(needId, amount, options = {}) {
    const entities = this.#store.getTrackedEntityIds();
    const promises = entities.map(id => this.stressNeed(id, needId, amount, options));
    await Promise.all(promises);
  }

  async relieveAll(needId, amount, options = {}) {
    const entities = this.#store.getTrackedEntityIds();
    const promises = entities.map(id => this.relieveNeed(id, needId, amount, options));
    await Promise.all(promises);
  }

  async stressMultiple(entityIds, needAmounts, options = {}) {
    const promises = [];
    for (const entityId of entityIds) {
      for (const { needId, amount } of needAmounts) {
        promises.push(this.stressNeed(entityId, needId, amount, options));
      }
    }
    await Promise.all(promises);
  }

  async relieveMultiple(entityIds, needAmounts, options = {}) {
    const promises = [];
    for (const entityId of entityIds) {
      for (const { needId, amount } of needAmounts) {
        promises.push(this.relieveNeed(entityId, needId, amount, options));
      }
    }
    await Promise.all(promises);
  }

  // --- Attribute Modifier ---

  #resolveStressAmount(config, requestedAmount) {
    if (requestedAmount !== undefined && requestedAmount !== null) {
      return Math.max(0, NeedsEngine.normalizeNumber(requestedAmount, 0));
    }

    const configuredAmount = NeedsEngine.normalizeNumber(config?.stressAmount, null);
    if (configuredAmount !== null) return Math.max(0, configuredAmount);

    const defaultAmount = NeedsEngine.normalizeNumber(
      game.settings?.get?.(MODULE_ID, 'defaultStressAmount'),
      10,
    );
    return Math.max(0, defaultAmount);
  }

  getAttributeModifier(entityId, attributePath) {
    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return 1.0;

    // Only actors have attributes
    let actor = null;
    if (entityInfo.source === 'actor') {
      actor = game.actors.get(entityId);
    } else if (entityInfo.linkedActorId) {
      actor = game.actors.get(entityInfo.linkedActorId);
    }
    if (!actor) return 1.0;

    const value = foundry.utils.getProperty(actor.system, attributePath);
    if (typeof value !== 'number') return 1.0;

    const table = this.#adapter.getModifierTable();
    for (const entry of table) {
      if (value <= entry.maxScore) return entry.multiplier;
    }
    return 1.0;
  }

  // --- Threshold Evaluation ---

  #evaluateThresholds(entityId, needId, oldValue, newValue, max, source = 'manual') {
    const config = this.#store.getNeedConfig(needId);
    const oldPct = NeedsEngine.getStressPercentage(oldValue, max, config);
    const newPct = NeedsEngine.getStressPercentage(newValue, max, config);
    const oldSev = NeedsEngine.getSeverity(oldPct);
    const newSev = NeedsEngine.getSeverity(newPct);

    // Crossed a severity threshold
    if (oldSev !== newSev) {
      this.#eventBus.emit(Events.THRESHOLD_CROSSED, {
        entityId, needId,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
        severity: newSev,
        previousSeverity: oldSev,
        source,
      });
    }

    const criticalThreshold = game.settings?.get?.(MODULE_ID, 'criticalThreshold') ?? 80;
    if (newPct >= criticalThreshold && oldPct < criticalThreshold) {
      this.#eventBus.emit(Events.THRESHOLD_CRITICAL, {
        entityId, needId, source,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
      });
    }
    // Still at critical but stressed further
    else if (newPct >= criticalThreshold && oldPct >= criticalThreshold && newPct > oldPct) {
      this.#eventBus.emit(Events.THRESHOLD_CRITICAL, {
        entityId, needId, source,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
        sustained: true,
      });
    }

    // Recovered from critical
    if (oldPct >= criticalThreshold && newPct < criticalThreshold) {
      this.#eventBus.emit(Events.THRESHOLD_RECOVERED, {
        entityId, needId, source,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
      });
    }
  }

  // --- Scene Modifiers ---

  #getSceneStressMultiplier(needId) {
    const scene = game.scenes?.active;
    if (!scene) return 1.0;
    const modifiers = scene.getFlag?.('mortal-needs', 'modifiers') || {};
    return modifiers[needId]?.stressMultiplier ?? 1.0;
  }

  getSceneDecayMultiplier(needId) {
    const scene = game.scenes?.active;
    if (!scene) return 1.0;
    const modifiers = scene.getFlag?.('mortal-needs', 'modifiers') || {};
    return modifiers[needId]?.decayMultiplier ?? 1.0;
  }

  // --- Static Helpers ---

  static getPercentage(value, max) {
    const safeValue = NeedsEngine.normalizeNumber(value, 0);
    const safeMax = NeedsEngine.normalizeNumber(max, 100);
    if (safeMax <= 0) return 0;
    const percentage = Math.round((safeValue / safeMax) * 100);
    return Number.isFinite(percentage) ? percentage : 0;
  }

  static getRatio(value, max) {
    const safeValue = NeedsEngine.normalizeNumber(value, 0);
    const safeMax = NeedsEngine.normalizeNumber(max, 100);
    if (safeMax <= 0) return 0;
    const ratio = safeValue / safeMax;
    if (!Number.isFinite(ratio)) return 0;
    return Math.max(0, Math.min(1, ratio));
  }

  static getStressPercentage(value, max, config = {}) {
    if (!NeedsEngine.isInvertedNeed(config)) {
      const min = NeedsEngine.normalizeNumber(config?.min, 0);
      const range = NeedsEngine.normalizeNumber(max, 100) - min;
      return range > 0 ? Math.max(0, Math.min(100, Math.round(((NeedsEngine.normalizeNumber(value, min) - min) / range) * 100))) : 0;
    }

    const safeValue = NeedsEngine.normalizeNumber(value, 0);
    const safeMin = NeedsEngine.normalizeNumber(config?.min, 0);
    const safeMax = NeedsEngine.normalizeNumber(max ?? config?.max, 100);
    const range = safeMax - safeMin;
    if (range <= 0) return 0;

    const percentage = Math.round(((safeMax - safeValue) / range) * 100);
    if (!Number.isFinite(percentage)) return 0;
    return Math.max(0, Math.min(100, percentage));
  }

  static getStressRatio(value, max, config = {}) {
    const percentage = NeedsEngine.getStressPercentage(value, max, config);
    return Math.max(0, Math.min(1, percentage / 100));
  }

  static getValueForStressPercentage(percentage, max, config = {}) {
    const safePercentage = Math.max(0, Math.min(100, NeedsEngine.normalizeNumber(percentage, 0)));
    const safeMin = NeedsEngine.normalizeNumber(config?.min, 0);
    const safeMax = NeedsEngine.normalizeNumber(max ?? config?.max, 100);
    const range = safeMax - safeMin;
    if (range <= 0) return safeMin;

    const ratio = safePercentage / 100;
    if (NeedsEngine.isInvertedNeed(config)) {
      return Math.round(safeMax - (range * ratio));
    }
    return Math.round(safeMin + (range * ratio));
  }

  static isInvertedNeed(config = {}) {
    return config?.inverted === true;
  }

  static normalizeNumber(value, fallback = 0) {
    const candidate = value && typeof value === 'object' && !Array.isArray(value)
      ? value.value
      : value;
    const number = Number(candidate);
    return Number.isFinite(number) ? number : fallback;
  }

  static getSeverity(percentage) {
    if (percentage >= 80) return Severity.CRITICAL;
    if (percentage >= 60) return Severity.HIGH;
    if (percentage >= 40) return Severity.MEDIUM;
    if (percentage >= 20) return Severity.LOW;
    return Severity.SAFE;
  }
}

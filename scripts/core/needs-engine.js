import { MODULE_ID, Events, Severity } from '../constants.js';

export class NeedsEngine {
  #store;
  #eventBus;
  #adapter;

  constructor(store, eventBus, adapter) {
    this.#store = store;
    this.#eventBus = eventBus;
    this.#adapter = adapter;
  }

  // --- Primary Operations ---

  async stressNeed(entityId, needId, amount, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config || !config.enabled) return null;

    const globalDefault = game.settings?.get?.(MODULE_ID, 'defaultStressAmount') ?? 10;
    const finalAmount = amount ?? config.stressAmount ?? globalDefault;
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

    const result = this.#store.adjustNeedValue(entityId, needId, adjustedAmount, 'stress');
    if (!result) return null;

    this.#eventBus.emit(Events.NEED_STRESSED, {
      entityId, needId,
      amount: adjustedAmount,
      value: result.value,
      previousValue: result.previousValue,
      max: result.max,
    });

    // Evaluate thresholds
    this.#evaluateThresholds(entityId, needId, result.previousValue, result.value, result.max, 'stress');

    // Persist
    await this.#store.persistActor(entityId);

    return result;
  }

  async relieveNeed(entityId, needId, amount, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config || !config.enabled) return null;

    const globalDefault = game.settings?.get?.(MODULE_ID, 'defaultStressAmount') ?? 10;
    const finalAmount = amount ?? config.stressAmount ?? globalDefault;
    const result = this.#store.adjustNeedValue(entityId, needId, -finalAmount, 'relieve');
    if (!result) return null;

    this.#eventBus.emit(Events.NEED_RELIEVED, {
      entityId, needId,
      amount: finalAmount,
      value: result.value,
      previousValue: result.previousValue,
      max: result.max,
    });

    // Evaluate thresholds (recovery check)
    this.#evaluateThresholds(entityId, needId, result.previousValue, result.value, result.max, 'relieve');

    // Persist
    await this.#store.persistActor(entityId);

    return result;
  }

  async setNeed(entityId, needId, value, options = {}) {
    const config = this.#store.getNeedConfig(needId);
    if (!config) return null;

    const result = this.#store.setNeedValue(entityId, needId, value, options.source || 'manual');
    if (!result) return null;

    this.#eventBus.emit(Events.NEED_SET, {
      entityId, needId,
      value: result.value,
      previousValue: result.previousValue,
      max: result.max,
    });

    // Evaluate thresholds
    this.#evaluateThresholds(entityId, needId, result.previousValue, result.value, result.max, options.source || 'manual');

    // Persist
    await this.#store.persistActor(entityId);

    return result;
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
    const oldPct = NeedsEngine.getPercentage(oldValue, max);
    const newPct = NeedsEngine.getPercentage(newValue, max);
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

    // Reached critical (>= 100%)
    if (newPct >= 100 && oldPct < 100) {
      this.#eventBus.emit(Events.THRESHOLD_CRITICAL, {
        entityId, needId,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
      });
    }
    // Still at critical but stressed further
    else if (newPct >= 100 && oldPct >= 100 && newValue > oldValue) {
      this.#eventBus.emit(Events.THRESHOLD_CRITICAL, {
        entityId, needId,
        value: newValue, max,
        percentage: newPct,
        previousPercentage: oldPct,
        sustained: true,
      });
    }

    // Recovered from critical
    const criticalThreshold = game.settings?.get?.(MODULE_ID, 'criticalThreshold') ?? 80;
    if (oldPct >= criticalThreshold && newPct < criticalThreshold) {
      this.#eventBus.emit(Events.THRESHOLD_RECOVERED, {
        entityId, needId,
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
    if (max <= 0) return 0;
    return Math.round((value / max) * 100);
  }

  static getSeverity(percentage) {
    if (percentage >= 80) return Severity.CRITICAL;
    if (percentage >= 60) return Severity.HIGH;
    if (percentage >= 40) return Severity.MEDIUM;
    if (percentage >= 20) return Severity.LOW;
    return Severity.SAFE;
  }
}

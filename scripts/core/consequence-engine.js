import { MODULE_ID, Events, EntitySource } from '../constants.js';
import { getConsequenceType } from '../consequences/consequence-type.js';
import { NeedsEngine } from './needs-engine.js';
import { watchNextMortalNeedsDialogRender } from '../ui/dialogs/window-layering.js';
import { isResponsibleGM } from './access.js';
import { consequenceId, escapeHTML } from './consequence-identity.js';
import { effectChanges } from './effect-data.js';

export class ConsequenceEngine {
  #eventBus;
  #store;
  #adapter;
  #pending = new Map();
  #failures = new Map();

  constructor(eventBus, store, adapter) {
    this.#eventBus = eventBus;
    this.#store = store;
    this.#adapter = adapter;

    // Subscribe to all need value change events
    this.#eventBus.on(Events.NEED_STRESSED, this.#onNeedChanged.bind(this));
    this.#eventBus.on(Events.NEED_RELIEVED, this.#onNeedChanged.bind(this));
    this.#eventBus.on(Events.NEED_SET, this.#onNeedChanged.bind(this));
    this.#eventBus.on(Events.NEED_CHECKED, this.#onNeedChanged.bind(this));
  }

  async #onNeedChanged(data) {
    if (!isResponsibleGM()) return;
    const previous = this.#pending.get(data.entityId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(() => this.#processChange(data));
    this.#pending.set(data.entityId, operation);
    try { return await operation; }
    finally { if (this.#pending.get(data.entityId) === operation) this.#pending.delete(data.entityId); }
  }

  async #processChange({ entityId, needId, value, previousValue, max, sustained = false }) {
    if (!isResponsibleGM()) return;

    const config = this.#store.getNeedConfig(needId);
    if (!config) return;

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return;

    const actor = this.#resolveActor(entityId, entityInfo);

    const oldPct = NeedsEngine.getStressPercentage(previousValue, max, config);
    const newPct = NeedsEngine.getStressPercentage(value, max, config);

    const saved = actor?.getFlag(MODULE_ID, 'appliedConsequences') || {};
    const recovery = new Map((config.consequences || []).map(c => [this.#getConsequenceKey(needId, c), c]));
    for (const [id, record] of Object.entries(saved)) {
      if (record.needId === needId) recovery.set(id, record.consequence);
    }
    for (const consequenceConfig of recovery.values()) {
      const threshold = this.#normalizeThreshold(consequenceConfig.threshold);
      if (oldPct >= threshold && newPct < threshold) await this.#handleRecovery(actor, entityId, needId, consequenceConfig);
    }
    for (const consequenceConfig of config.consequences || []) {
      const threshold = this.#normalizeThreshold(consequenceConfig.threshold);

      if (oldPct < threshold && newPct >= threshold) {
        // First time crossing this consequence's threshold — apply immediately
        await this.#handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, newPct, oldPct, false);
      } else if (oldPct >= threshold && newPct >= threshold && (newPct > oldPct || sustained)) {
        // Increasing stress or a positive stress check at the clamped boundary.
        await this.#handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, newPct, oldPct, true);
      }
    }
  }

  async #handleRecovery(actor, entityId, needId, consequenceConfig) {
    if (consequenceConfig.reversible === false) return;

    const removalMode = game.settings.get(MODULE_ID, 'consequenceRemovalMode');
    if (removalMode === 'manual') return;

    let removed = false;
    if (removalMode === 'ask_gm') {
      removed = await this.#showRemovalDialog(actor, entityId, needId, consequenceConfig);
    } else if (removalMode === 'immediate') {
      removed = await this.removeConsequence(actor, entityId, needId, consequenceConfig);
    }

    // Only reset ticks if the consequence was actually removed
    if (removed && actor) {
      const tickKey = this.#getTickKey(needId, consequenceConfig);
      await actor.setFlag(MODULE_ID, tickKey, 0);
    }
  }

  async #handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, percentage, previousPercentage, sustained) {
    const threshold = this.#normalizeThreshold(consequenceConfig.threshold);
    if (percentage < threshold) return;

    const maxTicks = this.#normalizeTicks(consequenceConfig.ticks);

    // Get tick count
    let currentTicks = 0;
    if (actor) {
      const tickKey = this.#getTickKey(needId, consequenceConfig);
      currentTicks = actor.getFlag(MODULE_ID, tickKey) ?? 0;
    }

    if (!sustained) {
      // First time crossing threshold: apply immediately
      await this.applyConsequence(actor, entityId, needId, consequenceConfig);
      if (actor) {
        const tickKey = this.#getTickKey(needId, consequenceConfig);
        await actor.setFlag(MODULE_ID, tickKey, 0);
      }
    } else {
      // Sustained at threshold: increment ticks
      const next = currentTicks + 1;
      if (next >= maxTicks) {
        await this.applyConsequence(actor, entityId, needId, consequenceConfig);
        if (actor) {
          const tickKey = this.#getTickKey(needId, consequenceConfig);
          await actor.setFlag(MODULE_ID, tickKey, 0);
        }
      } else {
        if (actor) {
          const tickKey = this.#getTickKey(needId, consequenceConfig);
          await actor.setFlag(MODULE_ID, tickKey, next);
        }
        this.#eventBus.emit(Events.CONSEQUENCE_TICK, {
          entityId, needId,
          consequenceType: consequenceConfig.type,
          currentTick: next,
          maxTicks,
        });
      }
    }
  }

  async applyConsequence(actor, entityId, needId, consequenceConfig) {
    if (!game.user.isGM) return { success: false, reason: 'not-gm' };
    const ConsequenceClass = getConsequenceType(consequenceConfig.type);
    if (!ConsequenceClass) {
      console.warn(`Mortal Needs | Unknown consequence type: ${consequenceConfig.type}`);
      this.#reportFailure(entityId, needId, consequenceConfig, 'unknown-type');
      return { success: false, reason: 'unknown-type' };
    }

    // Check if consequence requires an actor
    if (!actor && !['custom-callback', 'chat-notify', 'macro-execute'].includes(consequenceConfig.type)) {
      this.#reportFailure(entityId, needId, consequenceConfig, 'no-linked-actor');
      console.warn(`Mortal Needs | Consequence "${consequenceConfig.type}" skipped for entity ${entityId} (no linked actor)`);
      return { success: false, reason: 'no-actor' };
    }

    const instance = new ConsequenceClass(this.#adapter);
    try {
      const runtime = this.#getRuntimeConfig(needId, consequenceConfig);
      const result = await instance.apply(actor, needId, runtime);
      if (result?.success) {
        result.description ||= instance.getDescription(runtime);
        this.#failures.delete(`${entityId}:${runtime.consequenceId}`);
        if (actor && !['custom-callback', 'chat-notify', 'macro-execute'].includes(consequenceConfig.type)) {
          await actor.setFlag(MODULE_ID, `appliedConsequences.${runtime.consequenceId}`, {
            needId, consequence: { ...consequenceConfig, id: runtime.consequenceId },
            description: result.description,
          });
        }
        this.#eventBus.emit(Events.CONSEQUENCE_APPLIED, {
          entityId, needId,
          consequenceType: consequenceConfig.type,
          config: consequenceConfig,
          result,
        });
      } else if (!['already-active', 'external-condition'].includes(result?.reason)) {
        this.#reportFailure(entityId, needId, consequenceConfig, result?.reason || 'application-failed');
      }
      return result;
    } catch (err) {
      console.error(`Mortal Needs | Failed to apply consequence "${consequenceConfig.type}":`, err);
      this.#reportFailure(entityId, needId, consequenceConfig, err.message);
      return { success: false, reason: err.message };
    }
  }

  async removeConsequence(actor, entityId, needId, consequenceConfig) {
    if (!game.user.isGM) return false;
    const id = this.#getConsequenceKey(needId, consequenceConfig);
    consequenceConfig = actor?.getFlag(MODULE_ID, 'appliedConsequences')?.[id]?.consequence ?? consequenceConfig;
    const ConsequenceClass = getConsequenceType(consequenceConfig.type);
    if (!ConsequenceClass || !actor) return false;

    const instance = new ConsequenceClass(this.#adapter);
    try {
      const removed = await instance.remove(actor, needId, this.#getRuntimeConfig(needId, consequenceConfig));
      if (removed) {
        await actor.unsetFlag(MODULE_ID, `appliedConsequences.${id}`);
        this.#eventBus.emit(Events.CONSEQUENCE_REMOVED, {
          entityId, needId,
          consequenceType: consequenceConfig.type,
          config: consequenceConfig,
        });
      }
      return removed;
    } catch (err) {
      console.error(`Mortal Needs | Failed to remove consequence "${consequenceConfig.type}":`, err);
      this.#reportFailure(entityId, needId, consequenceConfig, err.message);
      return false;
    }
  }

  #reportFailure(entityId, needId, config, reason) {
    this.#failures.set(`${entityId}:${this.#getConsequenceKey(needId, config)}`, reason);
    ui.notifications?.warn(`Mortal Needs: ${this.#store.getTrackedEntityInfo(entityId)?.name || entityId}. Could not apply or remove ${game.i18n.localize(this.#store.getNeedConfig(needId)?.label || needId)}: ${reason}`);
    this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
  }

  async getConsequenceStatus(entityId, needId) {
    const info = this.#store.getTrackedEntityInfo(entityId);
    if (!info) return [];
    const actor = this.#resolveActor(entityId, info);
    const saved = actor?.getFlag(MODULE_ID, 'appliedConsequences') || {};
    const configs = new Map((this.#store.getNeedConfig(needId)?.consequences || [])
      .map(c => [this.#getConsequenceKey(needId, c), c]));
    for (const [id, record] of Object.entries(saved)) {
      if (record.needId === needId) configs.set(id, record.consequence);
    }
    return Promise.all([...configs].map(async ([id, config]) => {
      const Type = getConsequenceType(config.type);
      const instance = Type ? new Type(this.#adapter) : null;
      const runtime = this.#getRuntimeConfig(needId, config);
      const active = !!(actor && instance && await instance.isActive(actor, needId, runtime));
      const effect = config.type === 'active-effect' ? actor?.effects.find(e => e.flags?.[MODULE_ID]?.consequenceId === id) : null;
      const attribute = config.type === 'attribute-modify' ? actor?.getFlag(MODULE_ID, 'attributeConsequences')?.[runtime.consequenceId] : null;
      const description = attribute ? instance.getDescription({ ...runtime, path: attribute.path, operation: 'add', amount: attribute.delta })
        : effect ? instance.getDescription({ ...runtime, changeValue: effectChanges(effect)[0]?.value ?? runtime.changeValue })
        : instance?.getDescription(runtime) || config.type;
      return {
        id, config, active, removable: active || !!saved[id], reversible: config.reversible !== false,
        description: ['active-effect', 'attribute-modify'].includes(config.type) ? description : saved[id]?.description || description,
        error: this.#failures.get(`${entityId}:${id}`) || null,
        threshold: runtime.threshold, ticks: this.getTickProgress(entityId, needId, config),
      };
    }));
  }

  getTickProgress(entityId, needId, consequenceConfig) {
    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return { current: 0, max: this.#normalizeTicks(consequenceConfig.ticks) };

    const actor = this.#resolveActor(entityId, entityInfo);
    if (!actor) return { current: 0, max: this.#normalizeTicks(consequenceConfig.ticks) };

    const tickKey = this.#getTickKey(needId, consequenceConfig);
    const current = actor.getFlag(MODULE_ID, tickKey) ?? 0;
    return { current, max: this.#normalizeTicks(consequenceConfig.ticks) };
  }

  // --- Helpers ---

  #resolveActor(entityId, entityInfo) {
    if (entityInfo.source === EntitySource.ACTOR) {
      return game.actors.get(entityId);
    } else if (entityInfo.source === EntitySource.EXALTED_SCENES && entityInfo.linkedActorId) {
      return game.actors.get(entityInfo.linkedActorId);
    }
    return null;
  }

  async #showRemovalDialog(actor, entityId, needId, consequenceConfig) {
    const ConsequenceClass = getConsequenceType(consequenceConfig.type);
    if (!ConsequenceClass) return false;

    const instance = new ConsequenceClass(this.#adapter);
    const isActive = actor ? await instance.isActive(actor, needId, this.#getRuntimeConfig(needId, consequenceConfig)) : false;
    if (!isActive) return false;

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    const entityName = entityInfo?.name || 'Unknown';
    const needConfig = this.#store.getNeedConfig(needId);
    const needName = needConfig ? game.i18n.localize(needConfig.label) : needId;
    const description = instance.getDescription(this.#getRuntimeConfig(needId, consequenceConfig));

    watchNextMortalNeedsDialogRender();
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Dialogs.RemoveConsequenceTitle') },
      content: `<p>${game.i18n.format('MORTAL_NEEDS.Dialogs.RemoveConsequenceContent', {
        name: escapeHTML(entityName),
        need: escapeHTML(needName),
        consequence: escapeHTML(description),
      })}</p>`,
      yes: { label: game.i18n.localize('MORTAL_NEEDS.Dialogs.Remove') },
      no: { label: game.i18n.localize('MORTAL_NEEDS.Dialogs.Keep') },
      classes: ['mortal-needs-panel', 'mn-dialog'],
    });

    if (confirmed) {
      return this.removeConsequence(actor, entityId, needId, consequenceConfig);
    }
    return false;
  }

  #getRuntimeConfig(needId, consequenceConfig) {
    return {
      ...(consequenceConfig.config || {}),
      consequenceId: this.#getConsequenceKey(needId, consequenceConfig),
      threshold: this.#normalizeThreshold(consequenceConfig.threshold),
      ticks: this.#normalizeTicks(consequenceConfig.ticks),
      reversible: consequenceConfig.reversible ?? true,
      recoveryMode: game.settings.get(MODULE_ID, 'consequenceRemovalMode'),
      needLabel: game.i18n.localize(this.#store.getNeedConfig(needId)?.label || needId),
    };
  }

  #getTickKey(needId, consequenceConfig) {
    return `consequenceTicks_${this.#getConsequenceKey(needId, consequenceConfig)}`;
  }

  #getConsequenceKey(needId, consequenceConfig) {
    return consequenceId(needId, consequenceConfig);
  }

  #normalizeThreshold(value) {
    const threshold = Number(value);
    if (!Number.isFinite(threshold)) return 100;
    return Math.min(100, Math.max(0, threshold));
  }

  #normalizeTicks(value) {
    const ticks = Number.parseInt(value, 10);
    if (!Number.isFinite(ticks)) return 3;
    return Math.max(1, ticks);
  }
}

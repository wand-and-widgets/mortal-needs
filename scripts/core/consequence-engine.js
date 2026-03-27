import { MODULE_ID, Events, EntitySource } from '../constants.js';
import { getConsequenceType } from '../consequences/consequence-type.js';
import { NeedsEngine } from './needs-engine.js';

export class ConsequenceEngine {
  #eventBus;
  #store;
  #adapter;

  constructor(eventBus, store, adapter) {
    this.#eventBus = eventBus;
    this.#store = store;
    this.#adapter = adapter;

    // Subscribe to all need value change events
    this.#eventBus.on(Events.NEED_STRESSED, this.#onNeedChanged.bind(this));
    this.#eventBus.on(Events.NEED_RELIEVED, this.#onNeedChanged.bind(this));
    this.#eventBus.on(Events.NEED_SET, this.#onNeedChanged.bind(this));
  }

  async #onNeedChanged({ entityId, needId, value, previousValue, max }) {
    if (!game.user.isGM) return;

    const config = this.#store.getNeedConfig(needId);
    if (!config?.consequences?.length) return;

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return;

    const actor = this.#resolveActor(entityId, entityInfo);

    const oldPct = NeedsEngine.getPercentage(previousValue, max);
    const newPct = NeedsEngine.getPercentage(value, max);

    for (const consequenceConfig of config.consequences) {
      const threshold = consequenceConfig.threshold ?? 100;

      if (oldPct < threshold && newPct >= threshold) {
        // First time crossing this consequence's threshold — apply immediately
        await this.#handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, newPct, oldPct, false);
      } else if (oldPct >= threshold && newPct >= threshold && newPct > oldPct) {
        // Sustained at/above threshold and still increasing — tick
        await this.#handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, newPct, oldPct, true);
      } else if (oldPct >= threshold && newPct < threshold) {
        // Dropped below this consequence's threshold — recovery
        await this.#handleRecovery(actor, entityId, needId, consequenceConfig);
      }
    }
  }

  async #handleRecovery(actor, entityId, needId, consequenceConfig) {
    if (!consequenceConfig.reversible) return;

    const removalMode = game.settings.get(MODULE_ID, 'consequenceRemovalMode');
    if (removalMode === 'manual') return;

    let removed = false;
    if (removalMode === 'ask_gm') {
      removed = await this.#showRemovalDialog(actor, entityId, needId, consequenceConfig);
    } else if (removalMode === 'immediate') {
      await this.removeConsequence(actor, entityId, needId, consequenceConfig);
      removed = true;
    }

    // Only reset ticks if the consequence was actually removed
    if (removed && actor) {
      const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
      await actor.setFlag(MODULE_ID, tickKey, 0);
    }
  }

  async #handleConsequenceTick(actor, entityId, entityInfo, needId, consequenceConfig, percentage, previousPercentage, sustained) {
    const threshold = consequenceConfig.threshold ?? 100;
    if (percentage < threshold) return;

    const maxTicks = consequenceConfig.ticks ?? 3;

    // Get tick count
    let currentTicks = 0;
    if (actor) {
      const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
      currentTicks = actor.getFlag(MODULE_ID, tickKey) ?? 0;
    }

    if (!sustained) {
      // First time crossing threshold: apply immediately
      await this.applyConsequence(actor, entityId, needId, consequenceConfig);
      if (actor) {
        const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
        await actor.setFlag(MODULE_ID, tickKey, 0);
      }
    } else {
      // Sustained at threshold: increment ticks
      const next = currentTicks + 1;
      if (next >= maxTicks) {
        await this.applyConsequence(actor, entityId, needId, consequenceConfig);
        if (actor) {
          const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
          await actor.setFlag(MODULE_ID, tickKey, 0);
        }
      } else {
        if (actor) {
          const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
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
    const ConsequenceClass = getConsequenceType(consequenceConfig.type);
    if (!ConsequenceClass) {
      console.warn(`Mortal Needs | Unknown consequence type: ${consequenceConfig.type}`);
      return;
    }

    // Check if consequence requires an actor
    if (!actor && !['custom-callback', 'chat-notify', 'macro-execute'].includes(consequenceConfig.type)) {
      console.warn(`Mortal Needs | Consequence "${consequenceConfig.type}" skipped for entity ${entityId} (no linked actor)`);
      return;
    }

    const instance = new ConsequenceClass(this.#adapter);
    try {
      const result = await instance.apply(actor, needId, consequenceConfig.config || consequenceConfig);
      if (result?.success) {
        this.#eventBus.emit(Events.CONSEQUENCE_APPLIED, {
          entityId, needId,
          consequenceType: consequenceConfig.type,
          config: consequenceConfig,
          result,
        });
      }
    } catch (err) {
      console.error(`Mortal Needs | Failed to apply consequence "${consequenceConfig.type}":`, err);
    }
  }

  async removeConsequence(actor, entityId, needId, consequenceConfig) {
    const ConsequenceClass = getConsequenceType(consequenceConfig.type);
    if (!ConsequenceClass || !actor) return;

    const instance = new ConsequenceClass(this.#adapter);
    try {
      const removed = await instance.remove(actor, needId, consequenceConfig.config || consequenceConfig);
      if (removed) {
        this.#eventBus.emit(Events.CONSEQUENCE_REMOVED, {
          entityId, needId,
          consequenceType: consequenceConfig.type,
          config: consequenceConfig,
        });
      }
    } catch (err) {
      console.error(`Mortal Needs | Failed to remove consequence "${consequenceConfig.type}":`, err);
    }
  }

  getTickProgress(entityId, needId, consequenceConfig) {
    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return { current: 0, max: consequenceConfig.ticks ?? 3 };

    const actor = this.#resolveActor(entityId, entityInfo);
    if (!actor) return { current: 0, max: consequenceConfig.ticks ?? 3 };

    const tickKey = `consequenceTicks_${needId}_${consequenceConfig.type}`;
    const current = actor.getFlag(MODULE_ID, tickKey) ?? 0;
    return { current, max: consequenceConfig.ticks ?? 3 };
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
    const isActive = actor ? await instance.isActive(actor, needId, consequenceConfig.config || consequenceConfig) : false;
    if (!isActive) return false;

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    const entityName = entityInfo?.name || 'Unknown';
    const needConfig = this.#store.getNeedConfig(needId);
    const needName = needConfig ? game.i18n.localize(needConfig.label) : needId;
    const description = instance.getDescription(consequenceConfig.config || consequenceConfig);

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Dialogs.RemoveConsequenceTitle') },
      content: `<p>${game.i18n.format('MORTAL_NEEDS.Dialogs.RemoveConsequenceContent', {
        name: entityName,
        need: needName,
        consequence: description,
      })}</p>`,
      yes: { label: game.i18n.localize('MORTAL_NEEDS.Dialogs.Remove') },
      no: { label: game.i18n.localize('MORTAL_NEEDS.Dialogs.Keep') },
    });

    if (confirmed) {
      await this.removeConsequence(actor, entityId, needId, consequenceConfig);
      return true;
    }
    return false;
  }
}

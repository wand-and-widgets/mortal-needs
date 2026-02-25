import { MODULE_ID, Events, Severity, NeedCategory, EntitySource } from '../constants.js';
import { registerConsequenceType, getAllConsequenceTypes, getConsequenceType } from '../consequences/consequence-type.js';
import { CustomCallbackConsequence } from '../consequences/custom-callback.js';

export function createPublicAPI(store, engine, consequenceEngine, eventBus, configManager, adapter, app) {
  const api = {
    version: '2.0.0',

    // --- Needs ---
    needs: {
      async stress(entityId, needId, amount) {
        return engine.stressNeed(entityId, needId, amount);
      },
      async relieve(entityId, needId, amount) {
        return engine.relieveNeed(entityId, needId, amount);
      },
      async set(entityId, needId, value, options) {
        return engine.setNeed(entityId, needId, value, options);
      },
      get(entityId, needId) {
        return store.getActorNeedState(entityId, needId);
      },
      getAll(entityId) {
        return store.getActorAllNeeds(entityId);
      },
      async reset(entityId, needId) {
        return engine.resetNeed(entityId, needId);
      },
      async resetAll(entityId) {
        return engine.resetAll(entityId);
      },
    },

    // --- Batch Operations ---
    batch: {
      async stressAll(needId, amount, options) {
        return engine.stressAll(needId, amount, options);
      },
      async relieveAll(needId, amount, options) {
        return engine.relieveAll(needId, amount, options);
      },
      async stressMultiple(entityIds, needAmounts, options) {
        return engine.stressMultiple(entityIds, needAmounts, options);
      },
      async relieveMultiple(entityIds, needAmounts, options) {
        return engine.relieveMultiple(entityIds, needAmounts, options);
      },
    },

    // --- Configuration ---
    config: {
      getNeedConfig(needId) {
        return store.getNeedConfig(needId);
      },
      getEnabledNeeds() {
        return store.getEnabledNeedConfigs();
      },
      getAllNeeds() {
        return store.getAllNeedConfigs();
      },
      enableNeed(needId) {
        return store.enableNeed(needId);
      },
      disableNeed(needId) {
        return store.disableNeed(needId);
      },
      updateNeedConfig(needId, changes) {
        return store.updateNeedConfig(needId, changes);
      },
      exportConfig() {
        return configManager.exportConfig(store.getAllNeedConfigs());
      },
      async importConfig(json) {
        const configs = configManager.importConfig(json);
        if (configs) {
          store.setNeedConfigs(configs);
          await configManager.saveNeedsConfig(configs);
        }
        return configs;
      },
    },

    // --- Actor/Entity Tracking ---
    actors: {
      getTracked() {
        return store.getAllTrackedActors();
      },
      getTrackedActors() {
        return store.getTrackedEntitiesBySource(EntitySource.ACTOR);
      },
      getTrackedESChars() {
        return store.getTrackedEntitiesBySource(EntitySource.EXALTED_SCENES);
      },
      async track(entityId, source) {
        if (!game.user.isGM) {
          ui.notifications.warn('MORTAL_NEEDS.Notifications.GMOnly', { localize: true });
          return;
        }

        // Auto-detect source
        if (!source) {
          const actor = game.actors.get(entityId);
          if (actor) {
            source = EntitySource.ACTOR;
          } else {
            const esModule = game.modules.get('exalted-scenes');
            if (esModule?.active && esModule.api?.characters?.get(entityId)) {
              source = EntitySource.EXALTED_SCENES;
            }
          }
        }

        if (source === EntitySource.ACTOR) {
          const actor = game.actors.get(entityId);
          if (!actor) return;
          store.trackEntity(entityId, {
            source: EntitySource.ACTOR,
            name: actor.name,
            img: actor.img || actor.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
          });
          await store.loadActorNeeds(actor);
          // Save to tracked list
          const trackedIds = game.settings.get(MODULE_ID, 'trackedActors') || [];
          if (!trackedIds.includes(entityId)) {
            trackedIds.push(entityId);
            await game.settings.set(MODULE_ID, 'trackedActors', trackedIds);
          }
        } else if (source === EntitySource.EXALTED_SCENES) {
          const esModule = game.modules.get('exalted-scenes');
          const char = esModule?.api?.characters?.get(entityId);
          if (!char) return;
          store.trackEntity(entityId, {
            source: EntitySource.EXALTED_SCENES,
            name: char.name,
            img: char.thumbnail || char.image || 'icons/svg/mystery-man.svg',
            linkedActorId: char.actorId || null,
          });
          await store.loadESCharacterNeeds(entityId);
        }
      },
      async untrack(entityId) {
        if (!game.user.isGM) {
          ui.notifications.warn('MORTAL_NEEDS.Notifications.GMOnly', { localize: true });
          return;
        }

        const entityInfo = store.getTrackedEntityInfo(entityId);
        store.untrackEntity(entityId);

        if (entityInfo?.source === EntitySource.ACTOR) {
          const trackedIds = (game.settings.get(MODULE_ID, 'trackedActors') || []).filter(id => id !== entityId);
          await game.settings.set(MODULE_ID, 'trackedActors', trackedIds);
        } else if (entityInfo?.source === EntitySource.EXALTED_SCENES) {
          const esData = game.settings.get(MODULE_ID, 'esCharacterNeeds') || {};
          delete esData[entityId];
          await game.settings.set(MODULE_ID, 'esCharacterNeeds', esData);
        }
      },
      isTracked(entityId) {
        return store.isTracked(entityId);
      },
    },

    // --- Registration (for external modules) ---
    register: {
      need(config) {
        return store.registerNeed(config);
      },
      unregisterNeed(needId) {
        return store.unregisterNeed(needId);
      },
      consequenceType(type, ConsequenceTypeClass) {
        registerConsequenceType(type, ConsequenceTypeClass);
      },
      callback(id, callbackDef) {
        CustomCallbackConsequence.registerCallback(id, callbackDef);
      },
      preset(presetDef) {
        configManager.registerExternalPreset(presetDef);
        eventBus.emit(Events.PRESET_REGISTERED, { preset: presetDef });
      },
    },

    // --- Events ---
    events: {
      on(event, callback) {
        return eventBus.on(event, callback);
      },
      off(event, callback) {
        return eventBus.off(event, callback);
      },
      once(event, callback) {
        return eventBus.once(event, callback);
      },
      // Event name constants for convenience
      ...Events,
    },

    // --- Queries ---
    query: {
      actorsAboveThreshold(needId, threshold = 80) {
        const tracked = store.getAllTrackedActors();
        return tracked.filter(entity => {
          const need = entity.needs[needId];
          if (!need) return false;
          const pct = need.max > 0 ? Math.round((need.value / need.max) * 100) : 0;
          return pct >= threshold;
        });
      },
      actorsWithSeverity(needId, severity) {
        const tracked = store.getAllTrackedActors();
        return tracked.filter(entity => {
          const need = entity.needs[needId];
          if (!need) return false;
          const pct = need.max > 0 ? Math.round((need.value / need.max) * 100) : 0;
          const sev = api.query._getSeverity(pct);
          return sev === severity;
        });
      },
      criticalActors() {
        const critThreshold = game.settings?.get?.(MODULE_ID, 'criticalThreshold') ?? 80;
        const tracked = store.getAllTrackedActors();
        return tracked.filter(entity => {
          return Object.values(entity.needs).some(need => {
            const pct = need.max > 0 ? Math.round((need.value / need.max) * 100) : 0;
            return pct >= critThreshold;
          });
        });
      },
      needHistory(entityId, needId, limit) {
        return store.getHistory(entityId, needId, limit);
      },
      allHistory(limit) {
        return store.getAllHistory(limit);
      },
      _getSeverity(pct) {
        if (pct >= 80) return Severity.CRITICAL;
        if (pct >= 60) return Severity.HIGH;
        if (pct >= 40) return Severity.MEDIUM;
        if (pct >= 20) return Severity.LOW;
        return Severity.SAFE;
      },
    },

    // --- UI ---
    ui: {
      toggle() {
        app.toggle();
      },
      show() {
        if (app.ui && !app.ui.rendered) {
          app.ui.render(true);
        }
      },
      hide() {
        if (app.ui?.rendered) {
          app.ui.close();
        }
      },
      refresh() {
        if (app.ui?.rendered) {
          app.ui.render(false);
        }
      },
    },

    // --- System Info ---
    system: {
      get id() {
        return adapter.constructor.systemId;
      },
      get capabilities() {
        return adapter.getCapabilities();
      },
      get availableAttributes() {
        return adapter.getAvailableAttributes();
      },
      get availableConditions() {
        return adapter.getAvailableConditions();
      },
      get availableDamageTypes() {
        return adapter.getAvailableDamageTypes?.() || [];
      },
    },

    // --- Macro Helpers ---
    macro: {
      async stressParty(needId, amount) {
        return engine.stressAll(needId, amount);
      },
      async restParty(needAmounts) {
        const entities = store.getTrackedEntityIds();
        const promises = [];
        for (const entityId of entities) {
          for (const { needId, amount } of needAmounts) {
            promises.push(engine.relieveNeed(entityId, needId, amount));
          }
        }
        return Promise.all(promises);
      },
      async longRest() {
        const entities = store.getTrackedEntityIds();
        for (const entityId of entities) {
          await engine.resetAll(entityId);
        }
      },
      async shortRest(reliefPercentage = 25) {
        const entities = store.getTrackedEntityIds();
        const configs = store.getEnabledNeedConfigs();
        for (const entityId of entities) {
          for (const config of configs) {
            const current = store.getActorNeedState(entityId, config.id);
            if (current && current.value > 0) {
              const relief = Math.round(config.max * (reliefPercentage / 100));
              await engine.relieveNeed(entityId, config.id, relief);
            }
          }
        }
      },
      async setSceneModifier(needId, modifiers) {
        const scene = game.scenes?.active;
        if (!scene || !game.user.isGM) return;
        const current = scene.getFlag(MODULE_ID, 'modifiers') || {};
        current[needId] = { ...current[needId], ...modifiers };
        await scene.setFlag(MODULE_ID, 'modifiers', current);
      },
    },

    // --- Consequences ---
    consequences: {
      getAllTypes() {
        return getAllConsequenceTypes();
      },
      getType(type) {
        return getConsequenceType(type);
      },
      async apply(entityId, needId, consequenceConfig) {
        const entityInfo = store.getTrackedEntityInfo(entityId);
        if (!entityInfo) return;
        const actor = entityInfo.source === EntitySource.ACTOR
          ? game.actors.get(entityId)
          : entityInfo.linkedActorId
            ? game.actors.get(entityInfo.linkedActorId)
            : null;
        return consequenceEngine.applyConsequence(actor, entityId, needId, consequenceConfig);
      },
      async remove(entityId, needId, consequenceConfig) {
        const entityInfo = store.getTrackedEntityInfo(entityId);
        if (!entityInfo) return;
        const actor = entityInfo.source === EntitySource.ACTOR
          ? game.actors.get(entityId)
          : entityInfo.linkedActorId
            ? game.actors.get(entityInfo.linkedActorId)
            : null;
        return consequenceEngine.removeConsequence(actor, entityId, needId, consequenceConfig);
      },
    },

    // --- Broadcast (Show/Flash to Players) ---
    broadcast: {
      show() {
        if (!game.user.isGM) return;
        const payload = api.broadcast._buildPayload();
        game.socket.emit(`module.${MODULE_ID}`, {
          action: 'showNeeds',
          senderId: game.user.id,
          ...payload,
        });
        Hooks.callAll('mortalNeeds.broadcast.show', payload);
      },
      update() {
        if (!game.user.isGM) return;
        const payload = api.broadcast._buildPayload();
        game.socket.emit(`module.${MODULE_ID}`, {
          action: 'updateNeeds',
          senderId: game.user.id,
          ...payload,
        });
        Hooks.callAll('mortalNeeds.broadcast.update', payload);
      },
      hide() {
        if (!game.user.isGM) return;
        game.socket.emit(`module.${MODULE_ID}`, {
          action: 'hideNeeds',
          senderId: game.user.id,
        });
        Hooks.callAll('mortalNeeds.broadcast.hide', {});
      },
      flash() {
        if (!game.user.isGM) return;
        const payload = api.broadcast._buildPayload();
        game.socket.emit(`module.${MODULE_ID}`, {
          action: 'flashNeeds',
          senderId: game.user.id,
          ...payload,
        });
        Hooks.callAll('mortalNeeds.broadcast.flash', payload);
      },
      _buildPayload() {
        const tracked = store.getAllTrackedActors();
        const enabledNeeds = store.getEnabledNeedConfigs();
        return {
          needsData: {
            actors: tracked.map(e => ({
              id: e.id,
              name: e.name,
              img: e.img,
              needs: e.needs,
            })),
            needs: enabledNeeds.map(n => ({
              id: n.id,
              label: n.label,
              icon: n.icon,
              max: n.max,
            })),
          },
        };
      },
    },

    // --- Constants ---
    constants: {
      Events,
      Severity,
      NeedCategory,
      EntitySource,
    },
  };

  return Object.freeze(api);
}

import { MODULE_ID, Events, Severity, NeedCategory, EntitySource } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';
import { filterDisplayNeedsForEntity, filterNeedsForUser, isNeedVisibleToUser } from '../core/need-visibility.js';
import { registerConsequenceType, getAllConsequenceTypes, getConsequenceType } from '../consequences/consequence-type.js';
import { CustomCallbackConsequence } from '../consequences/custom-callback.js';

export function createPublicAPI(store, engine, consequenceEngine, eventBus, configManager, adapter, app) {
  const publicUser = Object.freeze({ isGM: false });
  const getCurrentUser = () => globalThis.game?.user;
  const canAccessNeed = needId => isNeedVisibleToUser(store.getNeedConfig(needId), getCurrentUser());
  const filterEntityForUser = (entity, user = getCurrentUser()) => {
    if (!entity) return entity;
    const visibleNeedIds = new Set(filterNeedsForUser(store.getAllNeedConfigs(), user).map(config => config.id));
    const needs = {};
    for (const [needId, state] of Object.entries(entity.needs || {})) {
      if (visibleNeedIds.has(needId)) needs[needId] = state;
    }
    return { ...entity, needs };
  };
  const filterHistoryForUser = entries => {
    const visibleNeedIds = new Set(filterNeedsForUser(store.getAllNeedConfigs(), getCurrentUser()).map(config => config.id));
    return entries.filter(entry => visibleNeedIds.has(entry.needId));
  };

  const api = {
    version: '2.3.1',

    // --- Needs ---
    needs: {
      async stress(entityId, needId, amount) {
        if (!canAccessNeed(needId)) return null;
        return engine.stressNeed(entityId, needId, amount);
      },
      async relieve(entityId, needId, amount) {
        if (!canAccessNeed(needId)) return null;
        return engine.relieveNeed(entityId, needId, amount);
      },
      async set(entityId, needId, value, options) {
        if (!canAccessNeed(needId)) return null;
        return engine.setNeed(entityId, needId, value, options);
      },
      get(entityId, needId) {
        if (!canAccessNeed(needId)) return null;
        return store.getActorNeedState(entityId, needId);
      },
      getAll(entityId) {
        const entityInfo = store.getTrackedEntityInfo(entityId);
        return filterEntityForUser({
          id: entityId,
          needs: store.getActorAllNeeds(entityId) || {},
          ...(entityInfo || {}),
        }).needs;
      },
      async reset(entityId, needId) {
        if (!canAccessNeed(needId)) return null;
        return engine.resetNeed(entityId, needId);
      },
      async resetAll(entityId) {
        if (!game.user?.isGM) {
          const configs = filterNeedsForUser(store.getEnabledNeedConfigs(), getCurrentUser());
          for (const config of configs) {
            await engine.resetNeed(entityId, config.id);
          }
          return true;
        }
        return engine.resetAll(entityId);
      },
    },

    // --- Batch Operations ---
    batch: {
      async stressAll(needId, amount, options) {
        if (!canAccessNeed(needId)) return null;
        return engine.stressAll(needId, amount, options);
      },
      async relieveAll(needId, amount, options) {
        if (!canAccessNeed(needId)) return null;
        return engine.relieveAll(needId, amount, options);
      },
      async stressMultiple(entityIds, needAmounts, options) {
        const visibleAmounts = (needAmounts || []).filter(entry => canAccessNeed(entry.needId));
        if (!visibleAmounts.length) return null;
        return engine.stressMultiple(entityIds, visibleAmounts, options);
      },
      async relieveMultiple(entityIds, needAmounts, options) {
        const visibleAmounts = (needAmounts || []).filter(entry => canAccessNeed(entry.needId));
        if (!visibleAmounts.length) return null;
        return engine.relieveMultiple(entityIds, visibleAmounts, options);
      },
    },

    // --- Configuration ---
    config: {
      getNeedConfig(needId) {
        const config = store.getNeedConfig(needId);
        return isNeedVisibleToUser(config, getCurrentUser()) ? config : null;
      },
      getEnabledNeeds() {
        return filterNeedsForUser(store.getEnabledNeedConfigs(), getCurrentUser());
      },
      getAllNeeds() {
        return filterNeedsForUser(store.getAllNeedConfigs(), getCurrentUser());
      },
      enableNeed(needId) {
        if (!game.user?.isGM) return null;
        return store.enableNeed(needId);
      },
      disableNeed(needId) {
        if (!game.user?.isGM) return null;
        return store.disableNeed(needId);
      },
      updateNeedConfig(needId, changes) {
        if (!game.user?.isGM) return null;
        return store.updateNeedConfig(needId, changes);
      },
      exportConfig() {
        return configManager.exportConfig(filterNeedsForUser(store.getAllNeedConfigs(), getCurrentUser()));
      },
      async importConfig(json) {
        if (!game.user?.isGM) return null;
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
        return store.getAllTrackedActors().map(entity => filterEntityForUser(entity));
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
        if (!canAccessNeed(needId)) return [];
        const config = store.getNeedConfig(needId);
        const tracked = store.getAllTrackedActors();
        return tracked.filter(entity => {
          const need = entity.needs[needId];
          if (!need) return false;
          const pct = NeedsEngine.getStressPercentage(need.value, need.max, config);
          return pct >= threshold;
        });
      },
      actorsWithSeverity(needId, severity) {
        if (!canAccessNeed(needId)) return [];
        const config = store.getNeedConfig(needId);
        const tracked = store.getAllTrackedActors();
        return tracked.filter(entity => {
          const need = entity.needs[needId];
          if (!need) return false;
          const pct = NeedsEngine.getStressPercentage(need.value, need.max, config);
          const sev = api.query._getSeverity(pct);
          return sev === severity;
        });
      },
      criticalActors() {
        const critThreshold = game.settings?.get?.(MODULE_ID, 'criticalThreshold') ?? 80;
        const tracked = store.getAllTrackedActors().map(entity => filterEntityForUser(entity));
        return tracked.filter(entity => {
          return Object.entries(entity.needs).some(([needId, need]) => {
            const config = store.getNeedConfig(needId);
            const pct = NeedsEngine.getStressPercentage(need.value, need.max, config);
            return pct >= critThreshold;
          });
        });
      },
      needHistory(entityId, needId, limit) {
        if (needId && !canAccessNeed(needId)) return [];
        return filterHistoryForUser(store.getHistory(entityId, needId, limit));
      },
      allHistory(limit) {
        return filterHistoryForUser(store.getAllHistory(limit));
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
      get effectSuggestions() {
        return adapter.getEffectSuggestions();
      },
    },

    // --- Macro Helpers ---
    macro: {
      async stressParty(needId, amount) {
        if (!canAccessNeed(needId)) return null;
        return engine.stressAll(needId, amount);
      },
      async restParty(needAmounts) {
        const entities = store.getTrackedEntityIds();
        const visibleAmounts = (needAmounts || []).filter(entry => canAccessNeed(entry.needId));
        const promises = [];
        for (const entityId of entities) {
          for (const { needId, amount } of visibleAmounts) {
            promises.push(engine.relieveNeed(entityId, needId, amount));
          }
        }
        return Promise.all(promises);
      },
      async longRest() {
        const entities = store.getTrackedEntityIds();
        for (const entityId of entities) {
          await api.needs.resetAll(entityId);
        }
      },
      async shortRest(reliefPercentage = 25) {
        const entities = store.getTrackedEntityIds();
        const configs = filterNeedsForUser(store.getEnabledNeedConfigs(), getCurrentUser());
        for (const entityId of entities) {
          for (const config of configs) {
            const current = store.getActorNeedState(entityId, config.id);
            const canRecover = NeedsEngine.isInvertedNeed(config)
              ? current && current.value < current.max
              : current && current.value > current.min;
            if (canRecover) {
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
        if (!canAccessNeed(needId)) return null;
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
        if (!canAccessNeed(needId)) return null;
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
        const enabledNeeds = filterNeedsForUser(store.getEnabledNeedConfigs(), publicUser);
        const usedNeedConfigs = new Map();
        const actors = tracked.map(entity => {
          const displayConfigs = filterDisplayNeedsForEntity(enabledNeeds, entity.needs, { user: publicUser });
          const needs = {};
          for (const config of displayConfigs) {
            if (!entity.needs?.[config.id]) continue;
            needs[config.id] = entity.needs[config.id];
            usedNeedConfigs.set(config.id, config);
          }
          return {
            id: entity.id,
            name: entity.name,
            img: entity.img,
            needs,
          };
        }).filter(entity => Object.keys(entity.needs).length > 0);

        return {
          needsData: {
            actors,
            needs: enabledNeeds.filter(n => usedNeedConfigs.has(n.id)).map(n => ({
              id: n.id,
              label: n.label,
              icon: n.icon,
              color: n.color || null,
              order: n.order ?? 0,
              min: n.min ?? 0,
              max: n.max,
              default: n.default ?? 0,
              inverted: n.inverted === true,
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

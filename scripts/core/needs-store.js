import { MODULE_ID, Events, EntitySource } from '../constants.js';

export class NeedsStore {
  #state = new Map();
  #needConfigs = [];
  #trackedEntities = new Map();
  #eventBus;
  #dirty = new Set();
  #history = new Map();
  #maxHistoryPerEntity = 100;

  constructor(eventBus) {
    this.#eventBus = eventBus;
  }

  // --- State Access (read-only copies) ---

  getActorNeedState(entityId, needId) {
    const entityNeeds = this.#state.get(entityId);
    if (!entityNeeds) return null;
    const state = entityNeeds.get(needId);
    return state ? { ...state } : null;
  }

  getActorAllNeeds(entityId) {
    const entityNeeds = this.#state.get(entityId);
    if (!entityNeeds) return null;
    const result = {};
    for (const [needId, state] of entityNeeds) {
      result[needId] = { ...state };
    }
    return result;
  }

  getAllTrackedActors() {
    const results = [];
    for (const [entityId, entityInfo] of this.#trackedEntities) {
      const needs = this.getActorAllNeeds(entityId) || {};
      results.push({
        id: entityId,
        source: entityInfo.source,
        name: entityInfo.name,
        img: entityInfo.img,
        linkedActorId: entityInfo.linkedActorId || null,
        needs,
      });
    }
    return results;
  }

  getTrackedEntityInfo(entityId) {
    const info = this.#trackedEntities.get(entityId);
    return info ? { ...info } : null;
  }

  getNeedConfig(needId) {
    const config = this.#needConfigs.find(c => c.id === needId);
    return config ? { ...config } : null;
  }

  getEnabledNeedConfigs() {
    return this.#needConfigs.filter(c => c.enabled).map(c => ({ ...c }));
  }

  getAllNeedConfigs() {
    return this.#needConfigs.map(c => ({ ...c }));
  }

  // --- State Mutations ---

  setNeedValue(entityId, needId, value, source = 'manual') {
    let entityNeeds = this.#state.get(entityId);
    if (!entityNeeds) {
      entityNeeds = new Map();
      this.#state.set(entityId, entityNeeds);
    }

    const config = this.getNeedConfig(needId);
    const min = config?.min ?? 0;
    const max = config?.max ?? 100;
    const clamped = Math.max(min, Math.min(max, Math.round(value)));

    const previous = entityNeeds.get(needId);
    const previousValue = previous?.value ?? 0;

    const newState = {
      value: clamped,
      min, max,
      lastChange: Date.now(),
      source,
    };
    entityNeeds.set(needId, newState);
    this.#dirty.add(entityId);

    // Record history
    this.#recordHistory(entityId, needId, previousValue, clamped, source);

    return { ...newState, previousValue };
  }

  adjustNeedValue(entityId, needId, delta, source = 'manual') {
    const current = this.getActorNeedState(entityId, needId);
    const currentValue = current?.value ?? 0;
    return this.setNeedValue(entityId, needId, currentValue + delta, source);
  }

  // --- Configuration Mutations ---

  setNeedConfigs(configs) {
    this.#needConfigs = configs.map(c => ({ ...c }));
  }

  updateNeedConfig(needId, changes) {
    const idx = this.#needConfigs.findIndex(c => c.id === needId);
    if (idx === -1) return null;
    this.#needConfigs[idx] = { ...this.#needConfigs[idx], ...changes };
    this.#eventBus.emit(Events.CONFIG_CHANGED, { needId, changes });
    return { ...this.#needConfigs[idx] };
  }

  registerNeed(config) {
    if (this.#needConfigs.find(c => c.id === config.id)) {
      console.warn(`Mortal Needs | Need "${config.id}" already registered`);
      return null;
    }
    const fullConfig = {
      min: 0, max: 100, default: 0, enabled: true, custom: true,
      iconType: 'fa', category: 'custom', order: this.#needConfigs.length,
      stressAmount: 10, attribute: null, consequences: [],
      decay: { enabled: false, rate: 5, interval: 3600 },
      flavor: { apply: [], remove: [] },
      ...config,
    };
    this.#needConfigs.push(fullConfig);

    // Initialize for all tracked entities
    for (const [entityId] of this.#trackedEntities) {
      this.setNeedValue(entityId, fullConfig.id, fullConfig.default, 'registration');
    }

    this.#eventBus.emit(Events.NEED_REGISTERED, { config: { ...fullConfig } });
    return { ...fullConfig };
  }

  unregisterNeed(needId) {
    const idx = this.#needConfigs.findIndex(c => c.id === needId);
    if (idx === -1) return;
    const config = this.#needConfigs[idx];
    if (!config.custom) {
      console.warn(`Mortal Needs | Cannot unregister built-in need "${needId}"`);
      return;
    }
    this.#needConfigs.splice(idx, 1);

    // Remove from all entity states
    for (const [entityId, entityNeeds] of this.#state) {
      entityNeeds.delete(needId);
      this.#dirty.add(entityId);
    }

    this.#eventBus.emit(Events.NEED_UNREGISTERED, { needId });
  }

  enableNeed(needId) {
    const updated = this.updateNeedConfig(needId, { enabled: true });
    if (updated) this.#eventBus.emit(Events.NEED_ENABLED, { needId });
    return updated;
  }

  disableNeed(needId) {
    const updated = this.updateNeedConfig(needId, { enabled: false });
    if (updated) this.#eventBus.emit(Events.NEED_DISABLED, { needId });
    return updated;
  }

  // --- Entity Tracking ---

  trackEntity(entityId, entityInfo) {
    this.#trackedEntities.set(entityId, { ...entityInfo });

    // Initialize needs if not already present
    if (!this.#state.has(entityId)) {
      const entityNeeds = new Map();
      for (const config of this.#needConfigs) {
        entityNeeds.set(config.id, {
          value: config.default ?? 0,
          min: config.min ?? 0,
          max: config.max ?? 100,
          lastChange: Date.now(),
          source: 'initialization',
        });
      }
      this.#state.set(entityId, entityNeeds);
      this.#dirty.add(entityId);
    }

    this.#eventBus.emit(Events.ACTOR_TRACKED, { entityId, entityInfo: { ...entityInfo } });
  }

  untrackEntity(entityId) {
    this.#trackedEntities.delete(entityId);
    this.#state.delete(entityId);
    this.#history.delete(entityId);
    this.#dirty.delete(entityId);
    this.#eventBus.emit(Events.ACTOR_UNTRACKED, { entityId });
  }

  isTracked(entityId) {
    return this.#trackedEntities.has(entityId);
  }

  getTrackedEntityIds() {
    return [...this.#trackedEntities.keys()];
  }

  getTrackedEntitiesBySource(source) {
    return [...this.#trackedEntities.entries()]
      .filter(([, info]) => info.source === source)
      .map(([id, info]) => ({ id, ...info }));
  }

  // --- Persistence (Foundry Actors) ---

  async loadActorNeeds(actor) {
    const saved = actor.getFlag(MODULE_ID, 'needs') || {};
    const entityNeeds = new Map();

    for (const config of this.#needConfigs) {
      const savedValue = saved[config.id];
      entityNeeds.set(config.id, {
        value: savedValue ?? config.default ?? 0,
        min: config.min ?? 0,
        max: config.max ?? 100,
        lastChange: Date.now(),
        source: 'load',
      });
    }

    this.#state.set(actor.id, entityNeeds);
  }

  async persistActor(entityId) {
    const entityInfo = this.#trackedEntities.get(entityId);
    if (!entityInfo) return;

    const entityNeeds = this.#state.get(entityId);
    if (!entityNeeds) return;

    const data = {};
    for (const [needId, state] of entityNeeds) {
      data[needId] = state.value;
    }

    if (entityInfo.source === EntitySource.ACTOR) {
      const actor = game.actors.get(entityId);
      if (actor) {
        await actor.setFlag(MODULE_ID, 'needs', data);
      }
    } else if (entityInfo.source === EntitySource.EXALTED_SCENES) {
      // ES characters: store in world settings
      const esData = game.settings.get(MODULE_ID, 'esCharacterNeeds') || {};
      esData[entityId] = data;
      await game.settings.set(MODULE_ID, 'esCharacterNeeds', esData);
    }

    this.#dirty.delete(entityId);
  }

  async persistAllDirty() {
    const promises = [];
    for (const entityId of this.#dirty) {
      promises.push(this.persistActor(entityId));
    }
    await Promise.all(promises);
  }

  async persistConfig() {
    await game.settings.set(MODULE_ID, 'needsConfig', this.#needConfigs);
  }

  // --- Persistence (ES Characters) ---

  async loadESCharacterNeeds(characterId) {
    const allData = game.settings.get(MODULE_ID, 'esCharacterNeeds') || {};
    const saved = allData[characterId] || {};
    const entityNeeds = new Map();

    for (const config of this.#needConfigs) {
      const savedValue = saved[config.id];
      entityNeeds.set(config.id, {
        value: savedValue ?? config.default ?? 0,
        min: config.min ?? 0,
        max: config.max ?? 100,
        lastChange: Date.now(),
        source: 'load',
      });
    }

    this.#state.set(characterId, entityNeeds);
  }

  // --- Sync from Remote ---

  syncFromRemote(remoteState) {
    for (const [entityId, needs] of Object.entries(remoteState)) {
      let entityNeeds = this.#state.get(entityId);
      if (!entityNeeds) {
        entityNeeds = new Map();
        this.#state.set(entityId, entityNeeds);
      }
      for (const [needId, value] of Object.entries(needs)) {
        const config = this.getNeedConfig(needId);
        entityNeeds.set(needId, {
          value,
          min: config?.min ?? 0,
          max: config?.max ?? 100,
          lastChange: Date.now(),
          source: 'socket',
        });
      }
    }
    this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
  }

  // --- History ---

  #recordHistory(entityId, needId, previousValue, newValue, source) {
    if (previousValue === newValue) return;

    if (!this.#history.has(entityId)) {
      this.#history.set(entityId, []);
    }
    const entries = this.#history.get(entityId);
    entries.push({
      timestamp: Date.now(),
      needId,
      previousValue,
      newValue,
      source,
      entityId,
    });

    // Trim history
    if (entries.length > this.#maxHistoryPerEntity) {
      entries.splice(0, entries.length - this.#maxHistoryPerEntity);
    }
  }

  getHistory(entityId, needId, limit = 50) {
    const entries = this.#history.get(entityId) || [];
    let filtered = needId ? entries.filter(e => e.needId === needId) : entries;
    if (limit) filtered = filtered.slice(-limit);
    return filtered.map(e => ({ ...e }));
  }

  getAllHistory(limit = 200) {
    const all = [];
    for (const entries of this.#history.values()) {
      all.push(...entries);
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    return all.slice(-limit).map(e => ({ ...e }));
  }

  // --- Serialization helpers ---

  getSerializableState() {
    const result = {};
    for (const [entityId, entityNeeds] of this.#state) {
      result[entityId] = {};
      for (const [needId, state] of entityNeeds) {
        result[entityId][needId] = state.value;
      }
    }
    return result;
  }
}

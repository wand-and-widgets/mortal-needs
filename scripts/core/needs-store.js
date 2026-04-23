import { MODULE_ID, Events, EntitySource } from '../constants.js';

export class NeedsStore {
  #state = new Map();
  #needConfigs = [];
  #trackedEntities = new Map();
  #eventBus;
  #dirty = new Set();
  #history = new Map();
  #maxHistoryPerEntity = 120;
  #maxHistoryTotal = 500;
  #historyPersistQueued = false;

  constructor(eventBus) {
    this.#eventBus = eventBus;
    this.#loadPersistedHistory();
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
    const min = this.#normalizeNumber(config?.min, 0);
    const max = this.#normalizeMax(config?.max, min);
    const fallback = this.#normalizeNumber(config?.default, min);
    const numericValue = this.#normalizeNeedValue(value, fallback);
    const clamped = Math.max(min, Math.min(max, Math.round(numericValue)));

    const previous = entityNeeds.get(needId);
    const previousValue = this.#normalizeNeedValue(previous?.value, 0);

    const newState = {
      value: clamped,
      min, max,
      lastChange: Date.now(),
      source,
    };
    entityNeeds.set(needId, newState);
    this.#dirty.add(entityId);

    // Record history
    this.#recordHistory(entityId, needId, previousValue, clamped, source, { min, max });

    return { ...newState, previousValue };
  }

  adjustNeedValue(entityId, needId, delta, source = 'manual') {
    const current = this.getActorNeedState(entityId, needId);
    const currentValue = this.#normalizeNeedValue(current?.value, 0);
    const safeDelta = this.#normalizeNumber(delta, 0);
    return this.setNeedValue(entityId, needId, currentValue + safeDelta, source);
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
        entityNeeds.set(config.id, this.#buildNeedState(config, config.default, 'initialization'));
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
    this.#persistHistorySoon();
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
      entityNeeds.set(config.id, this.#buildNeedState(config, savedValue, 'load'));
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
      entityNeeds.set(config.id, this.#buildNeedState(config, savedValue, 'load'));
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
        entityNeeds.set(needId, this.#buildNeedState(config, value, 'socket'));
      }
    }
    this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
  }

  // --- History ---

  #recordHistory(entityId, needId, previousValue, newValue, source, bounds = {}) {
    if (previousValue === newValue) return;

    if (!this.#history.has(entityId)) {
      this.#history.set(entityId, []);
    }
    const entries = this.#history.get(entityId);
    const timestamp = Date.now();
    const entry = {
      id: `${timestamp}-${entityId}-${needId}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp,
      needId,
      previousValue,
      newValue,
      min: bounds.min ?? 0,
      max: bounds.max ?? 100,
      source,
      entityId,
    };
    entries.push(entry);

    this.#trimHistory();
    this.#persistHistorySoon();
    this.#eventBus.emit(Events.HISTORY_UPDATED, {
      entry: { ...entry },
      total: this.getAllHistory(0).length,
    });
  }

  getHistory(entityId, needId, limit = 50) {
    const entries = this.#history.get(entityId) || [];
    let filtered = needId ? entries.filter(e => e.needId === needId) : entries;
    if (limit && limit > 0) filtered = filtered.slice(-limit);
    return filtered.map(e => ({ ...e }));
  }

  getAllHistory(limit = 200) {
    const all = [];
    for (const entries of this.#history.values()) {
      all.push(...entries);
    }
    all.sort((a, b) => a.timestamp - b.timestamp);
    const filtered = limit && limit > 0 ? all.slice(-limit) : all;
    return filtered.map(e => ({ ...e }));
  }

  clearHistory(entityId = null) {
    if (entityId) {
      this.#history.delete(entityId);
    } else {
      this.#history.clear();
    }

    this.#persistHistorySoon();
    this.#eventBus.emit(Events.HISTORY_CLEARED, { entityId });
    this.#eventBus.emit(Events.HISTORY_UPDATED, {
      cleared: true,
      entityId,
      total: this.getAllHistory(0).length,
    });
  }

  #loadPersistedHistory() {
    try {
      if (typeof game === 'undefined' || !game.settings?.get) return;
      const saved = game.settings?.get?.(MODULE_ID, 'needsHistory');
      const rawEntries = Array.isArray(saved) ? saved : saved?.entries;
      if (!Array.isArray(rawEntries)) return;

      for (const raw of rawEntries) {
        const entry = this.#normalizeHistoryEntry(raw);
        if (!entry) continue;

        if (!this.#history.has(entry.entityId)) {
          this.#history.set(entry.entityId, []);
        }
        this.#history.get(entry.entityId).push(entry);
      }

      this.#trimHistory();
    } catch (err) {
      console.warn('Mortal Needs | Failed to load persisted history:', err);
    }
  }

  #normalizeHistoryEntry(raw) {
    if (!raw || !raw.entityId || !raw.needId) return null;

    const timestamp = Number(raw.timestamp);
    const previousValue = Number(raw.previousValue);
    const newValue = Number(raw.newValue);
    if (!Number.isFinite(timestamp) || !Number.isFinite(previousValue) || !Number.isFinite(newValue)) {
      return null;
    }

    return {
      id: raw.id || `${timestamp}-${raw.entityId}-${raw.needId}`,
      timestamp,
      entityId: String(raw.entityId),
      needId: String(raw.needId),
      previousValue,
      newValue,
      min: Number.isFinite(Number(raw.min)) ? Number(raw.min) : 0,
      max: Number.isFinite(Number(raw.max)) ? Number(raw.max) : 100,
      source: raw.source || 'manual',
    };
  }

  #trimHistory() {
    for (const entries of this.#history.values()) {
      entries.sort((a, b) => a.timestamp - b.timestamp);
      if (entries.length > this.#maxHistoryPerEntity) {
        entries.splice(0, entries.length - this.#maxHistoryPerEntity);
      }
    }

    const all = this.getAllHistory(0);
    if (all.length <= this.#maxHistoryTotal) return;

    const keepIds = new Set(all.slice(-this.#maxHistoryTotal).map(entry => entry.id));
    for (const [entityId, entries] of this.#history) {
      const kept = entries.filter(entry => keepIds.has(entry.id));
      if (kept.length) {
        this.#history.set(entityId, kept);
      } else {
        this.#history.delete(entityId);
      }
    }
  }

  #persistHistorySoon() {
    if (typeof game === 'undefined') return;
    if (!game.user?.isGM) return;
    if (this.#historyPersistQueued) return;

    this.#historyPersistQueued = true;
    setTimeout(async () => {
      this.#historyPersistQueued = false;
      try {
        await game.settings.set(MODULE_ID, 'needsHistory', {
          version: 1,
          entries: this.getAllHistory(this.#maxHistoryTotal),
        });
      } catch (err) {
        console.warn('Mortal Needs | Failed to persist history:', err);
      }
    }, 75);
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

  #buildNeedState(config, rawValue, source) {
    const min = this.#normalizeNumber(config?.min ?? rawValue?.min, 0);
    const max = this.#normalizeMax(config?.max ?? rawValue?.max, min);
    const fallback = this.#normalizeNumber(config?.default, min);
    const value = Math.max(min, Math.min(max, Math.round(this.#normalizeNeedValue(rawValue, fallback))));

    return {
      value,
      min,
      max,
      lastChange: this.#normalizeTimestamp(rawValue?.lastChange, Date.now()),
      source,
    };
  }

  #normalizeNeedValue(value, fallback = 0) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return this.#normalizeNumber(value.value, fallback);
    }
    return this.#normalizeNumber(value, fallback);
  }

  #normalizeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  #normalizeMax(value, min = 0) {
    const max = this.#normalizeNumber(value, 100);
    return max > min ? max : Math.max(min + 1, 100);
  }

  #normalizeTimestamp(value, fallback) {
    const timestamp = Number(value);
    return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : fallback;
  }
}

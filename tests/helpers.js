import { MODULE_ID } from '../scripts/constants.js';

export const getProperty = (obj, path) => path.split('.').reduce((value, key) => value?.[key], obj);
export function setProperty(obj, path, value) {
  const parts = path.split('.');
  const key = parts.pop();
  for (const part of parts) obj = obj[part] ??= {};
  if (key.startsWith('-=')) delete obj[key.slice(2)];
  else if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Set)) {
    obj[key] ??= {};
    applyUpdates(obj[key], value);
  } else obj[key] = structuredClone(value);
}
function applyUpdates(target, changes) {
  for (const [path, value] of Object.entries(changes)) setProperty(target, path, value);
}

export class MockActor {
  constructor(id = 'actor1', system = { attributes: { hp: { value: 20 }, movement: { walk: 30 } } }) {
    this.id = id;
    this.name = `Character ${id}`;
    this.uuid = `Actor.${id}`;
    this._source = { system: structuredClone(system), flags: {} };
    this.system = this._source.system;
    this.flags = this._source.flags;
    this.effects = [];
    this.items = [];
    this.writes = [];
    this.owners = ['player'];
    this.delay = 0;
  }
  getFlag(scope, path) { return getProperty(this.flags[scope], path); }
  setFlag(scope, path, value) { return this.update({ [`flags.${scope}.${path}`]: value }); }
  unsetFlag(scope, path) {
    const parts = path.split('.');
    const last = parts.pop();
    return this.update({ [`flags.${scope}.${parts.length ? parts.join('.') + '.' : ''}-=${last}`]: null });
  }
  testUserPermission(user) { return user.isGM || this.owners.includes(user.id); }
  async update(changes) {
    if (this.delay) await new Promise(resolve => setTimeout(resolve, this.delay));
    if (this.failWrites) throw new Error('document-write-rejected');
    this.writes.push(structuredClone(changes));
    applyUpdates(this._source, changes);
    return this;
  }
  async createEmbeddedDocuments(type, data) {
    return data.map(source => {
      const effect = new MockEffect(this, source);
      this.effects.push(effect);
      return effect;
    });
  }
  async toggleStatusEffect(statusId) {
    if (!this.effects.some(effect => effect.statuses.has(statusId))) {
      return this.createEmbeddedDocuments('ActiveEffect', [{ name: statusId, statuses: [statusId] }]);
    }
  }
}
let nextEffect = 0;
export class MockEffect {
  constructor(actor, data) {
    this.id = `effect${++nextEffect}`;
    this.parent = actor;
    Object.assign(this, structuredClone(data));
    this.flags ||= {};
    this.statuses = new Set(data.statuses || []);
    this.disabled ??= false;
  }
  getFlag(scope, key) { return getProperty(this.flags[scope], key); }
  async update(changes) { applyUpdates(this, changes); return this; }
  setFlag(scope, key, value) { return this.update({ [`flags.${scope}.${key}`]: value }); }
  async delete() { this.parent.effects.splice(this.parent.effects.indexOf(this), 1); }
}

export function environment() {
  const values = new Map(Object.entries({
    playerVisibility: 'own', playerControl: false, criticalThreshold: 80,
    consequenceRemovalMode: 'immediate', needsHistory: { entries: [] },
    needsConfig: [], esCharacterNeeds: {}, defaultStressAmount: 10,
  }));
  const gm = { id: 'gm', isGM: true, active: true };
  const gm2 = { id: 'gm2', isGM: true, active: true };
  const player = { id: 'player', isGM: false, active: true };
  const users = [gm, gm2, player];
  users.activeGM = gm;
  const hookListeners = new Map();
  const hooks = [];
  globalThis.Hooks = {
    on(name, fn) { const list = hookListeners.get(name) || []; list.push(fn); hookListeners.set(name, list); return fn; },
    off() {},
    callAll(name, data) { hooks.push({ name, data }); for (const fn of hookListeners.get(name) || []) fn(data); },
  };
  globalThis.game = {
    user: gm, users, actors: new Map(), scenes: { active: null },
    settings: { get: (scope, key) => values.get(key), set: async (scope, key, value) => values.set(key, structuredClone(value)) },
    i18n: { localize: text => text, format: (text, data) => text + JSON.stringify(data) },
    time: { worldTime: 0 }, modules: new Map(), system: { id: 'test' },
  };
  globalThis.foundry = { utils: { getProperty, deepClone: structuredClone } };
  globalThis.CONFIG = { statusEffects: [{ id: 'fatigued', name: 'Fatigued' }] };
  const warnings = [];
  globalThis.ui = { notifications: { warn: text => warnings.push(text), error: text => warnings.push(text) } };
  return { values, gm, gm2, player, hooks, warnings, MODULE_ID };
}

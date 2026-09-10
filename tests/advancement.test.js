import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { EventBus } from '../scripts/core/event-bus.js';
import { NeedsStore } from '../scripts/core/needs-store.js';
import { TimeEngine } from '../scripts/core/time-engine.js';
import { MovementEngine } from '../scripts/core/movement-engine.js';

let env, store, actor, calls, engine, bus;
beforeEach(() => {
  env = environment(); actor = new MockActor(); game.actors.set(actor.id, actor);
  globalThis.canvas = { scene: { grid: { size: 100, distance: 5 } } };
  bus = new EventBus(); store = new NeedsStore(bus);
  store.setNeedConfigs([{ id: 'hunger', enabled: true, decay: { enabled: true, rate: 5, interval: 60 },
    movement: { enabled: true, interval: 2, amount: 10, metric: 'spaces', countTeleports: false } }]);
  store.trackEntity(actor.id, { source: 'actor' }); calls = [];
  engine = { getSceneDecayMultiplier: () => 2, stressNeed: async (...args) => { calls.push(args); return { value: 10, previousValue: 0 }; } };
});
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

test('world time retains fractional intervals and applies scene-scaled decay once', async () => {
  const time = new TimeEngine(bus, store, engine); time.initialize();
  Hooks.callAll('updateWorldTime', 30, 30); await settle(); assert.equal(calls.length, 0);
  Hooks.callAll('updateWorldTime', 90, 60); await settle();
  assert.deepEqual(calls.map(args => args.slice(0, 3)), [[actor.id, 'hunger', 10]]);
  Hooks.callAll('updateWorldTime', 120, 30); await settle(); assert.equal(calls.length, 2);
  assert.equal(calls[0][3].skipSceneModifier, true);
});

test('rewinding time and a secondary GM cannot duplicate decay', async () => {
  const time = new TimeEngine(bus, store, engine); time.initialize();
  Hooks.callAll('updateWorldTime', -60, -60); await settle();
  game.user = env.gm2; Hooks.callAll('updateWorldTime', 60, 120); await settle();
  assert.equal(calls.length, 0);
});

test('movement consumes full intervals, saves remainder, and resumes it after loading', async () => {
  await actor.setFlag('mortal-needs', 'movementProgress', { hunger: { spaces: 1 } });
  const movement = new MovementEngine(bus, store, engine); movement.initialize();
  Hooks.callAll('moveToken', { actorId: actor.id, parent: canvas.scene }, { passed: { spaces: 4 } }, {}, env.gm); await settle();
  assert.deepEqual(calls[0].slice(0, 3), [actor.id, 'hunger', 20]);
  assert.equal(actor.getFlag('mortal-needs', 'movementProgress').hunger.spaces, 1);
});

test('teleports, paste, explicit ignore, untracked tokens, and secondary GMs do not advance needs', async () => {
  const movement = new MovementEngine(bus, store, engine); movement.initialize();
  const token = { actorId: actor.id, parent: canvas.scene };
  Hooks.callAll('moveToken', token, { passed: { spaces: 4, waypoints: [{ teleport: true }] } }, {}, env.gm);
  Hooks.callAll('moveToken', token, { method: 'paste', passed: { spaces: 4 } }, {}, env.gm);
  Hooks.callAll('moveToken', token, { passed: { spaces: 4 } }, { mortalNeedsIgnoreMovement: true }, env.gm);
  Hooks.callAll('moveToken', { actorId: 'untracked' }, { passed: { spaces: 4 } }, {}, env.gm); await settle();
  game.user = env.gm2; Hooks.callAll('moveToken', token, { passed: { spaces: 4 } }, {}, env.gm2); await settle();
  assert.equal(calls.length, 0);
});

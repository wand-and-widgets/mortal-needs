import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { EventBus, Events } from '../scripts/core/event-bus.js';
import { NeedsStore } from '../scripts/core/needs-store.js';
import { NeedsEngine } from '../scripts/core/needs-engine.js';
import { SystemAdapter } from '../scripts/adapters/system-adapter.js';

let env, actor, bus, store, engine;
beforeEach(() => {
  env = environment(); actor = new MockActor(); game.actors.set(actor.id, actor);
  bus = new EventBus(); store = new NeedsStore(bus);
  store.setNeedConfigs(['hunger', 'thirst', 'secret'].map(id => ({ id, enabled: true, min: 0, max: 100, default: 0, visibility: id === 'secret' ? 'gm' : 'all' })));
  store.trackEntity(actor.id, { source: 'actor', name: actor.name });
  engine = new NeedsEngine(store, bus, new SystemAdapter());
});

test('rapid adjustments to different needs preserve every committed value', async () => {
  actor.delay = 2;
  await Promise.all(Array.from({ length: 10 }, () => engine.stressNeed(actor.id, 'hunger', 1)).concat(engine.setNeed(actor.id, 'thirst', 75)));
  assert.equal(actor.getFlag('mortal-needs', 'needs').hunger, 10);
  assert.equal(actor.getFlag('mortal-needs', 'needs').thirst, 75);
  assert.equal(actor.writes.length, 11);
});
test('failed saves roll back local values and create neither history nor threshold events', async () => {
  actor.failWrites = true;
  const observed = [];
  bus.on(Events.THRESHOLD_CROSSED, event => observed.push(event));
  await assert.rejects(engine.setNeed(actor.id, 'hunger', 90), /rejected/);
  assert.equal(store.getActorNeedState(actor.id, 'hunger').value, 0);
  assert.equal(store.getHistory(actor.id).length, 0);
  assert.equal(observed.length, 0);
});
test('players edit only owned, visible needs when the GM enables control', async () => {
  game.user = env.player;
  assert.equal(await engine.setNeed(actor.id, 'hunger', 30), null);
  env.values.set('playerControl', true);
  await engine.setNeed(actor.id, 'hunger', 30);
  assert.equal(store.getActorNeedState(actor.id, 'hunger').value, 30);
  assert.equal(await engine.setNeed(actor.id, 'secret', 50), null);
  actor.owners = [];
  assert.equal(await engine.setNeed(actor.id, 'thirst', 60), null);
  assert.equal(actor.writes.length, 1);
});
test('trusted document ingestion evaluates a change once and repeated ingestion is quiet', async () => {
  const observed = [];
  bus.on(Events.THRESHOLD_CROSSED, event => observed.push(event));
  await actor.setFlag('mortal-needs', 'needs', { hunger: 85 });
  await engine.ingestActorNeeds(actor);
  await engine.ingestActorNeeds(actor);
  assert.equal(store.getActorNeedState(actor.id, 'hunger').value, 85);
  assert.equal(observed.length, 1);
});
test('critical entry and recovery use the same configured threshold', async () => {
  env.values.set('criticalThreshold', 70);
  const entries = [], recoveries = [];
  bus.on(Events.THRESHOLD_CRITICAL, event => entries.push(event));
  bus.on(Events.THRESHOLD_RECOVERED, event => recoveries.push(event));
  await engine.setNeed(actor.id, 'hunger', 70);
  await engine.setNeed(actor.id, 'hunger', 69);
  assert.equal(entries.length, 1);
  assert.equal(recoveries.length, 1);
});
test('inverted and nonzero-minimum ranges agree at their stress boundaries', () => {
  const config = { min: 20, max: 120 };
  assert.equal(NeedsEngine.getStressPercentage(20, 120, config), 0);
  assert.equal(NeedsEngine.getStressPercentage(70, 120, config), 50);
  assert.equal(NeedsEngine.getStressPercentage(120, 120, { ...config, inverted: true }), 0);
  assert.equal(NeedsEngine.getValueForStressPercentage(75, 120, { ...config, inverted: true }), 45);
});
test('a consequence callback can adjust another need without holding the write queue', async () => {
  let done;
  const complete = new Promise(resolve => { done = resolve; });
  bus.once(Events.NEED_SET, async () => { await engine.setNeed(actor.id, 'thirst', 25); done(); });
  await engine.setNeed(actor.id, 'hunger', 30);
  await complete;
  assert.equal(actor.getFlag('mortal-needs', 'needs').thirst, 25);
});
test('nonfinite and unchanged inputs do not produce writes', async () => {
  for (const value of [NaN, Infinity, 'invalid', 0]) assert.equal(await engine.setNeed(actor.id, 'hunger', value), null);
  assert.equal(actor.writes.length, 0);
});

test('saving a removed character fails and restores the displayed value', async () => {
  game.actors.delete(actor.id);
  await assert.rejects(engine.setNeed(actor.id, 'hunger', 40), /no longer available/);
  assert.equal(store.getActorNeedState(actor.id, 'hunger').value, 0);
  assert.equal(store.getHistory(actor.id).length, 0);
});

test('parallel Exalted Scenes saves preserve both characters in shared settings', async () => {
  for (const id of ['es1','es2']) store.trackEntity(id, {source:'exalted-scenes',name:id});
  game.settings.set = async (scope, key, value) => {
    await new Promise(resolve => setTimeout(resolve, 3));
    env.values.set(key, structuredClone(value));
  };
  await Promise.all([engine.setNeed('es1','hunger',45), engine.setNeed('es2','thirst',70)]);
  assert.equal(env.values.get('esCharacterNeeds').es1.hunger,45);
  assert.equal(env.values.get('esCharacterNeeds').es2.thirst,70);
});

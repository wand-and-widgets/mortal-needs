import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { EventBus, Events } from '../scripts/core/event-bus.js';
import { NeedsStore } from '../scripts/core/needs-store.js';
import { NeedsEngine } from '../scripts/core/needs-engine.js';
import { ConsequenceEngine } from '../scripts/core/consequence-engine.js';
import { SystemAdapter } from '../scripts/adapters/system-adapter.js';
import '../scripts/consequences/attribute-modify.js';

let env, actor, bus, store, engine, consequences;
beforeEach(() => {
  env = environment(); actor = new MockActor('actor1', { attributes: { exhaustion: 0 } }); game.actors.set(actor.id, actor);
  bus = new EventBus(); store = new NeedsStore(bus);
  store.setNeedConfigs([{ id: 'hunger', min: 0, max: 100, default: 0, enabled: true,
    consequences: [{ id: 'hunger-exhaustion', type: 'attribute-modify', threshold: 100, ticks: 2,
      config: { path: 'attributes.exhaustion', operation: 'add', amount: 1 } }] }]);
  store.trackEntity(actor.id, { source: 'actor', name: actor.name });
  engine = new NeedsEngine(store, bus, new SystemAdapter());
  consequences = new ConsequenceEngine(bus, store, new SystemAdapter());
});
const settle = async () => { await new Promise(resolve => setTimeout(resolve, 15)); };

test('positive stress at the maximum still advances consequence checks without false history', async () => {
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  assert.equal(actor.system.attributes.exhaustion, 1);
  await engine.stressNeed(actor.id, 'hunger', 10); await settle();
  await engine.stressNeed(actor.id, 'hunger', 10); await settle();
  assert.equal(actor.system.attributes.exhaustion, 2);
  assert.equal(store.getHistory(actor.id).length, 1);
  await engine.relieveNeed(actor.id, 'hunger', 1); await settle();
  assert.equal(actor.system.attributes.exhaustion, 0);
});

test('zero stress, unchanged exact values, and relief at the safe bound never tick', async () => {
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  await engine.stressNeed(actor.id, 'hunger', 0);
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  assert.equal(consequences.getTickProgress(actor.id, 'hunger', store.getNeedConfig('hunger').consequences[0]).current, 0);
  assert.equal(actor.system.attributes.exhaustion, 1);
});

test('a failed capped check cannot trigger a consequence', async () => {
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  actor.failWrites = true;
  await assert.rejects(engine.stressNeed(actor.id, 'hunger', 10), /rejected/);
  assert.equal(actor.system.attributes.exhaustion, 1);
});

test('inverted needs repeat at their minimum', async () => {
  store.setNeedConfigs([{ ...store.getNeedConfig('hunger'), inverted: true, default: 100 }]);
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  await engine.stressNeed(actor.id, 'hunger', 100); await settle();
  await engine.stressNeed(actor.id, 'hunger', 10); await settle();
  await engine.stressNeed(actor.id, 'hunger', 10); await settle();
  assert.equal(actor.system.attributes.exhaustion, 2);
});

test('responsible GM accepts an owned player check once and rejects unauthorized checks', async () => {
  await engine.setNeed(actor.id, 'hunger', 100); await settle();
  env.values.set('playerControl', true);
  const check = { id: 'check1', entityId: actor.id, needId: 'hunger', value: 100, amount: 10, source: 'stress' };
  engine.ingestStressCheck(actor, check, env.player.id);
  engine.ingestStressCheck(actor, check, env.player.id); await settle();
  assert.equal(consequences.getTickProgress(actor.id, 'hunger', store.getNeedConfig('hunger').consequences[0]).current, 1);
  actor.owners = [];
  engine.ingestStressCheck(actor, { ...check, id: 'check2' }, env.player.id); await settle();
  assert.equal(actor.system.attributes.exhaustion, 1);
  engine.ingestStressCheck(actor, { ...check, id: 'unknown-user' }, 'missing-user'); await settle();
  assert.equal(actor.system.attributes.exhaustion, 1);
  actor.owners = [env.player.id]; game.user = env.gm2;
  engine.ingestStressCheck(actor, { ...check, id: 'check3' }, env.player.id); await settle();
  assert.equal(actor.system.attributes.exhaustion, 1);
});

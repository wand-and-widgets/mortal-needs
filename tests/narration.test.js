import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { EventBus, Events } from '../scripts/core/event-bus.js';
import { NeedsStore } from '../scripts/core/needs-store.js';
import { NeedsEngine } from '../scripts/core/needs-engine.js';
import { FlavorEngine } from '../scripts/integrations/flavor-engine.js';
import { ChatCards } from '../scripts/integrations/chat-cards.js';
import { SystemAdapter } from '../scripts/adapters/system-adapter.js';
import { createPublicAPI } from '../scripts/api/public-api.js';

let env, actor, bus, store, engine, flavor, messages;
const flush = () => new Promise(resolve => setTimeout(resolve, FlavorEngine.BATCH_DELAY + 30));
beforeEach(() => {
  env = environment(); actor = new MockActor(); game.actors.set(actor.id, actor);
  env.values.set('flavorMessages', true); env.values.set('notifyOnCritical', true);
  env.values.set('flavorVerbosity', 'minimal'); env.values.set('flavorVisibility', 'public');
  messages = [];
  globalThis.ChatMessage = { create: async data => messages.push(data) };
  foundry.applications = { handlebars: { renderTemplate: async (path, data) => JSON.stringify(data) } };
  bus = new EventBus(); store = new NeedsStore(bus);
  store.setNeedConfigs(['hunger', 'thirst', 'secret'].map(id => ({id, label:id, enabled:true, min:0, max:100, default:0, visibility:id === 'secret' ? 'gm' : 'all'})));
  store.trackEntity(actor.id, {source:'actor', name:actor.name});
  engine = new NeedsEngine(store, bus, new SystemAdapter());
  flavor = new FlavorEngine(bus, store); new ChatCards(bus, store);
});

test('critical entry produces one card and initialization produces none', async () => {
  await engine.setNeed(actor.id, 'hunger', 85, {source:'initialization'});
  await flush(); assert.equal(messages.length, 0);
  await engine.setNeed(actor.id, 'hunger', 10, {source:'initialization'});
  await engine.setNeed(actor.id, 'hunger', 85);
  await flush(); assert.equal(messages.length, 1);
  assert.equal(messages[0].flags['mortal-needs'].type, 'flavor');
});
test('custom critical thresholds and recovery bypass cooldown within one severity band', async () => {
  env.values.set('criticalThreshold', 70);
  await engine.setNeed(actor.id, 'hunger', 68, {source:'initialization'});
  await engine.setNeed(actor.id, 'hunger', 71); await flush();
  await engine.setNeed(actor.id, 'hunger', 69); await flush();
  assert.equal(messages.length, 2);
  assert.equal(JSON.parse(messages[1].content).directionLabel, 'MORTAL_NEEDS.Chat.FlavorImproving');
});
test('ordinary fast changes are coalesced and cooldown suppresses chatter', async () => {
  env.values.set('flavorVerbosity', 'normal');
  await engine.setNeed(actor.id, 'thirst', 25);
  await engine.setNeed(actor.id, 'thirst', 45);
  await flush(); assert.equal(messages.length, 1);
  assert.equal(JSON.parse(messages[0].content).value, 45);
  await engine.setNeed(actor.id, 'thirst', 65); await flush();
  assert.equal(messages.length, 1);
});
test('manual narration picks the worst public condition and works with automatic narration off', async () => {
  env.values.set('flavorMessages', false);
  await engine.setNeed(actor.id, 'secret', 100);
  await engine.setNeed(actor.id, 'thirst', 72);
  messages.length = 0;
  assert.equal(await flavor.narrateWorst(actor.id), true);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].flags['mortal-needs'].needId, 'thirst');
  assert.equal(messages[0].whisper, undefined);
});
test('private automatic narration is whispered and a secondary GM does not duplicate it', async () => {
  await engine.setNeed(actor.id, 'secret', 90); await flush();
  assert.deepEqual(messages[0].whisper, ['gm','gm2']);
  messages.length = 0; game.user = env.gm2;
  await engine.setNeed(actor.id, 'thirst', 90); await flush();
  assert.equal(messages.length, 0);
});
test('player API and broadcast payload exclude other characters and private needs', async () => {
  const other = new MockActor('other'); other.owners = []; game.actors.set(other.id, other);
  store.trackEntity(other.id, {source:'actor',name:other.name});
  store.recordCommittedChange(actor.id, 'hunger', 0, 10, 'manual');
  store.recordCommittedChange(other.id, 'hunger', 0, 10, 'manual');
  store.recordCommittedChange(actor.id, 'secret', 0, 10, 'manual');
  game.user = env.player;
  const api = createPublicAPI(store,engine,{},bus,{},new SystemAdapter(),{});
  assert.deepEqual(api.actors.getTracked().map(a => a.id), [actor.id]);
  assert.equal(api.needs.get(other.id,'hunger'), null);
  assert.equal(api.needs.get(actor.id,'secret'), null);
  assert.equal(api.query.allHistory(20).length, 1);
  const payload = api.broadcast._buildPayload().needsData;
  assert.deepEqual(payload.actors.map(a => a.id), [actor.id]);
  assert.equal(payload.needs.some(n => n.id === 'secret'), false);
});

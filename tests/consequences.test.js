import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { AttributeModifyConsequence } from '../scripts/consequences/attribute-modify.js';
import { ActiveEffectApplyConsequence } from '../scripts/consequences/active-effect-apply.js';
import { ConditionApplyConsequence } from '../scripts/consequences/condition-apply.js';
import { SystemAdapter } from '../scripts/adapters/system-adapter.js';
import { ConsequenceEngine } from '../scripts/core/consequence-engine.js';
import { EventBus, Events } from '../scripts/core/event-bus.js';
import { NeedsStore } from '../scripts/core/needs-store.js';
import { consequenceId, normalizeAttributePath } from '../scripts/core/consequence-identity.js';

let env, actor, adapter;
beforeEach(() => { env = environment(); actor = new MockActor(); adapter = new SystemAdapter(); game.actors.set(actor.id, actor); });
const attribute = { consequenceId: 'hunger_damage', path: 'attributes.hp.value', operation: 'subtract', amount: 12 };
const effect = { consequenceId: 'cold_slow', effectName: 'Chilled', changeKey: 'system.attributes.movement.walk', changeMode: '2', changeValue: '-10', stack: false, threshold: 60, reversible: true, recoveryMode: 'immediate' };

test('relative and full system paths agree and unsafe paths are rejected', () => {
  assert.equal(normalizeAttributePath(attribute.path), 'system.attributes.hp.value');
  assert.equal(normalizeAttributePath('system.attributes.hp.value'), 'system.attributes.hp.value');
  assert.equal(normalizeAttributePath('__proto__.polluted'), null);
});
test('attribute is inactive until applied; repeated clamped loss and unrelated healing recover correctly', async () => {
  const type = new AttributeModifyConsequence(adapter);
  assert.equal(await type.isActive(actor, 'hunger', attribute), false);
  await type.apply(actor, 'hunger', attribute);
  await type.apply(actor, 'hunger', attribute);
  assert.equal(actor.system.attributes.hp.value, 0);
  await actor.update({ 'system.attributes.hp.value': 3 });
  assert.equal(await type.remove(actor, 'hunger', attribute), true);
  assert.equal(actor.system.attributes.hp.value, 23);
  assert.equal(await type.isActive(actor, 'hunger', attribute), false);
  assert.equal(await type.remove(actor, 'hunger', attribute), false);
});
test('independent attribute consequences recover only their own deltas', async () => {
  const type = new AttributeModifyConsequence(adapter);
  const first = { ...attribute, amount: 3 };
  const second = { ...attribute, consequenceId: 'thirst_damage', amount: 4 };
  await type.apply(actor, 'hunger', first);
  await type.apply(actor, 'thirst', second);
  await type.remove(actor, 'hunger', first);
  assert.equal(actor.system.attributes.hp.value, 16);
  await type.remove(actor, 'thirst', second);
  assert.equal(actor.system.attributes.hp.value, 20);
});
test('failed attribute persistence does not leave an active ledger', async () => {
  actor.failWrites = true;
  const type = new AttributeModifyConsequence(adapter);
  await assert.rejects(type.apply(actor, 'hunger', attribute), /rejected/);
  assert.equal(await type.isActive(actor, 'hunger', attribute), false);
});
test('temporary nonstacking effects use one inspectable document and preserve base values', async () => {
  const type = new ActiveEffectApplyConsequence(adapter);
  await type.apply(actor, 'cold', effect);
  await type.apply(actor, 'cold', effect);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].changes[0].value, '-10');
  assert.match(actor.effects[0].description, /Removed when cold falls below 60%/);
  assert.match(actor.effects[0].img, /cold.svg$/);
  assert.equal(actor.system.attributes.movement.walk, 30);
});
test('numeric additive effects can stack explicitly and are fully removed', async () => {
  const type = new ActiveEffectApplyConsequence(adapter);
  await type.apply(actor, 'cold', { ...effect, stack: true });
  await type.apply(actor, 'cold', { ...effect, stack: true });
  assert.equal(actor.effects[0].changes[0].value, '-20');
  assert.equal(await type.remove(actor, 'cold', effect), true);
  assert.equal(actor.effects.length, 0);
});
test('override modes do not add together and disabled effects can be removed', async () => {
  const type = new ActiveEffectApplyConsequence(adapter);
  const config = { ...effect, changeMode: '5', changeValue: '10', stack: true };
  await type.apply(actor, 'cold', config);
  await type.apply(actor, 'cold', config);
  assert.equal(actor.effects[0].changes[0].value, '10');
  actor.effects[0].disabled = true;
  assert.equal(await type.isActive(actor, 'cold', config), false);
  assert.equal(await type.remove(actor, 'cold', config), true);
});
test('Foundry 14 writes typed system changes and can repeat a saved effect', async () => {
  game.release = { generation: 14 };
  const type = new ActiveEffectApplyConsequence(adapter);
  await type.apply(actor, 'cold', { ...effect, stack: true });
  await type.apply(actor, 'cold', { ...effect, stack: true });
  assert.equal(actor.effects.length, 1);
  assert.deepEqual(actor.effects[0].system.changes, [{ key: effect.changeKey, type: 'add', value: -20 }]);
  assert.equal(actor.effects[0].changes, undefined);
});
test('a preexisting external condition is never claimed or removed', async () => {
  await actor.toggleStatusEffect('fatigued');
  const type = new ConditionApplyConsequence(adapter);
  const config = { statusId: 'fatigued', consequenceId: 'hunger_fatigue' };
  assert.equal((await type.apply(actor, 'hunger', config)).reason, 'external-condition');
  assert.equal(await type.remove(actor, 'hunger', config), false);
  assert.equal(actor.effects.length, 1);
  assert.equal(actor.effects[0].flags['mortal-needs'], undefined);
});
test('two needs sharing a condition keep it until both recover', async () => {
  const type = new ConditionApplyConsequence(adapter);
  const a = { statusId: 'fatigued', consequenceId: 'hunger_fatigue' };
  const b = { statusId: 'fatigued', consequenceId: 'thirst_fatigue' };
  await type.apply(actor, 'hunger', a);
  await type.apply(actor, 'thirst', b);
  assert.equal(actor.effects.length, 1);
  assert.equal(await type.isActive(actor, 'thirst', b), true);
  await type.remove(actor, 'hunger', a);
  assert.equal(actor.effects.length, 1);
  assert.equal(await type.isActive(actor, 'hunger', a), false);
  await type.remove(actor, 'thirst', b);
  assert.equal(actor.effects.length, 0);
});
test('two thresholds for the same need have independent condition ownership', async () => {
  const type = new ConditionApplyConsequence(adapter);
  const a = { statusId: 'fatigued', consequenceId: 'hunger_low' };
  const b = { statusId: 'fatigued', consequenceId: 'hunger_high' };
  await type.apply(actor, 'hunger', a);
  await type.apply(actor, 'hunger', b);
  await type.remove(actor, 'hunger', a);
  assert.equal(await type.isActive(actor, 'hunger', b), true);
  await type.remove(actor, 'hunger', b);
  assert.equal(actor.effects.length, 0);
});
test('stable saved consequence identity survives later configuration edits', () => {
  const original = { type: 'active-effect', threshold: 60, config: effect };
  const id = consequenceId('cold', original);
  assert.equal(consequenceId('cold', { ...original, id, threshold: 80, config: { ...effect, changeValue: '-5' } }), id);
});
test('only the responsible GM applies automatic effects; recovery uses saved configuration', async () => {
  const bus = new EventBus();
  const store = new NeedsStore(bus);
  const config = { id: 'cold', enabled: true, min: 0, max: 100, default: 0, consequences: [{ id: 'slow', type: 'active-effect', config: effect, threshold: 60, reversible: true }] };
  store.setNeedConfigs([config]);
  store.trackEntity(actor.id, { source: 'actor', name: actor.name });
  const engine = new ConsequenceEngine(bus, store, adapter);
  const change = { entityId: actor.id, needId: 'cold', value: 70, previousValue: 50, max: 100 };
  game.user = env.gm2;
  await bus.emitAsync(Events.NEED_SET, change);
  assert.equal(actor.effects.length, 0);
  game.user = env.gm;
  await bus.emitAsync(Events.NEED_SET, change);
  assert.equal(actor.effects.length, 1);
  const edited = { ...config.consequences[0], type: 'condition-apply', config: { statusId: 'fatigued' } };
  assert.equal(await engine.removeConsequence(actor, actor.id, 'cold', edited), true);
  assert.equal(actor.effects.length, 0);
});

test('a rejected Active Effect creation is reported as a failure', async () => {
  actor.createEmbeddedDocuments = async () => [];
  const result = await new ActiveEffectApplyConsequence(adapter).apply(actor, 'cold', effect);
  assert.equal(result.success, false);
  assert.equal(result.reason, 'system-rejected-active-effect');
});

test('removing a consequence rule still allows its saved effect to recover', async () => {
  const bus = new EventBus(), store = new NeedsStore(bus);
  const config = {id:'cold',enabled:true,min:0,max:100,default:0,consequences:[{id:'slow',type:'active-effect',config:effect,threshold:60,reversible:true}]};
  store.setNeedConfigs([config]); store.trackEntity(actor.id,{source:'actor',name:actor.name});
  const engine = new ConsequenceEngine(bus,store,adapter);
  await bus.emitAsync(Events.NEED_SET,{entityId:actor.id,needId:'cold',previousValue:50,value:75,max:100});
  store.setNeedConfigs([{...config,consequences:[]}]);
  assert.equal((await engine.getConsequenceStatus(actor.id,'cold'))[0].active,true);
  await bus.emitAsync(Events.NEED_SET,{entityId:actor.id,needId:'cold',previousValue:75,value:50,max:100});
  assert.equal(actor.effects.length,0);
});

test('a disabled owned condition can be cleaned up after recovery', async () => {
  const type = new ConditionApplyConsequence(adapter), config={statusId:'fatigued',consequenceId:'hungry'};
  await type.apply(actor,'hunger',config); actor.effects[0].disabled=true;
  assert.equal(await type.isActive(actor,'hunger',config),false);
  assert.equal(await type.remove(actor,'hunger',config),true);
  assert.equal(actor.effects.length,0);
});

test('existing attribute penalties show a fresh readable label and their total applied amount', async () => {
  const bus = new EventBus(), store = new NeedsStore(bus);
  const rule = { id: 'exhaustion', type: 'attribute-modify', threshold: 100, reversible: true,
    config: { path: 'system.attributes.exhaustion', operation: 'add', amount: 1 } };
  actor.system.attributes.exhaustion = 0;
  store.setNeedConfigs([{ id: 'hunger', enabled: true, consequences: [rule] }]);
  store.trackEntity(actor.id, { source: 'actor', name: actor.name });
  const engine = new ConsequenceEngine(bus, store, adapter);
  await engine.applyConsequence(actor, actor.id, 'hunger', rule);
  await engine.applyConsequence(actor, actor.id, 'hunger', rule);
  await actor.setFlag('mortal-needs', 'appliedConsequences.exhaustion.description', 'Add 1 → system.attributes.exhaustion');
  game.i18n.localize = key => key === 'MORTAL_NEEDS.Needs.Exhaustion' ? 'Exhaustion' : key;
  const [status] = await engine.getConsequenceStatus(actor.id, 'hunger');
  assert.equal(status.active, true);
  assert.equal(status.description, 'Exhaustion +2');
  assert.equal(actor.system.attributes.exhaustion, 2);
});

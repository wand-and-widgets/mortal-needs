import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { environment, MockActor } from './helpers.js';
import { Dnd5eAdapter } from '../scripts/adapters/dnd5e-adapter.js';
import { Pf2eAdapter } from '../scripts/adapters/pf2e-adapter.js';
import { ActiveEffectApplyConsequence } from '../scripts/consequences/active-effect-apply.js';
import '../scripts/consequences/condition-apply.js';

beforeEach(() => environment());

test('the attribute-picker path creates a real system Active Effect change', async () => {
  const actor = new MockActor();
  const type = new ActiveEffectApplyConsequence(new Dnd5eAdapter());
  const result = await type.apply(actor, 'cold', { changeKey: 'attributes.movement.walk', changeMode: '2', changeValue: '-10', consequenceId: 'cold' });
  assert.equal(result.success, true);
  assert.equal(actor.effects[0].changes[0].key, 'system.attributes.movement.walk');
});

test('D&D skill totals resolve to roll bonuses, including existing saved effects', async () => {
  const actor = new MockActor();
  const type = new ActiveEffectApplyConsequence(new Dnd5eAdapter());
  const config = { changeKey: 'system.skills.acr.total', changeMode: '2', changeValue: '-2', consequenceId: 'skill', stack: true };
  await type.apply(actor, 'cold', config);
  assert.equal(actor.effects[0].changes[0].key, 'system.skills.acr.bonuses.check');
  // Simulate an effect that 3.0.0 already stored with the ineffective key.
  actor.effects[0].changes[0].key = 'system.skills.acr.total';
  await type.apply(actor, 'cold', config);
  assert.equal(actor.effects[0].changes[0].key, 'system.skills.acr.bonuses.check');
  assert.equal(actor.effects[0].changes[0].value, '-4');
  assert.equal(await type.remove(actor, 'cold', config), true);
});

test('consequence attribute lists omit read-only derived values but keep scaling attributes', () => {
  const dnd = new Dnd5eAdapter(), pf = new Pf2eAdapter();
  assert.ok(dnd.getAvailableAttributes().some(a => a.key === 'skills.acr.total'));
  assert.ok(dnd.getConsequenceAttributes('active-effect').some(a => a.key === 'system.skills.acr.bonuses.check'));
  assert.ok(!dnd.getConsequenceAttributes('attribute-modify').some(a => a.key.includes('skills.')));
  assert.ok(pf.getAvailableAttributes().some(a => a.key === 'abilities.con.mod'));
  assert.ok(!pf.getConsequenceAttributes('attribute-modify').some(a => a.key.includes('abilities.')));
  assert.ok(pf.getConsequenceAttributes('attribute-modify').some(a => a.key === 'system.attributes.hp.value'));
});

test('loading old module effects repairs their keys without claiming external effects or changing strength', async () => {
  const actor = new MockActor(); const adapter = new Dnd5eAdapter();
  const [owned, external] = await actor.createEmbeddedDocuments('ActiveEffect', [
    { changes: [{ key: 'skills.acr.total', mode: 2, value: '-4' }], flags: { 'mortal-needs': { sourceNeed: 'cold', consequenceSource: 'cold_active-effect_old' } } },
    { changes: [{ key: 'skills.acr.total', mode: 2, value: '-5' }] },
  ]);
  await adapter.repairActiveEffectKeys(actor);
  assert.equal(owned.changes[0].key, 'system.skills.acr.bonuses.check');
  assert.equal(owned.changes[0].value, '-4');
  assert.equal(external.changes[0].key, 'skills.acr.total');
});

test('editing a PF2e condition hides unsupported effects but preserves an existing effect rule', async () => {
  foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: base => base } };
  const { EffectConfigDialog } = await import('../scripts/ui/dialogs/effect-config-dialog.js');
  const adapter = new Pf2eAdapter();
  game.modules.set('mortal-needs', { api: { system: { capabilities: adapter.getCapabilities(), availableConditions: [],
    consequenceAttributes: type => adapter.getConsequenceAttributes(type) } } });
  const config = { consequences: [{ type: 'condition-apply', config: { statusId: 'fatigued' } }] };
  const store = { getNeedConfig: () => config };
  const dialog = new EffectConfigDialog('hunger', store, {}, {}, { editIndex: 0 });
  const context = await dialog._prepareContext({});
  assert.equal(context.selectedType, 'condition-apply');
  assert.ok(!context.types.some(type => type.type === 'active-effect'));
  config.consequences[0] = { type: 'active-effect', config: {} };
  const legacy = new EffectConfigDialog('hunger', store, {}, {}, { editIndex: 0 });
  assert.ok((await legacy._prepareContext({})).types.some(type => type.type === 'active-effect'));
});

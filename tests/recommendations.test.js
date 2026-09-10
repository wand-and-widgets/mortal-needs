import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { environment, getProperty } from './helpers.js';
import { Dnd5eAdapter } from '../scripts/adapters/dnd5e-adapter.js';
import { AttributeModifyConsequence } from '../scripts/consequences/attribute-modify.js';
import { applyRecommendation, recommendationViews, renderRecommendations } from '../scripts/ui/consequence-recommendations.js';

let options, configs, saves;
beforeEach(() => {
  environment();
  const strings = JSON.parse(readFileSync(new URL('../languages/en.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  game.i18n.localize = key => getProperty(strings, key) ?? key;
  game.i18n.format = (key, data) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (_, field) => data[field]);
  const adapter = new Dnd5eAdapter();
  game.modules.set('mortal-needs', { api: { system: { effectSuggestions: adapter.getEffectSuggestions(), availableAttributes: adapter.getAvailableAttributes() } } });
  configs = ['hunger', 'thirst', 'fear'].map(id => ({ id, enabled: false, label: id, consequences: [], customSetting: 37 }));
  saves = [];
  options = {
    store: { getNeedConfig: id => configs.find(need => need.id === id), getAllNeedConfigs: () => configs, setNeedConfigs: value => { configs = value; } },
    configManager: { saveNeedsConfig: async value => { saves.push(structuredClone(value)); } },
    eventBus: { emit() {} }, needId: 'hunger', index: 0,
  };
});

test('recommendation names the effect and trigger before adding; configured rules offer editing', async () => {
  const html = renderRecommendations(configs[0]);
  assert.match(html, /Exhaustion \+1/);
  assert.match(html, /Triggers at 100% stress/);
  assert.match(html, /Use recommendation/);
  assert.doesNotMatch(html, /system\.attributes/);
  await applyRecommendation(options);
  const saved = renderRecommendations(configs[0]);
  assert.match(saved, /Already configured/);
  assert.match(saved, /Edit rule/);
  assert.doesNotMatch(saved, /data-action="apply-suggestion"/);
});

test('rapid repeated clicks add one rule while preserving other settings and needs', async () => {
  const originalFear = structuredClone(configs[2]);
  const result = await Promise.all([applyRecommendation(options), applyRecommendation(options)]);
  assert.deepEqual(result.map(item => item.status), ['added', 'exists']);
  assert.equal(saves.length, 1);
  assert.equal(configs[0].consequences.length, 1);
  assert.equal(configs[0].enabled, false);
  assert.equal(configs[0].customSetting, 37);
  assert.deepEqual(configs[2], originalFear);
});

test('parallel additions from separate dialogs retain both needs', async () => {
  await Promise.all([applyRecommendation(options), applyRecommendation({ ...options, needId: 'thirst' })]);
  assert.equal(configs[0].consequences.length, 1);
  assert.equal(configs[1].consequences.length, 1);
});

test('a customized existing rule is recognized without resetting threshold or adding a duplicate', async () => {
  configs[0].consequences = [{ id: 'old', type: 'attribute-modify', threshold: 75, ticks: 8, reversible: false,
    config: { path: 'attributes.exhaustion', operation: 'add', amount: '2' } }];
  assert.equal((await applyRecommendation(options)).status, 'exists');
  const view = recommendationViews(configs[0])[0];
  assert.equal(view.threshold, 75);
  assert.equal(view.ticks, 8);
  assert.equal(view.reversible, false);
  assert.equal(view.description, 'Exhaustion +2');
  assert.equal(saves.length, 0);
});

test('failed saves leave configuration untouched and allow a later retry', async () => {
  options.configManager.saveNeedsConfig = async () => { throw new Error('failed save'); };
  await assert.rejects(applyRecommendation(options), /failed save/);
  assert.equal(configs[0].consequences.length, 0);
  options.configManager.saveNeedsConfig = async () => {};
  assert.equal((await applyRecommendation(options)).status, 'added');
});

test('player actions and missing suggestions cannot write settings', async () => {
  assert.equal((await applyRecommendation({ ...options, needId: 'fear' })).status, 'unavailable');
  game.user = { isGM: false };
  assert.equal((await applyRecommendation(options)).status, 'unavailable');
  assert.equal(saves.length, 0);
});

test('attribute descriptions resolve both path forms and hide unknown technical paths', () => {
  const type = new AttributeModifyConsequence(new Dnd5eAdapter());
  for (const path of ['attributes.exhaustion', 'system.attributes.exhaustion']) {
    assert.equal(type.getDescription({ path, operation: 'add', amount: 1 }), 'Exhaustion +1');
  }
  assert.equal(type.getDescription({ path: 'system.attributes.hp.value', operation: 'subtract', amount: 5 }), 'Current hit points -5');
  assert.equal(type.getDescription({ path: 'system.custom.mystery', operation: 'add', amount: 2 }), 'Custom attribute +2');
});

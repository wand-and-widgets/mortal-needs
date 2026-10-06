import { ConsequenceType, registerConsequenceType } from './consequence-type.js';
import { MODULE_ID } from '../constants.js';
import { normalizeAttributePath } from '../core/consequence-identity.js';
import { attributeLabel } from '../core/attribute-label.js';

export class AttributeModifyConsequence extends ConsequenceType {
  static TYPE = 'attribute-modify';
  static LABEL = 'MORTAL_NEEDS.Consequences.AttributeModify';
  static ICON = 'mn-icon fa-chart-line';
  static CONFIG_SCHEMA = [
    { key: 'path', type: 'text', label: 'MORTAL_NEEDS.Consequences.AttributePath', placeholder: 'system.attributes.hp.value' },
    { key: 'operation', type: 'select', label: 'MORTAL_NEEDS.Consequences.Operation', options: [
      { value: 'subtract', label: 'MORTAL_NEEDS.Consequences.OpSubtract' },
      { value: 'add', label: 'MORTAL_NEEDS.Consequences.OpAdd' },
      { value: 'set', label: 'MORTAL_NEEDS.Consequences.OpSet' },
      { value: 'multiply', label: 'MORTAL_NEEDS.Consequences.OpMultiply' },
    ]},
    { key: 'amount', type: 'number', label: 'MORTAL_NEEDS.Consequences.Amount', default: 5 },
  ];

  async apply(actor, needId, config) {
    if (!actor) return { success: false, reason: 'no-actor' };

    const path = normalizeAttributePath(config.path);
    if (!path) return { success: false, reason: 'invalid-path' };
    const currentValue = foundry.utils.getProperty(actor._source ?? actor, path);
    if (typeof currentValue !== 'number') return { success: false, reason: 'not-numeric' };
    const amount = Number(config.amount);
    if (!Number.isFinite(amount)) return { success: false, reason: 'invalid-amount' };

    let newValue;
    switch (config.operation) {
      case 'subtract': newValue = Math.max(0, currentValue - amount); break;
      case 'add': newValue = currentValue + amount; break;
      case 'set': newValue = amount; break;
      case 'multiply': newValue = Math.round(currentValue * amount); break;
      default: return { success: false, reason: 'unknown-operation' };
    }

    if (!Number.isFinite(newValue)) return { success: false, reason: 'invalid-result' };
    const key = config.consequenceId || `${needId}_${path.replaceAll('.', '_')}`;
    const ledger = structuredClone(actor.getFlag(MODULE_ID, 'attributeConsequences') || {});
    const previous = ledger[key];
    if (previous && previous.path !== path) return { success: false, reason: 'remove-before-changing-path' };
    ledger[key] = {
      needId, path, delta: (previous?.delta ?? 0) + newValue - currentValue,
      applications: (previous?.applications ?? 0) + 1,
      description: this.getDescription({ ...config, path }),
      config: { ...config, path },
    };
    await actor.update({ [path]: newValue, [`flags.${MODULE_ID}.attributeConsequences`]: ledger });
    return { success: true, previousValue: currentValue, newValue };
  }

  async remove(actor, needId, config) {
    if (!actor) return false;
    const path = normalizeAttributePath(config.path);
    const key = config.consequenceId || `${needId}_${path?.replaceAll('.', '_')}`;
    const ledger = structuredClone(actor.getFlag(MODULE_ID, 'attributeConsequences') || {});
    const applied = ledger[key];
    if (!applied || applied.needId !== needId) return false;
    const currentValue = foundry.utils.getProperty(actor._source ?? actor, applied.path);
    if (typeof currentValue !== 'number') return false;
    const revertedValue = currentValue - applied.delta;
    delete ledger[key];
    await actor.update({ [applied.path]: revertedValue, [`flags.${MODULE_ID}.attributeConsequences.-=${key}`]: null });
    return true;
  }

  async isActive(actor, needId, config) {
    if (!actor) return false;
    const path = normalizeAttributePath(config.path);
    const key = config.consequenceId || `${needId}_${path?.replaceAll('.', '_')}`;
    return actor.getFlag(MODULE_ID, 'attributeConsequences')?.[key]?.applications > 0;
  }

  getDescription(config) {
    const opKey = {
      subtract: 'MORTAL_NEEDS.Consequences.OpSubtract',
      add: 'MORTAL_NEEDS.Consequences.OpAdd',
      set: 'MORTAL_NEEDS.Consequences.OpSet',
      multiply: 'MORTAL_NEEDS.Consequences.OpMultiply',
    }[config.operation];
    const opLabel = opKey ? game.i18n.localize(opKey) : (config.operation || 'modify');

    const label = attributeLabel(config.path, this.adapter);
    const amount = Number(config.amount ?? 0);
    if (['add', 'subtract'].includes(config.operation) && Number.isFinite(amount)) {
      const delta = config.operation === 'subtract' ? -amount : amount;
      return `${label} ${delta > 0 ? '+' : ''}${delta}`;
    }
    return `${label}: ${opLabel} ${config.amount ?? 0}`;
  }
}

registerConsequenceType(AttributeModifyConsequence.TYPE, AttributeModifyConsequence);

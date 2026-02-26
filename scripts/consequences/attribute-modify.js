import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class AttributeModifyConsequence extends ConsequenceType {
  static TYPE = 'attribute-modify';
  static LABEL = 'MORTAL_NEEDS.Consequences.AttributeModify';
  static ICON = 'fas fa-chart-line';
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

    const currentValue = foundry.utils.getProperty(actor, config.path);
    if (typeof currentValue !== 'number') return { success: false, reason: 'not-numeric' };

    let newValue;
    switch (config.operation) {
      case 'subtract': newValue = Math.max(0, currentValue - config.amount); break;
      case 'add': newValue = currentValue + config.amount; break;
      case 'set': newValue = config.amount; break;
      case 'multiply': newValue = Math.round(currentValue * config.amount); break;
      default: return { success: false, reason: 'unknown-operation' };
    }

    await actor.update({ [config.path]: newValue });
    return { success: true, previousValue: currentValue, newValue };
  }

  async remove(actor, needId, config) {
    if (!actor) return false;
    const currentValue = foundry.utils.getProperty(actor, config.path);
    if (typeof currentValue !== 'number') return false;

    let revertedValue;
    switch (config.operation) {
      case 'subtract': revertedValue = currentValue + config.amount; break;
      case 'add': revertedValue = Math.max(0, currentValue - config.amount); break;
      case 'set': return false; // Cannot revert a "set" — previous value unknown
      case 'multiply': revertedValue = config.amount !== 0 ? Math.round(currentValue / config.amount) : currentValue; break;
      default: return false;
    }

    await actor.update({ [config.path]: revertedValue });
    return true;
  }

  async isActive(actor, needId, config) {
    // Attribute modifications are always "active" if the actor exists and the path is valid
    if (!actor) return false;
    const value = foundry.utils.getProperty(actor, config.path);
    return typeof value === 'number';
  }

  getDescription(config) {
    const opKey = {
      subtract: 'MORTAL_NEEDS.Consequences.OpSubtract',
      add: 'MORTAL_NEEDS.Consequences.OpAdd',
      set: 'MORTAL_NEEDS.Consequences.OpSet',
      multiply: 'MORTAL_NEEDS.Consequences.OpMultiply',
    }[config.operation];
    const opLabel = opKey ? game.i18n.localize(opKey) : (config.operation || 'modify');

    const attrs = this.adapter?.getAvailableAttributes?.() || [];
    const attr = attrs.find(a => a.key === config.path || `system.${a.key}` === config.path);
    const pathLabel = attr?.label ? game.i18n.localize(attr.label) : (config.path || '?');

    return `${opLabel} ${config.amount ?? 0} → ${pathLabel}`;
  }
}

registerConsequenceType(AttributeModifyConsequence.TYPE, AttributeModifyConsequence);

import { MODULE_ID } from '../constants.js';
import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class ActiveEffectApplyConsequence extends ConsequenceType {
  static TYPE = 'active-effect';
  static LABEL = 'MORTAL_NEEDS.Consequences.ActiveEffectApply';
  static ICON = 'fas fa-magic';
  static CONFIG_SCHEMA = [
    { key: 'effectName', type: 'text', label: 'MORTAL_NEEDS.Consequences.EffectName' },
    { key: 'changeKey', type: 'text', label: 'MORTAL_NEEDS.Consequences.ChangeKey', placeholder: 'system.attributes.hp.max' },
    { key: 'changeMode', type: 'select', label: 'MORTAL_NEEDS.Consequences.ChangeMode', options: [
      { value: '2', label: 'MORTAL_NEEDS.Consequences.ModeAdd' },
      { value: '3', label: 'MORTAL_NEEDS.Consequences.ModeDowngrade' },
      { value: '4', label: 'MORTAL_NEEDS.Consequences.ModeUpgrade' },
      { value: '5', label: 'MORTAL_NEEDS.Consequences.ModeOverride' },
    ]},
    { key: 'changeValue', type: 'text', label: 'MORTAL_NEEDS.Consequences.ChangeValue' },
  ];

  async apply(actor, needId, config) {
    if (!actor) return { success: false, reason: 'no-actor' };

    const sourceKey = `${needId}_${this.constructor.TYPE}_${config.consequenceId || 'default'}`;

    // Check for existing stackable effect
    const existing = actor.effects.find(e =>
      e.flags?.[MODULE_ID]?.consequenceSource === sourceKey
    );

    if (existing) {
      // Stack: update the change value
      const currentValue = parseFloat(existing.changes[0]?.value ?? 0);
      const newValue = currentValue + parseFloat(config.changeValue);
      await existing.update({
        changes: [{ key: config.changeKey, mode: parseInt(config.changeMode), value: String(newValue) }],
      });
      return { success: true, stacked: true, totalValue: newValue };
    }

    await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: config.effectName || `Mortal Needs: ${needId}`,
      icon: 'icons/svg/downgrade.svg',
      changes: [{ key: config.changeKey, mode: parseInt(config.changeMode), value: config.changeValue }],
      flags: {
        [MODULE_ID]: {
          consequenceSource: sourceKey,
          sourceNeed: needId,
        },
      },
    }]);

    return { success: true };
  }

  async remove(actor, needId, config) {
    if (!actor) return false;

    const sourceKey = `${needId}_${this.constructor.TYPE}_${config.consequenceId || 'default'}`;
    const effect = actor.effects.find(e =>
      e.flags?.[MODULE_ID]?.consequenceSource === sourceKey
    );
    if (effect) {
      await effect.delete();
      return true;
    }
    return false;
  }

  async isActive(actor, needId, config) {
    if (!actor) return false;
    const sourceKey = `${needId}_${this.constructor.TYPE}_${config.consequenceId || 'default'}`;
    return actor.effects.some(e =>
      e.flags?.[MODULE_ID]?.consequenceSource === sourceKey
    );
  }

  getDescription(config) {
    const modeKey = {
      '2': 'MORTAL_NEEDS.Consequences.ModeAdd',
      '3': 'MORTAL_NEEDS.Consequences.ModeDowngrade',
      '4': 'MORTAL_NEEDS.Consequences.ModeUpgrade',
      '5': 'MORTAL_NEEDS.Consequences.ModeOverride',
    }[String(config.changeMode)];
    const modeLabel = modeKey ? game.i18n.localize(modeKey) : `Mode ${config.changeMode}`;
    const name = config.effectName || 'Active Effect';
    return `${name}: ${modeLabel} ${config.changeValue ?? ''} → ${config.changeKey || '?'}`;
  }
}

registerConsequenceType(ActiveEffectApplyConsequence.TYPE, ActiveEffectApplyConsequence);

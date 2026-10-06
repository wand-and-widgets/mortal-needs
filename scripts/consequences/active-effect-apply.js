import { MODULE_ID } from '../constants.js';
import { ConsequenceType, registerConsequenceType } from './consequence-type.js';
import { attributeLabel } from '../core/attribute-label.js';
import { escapeHTML } from '../core/consequence-identity.js';
import { needIconPath } from '../ui/need-icons.js';
import { effectChanges, effectChangeMode, effectChangeData } from '../core/effect-data.js';

export class ActiveEffectApplyConsequence extends ConsequenceType {
  static TYPE = 'active-effect';
  static LABEL = 'MORTAL_NEEDS.Consequences.ActiveEffectApply';
  static ICON = 'mn-icon fa-magic';
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
    { key: 'stack', type: 'boolean', label: 'MORTAL_NEEDS.Dock.Stack', default: false },
  ];

  async apply(actor, needId, config) {
    if (!actor) return { success: false, reason: 'no-actor' };
    if (this.adapter?.getCapabilities?.().hasActiveEffects === false) return { success: false, reason: 'system-does-not-support-active-effects' };
    config = { ...config, changeKey: this.adapter?.resolveActiveEffectKey?.(config.changeKey) ?? config.changeKey };
    if (typeof config.changeKey !== 'string' || !config.changeKey.trim()
      || config.changeKey.split('.').some(p => ['__proto__', 'constructor', 'prototype'].includes(p))) {
      return { success: false, reason: 'invalid-change-key' };
    }
    const mode = Number(config.changeMode);
    if (![2, 3, 4, 5].includes(mode) || String(config.changeValue ?? '').trim() === '') return { success: false, reason: 'invalid-change' };

    const sourceKey = `${needId}_${this.constructor.TYPE}_${config.consequenceId || 'default'}`;

    // Check for existing stackable effect
    const existing = actor.effects.find(e =>
      e.flags?.[MODULE_ID]?.consequenceSource === sourceKey
    );

    const recovery = config.reversible === false ? 'The GM decides when to remove this effect.'
      : config.recoveryMode === 'immediate' ? `Removed when ${config.needLabel || needId} falls below ${config.threshold ?? 100}% stress.`
      : config.recoveryMode === 'ask_gm' ? 'The GM is asked to remove this effect after recovery.' : 'The GM removes this effect after recovery.';
    let changeValue = String(config.changeValue);
    if (existing && (config.stack ?? true) && mode === 2) {
      const currentValue = Number(effectChanges(existing)[0]?.value);
      const delta = Number(config.changeValue);
      if (!Number.isFinite(currentValue) || !Number.isFinite(delta)) return { success: false, reason: 'only-numeric-effects-can-stack' };
      changeValue = String(currentValue + delta);
    }
    const description = `<p>${escapeHTML(config.needLabel || needId)}: ${escapeHTML(this.getDescription({ ...config, changeValue }))}</p><p>${escapeHTML(recovery)}</p>`;
    if (existing) {
      const existingKey = effectChanges(existing)[0]?.key;
      if ((this.adapter?.resolveActiveEffectKey?.(existingKey) ?? existingKey) !== config.changeKey || effectChangeMode(effectChanges(existing)[0]) !== mode) {
        return { success: false, reason: 'remove-before-changing-effect' };
      }
      await existing.update({
        ...effectChangeData(config.changeKey, mode, changeValue),
        description,
        disabled: false,
      });
      return { success: true, stacked: changeValue !== String(config.changeValue), description: this.getDescription({ ...config, changeValue }) };
    }

    const created = await actor.createEmbeddedDocuments('ActiveEffect', [{
      name: config.effectName || `Mortal Needs: ${needId}`,
      img: needIconPath(needId),
      ...(Number(game.release?.generation ?? 13) < 13 ? { icon: needIconPath(needId) } : {}),
      description,
      origin: actor.uuid,
      transfer: false,
      ...effectChangeData(config.changeKey, mode, changeValue),
      flags: {
        [MODULE_ID]: {
          consequenceSource: sourceKey,
          sourceNeed: needId,
          consequenceId: config.consequenceId,
        },
      },
    }]);

    if (!created?.length) return { success: false, reason: 'system-rejected-active-effect' };
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
      e.flags?.[MODULE_ID]?.consequenceSource === sourceKey && !e.disabled
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
    const label = attributeLabel(config.changeKey, this.adapter);
    const value = Number(config.changeValue);
    const change = Number(config.changeMode) === 2 && Number.isFinite(value)
      ? `${value > 0 ? '+' : ''}${value}` : `${modeLabel} ${config.changeValue ?? ''}`;
    return `${name}: ${label} ${change}`;
  }
}

registerConsequenceType(ActiveEffectApplyConsequence.TYPE, ActiveEffectApplyConsequence);

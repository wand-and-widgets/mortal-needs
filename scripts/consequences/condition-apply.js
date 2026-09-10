import { MODULE_ID } from '../constants.js';
import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class ConditionApplyConsequence extends ConsequenceType {
  static TYPE = 'condition-apply';
  static LABEL = 'MORTAL_NEEDS.Consequences.ConditionApply';
  static ICON = 'fas fa-exclamation-triangle';
  static CONFIG_SCHEMA = [
    { key: 'statusId', type: 'select', label: 'MORTAL_NEEDS.Consequences.ConditionId', options: 'adapter:conditions' },
  ];

  async apply(actor, needId, config) {
    if (!actor) return { success: false, reason: 'no-actor' };

    const statusId = config.statusId;
    if (!statusId) return { success: false, reason: 'no-status-id' };

    // Check if already has this condition from this need
    const source = { sourceNeed: needId, consequenceId: config.consequenceId };
    const existing = this.adapter.findAppliedCondition ? this.adapter.findAppliedCondition(actor, statusId, source)
      : actor.effects.find(e =>
        e.statuses?.has(statusId) &&
        e.flags?.[MODULE_ID]?.sourceNeed === needId
      );
    if (existing) return { success: false, reason: 'already-active' };

    // Apply via adapter
    const applied = await this.adapter.applyCondition(actor, statusId, source);
    if (!applied) return { success: false, reason: this.adapter.findAppliedCondition?.(actor, statusId) ? 'external-condition' : 'adapter-failed' };

    return { success: true, statusId };
  }

  async remove(actor, needId, config) {
    if (!actor) return false;

    if (typeof this.adapter.removeCondition === 'function') {
      return this.adapter.removeCondition(actor, config.statusId, { sourceNeed: needId, consequenceId: config.consequenceId });
    }

    const effect = actor.effects.find(e =>
      e.statuses?.has(config.statusId) &&
      e.flags?.[MODULE_ID]?.sourceNeed === needId
    );
    if (!effect) return false;
    await effect.delete();
    return true;
  }

  async isActive(actor, needId, config) {
    if (!actor) return false;
    if (typeof this.adapter.findAppliedCondition === 'function') {
      return !!this.adapter.findAppliedCondition(actor, config.statusId, { sourceNeed: needId, consequenceId: config.consequenceId });
    }

    return actor.effects.some(e =>
      e.statuses?.has(config.statusId) &&
      e.flags?.[MODULE_ID]?.sourceNeed === needId
    );
  }

  getDescription(config) {
    const conditions = this.adapter.getAvailableConditions();
    const cond = conditions.find(c => c.id === config.statusId);
    const label = cond ? (typeof cond.label === 'string' ? game.i18n.localize(cond.label) : cond.label) : config.statusId;
    return `Apply: ${label}`;
  }
}

registerConsequenceType(ConditionApplyConsequence.TYPE, ConditionApplyConsequence);

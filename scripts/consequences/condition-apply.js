import { MODULE_ID } from '../constants.js';
import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class ConditionApplyConsequence extends ConsequenceType {
  static TYPE = 'condition-apply';
  static LABEL = 'MORTAL_NEEDS.Consequences.ConditionApply';
  static ICON = 'fas fa-exclamation-triangle';
  static CONFIG_SCHEMA = [
    { key: 'statusId', type: 'select', label: 'MORTAL_NEEDS.Consequences.Condition', options: 'adapter:conditions' },
  ];

  async apply(actor, needId, config) {
    if (!actor) return { success: false, reason: 'no-actor' };

    const statusId = config.statusId;
    if (!statusId) return { success: false, reason: 'no-status-id' };

    // Check if already has this condition from this need
    const existing = actor.effects.find(e =>
      e.statuses?.has(statusId) &&
      e.flags?.[MODULE_ID]?.sourceNeed === needId
    );
    if (existing) return { success: false, reason: 'already-active' };

    // Apply via adapter
    const applied = await this.adapter.applyCondition(actor, statusId, { sourceNeed: needId });
    if (!applied) return { success: false, reason: 'adapter-failed' };

    return { success: true, statusId };
  }

  async remove(actor, needId, config) {
    if (!actor) return false;

    const effect = actor.effects.find(e =>
      e.statuses?.has(config.statusId) &&
      e.flags?.[MODULE_ID]?.sourceNeed === needId
    );
    if (effect) {
      await effect.delete();
      return true;
    }
    return false;
  }

  async isActive(actor, needId, config) {
    if (!actor) return false;
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

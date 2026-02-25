import { MODULE_ID } from '../constants.js';

export class SystemAdapter {
  static get systemId() { return 'generic'; }

  getCapabilities() {
    return {
      hasExhaustion: false,
      hasConditions: true,
      hasActiveEffects: true,
      hasDamageTypes: false,
      supportsAttributeModifiers: false,
    };
  }

  getAttributeValue(actor, path) {
    return foundry.utils.getProperty(actor.system, path) ?? null;
  }

  getAvailableAttributes() {
    return [];
  }

  getAvailableConditions() {
    const statusEffects = CONFIG.statusEffects || [];
    return statusEffects.map(se => ({
      id: se.id,
      label: se.name ?? se.label ?? se.id,
      icon: se.icon ?? se.img ?? '',
    }));
  }

  async applyCondition(actor, statusId, flags = {}) {
    try {
      if (typeof actor.toggleStatusEffect === 'function') {
        await actor.toggleStatusEffect(statusId, { active: true });
      } else {
        // Fallback: create Active Effect
        const statusEffect = CONFIG.statusEffects.find(se => se.id === statusId);
        await actor.createEmbeddedDocuments('ActiveEffect', [{
          name: statusEffect?.name ?? statusEffect?.label ?? statusId,
          icon: statusEffect?.icon ?? statusEffect?.img ?? 'icons/svg/aura.svg',
          statuses: [statusId],
          flags: { [MODULE_ID]: flags },
        }]);
      }

      // Tag the effect with our flags
      if (flags.sourceNeed) {
        const effect = actor.effects.find(e => e.statuses?.has(statusId) && !e.flags?.[MODULE_ID]?.sourceNeed);
        if (effect) {
          await effect.setFlag(MODULE_ID, 'sourceNeed', flags.sourceNeed);
        }
      }
      return true;
    } catch (err) {
      console.error(`Mortal Needs | Failed to apply condition "${statusId}":`, err);
      return false;
    }
  }

  getAvailableDamageTypes() {
    return [];
  }

  getEffectSuggestions() {
    return {};
  }

  getModifierTable() {
    return [
      { maxScore: 5, multiplier: 1.5 },
      { maxScore: 10, multiplier: 1.2 },
      { maxScore: 15, multiplier: 1.0 },
      { maxScore: 20, multiplier: 0.8 },
      { maxScore: Infinity, multiplier: 0.6 },
    ];
  }

  isPlayerCharacter(actor) {
    return actor?.hasPlayerOwner && actor?.type === 'character';
  }
}

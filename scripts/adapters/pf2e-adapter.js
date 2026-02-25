import { SystemAdapter } from './system-adapter.js';

export class Pf2eAdapter extends SystemAdapter {
  static get systemId() { return 'pf2e'; }

  getCapabilities() {
    return {
      hasExhaustion: true,
      hasConditions: true,
      hasActiveEffects: true,
      hasDamageTypes: true,
      supportsAttributeModifiers: true,
    };
  }

  getAvailableAttributes() {
    return [
      { key: 'abilities.str.mod', label: 'PF2E.AbilityStr', group: 'abilities' },
      { key: 'abilities.dex.mod', label: 'PF2E.AbilityDex', group: 'abilities' },
      { key: 'abilities.con.mod', label: 'PF2E.AbilityCon', group: 'abilities' },
      { key: 'abilities.int.mod', label: 'PF2E.AbilityInt', group: 'abilities' },
      { key: 'abilities.wis.mod', label: 'PF2E.AbilityWis', group: 'abilities' },
      { key: 'abilities.cha.mod', label: 'PF2E.AbilityCha', group: 'abilities' },
    ];
  }

  getAvailableDamageTypes() {
    const cfg = CONFIG.PF2E?.damageTypes ?? {};
    return Object.entries(cfg).map(([key, data]) => ({
      id: key,
      label: typeof data === 'string' ? data : data.label ?? key,
    }));
  }

  getModifierTable() {
    // PF2e uses modifier-based scaling (-1 to +7 range for ability mods)
    return [
      { maxScore: -1, multiplier: 1.5 },
      { maxScore: 1, multiplier: 1.2 },
      { maxScore: 3, multiplier: 1.0 },
      { maxScore: 5, multiplier: 0.8 },
      { maxScore: Infinity, multiplier: 0.6 },
    ];
  }

  getEffectSuggestions() {
    return {
      hunger: [{ type: 'condition-apply', config: { statusId: 'fatigued' }, ticks: 3 }],
      thirst: [{ type: 'condition-apply', config: { statusId: 'fatigued' }, ticks: 2 }],
      exhaustion: [{ type: 'condition-apply', config: { statusId: 'fatigued' }, ticks: 3 }],
    };
  }
}

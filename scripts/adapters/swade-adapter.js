import { SystemAdapter } from './system-adapter.js';

export class SwadeAdapter extends SystemAdapter {
  static get systemId() { return 'swade'; }

  getCapabilities() {
    return {
      hasExhaustion: true,
      hasConditions: true,
      hasActiveEffects: true,
      hasDamageTypes: false,
      supportsAttributeModifiers: true,
    };
  }

  getAvailableAttributes() {
    return [
      { key: 'attributes.agility.die.sides', label: 'SWADE.AttrAgi', group: 'attributes' },
      { key: 'attributes.smarts.die.sides', label: 'SWADE.AttrSma', group: 'attributes' },
      { key: 'attributes.spirit.die.sides', label: 'SWADE.AttrSpi', group: 'attributes' },
      { key: 'attributes.strength.die.sides', label: 'SWADE.AttrStr', group: 'attributes' },
      { key: 'attributes.vigor.die.sides', label: 'SWADE.AttrVig', group: 'attributes' },
    ];
  }

  getModifierTable() {
    // SWADE uses die types: d4=4, d6=6, d8=8, d10=10, d12=12
    return [
      { maxScore: 4, multiplier: 1.5 },
      { maxScore: 6, multiplier: 1.2 },
      { maxScore: 8, multiplier: 1.0 },
      { maxScore: 10, multiplier: 0.8 },
      { maxScore: Infinity, multiplier: 0.6 },
    ];
  }

  getEffectSuggestions() {
    return {
      exhaustion: [{ type: 'attribute-modify', config: { path: 'system.fatigue.value', operation: 'add', amount: 1 }, ticks: 3 }],
    };
  }
}

import { SystemAdapter } from './system-adapter.js';

export class Wfrp4eAdapter extends SystemAdapter {
  static get systemId() { return 'wfrp4e'; }

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
      { key: 'characteristics.ws.value', label: 'WFRP4E.CharWS', group: 'characteristics' },
      { key: 'characteristics.bs.value', label: 'WFRP4E.CharBS', group: 'characteristics' },
      { key: 'characteristics.s.value', label: 'WFRP4E.CharS', group: 'characteristics' },
      { key: 'characteristics.t.value', label: 'WFRP4E.CharT', group: 'characteristics' },
      { key: 'characteristics.i.value', label: 'WFRP4E.CharI', group: 'characteristics' },
      { key: 'characteristics.ag.value', label: 'WFRP4E.CharAG', group: 'characteristics' },
      { key: 'characteristics.dex.value', label: 'WFRP4E.CharDex', group: 'characteristics' },
      { key: 'characteristics.int.value', label: 'WFRP4E.CharINT', group: 'characteristics' },
      { key: 'characteristics.wp.value', label: 'WFRP4E.CharWP', group: 'characteristics' },
      { key: 'characteristics.fel.value', label: 'WFRP4E.CharFel', group: 'characteristics' },
    ];
  }

  getModifierTable() {
    // WFRP4e characteristics range 1-99, typical 20-40
    return [
      { maxScore: 15, multiplier: 1.5 },
      { maxScore: 25, multiplier: 1.3 },
      { maxScore: 35, multiplier: 1.0 },
      { maxScore: 45, multiplier: 0.8 },
      { maxScore: Infinity, multiplier: 0.6 },
    ];
  }

  getEffectSuggestions() {
    return {
      exhaustion: [{ type: 'attribute-modify', config: { path: 'system.status.fatigue.value', operation: 'add', amount: 1 }, ticks: 3 }],
    };
  }
}

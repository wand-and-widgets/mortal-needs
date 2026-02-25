import { SystemAdapter } from './system-adapter.js';

export class GenericAdapter extends SystemAdapter {
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

  getAvailableAttributes() {
    // Try to discover common attribute patterns from the first player character
    const actor = game.actors?.find(a => a.hasPlayerOwner && a.type === 'character');
    if (!actor?.system) return [];

    const attrs = [];
    this.#discoverAttributes(actor.system, '', attrs, 0);
    return attrs;
  }

  #discoverAttributes(obj, prefix, results, depth) {
    if (depth > 3 || !obj || typeof obj !== 'object') return;

    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;

      if (typeof value === 'number' && key !== 'id') {
        results.push({
          key: path,
          label: path,
          group: prefix.split('.')[0] || 'attributes',
        });
      } else if (typeof value === 'object' && !Array.isArray(value)) {
        this.#discoverAttributes(value, path, results, depth + 1);
      }
    }
  }

  isPlayerCharacter(actor) {
    return actor?.hasPlayerOwner;
  }
}

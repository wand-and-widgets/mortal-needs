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
    return this._buildConditionList(CONFIG.statusEffects);
  }

  async applyCondition(actor, statusId, flags = {}) {
    try {
      const existingIds = new Set(
        this._getActorConditionDocuments(actor, statusId)
          .map(doc => doc.id)
          .filter(Boolean)
      );

      if (typeof actor.toggleStatusEffect === 'function') {
        await actor.toggleStatusEffect(statusId, { active: true });
      } else if (typeof actor.toggleCondition === 'function') {
        await actor.toggleCondition(statusId, { active: true });
      } else {
        // Fallback: create Active Effect
        const statusEffect = this.getAvailableConditions().find(se => se.id === statusId);
        await actor.createEmbeddedDocuments('ActiveEffect', [{
          name: statusEffect?.name ?? statusEffect?.label ?? statusId,
          icon: statusEffect?.icon ?? statusEffect?.img ?? 'icons/svg/aura.svg',
          statuses: [statusId],
          flags: { [MODULE_ID]: flags },
        }]);
      }

      // Tag the effect with our flags
      if (flags.sourceNeed) {
        const conditionDocs = this._getActorConditionDocuments(actor, statusId);
        const effect = conditionDocs.find(doc => !existingIds.has(doc.id) && !doc.flags?.[MODULE_ID]?.sourceNeed)
          ?? conditionDocs.find(doc => !doc.flags?.[MODULE_ID]?.sourceNeed);
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

  findAppliedCondition(actor, statusId, flags = {}) {
    const docs = this._getActorConditionDocuments(actor, statusId);
    if (flags.sourceNeed) {
      return docs.find(doc => doc.flags?.[MODULE_ID]?.sourceNeed === flags.sourceNeed) ?? null;
    }
    return docs[0] ?? null;
  }

  async removeCondition(actor, statusId, flags = {}) {
    const condition = this.findAppliedCondition(actor, statusId, flags);
    if (!condition || typeof condition.delete !== 'function') return false;
    await condition.delete();
    return true;
  }

  _buildConditionList(...sources) {
    const seen = new Set();

    return sources
      .flatMap(source => this._normalizeStatusEffects(source))
      .map(se => ({
        id: se.id,
        label: se.name ?? se.label ?? se.id,
        icon: se.icon ?? se.img ?? '',
      }))
      .filter(se => {
        if (!se.id || seen.has(se.id)) return false;
        seen.add(se.id);
        return true;
      });
  }

  _normalizeStatusEffects(source) {
    const results = [];

    const visit = (value, fallbackId = '') => {
      if (!value) return;

      if (Array.isArray(value)) {
        value.forEach(entry => visit(entry));
        return;
      }

      if (value instanceof Map) {
        value.forEach((entry, key) => visit(entry, key));
        return;
      }

      if (value instanceof Set) {
        value.forEach(entry => visit(entry));
        return;
      }

      if (Array.isArray(value.contents)) {
        value.contents.forEach(entry => visit(entry));
        return;
      }

      if (typeof value === 'object') {
        const id = value.id ?? value.key ?? fallbackId;
        const looksLikeStatusEffect = id && (
          value.label ||
          value.name ||
          value.icon ||
          value.img ||
          value.description
        );

        if (looksLikeStatusEffect) {
          results.push({ ...value, id });
          return;
        }

        Object.entries(value).forEach(([key, entry]) => visit(entry, key));
        return;
      }

      const id = fallbackId || String(value);
      results.push({ id, label: value });
    };

    visit(source);
    return results;
  }

  _getActorConditionDocuments(actor, statusId) {
    const docs = [
      ...this._collectionToArray(actor?.effects),
      ...this._collectionToArray(actor?.items),
      ...this._collectionToArray(actor?.itemTypes?.condition),
      ...this._collectionToArray(actor?.conditions?.active),
      ...this._collectionToArray(actor?.conditions?.stored),
    ];
    const seen = new Set();

    return docs.filter(doc => {
      if (!this._documentMatchesCondition(doc, statusId)) return false;
      const key = doc.uuid ?? doc.id ?? doc;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  _collectionToArray(collection) {
    if (!collection) return [];
    if (Array.isArray(collection)) return collection;
    if (Array.isArray(collection.contents)) return collection.contents;
    if (typeof collection.values === 'function') return Array.from(collection.values());
    if (typeof collection === 'object') return Object.values(collection);
    return [];
  }

  _documentMatchesCondition(doc, statusId) {
    if (!doc || !statusId) return false;
    if (doc.statuses?.has?.(statusId)) return true;
    if (Array.isArray(doc.statuses) && doc.statuses.includes(statusId)) return true;
    return [
      doc.id,
      doc.slug,
      doc.key,
      doc.system?.slug,
      doc.system?.slug?.value,
    ].some(value => value === statusId);
  }
}

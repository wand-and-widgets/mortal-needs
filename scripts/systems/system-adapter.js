/**
 * SystemAdapter - Abstraction layer for game system compatibility
 * Allows Mortal Needs to work with different RPG systems
 * @module mortal-needs/systems/system-adapter
 */

/**
 * Base adapter class with generic implementations
 * System-specific adapters should extend this class
 */
export class SystemAdapter {
    /**
     * Get the system ID this adapter supports
     * @returns {string} System ID
     */
    static get systemId() {
        return 'generic';
    }

    /**
     * Factory method to create appropriate adapter for current system
     * @param {string} systemId - The game system ID
     * @returns {SystemAdapter} Appropriate adapter instance
     */
    static create(systemId) {
        switch (systemId) {
            case 'dnd5e':
                return new DnD5eAdapter();
            case 'pf2e':
                return new PF2eAdapter();
            case 'swade':
                return new SwadeAdapter();
            case 'wfrp4e':
                return new WFRP4eAdapter();
            default:
                console.warn(`Mortal Needs | No specific adapter for system '${systemId}', using generic adapter`);
                return new SystemAdapter();
        }
    }

    /**
     * Get the constitution (or equivalent) score for an actor
     * @param {Actor} actor - The actor
     * @returns {number|null} Constitution score or null if not applicable
     */
    getConstitutionScore(actor) {
        return this.getAttributeValue(actor, 'con');
    }

    /**
     * Get a specific attribute/ability value for an actor
     * @param {Actor} actor - The actor
     * @param {string} attributeKey - The attribute key (e.g., 'con', 'str', 'wis')
     * @returns {number|null} Attribute value or null if not found
     */
    getAttributeValue(actor, attributeKey) {
        const data = actor.system;

        // Try various common attribute paths with the given key
        const paths = [
            `abilities.${attributeKey}.value`,
            `abilities.${attributeKey}.total`,
            `attributes.${attributeKey}.value`,
            `stats.${attributeKey}.value`,
            `characteristics.${attributeKey}.value`
        ];

        for (const path of paths) {
            const value = foundry.utils.getProperty(data, path);
            if (typeof value === 'number') {
                return value;
            }
        }

        // Try skill paths
        const skillPaths = [
            `skills.${attributeKey}.total`,
            `skills.${attributeKey}.value`,
            `skills.${attributeKey}.mod`
        ];

        for (const path of skillPaths) {
            const value = foundry.utils.getProperty(data, path);
            if (typeof value === 'number') {
                // For skills, convert modifier to pseudo-score (10 + mod*2)
                if (path.endsWith('.mod')) {
                    return 10 + (value * 2);
                }
                return value;
            }
        }

        return null;
    }

    /**
     * Get available attributes for this system
     * @returns {Array<{key: string, label: string, group: string}>}
     */
    getAvailableAttributes() {
        return [
            { key: 'con', label: 'Constitution', group: 'attributes' },
            { key: 'str', label: 'Strength', group: 'attributes' },
            { key: 'dex', label: 'Dexterity', group: 'attributes' },
            { key: 'int', label: 'Intelligence', group: 'attributes' },
            { key: 'wis', label: 'Wisdom', group: 'attributes' },
            { key: 'cha', label: 'Charisma', group: 'attributes' }
        ];
    }

    /**
     * Get the attribute name used for resilience calculations
     * @returns {string} Localized attribute name
     */
    getResilienceAttributeName() {
        return 'Constitution';
    }

    /**
     * Check if the actor is a player character
     * @param {Actor} actor - The actor to check
     * @returns {boolean} True if player character
     */
    isPlayerCharacter(actor) {
        return actor.hasPlayerOwner && actor.type === 'character';
    }

    /**
     * Get exhaustion/fatigue level from system
     * @param {Actor} actor - The actor
     * @returns {number} Current exhaustion level (0-6 typically)
     */
    getExhaustionLevel(actor) {
        return 0;
    }

    /**
     * Apply exhaustion effect to actor
     * @param {Actor} actor - The actor
     * @param {number} level - Exhaustion level to apply
     */
    async applyExhaustion(actor, level) {
        // Override in system-specific adapters
        console.warn('Mortal Needs | Exhaustion application not implemented for this system');
    }

    /**
     * Get actor's portrait image
     * @param {Actor} actor - The actor
     * @returns {string} Image path
     */
    getActorPortrait(actor) {
        return actor.img || 'icons/svg/mystery-man.svg';
    }
}

/**
 * D&D 5th Edition adapter
 */
class DnD5eAdapter extends SystemAdapter {
    static get systemId() {
        return 'dnd5e';
    }

    getAttributeValue(actor, attributeKey) {
        const data = actor.system;

        // Check abilities first
        const abilityValue = data?.abilities?.[attributeKey]?.value;
        if (typeof abilityValue === 'number') {
            return abilityValue;
        }

        // Check skills (convert modifier to pseudo-score)
        const skillMod = data?.skills?.[attributeKey]?.total;
        if (typeof skillMod === 'number') {
            return 10 + (skillMod * 2);
        }

        return null;
    }

    getAvailableAttributes() {
        return [
            // Abilities
            { key: 'str', label: 'DND5E.AbilityStr', group: 'abilities', localize: true },
            { key: 'dex', label: 'DND5E.AbilityDex', group: 'abilities', localize: true },
            { key: 'con', label: 'DND5E.AbilityCon', group: 'abilities', localize: true },
            { key: 'int', label: 'DND5E.AbilityInt', group: 'abilities', localize: true },
            { key: 'wis', label: 'DND5E.AbilityWis', group: 'abilities', localize: true },
            { key: 'cha', label: 'DND5E.AbilityCha', group: 'abilities', localize: true },
            // Skills
            { key: 'acr', label: 'DND5E.SkillAcr', group: 'skills', localize: true },
            { key: 'ani', label: 'DND5E.SkillAni', group: 'skills', localize: true },
            { key: 'arc', label: 'DND5E.SkillArc', group: 'skills', localize: true },
            { key: 'ath', label: 'DND5E.SkillAth', group: 'skills', localize: true },
            { key: 'dec', label: 'DND5E.SkillDec', group: 'skills', localize: true },
            { key: 'his', label: 'DND5E.SkillHis', group: 'skills', localize: true },
            { key: 'ins', label: 'DND5E.SkillIns', group: 'skills', localize: true },
            { key: 'itm', label: 'DND5E.SkillItm', group: 'skills', localize: true },
            { key: 'inv', label: 'DND5E.SkillInv', group: 'skills', localize: true },
            { key: 'med', label: 'DND5E.SkillMed', group: 'skills', localize: true },
            { key: 'nat', label: 'DND5E.SkillNat', group: 'skills', localize: true },
            { key: 'prc', label: 'DND5E.SkillPrc', group: 'skills', localize: true },
            { key: 'prf', label: 'DND5E.SkillPrf', group: 'skills', localize: true },
            { key: 'per', label: 'DND5E.SkillPer', group: 'skills', localize: true },
            { key: 'rel', label: 'DND5E.SkillRel', group: 'skills', localize: true },
            { key: 'slt', label: 'DND5E.SkillSlt', group: 'skills', localize: true },
            { key: 'ste', label: 'DND5E.SkillSte', group: 'skills', localize: true },
            { key: 'sur', label: 'DND5E.SkillSur', group: 'skills', localize: true }
        ];
    }

    getConstitutionScore(actor) {
        return actor.system?.abilities?.con?.value ?? null;
    }

    getResilienceAttributeName() {
        return game.i18n.localize('DND5E.AbilityCon');
    }

    isPlayerCharacter(actor) {
        return actor.hasPlayerOwner && (actor.type === 'character' || actor.type === 'npc');
    }

    getExhaustionLevel(actor) {
        // In dnd5e 3.0+, exhaustion is tracked differently
        const exhaustion = actor.system?.attributes?.exhaustion;
        return exhaustion ?? 0;
    }

    async applyExhaustion(actor, level) {
        const clampedLevel = Math.clamp(level, 0, 6);
        await actor.update({ 'system.attributes.exhaustion': clampedLevel });
    }
}

/**
 * Pathfinder 2e adapter
 */
class PF2eAdapter extends SystemAdapter {
    static get systemId() {
        return 'pf2e';
    }

    getConstitutionScore(actor) {
        // PF2e uses modifiers, we can derive score
        const conMod = actor.system?.abilities?.con?.mod ?? 0;
        return 10 + (conMod * 2);
    }

    getResilienceAttributeName() {
        return game.i18n.localize('PF2E.AbilityCon');
    }

    isPlayerCharacter(actor) {
        return actor.hasPlayerOwner && actor.type === 'character';
    }

    getExhaustionLevel(actor) {
        // PF2e uses conditions like "fatigued" and "drained"
        const fatigued = actor.hasCondition?.('fatigued') ? 1 : 0;
        const drained = actor.getCondition?.('drained')?.value ?? 0;
        return fatigued + drained;
    }

    async applyExhaustion(actor, level) {
        // Apply fatigued condition if level > 0
        if (level > 0) {
            await actor.toggleCondition?.('fatigued', { active: true });
        } else {
            await actor.toggleCondition?.('fatigued', { active: false });
        }
    }
}

/**
 * Savage Worlds Adventure Edition adapter
 */
class SwadeAdapter extends SystemAdapter {
    static get systemId() {
        return 'swade';
    }

    getConstitutionScore(actor) {
        // SWADE uses Vigor die type
        const vigor = actor.system?.attributes?.vigor?.die?.sides ?? 4;
        // Convert die type to approximate score (d4=8, d6=10, d8=12, etc.)
        return 6 + vigor;
    }

    getResilienceAttributeName() {
        return game.i18n.localize('SWADE.AttrVig');
    }

    isPlayerCharacter(actor) {
        return actor.hasPlayerOwner && actor.type === 'character';
    }

    getExhaustionLevel(actor) {
        return actor.system?.fatigue?.value ?? 0;
    }

    async applyExhaustion(actor, level) {
        const clampedLevel = Math.clamp(level, 0, 3);
        await actor.update({ 'system.fatigue.value': clampedLevel });
    }
}

/**
 * Warhammer Fantasy 4e adapter
 */
class WFRP4eAdapter extends SystemAdapter {
    static get systemId() {
        return 'wfrp4e';
    }

    getConstitutionScore(actor) {
        // WFRP4e uses Toughness
        const toughness = actor.system?.characteristics?.t?.value ?? 30;
        // Convert to D&D-like scale for consistency
        return Math.round(toughness / 3);
    }

    getResilienceAttributeName() {
        return game.i18n.localize('WFRP4E.CH.T');
    }

    isPlayerCharacter(actor) {
        return actor.hasPlayerOwner && actor.type === 'character';
    }

    getExhaustionLevel(actor) {
        // WFRP4e has different fatigue system
        const fatigue = actor.system?.status?.fatigue?.value ?? 0;
        return fatigue;
    }

    async applyExhaustion(actor, level) {
        await actor.update({ 'system.status.fatigue.value': level });
    }
}

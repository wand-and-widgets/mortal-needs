/**
 * PunishmentSystem - Handles punishment effects for critical needs
 * Supports exhaustion, damage, conditions, and max HP reduction
 * @module mortal-needs/punishment-system
 */

import { MODULE_ID, MODULE_NAME } from './constants.js';

/**
 * Punishment types available
 */
export const PUNISHMENT_TYPES = {
    NONE: 'none',
    EXHAUSTION: 'exhaustion',
    DAMAGE: 'damage',
    CONDITION: 'condition',
    MAX_HP: 'maxhp'
};

/**
 * Available damage types for D&D 5e
 */
export const DAMAGE_TYPES = {
    necrotic: { label: 'DND5E.DamageNecrotic', icon: 'fa-skull' },
    cold: { label: 'DND5E.DamageCold', icon: 'fa-snowflake' },
    fire: { label: 'DND5E.DamageFire', icon: 'fa-fire' },
    poison: { label: 'DND5E.DamagePoison', icon: 'fa-skull-crossbones' },
    psychic: { label: 'DND5E.DamagePsychic', icon: 'fa-brain' },
    radiant: { label: 'DND5E.DamageRadiant', icon: 'fa-sun' },
    bludgeoning: { label: 'DND5E.DamageBludgeoning', icon: 'fa-hammer' }
};

/**
 * Available conditions for D&D 5e (via Active Effects)
 */
export const CONDITIONS = {
    poisoned: {
        label: 'DND5E.ConPoisoned',
        icon: 'fa-biohazard',
        statusId: 'poisoned',
        description: 'MORTAL_NEEDS.Conditions.PoisonedDesc'
    },
    frightened: {
        label: 'DND5E.ConFrightened',
        icon: 'fa-ghost',
        statusId: 'frightened',
        description: 'MORTAL_NEEDS.Conditions.FrightenedDesc'
    },
    stunned: {
        label: 'DND5E.ConStunned',
        icon: 'fa-dizzy',
        statusId: 'stunned',
        description: 'MORTAL_NEEDS.Conditions.StunnedDesc'
    },
    incapacitated: {
        label: 'DND5E.ConIncapacitated',
        icon: 'fa-ban',
        statusId: 'incapacitated',
        description: 'MORTAL_NEEDS.Conditions.IncapacitatedDesc'
    }
};

/**
 * Punishment removal modes
 */
export const REMOVAL_MODES = {
    ASK_GM: 'ask_gm',
    IMMEDIATE: 'immediate',
    ON_REST: 'on_rest'
};

/**
 * Flavor text templates - Stephen King style, visceral and short
 */
export const FLAVOR_TEXTS = {
    hunger: {
        apply: [
            "Your stomach doesn't just growl—it screams.",
            "The emptiness inside has teeth now.",
            "Your body begins to consume itself.",
            "Hunger becomes a living thing, clawing at your insides."
        ],
        remove: [
            "The gnawing void quiets, for now.",
            "Your body remembers what it is to be fed."
        ]
    },
    thirst: {
        apply: [
            "Your tongue swells, a dead thing in your mouth.",
            "Every swallow is broken glass.",
            "Your blood thickens like syrup.",
            "The desert has crawled inside you."
        ],
        remove: [
            "Sweet relief floods through cracked lips.",
            "Life returns, one drop at a time."
        ]
    },
    exhaustion: {
        apply: [
            "Your bones turn to lead. Your eyes to sand.",
            "Sleep whispers dark promises.",
            "Your body betrays you, begging to collapse.",
            "The world blurs at the edges, darkness creeping in."
        ],
        remove: [
            "Strength seeps back into weary limbs.",
            "The weight lifts. You can breathe again."
        ]
    },
    cold: {
        apply: [
            "The frost finds the cracks in your soul.",
            "Your blood slows, thick and sluggish.",
            "Winter has taken root in your bones.",
            "The cold doesn't care. It never did."
        ],
        remove: [
            "Warmth blooms where ice once lived.",
            "Your blood remembers how to flow."
        ]
    },
    heat: {
        apply: [
            "The sun has crawled beneath your skin.",
            "Your thoughts melt, dripping away.",
            "Heat becomes a weight, crushing and absolute.",
            "Fire doesn't always burn—sometimes it smothers."
        ],
        remove: [
            "Cool mercy touches fevered skin.",
            "The inferno within subsides."
        ]
    },
    sanity: {
        apply: [
            "Reality cracks. Something peers through.",
            "Your mind folds in directions that shouldn't exist.",
            "The whispers aren't imagination anymore.",
            "You see the truth now. It sees you too."
        ],
        remove: [
            "The world snaps back into focus.",
            "The voices fade to manageable murmurs."
        ]
    },
    default: {
        apply: [
            "Your body pays the price.",
            "Something inside breaks.",
            "The toll is extracted.",
            "Suffering becomes a constant companion."
        ],
        remove: [
            "Relief washes over you.",
            "The burden lifts, if only slightly."
        ]
    }
};

/**
 * Main Punishment System class
 */
export class PunishmentSystem {
    /**
     * @param {NeedsManager} manager - The needs manager instance
     * @param {SystemAdapter} systemAdapter - The system adapter instance
     */
    constructor(manager, systemAdapter) {
        this.manager = manager;
        this.systemAdapter = systemAdapter;
    }

    /**
     * Get punishment configuration for a need
     * @param {string} needId - The need ID
     * @returns {object|null} Punishment config
     */
    getPunishmentConfig(needId) {
        const needConfig = this.manager.getNeedConfig(needId);
        return needConfig?.punishment || null;
    }

    /**
     * Apply punishment to an actor for a specific need
     * @param {Actor} actor - The actor to punish
     * @param {string} needId - The need that triggered punishment
     * @param {object} punishmentConfig - The punishment configuration
     * @returns {Promise<boolean>} Whether punishment was applied
     */
    async applyPunishment(actor, needId, punishmentConfig) {
        if (!actor || !punishmentConfig || punishmentConfig.type === PUNISHMENT_TYPES.NONE) {
            return false;
        }

        const { type, damageAmount, damageType, condition, maxHpReduction } = punishmentConfig;
        let result = false;

        switch (type) {
            case PUNISHMENT_TYPES.EXHAUSTION:
                result = await this._applyExhaustion(actor, needId);
                break;
            case PUNISHMENT_TYPES.DAMAGE:
                result = await this._applyDamage(actor, needId, damageAmount, damageType);
                break;
            case PUNISHMENT_TYPES.CONDITION:
                result = await this._applyCondition(actor, needId, condition);
                break;
            case PUNISHMENT_TYPES.MAX_HP:
                result = await this._applyMaxHpReduction(actor, needId, maxHpReduction);
                break;
        }

        if (result) {
            await this._sendPunishmentChat(actor, needId, punishmentConfig, 'apply');
        }

        return result;
    }

    /**
     * Check if punishment should be removed and handle removal
     * @param {Actor} actor - The actor
     * @param {string} needId - The need ID
     * @param {number} newPercentage - The new need percentage
     * @param {number} threshold - The critical threshold (e.g., 80)
     */
    async checkPunishmentRemoval(actor, needId, newPercentage, threshold) {
        const removalMode = game.settings.get(MODULE_ID, 'punishmentRemovalMode');
        const punishmentConfig = this.getPunishmentConfig(needId);

        if (!punishmentConfig || punishmentConfig.type === PUNISHMENT_TYPES.NONE) {
            return;
        }

        // Check if need dropped below critical
        if (newPercentage >= threshold) {
            return;
        }

        // Check if actor has the punishment active
        const hasActivePunishment = await this._hasActivePunishment(actor, needId, punishmentConfig);
        if (!hasActivePunishment) {
            return;
        }

        switch (removalMode) {
            case REMOVAL_MODES.IMMEDIATE:
                await this.removePunishment(actor, needId, punishmentConfig);
                break;
            case REMOVAL_MODES.ASK_GM:
                await this._showRemovalDialog(actor, needId, punishmentConfig);
                break;
            case REMOVAL_MODES.ON_REST:
                // Do nothing - punishment removed manually or on rest
                break;
        }
    }

    /**
     * Remove punishment from an actor
     * @param {Actor} actor - The actor
     * @param {string} needId - The need ID
     * @param {object} punishmentConfig - The punishment configuration
     */
    async removePunishment(actor, needId, punishmentConfig) {
        if (!actor || !punishmentConfig) return;

        const { type, condition } = punishmentConfig;

        switch (type) {
            case PUNISHMENT_TYPES.EXHAUSTION:
                await this._removeExhaustion(actor, needId);
                break;
            case PUNISHMENT_TYPES.CONDITION:
                await this._removeCondition(actor, condition);
                break;
            case PUNISHMENT_TYPES.MAX_HP:
                await this._removeMaxHpReduction(actor, needId);
                break;
            // DAMAGE cannot be "removed"
        }

        await this._sendPunishmentChat(actor, needId, punishmentConfig, 'remove');
    }

    /**
     * Apply exhaustion punishment
     * @private
     */
    async _applyExhaustion(actor, needId) {
        const currentLevel = this.systemAdapter.getExhaustionLevel(actor);
        const newLevel = Math.min(currentLevel + 1, 6);
        await this.systemAdapter.applyExhaustion(actor, newLevel);
        return true;
    }

    /**
     * Remove exhaustion (only one level, tracks per-need)
     * @private
     */
    async _removeExhaustion(actor, needId) {
        const currentLevel = this.systemAdapter.getExhaustionLevel(actor);
        const newLevel = Math.max(currentLevel - 1, 0);
        await this.systemAdapter.applyExhaustion(actor, newLevel);
    }

    /**
     * Apply damage punishment
     * @private
     */
    async _applyDamage(actor, needId, amount, damageType) {
        if (!amount || amount <= 0) return false;

        // Get current HP
        const currentHp = actor.system?.attributes?.hp?.value ?? 0;
        const newHp = Math.max(0, currentHp - amount);

        // Apply damage
        await actor.update({ 'system.attributes.hp.value': newHp });

        return true;
    }

    /**
     * Apply condition via Active Effect
     * @private
     */
    async _applyCondition(actor, needId, conditionId) {
        if (!conditionId || !CONDITIONS[conditionId]) return false;

        // Check if already has the condition
        const existingEffect = actor.effects.find(e =>
            e.statuses.has(conditionId) ||
            e.flags?.[MODULE_ID]?.needCondition === needId
        );

        if (existingEffect) return false;

        // Apply the condition using dnd5e's built-in method if available
        if (game.system.id === 'dnd5e') {
            // Try using the toggleStatusEffect method first
            try {
                await actor.toggleStatusEffect(conditionId, { active: true });

                // Mark the effect as belonging to this need
                const effect = actor.effects.find(e => e.statuses.has(conditionId));
                if (effect) {
                    await effect.setFlag(MODULE_ID, 'needCondition', needId);
                }
                return true;
            } catch (e) {
                console.warn(`${MODULE_NAME} | Failed to apply condition via toggleStatusEffect:`, e);
            }
        }

        // Fallback: Create manual Active Effect
        const effectData = {
            name: game.i18n.localize(CONDITIONS[conditionId].label),
            icon: `icons/svg/status/${conditionId}.svg`,
            statuses: [conditionId],
            flags: {
                [MODULE_ID]: {
                    needCondition: needId
                }
            }
        };

        await actor.createEmbeddedDocuments('ActiveEffect', [effectData]);
        return true;
    }

    /**
     * Remove condition from actor
     * @private
     */
    async _removeCondition(actor, conditionId) {
        if (!conditionId) return;

        // Find effect with this condition that was applied by Mortal Needs
        const effect = actor.effects.find(e =>
            e.statuses.has(conditionId) &&
            e.flags?.[MODULE_ID]?.needCondition
        );

        if (effect) {
            await effect.delete();
        }
    }

    /**
     * Apply max HP reduction
     * @private
     */
    async _applyMaxHpReduction(actor, needId, amount) {
        if (!amount || amount <= 0) return false;

        // Track the reduction in flags
        const currentReduction = actor.getFlag(MODULE_ID, `maxHpReduction_${needId}`) ?? 0;
        const newReduction = currentReduction + amount;
        await actor.setFlag(MODULE_ID, `maxHpReduction_${needId}`, newReduction);

        // Apply Active Effect to reduce max HP
        const existingEffect = actor.effects.find(e =>
            e.flags?.[MODULE_ID]?.maxHpEffect === needId
        );

        if (existingEffect) {
            // Update existing effect
            await existingEffect.update({
                changes: [{
                    key: 'system.attributes.hp.max',
                    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                    value: -newReduction
                }]
            });
        } else {
            // Create new effect
            const needName = game.i18n.localize(`MORTAL_NEEDS.Needs.${needId}`);
            await actor.createEmbeddedDocuments('ActiveEffect', [{
                name: `${needName} (${game.i18n.localize('MORTAL_NEEDS.Punishment.MaxHpReduction')})`,
                icon: 'icons/svg/downgrade.svg',
                changes: [{
                    key: 'system.attributes.hp.max',
                    mode: CONST.ACTIVE_EFFECT_MODES.ADD,
                    value: -newReduction
                }],
                flags: {
                    [MODULE_ID]: {
                        maxHpEffect: needId
                    }
                }
            }]);
        }

        return true;
    }

    /**
     * Remove max HP reduction
     * @private
     */
    async _removeMaxHpReduction(actor, needId) {
        // Clear the reduction flag
        await actor.unsetFlag(MODULE_ID, `maxHpReduction_${needId}`);

        // Remove the Active Effect
        const effect = actor.effects.find(e =>
            e.flags?.[MODULE_ID]?.maxHpEffect === needId
        );

        if (effect) {
            await effect.delete();
        }
    }

    /**
     * Check if actor has active punishment for a need
     * @private
     */
    async _hasActivePunishment(actor, needId, punishmentConfig) {
        const { type, condition } = punishmentConfig;

        switch (type) {
            case PUNISHMENT_TYPES.EXHAUSTION:
                return this.systemAdapter.getExhaustionLevel(actor) > 0;
            case PUNISHMENT_TYPES.CONDITION:
                return actor.effects.some(e =>
                    e.statuses.has(condition) &&
                    e.flags?.[MODULE_ID]?.needCondition === needId
                );
            case PUNISHMENT_TYPES.MAX_HP:
                return actor.effects.some(e =>
                    e.flags?.[MODULE_ID]?.maxHpEffect === needId
                );
            default:
                return false;
        }
    }

    /**
     * Show removal dialog for GM
     * @private
     */
    async _showRemovalDialog(actor, needId, punishmentConfig) {
        const needName = game.i18n.localize(`MORTAL_NEEDS.Needs.${needId}`);
        const punishmentName = this._getPunishmentDisplayName(punishmentConfig);

        new foundry.applications.api.DialogV2({
            window: {
                title: game.i18n.localize('MORTAL_NEEDS.Dialogs.RemovalTitle'),
                icon: 'fas fa-heart-crack'
            },
            content: `
                <div class="mn-removal-dialog">
                    <div class="mn-removal-portrait">
                        <img src="${actor.img}" alt="${actor.name}">
                    </div>
                    <div class="mn-removal-info">
                        <h3>${actor.name}</h3>
                        <p>${game.i18n.format('MORTAL_NEEDS.Dialogs.RemovalMessage', {
                            need: needName,
                            punishment: punishmentName
                        })}</p>
                        <p class="mn-removal-question">${game.i18n.localize('MORTAL_NEEDS.Dialogs.RemovalQuestion')}</p>
                    </div>
                </div>
            `,
            buttons: [
                {
                    action: 'remove',
                    label: game.i18n.localize('MORTAL_NEEDS.Dialogs.RemoveNow'),
                    icon: 'fas fa-check',
                    default: true,
                    callback: async () => {
                        await this.removePunishment(actor, needId, punishmentConfig);
                    }
                },
                {
                    action: 'keep',
                    label: game.i18n.localize('MORTAL_NEEDS.Dialogs.KeepPunishment'),
                    icon: 'fas fa-times'
                }
            ],
            rejectClose: false
        }).render(true);
    }

    /**
     * Get display name for punishment type
     * @private
     */
    _getPunishmentDisplayName(punishmentConfig) {
        const { type, condition, damageType } = punishmentConfig;

        switch (type) {
            case PUNISHMENT_TYPES.EXHAUSTION:
                return game.i18n.localize('MORTAL_NEEDS.Punishment.Exhaustion');
            case PUNISHMENT_TYPES.DAMAGE:
                const dmgLabel = DAMAGE_TYPES[damageType]?.label || damageType;
                return `${game.i18n.localize('MORTAL_NEEDS.Punishment.Damage')} (${game.i18n.localize(dmgLabel)})`;
            case PUNISHMENT_TYPES.CONDITION:
                const condLabel = CONDITIONS[condition]?.label || condition;
                return game.i18n.localize(condLabel);
            case PUNISHMENT_TYPES.MAX_HP:
                return game.i18n.localize('MORTAL_NEEDS.Punishment.MaxHpReduction');
            default:
                return game.i18n.localize('MORTAL_NEEDS.Punishment.None');
        }
    }

    /**
     * Send styled chat message for punishment
     * @private
     */
    async _sendPunishmentChat(actor, needId, punishmentConfig, action) {
        const needName = game.i18n.localize(`MORTAL_NEEDS.Needs.${needId}`);
        const flavorTexts = FLAVOR_TEXTS[needId] || FLAVOR_TEXTS.default;
        const flavors = action === 'apply' ? flavorTexts.apply : flavorTexts.remove;
        const flavor = flavors[Math.floor(Math.random() * flavors.length)];

        const templateData = {
            actor: {
                name: actor.name,
                img: actor.img
            },
            need: {
                id: needId,
                name: needName,
                icon: this.manager.getNeedConfig(needId)?.icon || 'fa-exclamation-triangle'
            },
            punishment: {
                type: punishmentConfig.type,
                displayName: this._getPunishmentDisplayName(punishmentConfig),
                amount: punishmentConfig.damageAmount || punishmentConfig.maxHpReduction || 1,
                damageType: punishmentConfig.damageType,
                damageTypeLabel: DAMAGE_TYPES[punishmentConfig.damageType]?.label
            },
            flavor,
            action,
            isApply: action === 'apply',
            isRemove: action === 'remove'
        };

        const content = await renderTemplate(
            `modules/${MODULE_ID}/templates/chat/punishment-card.hbs`,
            templateData
        );

        await ChatMessage.create({
            content,
            speaker: ChatMessage.getSpeaker({ actor }),
            flags: {
                [MODULE_ID]: {
                    type: 'punishment',
                    needId,
                    action
                }
            }
        });
    }

    /**
     * Get random flavor text for a need
     * @param {string} needId - The need ID
     * @param {string} action - 'apply' or 'remove'
     * @returns {string} Random flavor text
     */
    getFlavorText(needId, action) {
        const flavorTexts = FLAVOR_TEXTS[needId] || FLAVOR_TEXTS.default;
        const flavors = action === 'apply' ? flavorTexts.apply : flavorTexts.remove;
        return flavors[Math.floor(Math.random() * flavors.length)];
    }
}

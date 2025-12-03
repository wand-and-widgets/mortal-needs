/**
 * NeedsManager - Core data management for mortal needs
 * Handles all CRUD operations, calculations, and state management
 * @module mortal-needs/needs-manager
 */

import { MODULE_ID } from './constants.js';
import { PunishmentSystem, PUNISHMENT_TYPES, DAMAGE_TYPES, CONDITIONS } from './punishment-system.js';

/**
 * Default needs configuration
 * Each need has: id, icon, enabled, min, max, default, attribute, stressAmount, punishment
 * attribute: the key of the attribute/skill that influences stress resistance for this need (null = none)
 * stressAmount: the default stress amount to apply for this need (1-100)
 * punishment: object defining what happens at critical threshold
 *   - type: 'none', 'exhaustion', 'damage', 'condition', 'maxhp'
 *   - damageAmount: amount of damage (for 'damage' type)
 *   - damageType: type of damage (necrotic, cold, fire, poison, etc.)
 *   - condition: condition to apply (poisoned, frightened, stunned, incapacitated)
 *   - maxHpReduction: amount to reduce max HP (for 'maxhp' type)
 *   - ticks: number of stress applications at 100% before punishment triggers (1-10)
 */
const DEFAULT_NEEDS = [
    { id: 'hunger', icon: 'fa-utensils', enabled: true, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'exhaustion', ticks: 3 } },
    { id: 'thirst', icon: 'fa-tint', enabled: true, min: 0, max: 100, default: 0, attribute: null, stressAmount: 15,
      punishment: { type: 'exhaustion', ticks: 2 } },
    { id: 'exhaustion', icon: 'fa-bed', enabled: true, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'exhaustion', ticks: 3 } },
    { id: 'cold', icon: 'fa-snowflake', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'damage', damageAmount: 5, damageType: 'cold', ticks: 3 } },
    { id: 'heat', icon: 'fa-sun', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'damage', damageAmount: 5, damageType: 'fire', ticks: 3 } },
    { id: 'comfort', icon: 'fa-couch', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'none', ticks: 3 } },
    { id: 'sanity', icon: 'fa-brain', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 5,
      punishment: { type: 'condition', condition: 'frightened', ticks: 5 } },
    { id: 'morale', icon: 'fa-smile', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 5,
      punishment: { type: 'none', ticks: 5 } },
    { id: 'pain', icon: 'fa-band-aid', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'condition', condition: 'stunned', ticks: 3 } },
    { id: 'radiation', icon: 'fa-radiation', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 5,
      punishment: { type: 'maxhp', maxHpReduction: 5, ticks: 5 } },
    { id: 'corruption', icon: 'fa-skull', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 2,
      punishment: { type: 'damage', damageAmount: 10, damageType: 'necrotic', ticks: 10 } },
    { id: 'fatigue', icon: 'fa-moon', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'exhaustion', ticks: 3 } },
    { id: 'environmental', icon: 'fa-cloud', enabled: false, min: 0, max: 100, default: 0, attribute: null, stressAmount: 10,
      punishment: { type: 'condition', condition: 'poisoned', ticks: 3 } }
];

/**
 * Constitution modifier thresholds
 * Maps attribute score ranges to stress multipliers
 */
const CONSTITUTION_MODIFIERS = {
    veryLow: { max: 6, multiplier: 1.5 },    // 150% stress
    low: { max: 9, multiplier: 1.3 },         // 130% stress
    average: { max: 12, multiplier: 1.0 },    // 100% stress (baseline)
    high: { max: 15, multiplier: 0.8 },       // 80% stress
    veryHigh: { max: 18, multiplier: 0.6 },   // 60% stress
    legendary: { max: Infinity, multiplier: 0.5 } // 50% stress
};

/**
 * Main class for managing mortal needs data and operations
 */
export class NeedsManager {
    /**
     * @param {SystemAdapter} systemAdapter - Adapter for system-specific operations
     */
    constructor(systemAdapter) {
        this.systemAdapter = systemAdapter;
        this.needsConfig = [];
        this.actorNeeds = new Map(); // Map<actorId, Map<needId, value>>
        this._initialized = false;
        this.punishmentSystem = null;
    }

    /**
     * Initialize the manager
     * Loads configuration and existing actor data
     */
    async initialize() {
        if (this._initialized) return;

        // Load needs configuration from settings or use defaults
        await this._loadNeedsConfig();

        // Load existing actor needs from flags
        await this._loadActorNeeds();

        // Initialize punishment system
        this.punishmentSystem = new PunishmentSystem(this, this.systemAdapter);

        this._initialized = true;
        console.log(`${MODULE_ID} | NeedsManager initialized with ${this.needsConfig.length} needs`);
    }

    /**
     * Load needs configuration from module settings
     * @private
     */
    async _loadNeedsConfig() {
        const savedConfig = game.settings.get(MODULE_ID, 'needsConfig');

        if (savedConfig && savedConfig.length > 0) {
            this.needsConfig = savedConfig;
        } else {
            // Use defaults and save them
            this.needsConfig = foundry.utils.deepClone(DEFAULT_NEEDS);
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Load actor needs from their flags
     * @private
     */
    async _loadActorNeeds() {
        // Get tracked actor IDs from settings
        const trackedActorIds = game.settings.get(MODULE_ID, 'trackedActors') || [];

        // If no actors are tracked yet (first time), track all player-owned characters
        if (trackedActorIds.length === 0) {
            const playerActors = game.actors.filter(a =>
                a.hasPlayerOwner && (a.type === 'character' || a.type === 'npc')
            );
            for (const actor of playerActors) {
                await this.initializeActorNeeds(actor);
            }
        } else {
            // Only load tracked actors
            for (const actorId of trackedActorIds) {
                const actor = game.actors.get(actorId);
                if (actor) {
                    await this.initializeActorNeeds(actor);
                }
            }
        }
    }

    /**
     * Refresh tracked actors based on settings
     * Called when GM changes actor selection
     */
    async refreshTrackedActors() {
        // Clear current tracking
        this.actorNeeds.clear();

        // Reload from settings
        await this._loadActorNeeds();
    }

    /**
     * Initialize or load needs for a specific actor
     * @param {Actor} actor - The actor to initialize
     */
    async initializeActorNeeds(actor) {
        if (!actor) return;

        const actorId = actor.id;
        const existingNeeds = actor.getFlag(MODULE_ID, 'needs') || {};

        // Create needs map for this actor
        const needsMap = new Map();

        for (const need of this.needsConfig) {
            if (!need.enabled) continue;

            // Use existing value or default
            const value = existingNeeds[need.id] ?? need.default;
            needsMap.set(need.id, value);
        }

        this.actorNeeds.set(actorId, needsMap);
    }

    /**
     * Get all enabled needs configurations
     * @returns {Array} Array of enabled need configs
     */
    getEnabledNeeds() {
        return this.needsConfig.filter(n => n.enabled);
    }

    /**
     * Get all needs configurations
     * @returns {Array} Array of all need configs
     */
    getAllNeeds() {
        return [...this.needsConfig];
    }

    /**
     * Get a specific need configuration
     * @param {string} needId - The need ID
     * @returns {object|null} The need config or null
     */
    getNeedConfig(needId) {
        return this.needsConfig.find(n => n.id === needId) || null;
    }

    /**
     * Get all actors with needs tracking
     * @returns {Array} Array of actor objects with their needs data
     */
    getTrackedActors() {
        const result = [];

        for (const [actorId, needsMap] of this.actorNeeds) {
            const actor = game.actors.get(actorId);
            if (!actor) continue;

            const needs = {};
            for (const [needId, value] of needsMap) {
                const config = this.getNeedConfig(needId);
                if (config && config.enabled) {
                    needs[needId] = {
                        value,
                        max: config.max,
                        min: config.min,
                        icon: config.icon
                    };
                }
            }

            result.push({
                id: actorId,
                name: actor.name,
                img: actor.img,
                needs
            });
        }

        return result;
    }

    /**
     * Get needs data for a specific actor
     * @param {string} actorId - The actor ID
     * @returns {object|null} Actor needs data or null
     */
    getActorNeeds(actorId) {
        const needsMap = this.actorNeeds.get(actorId);
        if (!needsMap) return null;

        const result = {};
        for (const [needId, value] of needsMap) {
            const config = this.getNeedConfig(needId);
            if (config && config.enabled) {
                result[needId] = {
                    value,
                    max: config.max,
                    min: config.min,
                    icon: config.icon
                };
            }
        }

        return result;
    }

    /**
     * Get a specific need value for an actor
     * @param {string} actorId - The actor ID
     * @param {string} needId - The need ID
     * @returns {number|null} The need value or null
     */
    getNeedValue(actorId, needId) {
        const needsMap = this.actorNeeds.get(actorId);
        return needsMap?.get(needId) ?? null;
    }

    /**
     * Calculate constitution modifier for stress calculations
     * @param {Actor} actor - The actor to check
     * @returns {number} Multiplier for stress amounts
     */
    getConstitutionModifier(actor) {
        return this.getAttributeModifier(actor, 'con');
    }

    /**
     * Calculate attribute modifier for stress calculations
     * @param {Actor} actor - The actor to check
     * @param {string|null} attributeKey - The attribute key to use (null = no resistance)
     * @returns {number} Multiplier for stress amounts
     */
    getAttributeModifier(actor, attributeKey) {
        if (!actor) return 1.0;
        if (!attributeKey || attributeKey === 'none') return 1.0;

        // Get attribute score from system adapter
        const attrScore = this.systemAdapter.getAttributeValue(actor, attributeKey);
        if (attrScore === null) return 1.0;

        // Find matching tier
        for (const [tier, data] of Object.entries(CONSTITUTION_MODIFIERS)) {
            if (attrScore <= data.max) {
                return data.multiplier;
            }
        }

        return 1.0;
    }

    /**
     * Get available attributes for the current system
     * @returns {Array} Array of attribute options
     */
    getAvailableAttributes() {
        return this.systemAdapter.getAvailableAttributes();
    }

    /**
     * Set the attribute for a specific need
     * @param {string} needId - The need ID
     * @param {string|null} attributeKey - The attribute key (null or 'none' for no resistance)
     */
    async setNeedAttribute(needId, attributeKey) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.attribute = (attributeKey === 'none' || !attributeKey) ? null : attributeKey;
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Set the stress amount for a specific need
     * @param {string} needId - The need ID
     * @param {number} amount - The stress amount (1-100)
     */
    async setNeedStressAmount(needId, amount) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.stressAmount = Math.clamp(amount, 1, 100);
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Set the auto-exhaustion flag for a specific need
     * @param {string} needId - The need ID
     * @param {boolean} enabled - Whether auto-exhaustion is enabled
     */
    async setNeedAutoExhaustion(needId, enabled) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.autoExhaustion = !!enabled;
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Set the exhaustion ticks for a specific need
     * @param {string} needId - The need ID
     * @param {number} ticks - Number of stress applications at 100% before gaining exhaustion (1-10)
     */
    async setNeedExhaustionTicks(needId, ticks) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.exhaustionTicks = Math.clamp(ticks, 1, 10);
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Get the current tick progress for an actor's need punishment
     * @param {string} actorId - The actor ID
     * @param {string} needId - The need ID
     * @returns {object} Current tick and max ticks
     */
    getPunishmentTickProgress(actorId, needId) {
        const actor = game.actors.get(actorId);
        const config = this.getNeedConfig(needId);
        if (!actor || !config) return { current: 0, max: 3 };

        const tickKey = `punishmentTicks_${needId}`;
        const currentTicks = actor.getFlag(MODULE_ID, tickKey) ?? 0;
        const maxTicks = config.punishment?.ticks ?? 3;

        return { current: currentTicks, max: maxTicks };
    }

    /**
     * Alias for backward compatibility
     * @deprecated Use getPunishmentTickProgress instead
     */
    getExhaustionTickProgress(actorId, needId) {
        return this.getPunishmentTickProgress(actorId, needId);
    }

    /**
     * Set punishment configuration for a need
     * @param {string} needId - The need ID
     * @param {object} punishmentConfig - The punishment configuration
     */
    async setNeedPunishment(needId, punishmentConfig) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.punishment = { ...config.punishment, ...punishmentConfig };
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Get available punishment types
     * @returns {object} Punishment types constants
     */
    getPunishmentTypes() {
        return PUNISHMENT_TYPES;
    }

    /**
     * Get available damage types
     * @returns {object} Damage types with labels
     */
    getDamageTypes() {
        return DAMAGE_TYPES;
    }

    /**
     * Get available conditions
     * @returns {object} Conditions with labels
     */
    getConditions() {
        return CONDITIONS;
    }

    /**
     * Apply stress to a need (increase value)
     * @param {string} actorId - The actor ID
     * @param {string} needId - The need ID
     * @param {number} amount - Base amount to add (if null, uses the need's configured stressAmount)
     * @param {object} options - Additional options
     * @param {boolean} options.applyAttrMod - Apply attribute modifier (default: true)
     * @param {boolean} options.sync - Sync via socket (default: true)
     * @returns {number|null} New value or null if failed
     */
    async stressNeed(actorId, needId, amount, options = {}) {
        const { applyAttrMod = true, sync = true } = options;

        const needsMap = this.actorNeeds.get(actorId);
        if (!needsMap || !needsMap.has(needId)) return null;

        const config = this.getNeedConfig(needId);
        if (!config) return null;

        const actor = game.actors.get(actorId);

        // Use the need's configured stressAmount if no amount provided
        let finalAmount = amount ?? config.stressAmount ?? 10;

        // Apply attribute modifier if enabled (uses the configured attribute for this need)
        if (applyAttrMod && actor && config.attribute) {
            const modifier = this.getAttributeModifier(actor, config.attribute);
            finalAmount = Math.round(finalAmount * modifier);
        }

        // Calculate new value
        const currentValue = needsMap.get(needId);
        const newValue = Math.clamp(currentValue + finalAmount, config.min, config.max);

        // Update local state
        needsMap.set(needId, newValue);

        // Persist to actor flags
        await this._persistActorNeed(actorId, needId, newValue);

        // Sync to other clients
        if (sync && game.user.isGM) {
            game.modules.get(MODULE_ID)?.api?.emitSocket?.('updateNeed', {
                actorId,
                needId,
                value: newValue
            });
        }

        // Check for threshold effects (including auto-exhaustion)
        await this._checkThresholdEffects(actorId, needId, newValue, currentValue);

        return newValue;
    }

    /**
     * Relieve a need (decrease value)
     * @param {string} actorId - The actor ID
     * @param {string} needId - The need ID
     * @param {number} amount - Amount to subtract
     * @param {object} options - Additional options
     * @returns {number|null} New value or null if failed
     */
    async relieveNeed(actorId, needId, amount, options = {}) {
        return this.stressNeed(actorId, needId, -Math.abs(amount), { ...options, applyAttrMod: false });
    }

    /**
     * Set a need to a specific value
     * @param {string} actorId - The actor ID
     * @param {string} needId - The need ID
     * @param {number} value - The value to set
     * @param {object} options - Additional options
     * @returns {number|null} New value or null if failed
     */
    async setNeed(actorId, needId, value, options = {}) {
        const { sync = true } = options;

        const needsMap = this.actorNeeds.get(actorId);
        if (!needsMap || !needsMap.has(needId)) return null;

        const config = this.getNeedConfig(needId);
        if (!config) return null;

        const newValue = Math.clamp(value, config.min, config.max);

        // Update local state
        needsMap.set(needId, newValue);

        // Persist to actor flags
        await this._persistActorNeed(actorId, needId, newValue);

        // Sync to other clients
        if (sync && game.user.isGM) {
            game.modules.get(MODULE_ID)?.api?.emitSocket?.('updateNeed', {
                actorId,
                needId,
                value: newValue
            });
        }

        // Check for threshold effects
        await this._checkThresholdEffects(actorId, needId, newValue);

        return newValue;
    }

    /**
     * Apply stress to a need for all tracked actors
     * @param {string} needId - The need ID
     * @param {number} amount - Base amount to add
     * @param {object} options - Additional options
     */
    async stressAll(needId, amount, options = {}) {
        const promises = [];

        for (const actorId of this.actorNeeds.keys()) {
            promises.push(this.stressNeed(actorId, needId, amount, options));
        }

        await Promise.all(promises);
    }

    /**
     * Relieve a need for all tracked actors
     * @param {string} needId - The need ID
     * @param {number} amount - Amount to subtract
     * @param {object} options - Additional options
     */
    async relieveAll(needId, amount, options = {}) {
        const promises = [];

        for (const actorId of this.actorNeeds.keys()) {
            promises.push(this.relieveNeed(actorId, needId, amount, options));
        }

        await Promise.all(promises);
    }

    /**
     * Apply stress to multiple needs at once for specific actors
     * @param {string[]} actorIds - Array of actor IDs
     * @param {object} needAmounts - Object mapping needId to amount
     * @param {object} options - Additional options
     */
    async stressMultiple(actorIds, needAmounts, options = {}) {
        const promises = [];

        for (const actorId of actorIds) {
            for (const [needId, amount] of Object.entries(needAmounts)) {
                promises.push(this.stressNeed(actorId, needId, amount, options));
            }
        }

        await Promise.all(promises);
    }

    /**
     * Persist a need value to actor flags
     * @private
     */
    async _persistActorNeed(actorId, needId, value) {
        const actor = game.actors.get(actorId);
        if (!actor) return;

        const currentNeeds = actor.getFlag(MODULE_ID, 'needs') || {};
        currentNeeds[needId] = value;

        await actor.setFlag(MODULE_ID, 'needs', currentNeeds);
    }

    /**
     * Check and apply threshold effects
     * @private
     */
    async _checkThresholdEffects(actorId, needId, value, previousValue = 0) {
        const config = this.getNeedConfig(needId);
        if (!config) return;

        const percentage = (value / config.max) * 100;
        const previousPercentage = (previousValue / config.max) * 100;
        const actor = game.actors.get(actorId);
        const criticalThreshold = game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80;

        // Emit hook for other modules/macros to react
        Hooks.callAll('mortalNeedsThreshold', {
            actorId,
            needId,
            value,
            percentage,
            severity: this._getSeverity(percentage)
        });

        // Punishment system (GM only)
        if (config.punishment && config.punishment.type !== PUNISHMENT_TYPES.NONE && actor && game.user.isGM) {
            await this._handlePunishment(actor, needId, percentage, previousPercentage, criticalThreshold);
        }
    }

    /**
     * Handle punishment when a need reaches critical threshold (100%)
     * Tick-based system: counts stress applications at 100%, applies punishment after X ticks
     * @private
     */
    async _handlePunishment(actor, needId, percentage, previousPercentage, criticalThreshold) {
        const config = this.getNeedConfig(needId);
        if (!config?.punishment || config.punishment.type === PUNISHMENT_TYPES.NONE) return;

        const tickKey = `punishmentTicks_${needId}`;
        const maxTicks = config.punishment.ticks ?? 3;

        // Check if we just hit 100% (crossing the threshold)
        if (percentage >= 100 && previousPercentage < 100) {
            // First time hitting 100%, apply punishment immediately
            await this.punishmentSystem.applyPunishment(actor, needId, config.punishment);

            // Reset tick counter
            await actor.setFlag(MODULE_ID, tickKey, 0);
        }
        // Already at 100%, increment tick counter
        else if (percentage >= 100 && previousPercentage >= 100) {
            const currentTicks = actor.getFlag(MODULE_ID, tickKey) ?? 0;
            const newTicks = currentTicks + 1;

            // Check if we've reached max ticks
            if (newTicks >= maxTicks) {
                // Apply punishment and reset counter
                await this.punishmentSystem.applyPunishment(actor, needId, config.punishment);
                await actor.setFlag(MODULE_ID, tickKey, 0);
            } else {
                // Just increment the tick counter
                await actor.setFlag(MODULE_ID, tickKey, newTicks);
            }
        }
        // Dropped below critical threshold, check for punishment removal
        else if (percentage < criticalThreshold && previousPercentage >= criticalThreshold) {
            await actor.setFlag(MODULE_ID, tickKey, 0);
            await this.punishmentSystem.checkPunishmentRemoval(actor, needId, percentage, criticalThreshold);
        }
        // Just dropped below 100% but still critical - reset ticks
        else if (percentage < 100 && previousPercentage >= 100) {
            await actor.setFlag(MODULE_ID, tickKey, 0);
        }
    }

    /**
     * Get severity level based on percentage
     * @private
     */
    _getSeverity(percentage) {
        if (percentage >= 80) return 'critical';
        if (percentage >= 60) return 'high';
        if (percentage >= 40) return 'medium';
        if (percentage >= 20) return 'low';
        return 'minimal';
    }

    /**
     * Handle actor updates (e.g., Constitution changes)
     * @param {Actor} actor - The updated actor
     * @param {object} changes - The changes object
     */
    onActorUpdate(actor, changes) {
        // Currently just logs, but can be extended to recalculate things
        // based on attribute changes
    }

    /**
     * Update need from socket message
     * @param {object} data - Socket data
     */
    updateNeedFromSocket(data) {
        const { actorId, needId, value } = data;
        const needsMap = this.actorNeeds.get(actorId);
        if (needsMap) {
            needsMap.set(needId, value);
        }
    }

    /**
     * Full sync from socket message
     * @param {object} data - Socket data with all actor needs
     */
    syncFromSocket(data) {
        for (const [actorId, needs] of Object.entries(data)) {
            const needsMap = this.actorNeeds.get(actorId) || new Map();
            for (const [needId, value] of Object.entries(needs)) {
                needsMap.set(needId, value);
            }
            this.actorNeeds.set(actorId, needsMap);
        }
    }

    /**
     * Enable or disable a need type
     * @param {string} needId - The need ID
     * @param {boolean} enabled - Whether to enable
     */
    async setNeedEnabled(needId, enabled) {
        const config = this.needsConfig.find(n => n.id === needId);
        if (config) {
            config.enabled = enabled;
            await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);
        }
    }

    /**
     * Add a new custom need type
     * @param {object} needConfig - The need configuration
     */
    async addCustomNeed(needConfig) {
        const { id, icon = 'fa-question', min = 0, max = 100, defaultValue = 0 } = needConfig;

        // Check if already exists
        if (this.needsConfig.find(n => n.id === id)) {
            throw new Error(`Need with id '${id}' already exists`);
        }

        this.needsConfig.push({
            id,
            icon,
            enabled: true,
            min,
            max,
            default: defaultValue,
            custom: true
        });

        await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);

        // Initialize this need for all tracked actors
        for (const [actorId, needsMap] of this.actorNeeds) {
            needsMap.set(id, defaultValue);
            await this._persistActorNeed(actorId, id, defaultValue);
        }
    }

    /**
     * Remove a custom need type
     * @param {string} needId - The need ID to remove
     */
    async removeCustomNeed(needId) {
        const index = this.needsConfig.findIndex(n => n.id === needId && n.custom);
        if (index === -1) {
            throw new Error(`Custom need '${needId}' not found`);
        }

        this.needsConfig.splice(index, 1);
        await game.settings.set(MODULE_ID, 'needsConfig', this.needsConfig);

        // Remove from all actors
        for (const [actorId, needsMap] of this.actorNeeds) {
            needsMap.delete(needId);
            const actor = game.actors.get(actorId);
            if (actor) {
                const currentNeeds = actor.getFlag(MODULE_ID, 'needs') || {};
                delete currentNeeds[needId];
                await actor.setFlag(MODULE_ID, 'needs', currentNeeds);
            }
        }
    }
}

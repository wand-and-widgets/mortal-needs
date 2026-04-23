/**
 * Settings registration for Mortal Needs module (Foundry v13)
 * @module mortal-needs/settings
 */

import { MODULE_ID, MODULE_TITLE as MODULE_NAME } from './constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Register all module settings
 */
export function registerSettings() {
    // Needs Configuration (hidden, stores the full config)
    game.settings.register(MODULE_ID, 'needsConfig', {
        name: 'Needs Configuration',
        hint: 'Internal storage for needs configuration',
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

    // Tracked Actors (hidden, stores actor IDs to track)
    game.settings.register(MODULE_ID, 'trackedActors', {
        name: 'Tracked Actors',
        hint: 'Internal storage for tracked actor IDs',
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

    // Default Stress Amount
    game.settings.register(MODULE_ID, 'defaultStressAmount', {
        name: 'MORTAL_NEEDS.Settings.DefaultStressAmount',
        hint: 'MORTAL_NEEDS.Settings.DefaultStressAmountHint',
        scope: 'world',
        config: false,
        type: Number,
        default: 20,
        range: {
            min: 1,
            max: 50,
            step: 1
        }
    });

    // Apply Constitution Modifier (DEPRECATED - now configured per-need via resistance attribute)
    // Kept for backward compatibility but hidden from settings UI
    game.settings.register(MODULE_ID, 'applyConModifier', {
        name: 'MORTAL_NEEDS.Settings.ApplyConModifier',
        hint: 'MORTAL_NEEDS.Settings.ApplyConModifierHint',
        scope: 'world',
        config: false,  // Hidden - resistance is now per-need
        type: Boolean,
        default: true
    });

    // Show Need Values (DEPRECATED - values are always shown in horizontal mode, hidden in vertical)
    // Kept for potential future use but hidden from settings UI
    game.settings.register(MODULE_ID, 'showNeedValues', {
        name: 'MORTAL_NEEDS.Settings.ShowNeedValues',
        hint: 'MORTAL_NEEDS.Settings.ShowNeedValuesHint',
        scope: 'world',
        config: false,  // Hidden - behavior now depends on bar orientation
        type: Boolean,
        default: true
    });

    // Player Visibility Mode
    game.settings.register(MODULE_ID, 'playerVisibility', {
        name: 'MORTAL_NEEDS.Settings.PlayerVisibility',
        hint: 'MORTAL_NEEDS.Settings.PlayerVisibilityHint',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            'none': 'MORTAL_NEEDS.Settings.PlayerVisibilityNone',
            'own': 'MORTAL_NEEDS.Settings.PlayerVisibilityOwn',
            'all': 'MORTAL_NEEDS.Settings.PlayerVisibilityAll'
        },
        default: 'own'
    });

    // Bar Animation
    game.settings.register(MODULE_ID, 'animateBars', {
        name: 'MORTAL_NEEDS.Settings.AnimateBars',
        hint: 'MORTAL_NEEDS.Settings.AnimateBarsHint',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
    });

    // Compact Mode (DEPRECATED - replaced by barOrientation setting)
    // Kept for backward compatibility but hidden from settings UI
    game.settings.register(MODULE_ID, 'compactMode', {
        name: 'MORTAL_NEEDS.Settings.CompactMode',
        hint: 'MORTAL_NEEDS.Settings.CompactModeHint',
        scope: 'client',
        config: false,  // Hidden - replaced by barOrientation
        type: Boolean,
        default: false
    });

    // Bar Orientation
    game.settings.register(MODULE_ID, 'barOrientation', {
        name: 'MORTAL_NEEDS.Settings.BarOrientation',
        hint: 'MORTAL_NEEDS.Settings.BarOrientationHint',
        scope: 'client',
        config: true,
        type: String,
        choices: {
            'vertical': 'MORTAL_NEEDS.Settings.BarOrientationVertical',
            'horizontal': 'MORTAL_NEEDS.Settings.BarOrientationHorizontal'
        },
        default: 'vertical',
        onChange: () => {
            game.modules.get(MODULE_ID)?.api?.ui?.render();
        }
    });

    // Panel Position (stored internally)
    game.settings.register(MODULE_ID, 'panelPosition', {
        name: 'Panel Position',
        scope: 'client',
        config: false,
        type: Object,
        default: { top: 100, left: 120 }
    });

    // UI Scale (visible to all users - each player can adjust their own UI size)
    game.settings.register(MODULE_ID, 'uiScale', {
        name: 'MORTAL_NEEDS.Settings.UIScale',
        hint: 'MORTAL_NEEDS.Settings.UIScaleHint',
        scope: 'client',
        config: true,
        type: Number,
        default: 100,
        range: {
            min: 80,
            max: 200,
            step: 10
        },
        onChange: () => {
            game.modules.get(MODULE_ID)?.api?.ui?.render();
        }
    });

    // Notification on Critical
    game.settings.register(MODULE_ID, 'notifyOnCritical', {
        name: 'MORTAL_NEEDS.Settings.NotifyOnCritical',
        hint: 'MORTAL_NEEDS.Settings.NotifyOnCriticalHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // Critical Threshold
    game.settings.register(MODULE_ID, 'criticalThreshold', {
        name: 'MORTAL_NEEDS.Settings.CriticalThreshold',
        hint: 'MORTAL_NEEDS.Settings.CriticalThresholdHint',
        scope: 'world',
        config: true,
        type: Number,
        default: 80,
        range: {
            min: 50,
            max: 100,
            step: 5
        }
    });

    // Punishment Removal Mode
    game.settings.register(MODULE_ID, 'punishmentRemovalMode', {
        name: 'MORTAL_NEEDS.Settings.PunishmentRemovalMode',
        hint: 'MORTAL_NEEDS.Settings.PunishmentRemovalModeHint',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            'ask_gm': 'MORTAL_NEEDS.Settings.RemovalModeAskGM',
            'immediate': 'MORTAL_NEEDS.Settings.RemovalModeImmediate',
            'on_rest': 'MORTAL_NEEDS.Settings.RemovalModeOnRest'
        },
        default: 'ask_gm'
    });

    // Show Punishment Chat Messages
    game.settings.register(MODULE_ID, 'showPunishmentChat', {
        name: 'MORTAL_NEEDS.Settings.ShowPunishmentChat',
        hint: 'MORTAL_NEEDS.Settings.ShowPunishmentChatHint',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // Register setting menu for needs configuration
    game.settings.registerMenu(MODULE_ID, 'configureNeeds', {
        name: 'MORTAL_NEEDS.Settings.ConfigureNeeds',
        label: 'MORTAL_NEEDS.Settings.ConfigureNeedsLabel',
        hint: 'MORTAL_NEEDS.Settings.ConfigureNeedsHint',
        icon: 'fas fa-bars',
        type: NeedsConfigMenu,
        restricted: true
    });

    // Register setting menu for actor selection
    game.settings.registerMenu(MODULE_ID, 'configureActors', {
        name: 'MORTAL_NEEDS.Settings.ConfigureActors',
        label: 'MORTAL_NEEDS.Settings.ConfigureActorsLabel',
        hint: 'MORTAL_NEEDS.Settings.ConfigureActorsHint',
        icon: 'fas fa-users',
        type: ActorSelectionMenu,
        restricted: true
    });

    console.log(`${MODULE_NAME} | Settings registered`);
}

/**
 * Configuration menu for needs (Foundry v13 ApplicationV2)
 */
class NeedsConfigMenu extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(options = {}) {
        super(options);
        console.log('Mortal Needs | NeedsConfigMenu constructor called');
    }

    static DEFAULT_OPTIONS = {
        id: 'mortal-needs-config-menu',
        classes: ['mortal-needs', 'needs-config'],
        tag: 'form',
        window: {
            frame: true,
            positioned: true,
            title: 'MORTAL_NEEDS.Settings.ConfigureNeeds',
            icon: 'fas fa-cog'
        },
        position: {
            width: 450,
            height: 'auto'
        },
        form: {
            handler: NeedsConfigMenu.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addCustomNeed: NeedsConfigMenu.#onAddCustomNeed,
            removeNeed: NeedsConfigMenu.#onRemoveNeed,
            toggleNeedDetails: NeedsConfigMenu.#onToggleNeedDetails,
            changePunishmentType: NeedsConfigMenu.#onChangePunishmentType
        }
    };

    static PARTS = {
        form: {
            id: 'form',
            template: `modules/${MODULE_ID}/templates/needs-config-dialog.hbs`
        }
    };

    async _prepareContext(options) {
        console.log('Mortal Needs | _prepareContext CALLED');

        const manager = game.modules.get(MODULE_ID)?.api?.manager;
        console.log('Mortal Needs | manager:', manager);

        if (!manager) {
            console.log('Mortal Needs | No manager, returning empty');
            return { needs: [], damageTypes: [], conditions: [], attributeGroups: [] };
        }

        const allNeeds = manager.getAllNeeds();
        const damageTypes = manager.getDamageTypes();
        const conditions = manager.getConditions();

        console.log('Mortal Needs | _prepareContext - damageTypes:', damageTypes);
        console.log('Mortal Needs | _prepareContext - conditions:', conditions);

        // Get saved UI scale
        const savedScale = game.settings.get(MODULE_ID, 'uiScale') ?? 100;

        // Prepare attribute groups for the template
        const availableAttrs = manager.getAvailableAttributes();
        const groupedAttrs = {};
        for (const attr of availableAttrs) {
            const groupKey = attr.group || 'other';
            if (!groupedAttrs[groupKey]) {
                groupedAttrs[groupKey] = [];
            }
            groupedAttrs[groupKey].push({
                key: attr.key,
                label: attr.localize ? game.i18n.localize(attr.label) : attr.label
            });
        }

        const attributeGroups = [
            { key: 'abilities', label: game.i18n.localize('MORTAL_NEEDS.Settings.Abilities'), attributes: groupedAttrs.abilities || [] },
            { key: 'skills', label: game.i18n.localize('MORTAL_NEEDS.Settings.Skills'), attributes: groupedAttrs.skills || [] }
        ].filter(g => g.attributes.length > 0);

        // Default punishment structure with all possible fields
        const defaultPunishment = {
            type: 'none',
            ticks: 3,
            damageAmount: 5,
            damageType: 'necrotic',
            condition: 'poisoned',
            maxHpReduction: 5
        };

        // Prepare damage types and conditions lists
        const damageTypesList = Object.entries(damageTypes || {}).map(([key, data]) => ({
            key,
            label: game.i18n.localize(data.label)
        }));

        const conditionsList = Object.entries(conditions || {}).map(([key, data]) => ({
            key,
            label: game.i18n.localize(data.label)
        }));

        console.log('Mortal Needs | _prepareContext - damageTypesList:', damageTypesList);
        console.log('Mortal Needs | _prepareContext - conditionsList:', conditionsList);

        return {
            needs: allNeeds.map(n => {
                const punishment = { ...defaultPunishment, ...(n.punishment || {}) };
                return {
                    ...n,
                    name: game.i18n.localize(`MORTAL_NEEDS.Needs.${n.id}`),
                    punishment,
                    // Pre-compute selected states for dropdowns to avoid complex Handlebars logic
                    damageTypesWithSelected: damageTypesList.map(dt => ({
                        ...dt,
                        selected: dt.key === punishment.damageType
                    })),
                    conditionsWithSelected: conditionsList.map(c => ({
                        ...c,
                        selected: c.key === punishment.condition
                    }))
                };
            }),
            damageTypes: damageTypesList,
            conditions: conditionsList,
            attributeGroups,
            uiScale: savedScale,
            uiScaleRaw: savedScale
        };
    }

    static async #onSubmit(event, form, formData) {
        const manager = game.modules.get(MODULE_ID)?.api?.manager;
        if (!manager) return;

        const allNeeds = manager.getAllNeeds();
        for (const need of allNeeds) {
            const enabled = formData.object[`${need.id}-enabled`] ?? false;
            await manager.setNeedEnabled(need.id, enabled);

            // Update stress amount
            const stressAmount = formData.object[`${need.id}-stressAmount`];
            if (stressAmount !== undefined) {
                await manager.setNeedStressAmount(need.id, parseInt(stressAmount));
            }

            // Update attribute
            const attribute = formData.object[`${need.id}-attribute`];
            if (attribute !== undefined) {
                await manager.setNeedAttribute(need.id, attribute === 'none' ? null : attribute);
            }

            // Update punishment configuration
            const punishmentType = formData.object[`${need.id}-punishmentType`];
            if (punishmentType !== undefined) {
                // Get existing punishment config from the manager to preserve values when type changes
                const needConfig = manager.getNeedConfig(need.id);
                const existingPunishment = needConfig?.punishment || {};

                // Always save all punishment fields to preserve values when switching types
                // Hidden inputs may not be included in formData, so use existing values as fallback
                const punishmentConfig = {
                    type: punishmentType,
                    ticks: parseInt(formData.object[`${need.id}-punishmentTicks`]) || existingPunishment.ticks || 3,
                    // Always include all type-specific options (using formData or existing values)
                    damageAmount: parseInt(formData.object[`${need.id}-damageAmount`]) || existingPunishment.damageAmount || 5,
                    damageType: formData.object[`${need.id}-damageType`] || existingPunishment.damageType || 'necrotic',
                    condition: formData.object[`${need.id}-condition`] || existingPunishment.condition || 'poisoned',
                    maxHpReduction: parseInt(formData.object[`${need.id}-maxHpReduction`]) || existingPunishment.maxHpReduction || 5
                };

                await manager.setNeedPunishment(need.id, punishmentConfig);
            }
        }

        // Save UI scale
        const uiScale = formData.object.uiScale;
        if (uiScale !== undefined) {
            await game.settings.set(MODULE_ID, 'uiScale', parseInt(uiScale));
        }

        game.modules.get(MODULE_ID)?.api?.ui?.render();
    }

    static async #onAddCustomNeed(event, target) {
        const manager = game.modules.get(MODULE_ID)?.api?.manager;
        if (!manager) return;

        const self = this;

        new foundry.applications.api.DialogV2({
            window: { title: game.i18n.localize('MORTAL_NEEDS.Settings.AddCustomNeed') },
            content: `
                <form>
                    <div class="form-group">
                        <label>${game.i18n.localize('MORTAL_NEEDS.Settings.NeedId')}</label>
                        <input type="text" name="id" placeholder="my_need" required>
                        <p class="notes">${game.i18n.localize('MORTAL_NEEDS.Settings.NeedIdHint')}</p>
                    </div>
                    <div class="form-group">
                        <label>${game.i18n.localize('MORTAL_NEEDS.Settings.NeedIcon')}</label>
                        <input type="text" name="icon" value="fa-question" placeholder="fa-icon-name">
                        <p class="notes">${game.i18n.localize('MORTAL_NEEDS.Settings.NeedIconHint')}</p>
                    </div>
                </form>
            `,
            buttons: [
                {
                    action: 'add',
                    label: game.i18n.localize('Add'),
                    icon: 'fas fa-plus',
                    default: true,
                    callback: async (event, button, dialog) => {
                        const form = dialog.querySelector('form');
                        const id = form.querySelector('input[name="id"]').value
                            .trim()
                            .toLowerCase()
                            .replace(/\s+/g, '_')
                            .replace(/[^a-z0-9_]/g, '');
                        const icon = form.querySelector('input[name="icon"]').value.trim() || 'fa-question';

                        if (id) {
                            try {
                                await manager.addCustomNeed({ id, icon });
                                self.render();
                                ui.notifications.info(
                                    game.i18n.format('MORTAL_NEEDS.Notifications.NeedAdded', { name: id })
                                );
                            } catch (error) {
                                ui.notifications.error(error.message);
                            }
                        }
                    }
                },
                {
                    action: 'cancel',
                    label: game.i18n.localize('Cancel'),
                    icon: 'fas fa-times'
                }
            ],
            rejectClose: false
        }).render(true);
    }

    static async #onRemoveNeed(event, target) {
        const manager = game.modules.get(MODULE_ID)?.api?.manager;
        if (!manager) return;

        const needId = target.dataset.needId;
        const self = this;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize('MORTAL_NEEDS.Settings.RemoveNeed') },
            content: `<p>${game.i18n.format('MORTAL_NEEDS.Settings.RemoveNeedConfirm', { name: needId })}</p>`
        });

        if (confirmed) {
            try {
                await manager.removeCustomNeed(needId);
                self.render();
                ui.notifications.info(
                    game.i18n.format('MORTAL_NEEDS.Notifications.NeedRemoved', { name: needId })
                );
            } catch (error) {
                ui.notifications.error(error.message);
            }
        }
    }

    static #onToggleNeedDetails(event, target) {
        const needId = target.dataset.needId;
        const detailsRow = this.element.querySelector(`[data-need-details="${needId}"]`);
        const icon = target.querySelector('i');

        if (detailsRow) {
            const isVisible = detailsRow.style.display !== 'none';
            detailsRow.style.display = isVisible ? 'none' : '';

            // Toggle icon
            if (icon) {
                icon.classList.toggle('fa-chevron-down', isVisible);
                icon.classList.toggle('fa-chevron-up', !isVisible);
            }
        }
    }

    /**
     * Handle punishment type change via action
     * @param {Event} event - The change event
     * @param {HTMLElement} target - The select element
     */
    static #onChangePunishmentType(event, target) {
        const needId = target.dataset.needId;
        const punishmentType = target.value;
        console.log(`Mortal Needs | Punishment type changed for ${needId} to ${punishmentType}`);

        const row = this.element.querySelector(`.need-config-row[data-need-id="${needId}"]`);
        if (!row) {
            console.warn('Mortal Needs | Row not found for need:', needId);
            return;
        }

        // Hide all punishment option groups within this row
        row.querySelectorAll('[data-punishment-options]').forEach(el => {
            el.style.display = 'none';
        });

        // Show the relevant option group based on punishment type
        if (punishmentType !== 'none' && punishmentType !== 'exhaustion') {
            const optionGroup = row.querySelector(`[data-punishment-options="${punishmentType}"]`);
            if (optionGroup) {
                optionGroup.style.display = 'flex';
                optionGroup.style.flexDirection = 'column';
            }
        }

        // Show/hide ticks group (visible for all punishment types except 'none')
        const ticksGroup = row.querySelector('.ticks-group');
        if (ticksGroup) {
            ticksGroup.style.display = punishmentType === 'none' ? 'none' : 'flex';
            if (punishmentType !== 'none') {
                ticksGroup.style.flexDirection = 'column';
            }
        }
    }
}

/**
 * Actor selection menu (Foundry v13 ApplicationV2)
 * Allows GM to choose which actors to track
 */
class ActorSelectionMenu extends HandlebarsApplicationMixin(ApplicationV2) {
    static DEFAULT_OPTIONS = {
        id: 'mortal-needs-actor-selection',
        classes: ['mortal-needs', 'actor-selection'],
        tag: 'form',
        window: {
            frame: true,
            positioned: true,
            title: 'MORTAL_NEEDS.Settings.ConfigureActors',
            icon: 'fas fa-users'
        },
        position: {
            width: 500,
            height: 'auto'
        },
        form: {
            handler: ActorSelectionMenu.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            selectAll: ActorSelectionMenu.#onSelectAll,
            deselectAll: ActorSelectionMenu.#onDeselectAll
        }
    };

    static PARTS = {
        form: {
            id: 'form',
            template: `modules/${MODULE_ID}/templates/actor-selection-dialog.hbs`
        }
    };

    async _prepareContext(options) {
        // Get all player-owned character actors
        const allActors = game.actors.filter(a =>
            a.hasPlayerOwner && (a.type === 'character' || a.type === 'npc')
        );

        // Get currently tracked actors
        const trackedActorIds = game.settings.get(MODULE_ID, 'trackedActors') || [];

        // If no actors are tracked yet, default to all player-owned characters
        const isFirstTime = trackedActorIds.length === 0;

        const actors = allActors.map(actor => ({
            id: actor.id,
            name: actor.name,
            img: actor.img || 'icons/svg/mystery-man.svg',
            type: actor.type,
            tracked: isFirstTime ? true : trackedActorIds.includes(actor.id),
            owners: Object.entries(actor.ownership)
                .filter(([id, level]) => level >= 3 && id !== 'default')
                .map(([id]) => game.users.get(id)?.name)
                .filter(Boolean)
                .join(', ') || game.i18n.localize('MORTAL_NEEDS.Settings.NoOwners')
        }));

        // Sort: tracked first, then by name
        actors.sort((a, b) => {
            if (a.tracked !== b.tracked) return b.tracked - a.tracked;
            return a.name.localeCompare(b.name);
        });

        return { actors, isFirstTime };
    }

    static async #onSubmit(event, form, formData) {
        const trackedActorIds = [];

        // Collect all checked actor IDs
        for (const [key, value] of Object.entries(formData.object)) {
            if (key.startsWith('actor-') && value === true) {
                const actorId = key.replace('actor-', '');
                trackedActorIds.push(actorId);
            }
        }

        // Save to settings
        await game.settings.set(MODULE_ID, 'trackedActors', trackedActorIds);

        // Refresh the manager and UI
        const manager = game.modules.get(MODULE_ID)?.api?.manager;
        if (manager) {
            await manager.refreshTrackedActors();
        }

        game.modules.get(MODULE_ID)?.api?.ui?.render();

        ui.notifications.info(
            game.i18n.format('MORTAL_NEEDS.Notifications.ActorsUpdated', { count: trackedActorIds.length })
        );
    }

    static #onSelectAll(event, target) {
        const form = this.element.querySelector('form');
        form.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
    }

    static #onDeselectAll(event, target) {
        const form = this.element.querySelector('form');
        form.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
    }
}

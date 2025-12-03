/**
 * MortalNeedsUI - Main UI widget for the Mortal Needs module
 * Uses Foundry v13 ApplicationV2 API
 * BG3-inspired compact design with vertical bars and progressive disclosure
 * @module mortal-needs/ui/mortal-needs-ui
 */

import { MODULE_ID, MODULE_NAME } from '../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Main Application class for the Mortal Needs panel
 * Extends Foundry v13's ApplicationV2 with Handlebars support
 */
export class MortalNeedsUI extends HandlebarsApplicationMixin(ApplicationV2) {
    /**
     * @param {NeedsManager} manager - The needs manager instance
     * @param {object} options - Application options
     */
    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this._dragData = null;
        this._selectedActors = new Set();
        this._expandedActors = new Set();
        this._tooltip = null;
        this._panelDrag = null; // For panel repositioning
        this._panelDragBound = false; // Flag to prevent duplicate event listeners
    }

    /**
     * Default application configuration
     * Frameless HUD-style panel for immersive in-game experience
     */
    static DEFAULT_OPTIONS = {
        id: 'mortal-needs-panel',
        classes: ['mortal-needs', 'mortal-needs-panel', 'mn-hud-mode'],
        tag: 'div',
        window: {
            frame: false,
            positioned: true,
            minimizable: false,
            resizable: false
        },
        position: {
            width: 'auto',
            height: 'auto'
            // Note: top/left are NOT set here - they are loaded from settings in _preRender
        },
        actions: {
            selectActor: MortalNeedsUI.#onActorSelect,
            openActorSheet: MortalNeedsUI.#onOpenActorSheet,
            stressNeed: MortalNeedsUI.#onStressNeed,
            relieveNeed: MortalNeedsUI.#onRelieveNeed,
            stressAll: MortalNeedsUI.#onStressAll,
            relieveAll: MortalNeedsUI.#onRelieveAll,
            selectAllActors: MortalNeedsUI.#onSelectAll,
            deselectAllActors: MortalNeedsUI.#onDeselectAll,
            openMultiStress: MortalNeedsUI.#onMultiStress,
            openSettings: MortalNeedsUI.#onOpenSettings,
            toggleExpand: MortalNeedsUI.#onToggleExpand,
            openActorSelection: MortalNeedsUI.#onOpenActorSelection
        }
    };

    /**
     * Load saved position before rendering
     * @param {object} options - Render options
     * @override
     */
    async _preRender(options) {
        await super._preRender(options);

        // Load saved position from settings
        const savedPosition = game.settings.get(MODULE_ID, 'panelPosition');
        const defaultTop = 100;
        const defaultLeft = 120;

        // Set position for this render
        this.position.top = savedPosition?.top ?? defaultTop;
        this.position.left = savedPosition?.left ?? defaultLeft;
    }

    /**
     * Handlebars template parts
     */
    static PARTS = {
        panel: {
            id: 'panel',
            template: `modules/${MODULE_ID}/templates/mortal-needs-panel.hbs`,
            scrollable: ['.mn-actors-grid']
        }
    };

    /**
     * Prepare context data for rendering
     * @param {object} options - Render options
     * @returns {object} Template context
     */
    async _prepareContext(options) {
        const allActors = this.manager.getTrackedActors();
        const enabledNeeds = this.manager.getEnabledNeeds();
        const availableAttributes = this.manager.getAvailableAttributes();
        const isGM = game.user.isGM;
        const barOrientation = game.settings.get(MODULE_ID, 'barOrientation') ?? 'vertical';
        const playerVisibility = game.settings.get(MODULE_ID, 'playerVisibility') ?? 'own';

        // Filter actors based on player visibility settings
        let actors = allActors;
        if (!isGM) {
            if (playerVisibility === 'none') {
                actors = []; // Players see nothing
            } else if (playerVisibility === 'own') {
                // Players only see their own characters
                actors = allActors.filter(actor => {
                    const foundryActor = game.actors.get(actor.id);
                    return foundryActor?.isOwner;
                });
            }
            // 'all' - players see all tracked actors (no filter)
        }

        // Create a lookup for attribute labels
        const attrLookup = {};
        for (const attr of availableAttributes) {
            attrLookup[attr.key] = attr.localize
                ? game.i18n.localize(attr.label)
                : attr.label;
        }

        const formattedActors = actors.map(actor => {
            const needsArray = [];
            let hasCritical = false;

            for (const need of enabledNeeds) {
                const actorNeed = actor.needs[need.id];
                if (actorNeed) {
                    const percentage = Math.round((actorNeed.value / actorNeed.max) * 100);
                    const attrKey = need.attribute;
                    const hasResistance = attrKey && attrKey !== 'none';
                    const attrLabel = hasResistance ? (attrLookup[attrKey] || attrKey.toUpperCase()) : null;
                    const severity = this._getSeverityClass(percentage);

                    if (severity === 'critical') hasCritical = true;

                    // Get tick progress for punishment display
                    const tickProgress = this.manager.getExhaustionTickProgress(actor.id, need.id);
                    const isAtMax = percentage >= 100;

                    // Get punishment configuration
                    const punishment = need.punishment || { type: 'none', ticks: 3 };
                    const hasPunishment = punishment.type && punishment.type !== 'none';
                    const punishmentTicks = punishment.ticks || 3;

                    // Generate punishment tooltip
                    let punishmentTooltip = '';
                    if (hasPunishment) {
                        switch (punishment.type) {
                            case 'exhaustion':
                                punishmentTooltip = game.i18n.localize('MORTAL_NEEDS.Tooltips.PunishmentExhaustion');
                                break;
                            case 'damage':
                                punishmentTooltip = game.i18n.format('MORTAL_NEEDS.Tooltips.PunishmentDamage', {
                                    amount: punishment.damageAmount || 5,
                                    type: punishment.damageType || 'necrotic'
                                });
                                break;
                            case 'condition':
                                punishmentTooltip = game.i18n.format('MORTAL_NEEDS.Tooltips.PunishmentCondition', {
                                    condition: punishment.condition || 'poisoned'
                                });
                                break;
                            case 'maxhp':
                                punishmentTooltip = game.i18n.format('MORTAL_NEEDS.Tooltips.PunishmentMaxHP', {
                                    amount: punishment.maxHpReduction || 5
                                });
                                break;
                        }
                    }

                    needsArray.push({
                        id: need.id,
                        name: game.i18n.localize(`MORTAL_NEEDS.Needs.${need.id}`),
                        icon: need.icon,
                        value: actorNeed.value,
                        max: actorNeed.max,
                        percentage,
                        severity,
                        attribute: attrKey,
                        hasResistance,
                        attributeLabel: attrLabel,
                        attributeShort: hasResistance ? attrKey.substring(0, 3).toUpperCase() : null,
                        stressAmount: need.stressAmount ?? 10,
                        // Punishment system
                        hasPunishment,
                        punishmentType: punishment.type,
                        punishmentTooltip,
                        punishmentTicks,
                        currentTicks: tickProgress.current,
                        maxTicks: punishmentTicks,
                        isAtMax,
                        showTicks: hasPunishment && isAtMax,
                        ticksArray: hasPunishment ? this._generateTicksArray(tickProgress.current, punishmentTicks) : []
                    });
                }
            }

            return {
                ...actor,
                needs: needsArray,
                selected: this._selectedActors.has(actor.id),
                expanded: this._expandedActors.has(actor.id),
                hasCritical
            };
        });

        return {
            actors: formattedActors,
            enabledNeeds,
            isGM,
            selectedCount: this._selectedActors.size > 0 ? this._selectedActors.size : null,
            moduleId: MODULE_ID,
            barOrientation,
            isHorizontal: barOrientation === 'horizontal'
        };
    }

    /**
     * Get CSS class for severity level
     * @private
     */
    _getSeverityClass(percentage) {
        if (percentage >= 80) return 'critical';
        if (percentage >= 60) return 'high';
        if (percentage >= 40) return 'medium';
        if (percentage >= 20) return 'low';
        return 'minimal';
    }

    /**
     * Generate array of tick objects for template rendering
     * @private
     */
    _generateTicksArray(current, max) {
        const ticks = [];
        for (let i = 0; i < max; i++) {
            ticks.push({
                index: i,
                filled: i < current
            });
        }
        return ticks;
    }

    /**
     * Actions performed after rendering
     * @param {object} context - Render context
     * @param {object} options - Render options
     */
    _onRender(context, options) {
        const html = this.element;

        // CRITICAL: Force fixed positioning to prevent layout interference
        html.style.position = 'fixed';
        html.style.margin = '0';
        html.style.padding = '0';
        html.style.zIndex = '60';

        // Apply saved UI scale
        const savedScale = game.settings.get(MODULE_ID, 'uiScale') ?? 100;
        const panelContent = html.querySelector('.mn-panel-content');
        if (panelContent) {
            panelContent.style.setProperty('--mn-ui-scale', savedScale / 100);
        }

        // Ensure position is within viewport bounds (position loaded in _preRender)
        const currentTop = parseInt(this.element.style.top) || this.position.top || 100;
        const currentLeft = parseInt(this.element.style.left) || this.position.left || 120;

        const maxLeft = window.innerWidth - 100;
        const maxTop = window.innerHeight - 100;

        this.element.style.top = `${Math.min(Math.max(0, currentTop), maxTop)}px`;
        this.element.style.left = `${Math.min(Math.max(0, currentLeft), maxLeft)}px`;

        // Remove any right/bottom positioning that might conflict
        this.element.style.right = 'auto';
        this.element.style.bottom = 'auto';

        // Setup tooltip element reference and apply scale to it
        this._tooltip = html.querySelector('#mn-tooltip');
        if (this._tooltip) {
            this._tooltip.style.setProperty('--mn-ui-scale', savedScale / 100);
        }

        // Add hover tooltips for vertical bars
        html.querySelectorAll('.mn-vbar-container').forEach(container => {
            container.addEventListener('mouseenter', this._onBarHover.bind(this));
            container.addEventListener('mouseleave', this._onBarLeave.bind(this));
            container.addEventListener('mousemove', this._onBarMove.bind(this));
        });

        // Double-click to expand/collapse actor units
        html.querySelectorAll('.mn-actor-unit').forEach(unit => {
            unit.addEventListener('dblclick', this._onActorDoubleClick.bind(this));
        });

        // Panel drag functionality (for repositioning the HUD) - available to all users
        this._setupPanelDrag(html);

        if (!game.user.isGM) return;

        // Vertical bar click/drag handlers (GM only)
        html.querySelectorAll('.mn-vbar').forEach(bar => {
            bar.addEventListener('click', this._onVBarClick.bind(this));
            bar.addEventListener('mousedown', this._onVBarDragStart.bind(this));
        });

        // Horizontal bar click/drag handlers (GM only, in expanded view)
        html.querySelectorAll('.mn-hbar').forEach(bar => {
            bar.addEventListener('click', this._onHBarClick.bind(this));
            bar.addEventListener('mousedown', this._onHBarDragStart.bind(this));
        });

        // Global drag handlers for bars
        html.addEventListener('mousemove', this._onBarDrag.bind(this));
        html.addEventListener('mouseup', this._onBarDragEnd.bind(this));
        html.addEventListener('mouseleave', this._onBarDragEnd.bind(this));
    }

    /**
     * Setup panel drag functionality for HUD repositioning
     * @param {HTMLElement} html - The panel element
     * @private
     */
    _setupPanelDrag(html) {
        const panelContent = html.querySelector('.mn-panel-content');
        if (!panelContent) return;

        // Check if drag handle already exists (avoid duplicates on re-render)
        let dragHandle = panelContent.querySelector('.mn-drag-handle');
        if (!dragHandle) {
            // Create drag handle element
            dragHandle = document.createElement('div');
            dragHandle.className = 'mn-drag-handle';
            dragHandle.innerHTML = '<i class="fas fa-grip-horizontal"></i>';
            panelContent.prepend(dragHandle);
        }

        // Ensure pointer events work correctly
        dragHandle.style.pointerEvents = 'auto';
        dragHandle.style.cursor = 'grab';

        // Remove any existing listeners to avoid duplicates
        const newHandle = dragHandle.cloneNode(true);
        dragHandle.parentNode.replaceChild(newHandle, dragHandle);
        dragHandle = newHandle;

        // Drag start
        dragHandle.addEventListener('mousedown', (event) => {
            if (event.button !== 0) return; // Left click only

            event.preventDefault();
            event.stopPropagation();

            const rect = this.element.getBoundingClientRect();
            this._panelDrag = {
                startX: event.clientX,
                startY: event.clientY,
                startLeft: rect.left,
                startTop: rect.top
            };

            dragHandle.classList.add('dragging');
            document.body.style.cursor = 'grabbing';
        });

        // Bind global handlers (only once)
        if (!this._panelDragBound) {
            this._panelDragBound = true;
            document.addEventListener('mousemove', this._onPanelDrag.bind(this));
            document.addEventListener('mouseup', this._onPanelDragEnd.bind(this));
        }
    }

    /**
     * Handle panel dragging
     * @param {MouseEvent} event
     * @private
     */
    _onPanelDrag(event) {
        if (!this._panelDrag) return;

        const deltaX = event.clientX - this._panelDrag.startX;
        const deltaY = event.clientY - this._panelDrag.startY;

        const newLeft = this._panelDrag.startLeft + deltaX;
        const newTop = this._panelDrag.startTop + deltaY;

        // Apply new position
        this.element.style.left = `${newLeft}px`;
        this.element.style.top = `${newTop}px`;
    }

    /**
     * Handle panel drag end
     * @param {MouseEvent} event
     * @private
     */
    _onPanelDragEnd(event) {
        if (!this._panelDrag) return;

        // Save position to settings
        const rect = this.element.getBoundingClientRect();
        game.settings.set(MODULE_ID, 'panelPosition', {
            top: rect.top,
            left: rect.left
        });

        // Clean up
        const dragHandle = this.element.querySelector('.mn-drag-handle');
        if (dragHandle) {
            dragHandle.classList.remove('dragging');
        }
        document.body.style.cursor = '';
        this._panelDrag = null;
    }

    /* -------------------------------------------- */
    /*  Tooltip Handlers                            */
    /* -------------------------------------------- */

    /**
     * Show tooltip on bar hover
     * @private
     */
    _onBarHover(event) {
        const container = event.currentTarget;
        const tooltip = this._tooltip;
        if (!tooltip) return;

        const title = container.dataset.tooltipTitle || '';
        const value = container.dataset.tooltipValue || '';
        const percent = container.dataset.tooltipPercent || '';
        const resist = container.dataset.tooltipResist || '';

        tooltip.querySelector('.mn-tooltip-title').textContent = title;
        tooltip.querySelector('.mn-tooltip-value').textContent = value;
        tooltip.querySelector('.mn-tooltip-details').textContent = percent;

        const resistEl = tooltip.querySelector('.mn-tooltip-resistance');
        if (resist) {
            resistEl.innerHTML = `<i class="fas fa-shield-alt"></i> ${game.i18n.localize('MORTAL_NEEDS.UI.ResistanceShort')}: ${resist}`;
            resistEl.style.display = 'flex';
        } else {
            resistEl.style.display = 'none';
        }

        tooltip.classList.add('visible');
    }

    /**
     * Hide tooltip
     * @private
     */
    _onBarLeave(event) {
        if (this._tooltip) {
            this._tooltip.classList.remove('visible');
        }
    }

    /**
     * Position tooltip near cursor
     * @private
     */
    _onBarMove(event) {
        if (!this._tooltip) return;

        const x = event.clientX + 12;
        const y = event.clientY + 12;

        // Keep tooltip in viewport
        const rect = this._tooltip.getBoundingClientRect();
        const maxX = window.innerWidth - rect.width - 10;
        const maxY = window.innerHeight - rect.height - 10;

        this._tooltip.style.left = `${Math.min(x, maxX)}px`;
        this._tooltip.style.top = `${Math.min(y, maxY)}px`;
    }

    /* -------------------------------------------- */
    /*  Actor Expand/Collapse                       */
    /* -------------------------------------------- */

    /**
     * Handle double-click to expand/collapse actor
     * @private
     */
    _onActorDoubleClick(event) {
        // Don't expand if clicking on a button or control
        if (event.target.closest('button') || event.target.closest('.mn-ctrl-btn')) {
            return;
        }

        const actorId = event.currentTarget.dataset.actorId;
        if (this._expandedActors.has(actorId)) {
            this._expandedActors.delete(actorId);
        } else {
            this._expandedActors.add(actorId);
        }
        this.render();
    }

    /* -------------------------------------------- */
    /*  Action Handlers (Static)                    */
    /* -------------------------------------------- */

    /**
     * Handle actor portrait click
     * Normal click: Open character sheet
     * Ctrl+click: Toggle selection for multi-select operations
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onActorSelect(event, target) {
        const actorId = target.dataset.actorId || target.closest('[data-actor-id]')?.dataset.actorId;
        if (!actorId) return;

        // Ctrl+click or Meta+click: Toggle selection for multi-select
        if (event.ctrlKey || event.metaKey) {
            if (this._selectedActors.has(actorId)) {
                this._selectedActors.delete(actorId);
            } else {
                this._selectedActors.add(actorId);
            }
            this.render();
        } else {
            // Normal click: Open character sheet
            const actor = game.actors.get(actorId);
            if (actor) {
                actor.sheet.render(true);
            }
        }
    }

    /**
     * Handle opening actor sheet
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onOpenActorSheet(event, target) {
        const actorId = target.dataset.actorId;
        const actor = game.actors.get(actorId);
        if (actor) {
            actor.sheet.render(true);
        }
    }

    /**
     * Handle stress button click
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onStressNeed(event, target) {
        const actorId = target.closest('[data-actor-id]').dataset.actorId;
        const needId = target.dataset.needId;

        // Use the need's configured stressAmount (null tells manager to use its own config)
        await this.manager.stressNeed(actorId, needId, null);
        this.render();
    }

    /**
     * Handle relieve button click
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onRelieveNeed(event, target) {
        const actorId = target.closest('[data-actor-id]').dataset.actorId;
        const needId = target.dataset.needId;

        // Get the need's configured stressAmount for relieving
        const config = this.manager.getNeedConfig(needId);
        const amount = config?.stressAmount ?? 10;

        await this.manager.relieveNeed(actorId, needId, amount);
        this.render();
    }

    /**
     * Handle stress all button click
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onStressAll(event, target) {
        const needId = target.dataset.needId;

        const actorIds = this._selectedActors.size > 0
            ? Array.from(this._selectedActors)
            : Array.from(this.manager.actorNeeds.keys());

        // Use the need's configured stressAmount
        for (const actorId of actorIds) {
            await this.manager.stressNeed(actorId, needId, null);
        }
        this.render();
    }

    /**
     * Handle relieve all button click
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onRelieveAll(event, target) {
        const needId = target.dataset.needId;

        // Get the need's configured stressAmount for relieving
        const config = this.manager.getNeedConfig(needId);
        const amount = config?.stressAmount ?? 10;

        const actorIds = this._selectedActors.size > 0
            ? Array.from(this._selectedActors)
            : Array.from(this.manager.actorNeeds.keys());

        for (const actorId of actorIds) {
            await this.manager.relieveNeed(actorId, needId, amount);
        }
        this.render();
    }

    /**
     * Handle select all actors
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onSelectAll(event, target) {
        for (const actorId of this.manager.actorNeeds.keys()) {
            this._selectedActors.add(actorId);
        }
        this.render();
    }

    /**
     * Handle deselect all actors
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onDeselectAll(event, target) {
        this._selectedActors.clear();
        this.render();
    }

    /**
     * Handle expand/collapse toggle
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onToggleExpand(event, target) {
        const actorId = target.closest('[data-actor-id]')?.dataset.actorId;
        if (!actorId) return;

        if (this._expandedActors.has(actorId)) {
            this._expandedActors.delete(actorId);
        } else {
            this._expandedActors.add(actorId);
        }
        this.render();
    }

    /**
     * Handle multi-stress dialog
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onMultiStress(event, target) {
        const enabledNeeds = this.manager.getEnabledNeeds();

        const content = await renderTemplate(`modules/${MODULE_ID}/templates/multi-stress-dialog.hbs`, {
            needs: enabledNeeds.map(n => ({
                ...n,
                name: game.i18n.localize(`MORTAL_NEEDS.Needs.${n.id}`)
            }))
        });

        const self = this;

        new foundry.applications.api.DialogV2({
            window: { title: game.i18n.localize('MORTAL_NEEDS.UI.MultiStress') },
            content,
            buttons: [
                {
                    action: 'stress',
                    label: game.i18n.localize('MORTAL_NEEDS.UI.Stress'),
                    icon: 'fas fa-arrow-up',
                    default: true,
                    callback: async (event, button, dialog) => {
                        // Foundry v13 DialogV2: dialog is the dialog object, not the element
                        const dialogEl = dialog.element ?? dialog;
                        const form = dialogEl.querySelector('form') ?? document.querySelector('.dialog form');
                        if (!form) return;

                        const selectedNeeds = {};

                        form.querySelectorAll('input[type="checkbox"]:checked').forEach(el => {
                            const needId = el.dataset.needId;
                            const amountInput = form.querySelector(`input[data-amount-for="${needId}"]`);
                            const amount = parseInt(amountInput?.value) || 20;
                            selectedNeeds[needId] = amount;
                        });

                        const actorIds = self._selectedActors.size > 0
                            ? Array.from(self._selectedActors)
                            : Array.from(self.manager.actorNeeds.keys());

                        await self.manager.stressMultiple(actorIds, selectedNeeds);
                        self.render();
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

    /**
     * Handle settings button
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onOpenSettings(event, target) {
        new NeedsConfigDialog(this.manager).render(true);
    }

    /**
     * Handle actor selection dialog
     * Opens a dialog to select which actors to track
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static async #onOpenActorSelection(event, target) {
        // Get all player-owned character actors
        const allActors = game.actors.filter(a =>
            a.hasPlayerOwner && (a.type === 'character' || a.type === 'npc')
        );

        // Get currently tracked actors
        const trackedActorIds = game.settings.get(MODULE_ID, 'trackedActors') || [];
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

        // Build the dialog content
        let actorListHtml = '';
        for (const actor of actors) {
            actorListHtml += `
                <div class="actor-row ${actor.tracked ? 'tracked' : ''}">
                    <input type="checkbox" id="actor-${actor.id}" name="actor-${actor.id}" ${actor.tracked ? 'checked' : ''}>
                    <img src="${actor.img}" alt="${actor.name}" class="actor-portrait">
                    <div class="actor-info">
                        <label for="actor-${actor.id}" class="actor-name">${actor.name}</label>
                        <span class="actor-details">
                            <span class="actor-type">${actor.type}</span>
                            ${actor.owners ? `<span class="actor-owners"><i class="fas fa-user"></i> ${actor.owners}</span>` : ''}
                        </span>
                    </div>
                </div>
            `;
        }

        const content = `
            <div class="mn-actor-selection-dialog">
                <p class="notes">${game.i18n.localize('MORTAL_NEEDS.Settings.ConfigureActorsHint')}</p>
                ${isFirstTime ? `<p class="notification info"><i class="fas fa-info-circle"></i> ${game.i18n.localize('MORTAL_NEEDS.Settings.FirstTimeActorSelection')}</p>` : ''}
                <div class="actor-selection-controls">
                    <button type="button" class="select-all-btn"><i class="fas fa-check-double"></i> ${game.i18n.localize('MORTAL_NEEDS.UI.SelectAll')}</button>
                    <button type="button" class="deselect-all-btn"><i class="fas fa-times"></i> ${game.i18n.localize('MORTAL_NEEDS.UI.DeselectAll')}</button>
                </div>
                <div class="actors-list">
                    ${actorListHtml || `<p class="no-actors"><i class="fas fa-users-slash"></i><br>${game.i18n.localize('MORTAL_NEEDS.Settings.NoActorsAvailable')}</p>`}
                </div>
            </div>
        `;

        const self = this;

        const dialog = new foundry.applications.api.DialogV2({
            window: {
                title: game.i18n.localize('MORTAL_NEEDS.Settings.ConfigureActors'),
                icon: 'fas fa-users'
            },
            content,
            buttons: [
                {
                    action: 'save',
                    label: game.i18n.localize('Save'),
                    icon: 'fas fa-save',
                    default: true,
                    callback: async (event, button, dialog) => {
                        // In Foundry v13 DialogV2, we need to access the element property
                        const dialogEl = dialog.element ?? dialog;
                        const container = dialogEl instanceof HTMLElement ? dialogEl : document.querySelector('.mn-actor-selection-dialog');

                        const trackedIds = [];
                        container?.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => {
                            const actorId = cb.id.replace('actor-', '');
                            trackedIds.push(actorId);
                        });

                        // Save to settings
                        await game.settings.set(MODULE_ID, 'trackedActors', trackedIds);

                        // Refresh the manager and UI
                        await self.manager.refreshTrackedActors();
                        self.render();

                        ui.notifications.info(
                            game.i18n.format('MORTAL_NEEDS.Notifications.ActorsUpdated', { count: trackedIds.length })
                        );
                    }
                },
                {
                    action: 'cancel',
                    label: game.i18n.localize('Cancel'),
                    icon: 'fas fa-times'
                }
            ],
            rejectClose: false
        });

        dialog.render(true);

        // Add event listeners for select all / deselect all after render
        setTimeout(() => {
            const dialogEl = dialog.element;
            if (!dialogEl) return;

            dialogEl.querySelector('.select-all-btn')?.addEventListener('click', () => {
                dialogEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = true);
            });

            dialogEl.querySelector('.deselect-all-btn')?.addEventListener('click', () => {
                dialogEl.querySelectorAll('input[type="checkbox"]').forEach(cb => cb.checked = false);
            });
        }, 100);
    }

    /* -------------------------------------------- */
    /*  Vertical Bar Handlers (Instance)            */
    /* -------------------------------------------- */

    /**
     * Handle vertical bar click (set value)
     * @private
     */
    async _onVBarClick(event) {
        if (this._dragData) return;

        const bar = event.currentTarget;
        const actorId = bar.dataset.actorId;
        const needId = bar.dataset.needId;

        const rect = bar.getBoundingClientRect();
        // For vertical bars, we calculate from bottom (0) to top (100)
        const clickY = rect.bottom - event.clientY;
        const percentage = Math.round((clickY / rect.height) * 100);

        const config = this.manager.getNeedConfig(needId);
        if (config) {
            const newValue = Math.round((percentage / 100) * config.max);
            await this.manager.setNeed(actorId, needId, newValue);
            this.render();
        }
    }

    /**
     * Handle vertical bar drag start
     * @private
     */
    _onVBarDragStart(event) {
        if (event.button !== 0) return;

        const bar = event.currentTarget;
        this._dragData = {
            actorId: bar.dataset.actorId,
            needId: bar.dataset.needId,
            bar: bar,
            type: 'vertical'
        };

        event.preventDefault();
    }

    /* -------------------------------------------- */
    /*  Horizontal Bar Handlers (Instance)          */
    /* -------------------------------------------- */

    /**
     * Handle horizontal bar click (set value)
     * @private
     */
    async _onHBarClick(event) {
        if (this._dragData) return;

        const bar = event.currentTarget;
        const actorId = bar.dataset.actorId;
        const needId = bar.dataset.needId;

        const rect = bar.getBoundingClientRect();
        const clickX = event.clientX - rect.left;
        const percentage = Math.round((clickX / rect.width) * 100);

        const config = this.manager.getNeedConfig(needId);
        if (config) {
            const newValue = Math.round((percentage / 100) * config.max);
            await this.manager.setNeed(actorId, needId, newValue);
            this.render();
        }
    }

    /**
     * Handle horizontal bar drag start
     * @private
     */
    _onHBarDragStart(event) {
        if (event.button !== 0) return;

        const bar = event.currentTarget;
        this._dragData = {
            actorId: bar.dataset.actorId,
            needId: bar.dataset.needId,
            bar: bar,
            type: 'horizontal'
        };

        event.preventDefault();
    }

    /* -------------------------------------------- */
    /*  Common Bar Drag Handlers                    */
    /* -------------------------------------------- */

    /**
     * Handle bar dragging (both vertical and horizontal)
     * @private
     */
    _onBarDrag(event) {
        if (!this._dragData) return;

        const rect = this._dragData.bar.getBoundingClientRect();
        let percentage;

        if (this._dragData.type === 'vertical') {
            // Vertical: bottom to top
            const dragY = rect.bottom - event.clientY;
            percentage = Math.max(0, Math.min(100, Math.round((dragY / rect.height) * 100)));

            const fill = this._dragData.bar.querySelector('.mn-vbar-fill');
            if (fill) {
                fill.style.height = `${percentage}%`;
            }
        } else {
            // Horizontal: left to right
            const dragX = event.clientX - rect.left;
            percentage = Math.max(0, Math.min(100, Math.round((dragX / rect.width) * 100)));

            const fill = this._dragData.bar.querySelector('.mn-hbar-fill');
            if (fill) {
                fill.style.width = `${percentage}%`;
            }

            // Update text in horizontal bar
            const text = this._dragData.bar.querySelector('.mn-hbar-text');
            if (text) {
                const config = this.manager.getNeedConfig(this._dragData.needId);
                if (config) {
                    const value = Math.round((percentage / 100) * config.max);
                    text.textContent = value;
                }
            }
        }
    }

    /**
     * Handle bar drag end
     * @private
     */
    async _onBarDragEnd(event) {
        if (!this._dragData) return;

        const rect = this._dragData.bar.getBoundingClientRect();
        let percentage;

        if (this._dragData.type === 'vertical') {
            const dragY = rect.bottom - event.clientY;
            percentage = Math.max(0, Math.min(100, Math.round((dragY / rect.height) * 100)));
        } else {
            const dragX = event.clientX - rect.left;
            percentage = Math.max(0, Math.min(100, Math.round((dragX / rect.width) * 100)));
        }

        const config = this.manager.getNeedConfig(this._dragData.needId);
        if (config) {
            const newValue = Math.round((percentage / 100) * config.max);
            await this.manager.setNeed(this._dragData.actorId, this._dragData.needId, newValue);
        }

        this._dragData = null;
        this.render();
    }

    /* -------------------------------------------- */
    /*  Public Methods                              */
    /* -------------------------------------------- */

    /**
     * Toggle visibility
     */
    toggle() {
        if (this.rendered) {
            this.close();
        } else {
            this.render(true);
        }
    }
}

/**
 * Dialog for configuring which needs are enabled
 * Uses Foundry v13 ApplicationV2
 */
export class NeedsConfigDialog extends HandlebarsApplicationMixin(ApplicationV2) {
    constructor(manager, options = {}) {
        super(options);
        this.manager = manager;
        this._originalScale = game.settings.get(MODULE_ID, 'uiScale') ?? 100;
        this._previewScale = this._originalScale;
    }

    static DEFAULT_OPTIONS = {
        id: 'mortal-needs-config',
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
            handler: NeedsConfigDialog.#onSubmit,
            submitOnChange: false,
            closeOnSubmit: true
        },
        actions: {
            addCustomNeed: NeedsConfigDialog.#onAddCustomNeed,
            removeNeed: NeedsConfigDialog.#onRemoveNeed,
            toggleNeedDetails: NeedsConfigDialog.#onToggleNeedDetails,
            previewScale: NeedsConfigDialog.#onPreviewScale
        }
    };

    static PARTS = {
        form: {
            id: 'form',
            template: `modules/${MODULE_ID}/templates/needs-config-dialog.hbs`
        }
    };

    async _prepareContext(options) {
        const allNeeds = this.manager.getAllNeeds();
        const availableAttributes = this.manager.getAvailableAttributes();
        const damageTypes = this.manager.getDamageTypes();
        const conditions = this.manager.getConditions();

        // Group attributes by type (abilities, skills)
        const attributeGroups = [];
        const groupedAttrs = {};

        for (const attr of availableAttributes) {
            const groupKey = attr.group || 'other';
            if (!groupedAttrs[groupKey]) {
                groupedAttrs[groupKey] = [];
            }
            groupedAttrs[groupKey].push({
                key: attr.key,
                label: attr.localize ? game.i18n.localize(attr.label) : attr.label
            });
        }

        // Create ordered groups
        const groupOrder = ['abilities', 'skills', 'other'];
        const groupLabels = {
            abilities: game.i18n.localize('MORTAL_NEEDS.Settings.Abilities'),
            skills: game.i18n.localize('MORTAL_NEEDS.Settings.Skills'),
            other: game.i18n.localize('MORTAL_NEEDS.Settings.Other')
        };

        for (const groupKey of groupOrder) {
            if (groupedAttrs[groupKey]?.length > 0) {
                attributeGroups.push({
                    key: groupKey,
                    label: groupLabels[groupKey] || groupKey,
                    attributes: groupedAttrs[groupKey]
                });
            }
        }

        // UI Scale values
        const uiScaleRaw = this._previewScale;
        const uiScale = `${uiScaleRaw}`;

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
            uiScale,
            uiScaleRaw
        };
    }

    static async #onSubmit(event, form, formData) {
        const allNeeds = this.manager.getAllNeeds();

        for (const need of allNeeds) {
            const enabled = formData.object[`${need.id}-enabled`] ?? false;
            const attribute = formData.object[`${need.id}-attribute`] ?? 'none';
            const stressAmount = parseInt(formData.object[`${need.id}-stressAmount`]) || 10;

            await this.manager.setNeedEnabled(need.id, enabled);
            await this.manager.setNeedAttribute(need.id, attribute === 'none' ? null : attribute);
            await this.manager.setNeedStressAmount(need.id, stressAmount);

            // Update punishment configuration
            const punishmentType = formData.object[`${need.id}-punishmentType`];
            if (punishmentType !== undefined) {
                // Get existing punishment config from the manager to preserve values when type changes
                const needConfig = this.manager.getNeedConfig(need.id);
                const existingPunishment = needConfig?.punishment || {};

                // Always save all punishment fields to preserve values when switching types
                const punishmentConfig = {
                    type: punishmentType,
                    ticks: parseInt(formData.object[`${need.id}-punishmentTicks`]) || existingPunishment.ticks || 3,
                    damageAmount: parseInt(formData.object[`${need.id}-damageAmount`]) || existingPunishment.damageAmount || 5,
                    damageType: formData.object[`${need.id}-damageType`] || existingPunishment.damageType || 'necrotic',
                    condition: formData.object[`${need.id}-condition`] || existingPunishment.condition || 'poisoned',
                    maxHpReduction: parseInt(formData.object[`${need.id}-maxHpReduction`]) || existingPunishment.maxHpReduction || 5
                };

                await this.manager.setNeedPunishment(need.id, punishmentConfig);
            }
        }

        // Save UI Scale
        const uiScale = parseInt(formData.object.uiScale) || 100;
        await game.settings.set(MODULE_ID, 'uiScale', uiScale);
        this._originalScale = uiScale;

        game.modules.get(MODULE_ID)?.api?.ui?.render();
    }

    static #onToggleNeedDetails(event, target) {
        const needId = target.dataset.needId;
        const detailsRow = this.element.querySelector(`[data-need-details="${needId}"]`);
        const icon = target.querySelector('i');

        if (detailsRow) {
            const isHidden = detailsRow.style.display === 'none';
            detailsRow.style.display = isHidden ? 'block' : 'none';
            icon?.classList.toggle('fa-chevron-down', !isHidden);
            icon?.classList.toggle('fa-chevron-up', isHidden);
        }
    }

    /**
     * Handle UI scale slider preview
     * @param {Event} event
     * @param {HTMLElement} target
     */
    static #onPreviewScale(event, target) {
        const value = parseInt(target.value) || 100;
        this._previewScale = value;

        // Update the displayed value
        const valueDisplay = this.element.querySelector('.ui-scale-value');
        if (valueDisplay) {
            valueDisplay.textContent = `${value}%`;
        }

        // Apply preview to main panel
        this.#applyScalePreview(value);
    }

    /**
     * Apply scale preview to the main needs panel
     * @param {number} scale - Scale percentage (80-200)
     */
    static #applyScalePreview(scale) {
        const mainPanel = game.modules.get(MODULE_ID)?.api?.ui?.element;
        if (mainPanel) {
            const panelContent = mainPanel.querySelector('.mn-panel-content');
            if (panelContent) {
                panelContent.style.setProperty('--mn-ui-scale', scale / 100);
            }
        }
    }

    /**
     * Called after rendering - attach additional event listeners
     * @param {object} context
     * @param {object} options
     */
    _onRender(context, options) {
        const html = this.element;

        // Setup slider input event for real-time preview
        const slider = html.querySelector('.ui-scale-slider');
        if (slider) {
            slider.addEventListener('input', (event) => {
                const value = parseInt(event.target.value) || 100;
                this._previewScale = value;

                // Update the displayed value
                const valueDisplay = html.querySelector('.ui-scale-value');
                if (valueDisplay) {
                    valueDisplay.textContent = `${value}%`;
                }

                // Apply preview to main panel
                NeedsConfigDialog.#applyScalePreview(value);
            });
        }

        // Setup punishment type change handlers
        html.querySelectorAll('.need-punishment-type').forEach(select => {
            select.addEventListener('change', (event) => {
                const needId = select.dataset.needId;
                const punishmentType = select.value;

                // Find the parent row
                const row = select.closest('.need-config-row');
                if (!row) return;

                // Hide all punishment option groups
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
            });
        });
    }

    /**
     * Called when dialog closes - revert scale if not saved
     * @param {object} options
     */
    async _onClose(options) {
        // If scale was changed but not saved, revert to original
        if (this._previewScale !== this._originalScale) {
            NeedsConfigDialog.#applyScalePreview(this._originalScale);
        }
        return super._onClose?.(options);
    }

    static async #onAddCustomNeed(event, target) {
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
                                await self.manager.addCustomNeed({ id, icon });
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
        const needId = target.dataset.needId;
        const self = this;

        const confirmed = await foundry.applications.api.DialogV2.confirm({
            window: { title: game.i18n.localize('MORTAL_NEEDS.Settings.RemoveNeed') },
            content: `<p>${game.i18n.format('MORTAL_NEEDS.Settings.RemoveNeedConfirm', { name: needId })}</p>`
        });

        if (confirmed) {
            try {
                await self.manager.removeCustomNeed(needId);
                self.render();
                ui.notifications.info(
                    game.i18n.format('MORTAL_NEEDS.Notifications.NeedRemoved', { name: needId })
                );
            } catch (error) {
                ui.notifications.error(error.message);
            }
        }
    }
}

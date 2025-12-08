/**
 * Mortal Needs - A survival needs management module for Foundry VTT v13
 * @module mortal-needs
 */

// Import constants first to avoid circular dependencies
import { MODULE_ID, MODULE_NAME } from './constants.js';

// Import submodules
import { NeedsManager } from './needs-manager.js';
import { MortalNeedsUI } from './ui/mortal-needs-ui.js';
import { registerSettings } from './settings.js';
import { SystemAdapter } from './systems/system-adapter.js';

/**
 * Main module class that orchestrates all functionality
 */
class MortalNeeds {
    constructor() {
        this.manager = null;
        this.ui = null;
        this.systemAdapter = null;
        this.socket = null;
    }

    /**
     * Initialize the module
     */
    async initialize() {
        console.log(`${MODULE_NAME} | Initializing module...`);

        // Initialize system adapter based on current game system
        this.systemAdapter = SystemAdapter.create(game.system.id);

        // Initialize the needs manager
        this.manager = new NeedsManager(this.systemAdapter);
        await this.manager.initialize();

        // Initialize UI (only creates instance, doesn't render yet)
        this.ui = new MortalNeedsUI(this.manager);

        // Setup socket for multiplayer sync
        this._setupSocket();

        console.log(`${MODULE_NAME} | Module initialized successfully`);
    }

    /**
     * Setup socket communication for real-time updates
     * @private
     */
    _setupSocket() {
        // Use Foundry v13 native socket
        game.socket.on(`module.${MODULE_ID}`, this._handleSocketMessage.bind(this));
    }

    /**
     * Handle socket messages
     * @private
     */
    _handleSocketMessage(data) {
        // Ignore messages from ourselves (we already updated locally)
        if (data.senderId === game.user.id) return;

        switch (data.action) {
            case 'updateNeed':
                this._onSocketUpdateNeed(data.payload);
                break;
            case 'syncNeeds':
                this._onSocketSyncNeeds(data.payload);
                break;
        }
    }

    /**
     * Handle need update from socket
     * @private
     */
    _onSocketUpdateNeed(data) {
        this.manager.updateNeedFromSocket(data);
        // Use partial update if possible, fall back to full render
        if (this.ui && data.actorId && data.needId) {
            if (!this.ui._updateNeedDisplay(data.actorId, data.needId)) {
                this.ui.render();
            }
        } else {
            this.ui?.render();
        }
    }

    /**
     * Handle full sync from socket
     * @private
     */
    _onSocketSyncNeeds(data) {
        this.manager.syncFromSocket(data);
        this.ui?.render();
    }

    /**
     * Emit socket event to all clients
     * @param {string} action - The action name
     * @param {object} payload - The data to send
     */
    emitSocket(action, payload) {
        // Include sender ID so we can ignore our own messages
        game.socket.emit(`module.${MODULE_ID}`, {
            action,
            payload,
            senderId: game.user.id
        });
    }

    /**
     * Toggle the UI visibility
     */
    toggleUI() {
        if (this.ui) {
            this.ui.toggle();
        }
    }

    /**
     * Show the UI
     */
    showUI() {
        if (this.ui) {
            this.ui.render(true);
        }
    }

    /**
     * Hide the UI
     */
    hideUI() {
        if (this.ui) {
            this.ui.close();
        }
    }
}

// Create global module instance
let mortalNeeds = null;

/* -------------------------------------------- */
/*  Foundry VTT Hooks                           */
/* -------------------------------------------- */

/**
 * Hook: init
 * Register settings and prepare module data structures
 */
Hooks.once('init', () => {
    console.log(`${MODULE_NAME} | Initializing...`);

    // Register module settings
    registerSettings();

    // Register Handlebars helpers
    _registerHandlebarsHelpers();
});

/**
 * Hook: ready
 * Module is fully ready, initialize everything
 */
Hooks.once('ready', async () => {
    // Create and initialize the main module instance
    mortalNeeds = new MortalNeeds();
    await mortalNeeds.initialize();

    // Expose API globally for macros and other modules
    game.modules.get(MODULE_ID).api = {
        get manager() { return mortalNeeds.manager; },
        get ui() { return mortalNeeds.ui; },
        toggleUI: () => mortalNeeds.toggleUI(),
        showUI: () => mortalNeeds.showUI(),
        hideUI: () => mortalNeeds.hideUI(),
        stressNeed: (actorId, needId, amount) => mortalNeeds.manager.stressNeed(actorId, needId, amount),
        relieveNeed: (actorId, needId, amount) => mortalNeeds.manager.relieveNeed(actorId, needId, amount),
        stressAll: (needId, amount) => mortalNeeds.manager.stressAll(needId, amount),
        relieveAll: (needId, amount) => mortalNeeds.manager.relieveAll(needId, amount),
        getNeedValue: (actorId, needId) => mortalNeeds.manager.getNeedValue(actorId, needId),
        getActorNeeds: (actorId) => mortalNeeds.manager.getActorNeeds(actorId),
        emitSocket: (action, payload) => mortalNeeds.emitSocket(action, payload),

        /**
         * Handle punishment type change in the config dialog
         * Called from inline onchange handler in the template
         * @param {HTMLSelectElement} select - The select element that changed
         */
        onPunishmentTypeChange: (select) => {
            const needId = select.dataset.needId;
            const punishmentType = select.value;
            console.log(`Mortal Needs | Punishment type changed for ${needId} to ${punishmentType}`);

            // Find the parent row
            const row = select.closest('.need-config-row');
            if (!row) {
                console.warn('Mortal Needs | Could not find parent row');
                return;
            }

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
        }
    };

    // Also expose on globalThis for easy console access
    globalThis.MortalNeeds = game.modules.get(MODULE_ID).api;

    console.log(`${MODULE_NAME} | Ready!`);
});

/**
 * Hook: getSceneControlButtons
 * Add toggle button to token controls (v13 compatible)
 */
Hooks.on('getSceneControlButtons', (controls) => {
    // Check player visibility setting - players only see the button if visibility is not 'none'
    const playerVisibility = game.settings.get(MODULE_ID, 'playerVisibility');
    const isGM = game.user.isGM;

    // GMs always see the button; players only see it when playerVisibility is 'own' or 'all'
    if (!isGM && playerVisibility === 'none') return;

    console.log("Mortal Needs | getSceneControlButtons fired", controls);

    // Handle both array (v11/v12) and object (v13) structures
    let tokenControls;
    if (Array.isArray(controls)) {
        tokenControls = controls.find(c => c.name === 'token');
    } else {
        tokenControls = controls.tokens;
    }

    if (tokenControls) {
        console.log("Mortal Needs | Adding tool to token controls");
        const tool = {
            name: 'mortal-needs',
            title: game.i18n.localize('MORTAL_NEEDS.Controls.Toggle'),
            icon: 'fas fa-heartbeat',
            visible: true,
            button: true,
            onClick: () => {
                mortalNeeds?.toggleUI();
            }
        };

        // Handle different tools structures
        if (Array.isArray(tokenControls.tools)) {
            tokenControls.tools.push(tool);
        } else if (tokenControls.tools instanceof Map) {
            tokenControls.tools.set('mortal-needs', tool);
        } else if (typeof tokenControls.tools === 'object' && tokenControls.tools !== null) {
            tokenControls.tools['mortal-needs'] = tool;
        } else {
            console.warn("Mortal Needs | Unknown tools structure:", tokenControls.tools);
        }
    } else {
        console.warn("Mortal Needs | Token controls not found!");
    }
});

/**
 * Hook: updateActor
 * React to actor changes (e.g., Constitution changes)
 */
Hooks.on('updateActor', (actor, changes, options, userId) => {
    if (!mortalNeeds?.manager) return;
    mortalNeeds.manager.onActorUpdate(actor, changes);
});

/**
 * Hook: createToken
 * Initialize needs for new tokens
 */
Hooks.on('createToken', (token, options, userId) => {
    if (!mortalNeeds?.manager) return;
    if (token.actor?.hasPlayerOwner) {
        mortalNeeds.manager.initializeActorNeeds(token.actor);
        mortalNeeds.ui?.render();
    }
});

/**
 * Hook: deleteToken
 * Clean up needs data when token is deleted
 */
Hooks.on('deleteToken', (token, options, userId) => {
    if (!mortalNeeds?.ui) return;
    mortalNeeds.ui.render();
});

/* -------------------------------------------- */
/*  Handlebars Helpers                          */
/* -------------------------------------------- */

/**
 * Register custom Handlebars helpers for templates
 * @private
 */
function _registerHandlebarsHelpers() {
    // Helper to calculate percentage for bars
    Handlebars.registerHelper('needPercentage', function(value, max) {
        return Math.round((value / max) * 100);
    });

    // Helper to get severity class based on percentage
    Handlebars.registerHelper('needSeverity', function(value, max) {
        const percentage = (value / max) * 100;
        if (percentage >= 80) return 'critical';
        if (percentage >= 60) return 'high';
        if (percentage >= 40) return 'medium';
        if (percentage >= 20) return 'low';
        return 'minimal';
    });

    // Helper to localize need names
    Handlebars.registerHelper('localizeNeed', function(needId) {
        return game.i18n.localize(`MORTAL_NEEDS.Needs.${needId}`);
    });
}

/* -------------------------------------------- */
/*  Module Exports                              */
/* -------------------------------------------- */

export { MortalNeeds };

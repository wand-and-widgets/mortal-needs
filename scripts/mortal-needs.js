import { MODULE_ID, MODULE_TITLE, Events, EntitySource } from './constants.js';

// Core systems
import { EventBus } from './core/event-bus.js';
import { NeedsStore } from './core/needs-store.js';
import { NeedsEngine } from './core/needs-engine.js';
import { ConsequenceEngine } from './core/consequence-engine.js';
import { ConfigManager } from './core/config-manager.js';
import { SocketManager } from './core/socket-manager.js';
import { TimeEngine } from './core/time-engine.js';
import { MovementEngine } from './core/movement-engine.js';
import { isResponsibleGM } from './core/access.js';
import { needIcon } from './ui/need-icons.js';

// Consequence types (self-registering)
import './consequences/attribute-modify.js';
import './consequences/condition-apply.js';
import './consequences/active-effect-apply.js';
import './consequences/custom-callback.js';
import './consequences/chat-notify.js';
import './consequences/macro-execute.js';

// Adapters
import { SystemAdapter } from './adapters/system-adapter.js';
import { Dnd5eAdapter } from './adapters/dnd5e-adapter.js';
import { Pf2eAdapter } from './adapters/pf2e-adapter.js';
import { SwadeAdapter } from './adapters/swade-adapter.js';
import { Wfrp4eAdapter } from './adapters/wfrp4e-adapter.js';
import { GenericAdapter } from './adapters/generic-adapter.js';

// UI
import { MortalNeedsDock as MortalNeedsApp } from './ui/mortal-needs-dock.js';

// Integrations
import { ChatCards } from './integrations/chat-cards.js';
import { FlavorEngine } from './integrations/flavor-engine.js';

// Broadcast overlays
import { BroadcastHUD } from './ui/broadcast-hud.js';
import { FlashPopup } from './ui/flash-popup.js';

// API
import { createPublicAPI } from './api/public-api.js';

let mortalNeeds = null;

class MortalNeeds {
  constructor() {
    this.eventBus = null;
    this.store = null;
    this.engine = null;
    this.consequenceEngine = null;
    this.configManager = null;
    this.socketManager = null;
    this.timeEngine = null;
    this.movementEngine = null;
    this.adapter = null;
    this.chatCards = null;
    this.flavorEngine = null;
    this.ui = null;
  }

  async initialize() {
    console.log(`${MODULE_TITLE} | Initializing v3.0.0...`);

    // 1. Create event bus
    this.eventBus = new EventBus();

    // 2. Create system adapter
    this.adapter = this.#createAdapter();
    console.log(`${MODULE_TITLE} | System adapter: ${this.adapter.constructor.systemId}`);

    // 3. Create core systems
    this.store = new NeedsStore(this.eventBus);
    this.configManager = new ConfigManager(this.eventBus);
    this.engine = new NeedsEngine(this.store, this.eventBus, this.adapter);
    this.consequenceEngine = new ConsequenceEngine(this.eventBus, this.store, this.adapter);
    this.socketManager = new SocketManager(this.eventBus, this.store);
    this.timeEngine = new TimeEngine(this.eventBus, this.store, this.engine);
    this.movementEngine = new MovementEngine(this.eventBus, this.store, this.engine);

    // 4. Load configuration
    const needsConfig = await this.configManager.loadNeedsConfig();
    this.store.setNeedConfigs(needsConfig);

    // 5. Load tracked actors
    await this.#loadTrackedEntities();

    // 6. Initialize subsystems
    this.socketManager.initialize();
    this.timeEngine.initialize();
    this.movementEngine.initialize();
    this.chatCards = new ChatCards(this.eventBus, this.store);
    this.flavorEngine = new FlavorEngine(this.eventBus, this.store);

    // 7. Request sync if player
    if (!game.user.isGM) {
      this.socketManager.requestSync();
    }

    // 8. Expose public API
    const api = createPublicAPI(this.store, this.engine, this.consequenceEngine, this.eventBus, this.configManager, this.adapter, this);
    game.modules.get(MODULE_ID).api = api;
    // Global convenience reference
    globalThis.MortalNeeds = api;

    // 9. Initialize broadcast overlays (for all clients)
    this.broadcastHUD = new BroadcastHUD();
    this.flashPopup = new FlashPopup();

    // 10. Integrate with SessionFlow (if active)
    this.#initSessionFlowIntegration();

    // 11. Subscribe to actor events
    this.#registerActorHooks();

    console.log(`${MODULE_TITLE} | Initialization complete`);
  }

  #createAdapter() {
    const systemId = game.system?.id;
    const adapters = {
      dnd5e: Dnd5eAdapter,
      pf2e: Pf2eAdapter,
      swade: SwadeAdapter,
      wfrp4e: Wfrp4eAdapter,
    };
    const AdapterClass = adapters[systemId] || GenericAdapter;
    return new AdapterClass();
  }

  async #loadTrackedEntities() {
    const trackedIds = game.settings.get(MODULE_ID, 'trackedActors') || [];

    for (const id of trackedIds) {
      const actor = game.actors.get(id);
      if (actor) {
        this.store.trackEntity(id, {
          source: EntitySource.ACTOR,
          name: actor.name,
          img: actor.img || actor.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
        });
        await this.store.loadActorNeeds(actor);
      }
    }

    // Load Exalted Scenes characters (if module active)
    await this.#loadExaltedScenesCharacters();
  }

  async #loadExaltedScenesCharacters() {
    const esModule = game.modules.get('exalted-scenes');
    if (!esModule?.active || !esModule.api?.isReady) return;

    const esData = game.settings.get(MODULE_ID, 'esCharacterNeeds') || {};
    const trackedESIds = Object.keys(esData);

    for (const charId of trackedESIds) {
      try {
        const char = esModule.api.characters.get(charId);
        if (char) {
          this.store.trackEntity(charId, {
            source: EntitySource.EXALTED_SCENES,
            name: char.name,
            img: char.thumbnail || char.image || 'icons/svg/mystery-man.svg',
            linkedActorId: char.actorId || null,
          });
          await this.store.loadESCharacterNeeds(charId);
        }
      } catch (err) {
        console.warn(`${MODULE_TITLE} | Failed to load ES character ${charId}:`, err);
      }
    }

    // Listen for ES character changes
    if (esModule.api?.hooks) {
      Hooks.on(esModule.api.hooks.CHARACTER_UPDATE, ({ characterId }) => {
        if (this.store.isTracked(characterId)) {
          const char = esModule.api.characters.get(characterId);
          if (char) {
            this.store.trackEntity(characterId, {
              source: EntitySource.EXALTED_SCENES,
              name: char.name,
              img: char.thumbnail || char.image || 'icons/svg/mystery-man.svg',
              linkedActorId: char.actorId || null,
            });
          }
        }
      });

      Hooks.on(esModule.api.hooks.CHARACTER_DELETE, ({ characterId }) => {
        if (this.store.isTracked(characterId)) {
          this.store.untrackEntity(characterId);
        }
      });
    }
  }

  #registerActorHooks() {
    Hooks.on('updateActor', (actor, changes) => {
      if (this.store.isTracked(actor.id)) {
        // Refresh entity info (name/img might have changed)
        this.store.trackEntity(actor.id, {
          source: EntitySource.ACTOR,
          name: actor.name,
          img: actor.img || actor.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
        });
        const flat = foundry.utils.flattenObject(changes);
        if (Object.keys(flat).some(key => key === `flags.${MODULE_ID}.needs` || key.startsWith(`flags.${MODULE_ID}.needs.`))) {
          this.engine.ingestActorNeeds(actor).catch(error => console.error('Mortal Needs | Actor sync failed:', error));
        }
        this.eventBus.emit(Events.ACTORS_REFRESHED, {});
      }
    });

    Hooks.on('deleteActor', (actor) => {
      if (this.store.isTracked(actor.id)) {
        this.store.untrackEntity(actor.id);
        // Remove from tracked list
        const trackedIds = (game.settings.get(MODULE_ID, 'trackedActors') || []).filter(id => id !== actor.id);
        if (isResponsibleGM()) game.settings.set(MODULE_ID, 'trackedActors', trackedIds);
      }
    });

    Hooks.on('mortalNeeds.settingsChanged', ({ key }) => {
      this.#syncSettings(key).catch(error => console.error('Mortal Needs | Settings sync failed:', error));
    });
    for (const event of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect', 'createItem', 'updateItem', 'deleteItem']) {
      Hooks.on(event, doc => {
        if (this.store.isTracked(doc.parent?.id)) this.eventBus.emit(Events.ACTORS_REFRESHED, {});
      });
    }
  }

  async #syncSettings(key) {
    if (key === 'needsConfig') {
      this.store.setNeedConfigs(game.settings.get(MODULE_ID, key) || []);
      this.eventBus.emit(Events.CONFIG_CHANGED, { source: 'document' });
    } else if (key === 'trackedActors') {
      const ids = game.settings.get(MODULE_ID, key) || [];
      for (const entity of this.store.getTrackedEntitiesBySource(EntitySource.ACTOR)) {
        if (!ids.includes(entity.id)) this.store.untrackEntity(entity.id);
      }
      for (const id of ids) {
        const actor = game.actors.get(id);
        if (!actor || this.store.isTracked(id)) continue;
        this.store.trackEntity(id, { source: EntitySource.ACTOR, name: actor.name, img: actor.img });
        await this.store.loadActorNeeds(actor);
      }
    } else if (key === 'esCharacterNeeds') {
      const data = game.settings.get(MODULE_ID, key) || {};
      for (const entity of this.store.getTrackedEntitiesBySource(EntitySource.EXALTED_SCENES)) {
        if (!data[entity.id]) this.store.untrackEntity(entity.id);
        else await this.engine.ingestEntityNeeds(entity.id, () => this.store.loadESCharacterNeeds(entity.id));
      }
      const es = game.modules.get('exalted-scenes')?.api;
      for (const id of Object.keys(data)) {
        if (this.store.isTracked(id) || !es?.isReady) continue;
        const character = es.characters.get(id);
        if (!character) continue;
        this.store.trackEntity(id, { source: EntitySource.EXALTED_SCENES, name: character.name,
          img: character.thumbnail || character.image || 'icons/svg/mystery-man.svg', linkedActorId: character.actorId || null });
        await this.store.loadESCharacterNeeds(id);
      }
    }
    this.eventBus.emit(Events.ACTORS_REFRESHED, {});
  }

  async #initSessionFlowIntegration() {
    const sf = game.modules.get('sessionflow');
    if (!sf?.active || !sf.api?.registerWidgetType) return;

    try {
      const { createMortalNeedsWidgetClass } = await import('./integrations/sessionflow-widget.js');
      const WidgetClass = createMortalNeedsWidgetClass();
      if (WidgetClass) {
        sf.api.registerWidgetType(WidgetClass.TYPE, WidgetClass);
      }
      console.log(`${MODULE_TITLE} | Registered SessionFlow widget`);
    } catch (err) {
      console.warn(`${MODULE_TITLE} | Failed to register SessionFlow widget:`, err);
    }
  }

  // --- UI Control ---

  toggle() {
    if (this.ui) {
      if (this.ui.rendered) {
        this.ui.close();
      } else {
        this.ui.render(true);
      }
      this.eventBus.emit(Events.UI_TOGGLED, { visible: this.ui.rendered });
    }
  }
}

// --- Foundry Hook Registration ---

Hooks.once('init', () => {
  console.log(`${MODULE_TITLE} | Registering settings...`);
  mortalNeeds = new MortalNeeds();
  mortalNeeds.configManager = new ConfigManager(null);
  mortalNeeds.configManager.registerAllSettings();

  // Pre-load partial templates so {{> "path"}} works in Handlebars
  (foundry.applications.handlebars?.loadTemplates ?? globalThis.loadTemplates)([
    `modules/${MODULE_ID}/templates/components/actor-card.hbs`,
    `modules/${MODULE_ID}/templates/components/need-bar-horizontal.hbs`,
    `modules/${MODULE_ID}/templates/components/need-bar-vertical.hbs`,
    `modules/${MODULE_ID}/templates/components/need-bar-radial.hbs`,
    `modules/${MODULE_ID}/templates/components/empty-state.hbs`,
  ]);

  // Register Handlebars helpers
  Handlebars.registerHelper('mnIcon', config => new Handlebars.SafeString(needIcon(config)));
  Handlebars.registerHelper('mnPercentage', (value, max) => {
    return NeedsEngine.getPercentage(value, max);
  });
  Handlebars.registerHelper('mnSeverity', (value, max) => {
    return NeedsEngine.getSeverity(NeedsEngine.getPercentage(value, max));
  });
  Handlebars.registerHelper('mnLocalize', (key) => {
    return game.i18n.localize(key);
  });

  // Register keybindings (must be in init hook)
  game.keybindings.register(MODULE_ID, 'togglePanel', {
    name: 'MORTAL_NEEDS.Keybindings.TogglePanel',
    hint: 'MORTAL_NEEDS.Keybindings.TogglePanelHint',
    editable: [{ key: 'KeyN', modifiers: ['Control', 'Shift'] }],
    onDown: () => mortalNeeds.toggle(),
  });

  // Add scene control button (must be registered before ready)
  Hooks.on('getSceneControlButtons', (controls) => {
    // Handle both v12 (array) and v13 (object) structures
    let tokenControls;
    if (Array.isArray(controls)) {
      tokenControls = controls.find(c => c.name === 'token');
    } else {
      tokenControls = controls?.tokens;
    }

    if (!tokenControls?.tools) return;

    const tool = {
      name: 'mortal-needs',
      title: 'MORTAL_NEEDS.Controls.Toggle',
      icon: 'fas fa-heartbeat',
      button: true,
      onChange: () => mortalNeeds.toggle(),
    };

    if (Array.isArray(tokenControls.tools)) {
      tokenControls.tools.push(tool);
    } else if (tokenControls.tools instanceof Map) {
      tokenControls.tools.set('mortal-needs', tool);
    } else if (typeof tokenControls.tools === 'object') {
      tokenControls.tools['mortal-needs'] = tool;
    }
  });
});

Hooks.once('ready', async () => {
  // Run migration before initialization
  const { MigrationRunner } = await import('./migration/migration-runner.js');
  await MigrationRunner.run();

  await mortalNeeds.initialize();

  // Initialize UI
  mortalNeeds.ui = new MortalNeedsApp(
    mortalNeeds.store,
    mortalNeeds.engine,
    mortalNeeds.eventBus,
    mortalNeeds.configManager,
    mortalNeeds.adapter,
    mortalNeeds,
  );
  mortalNeeds.ui.restore();
  if (game.settings.get(MODULE_ID, 'broadcastState')?.visible) {
    Hooks.callAll('mortalNeeds.broadcast.show', game.modules.get(MODULE_ID).api.broadcast._buildPayload());
  }
});

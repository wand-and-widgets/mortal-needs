import { MODULE_ID, MODULE_TITLE, Events, EntitySource, Severity } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MortalNeedsApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #engine;
  #eventBus;
  #configManager;
  #adapter;
  #app;
  #unsubscribers = [];
  #expandedActors = new Set();

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-panel',
    classes: ['mortal-needs-panel'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.Title',
      icon: 'fas fa-heartbeat',
      resizable: true,
      minimizable: true,
    },
    position: {
      width: 340,
      height: 'auto',
    },
    actions: {
      'stress': MortalNeedsApp.#onStress,
      'relieve': MortalNeedsApp.#onRelieve,
      'toggle-expand': MortalNeedsApp.#onToggleExpand,
      'reset-all': MortalNeedsApp.#onResetAll,
      'untrack': MortalNeedsApp.#onUntrack,
      'add-actors': MortalNeedsApp.#onAddActors,
      'stress-all': MortalNeedsApp.#onStressAll,
      'relieve-all': MortalNeedsApp.#onRelieveAll,
      'configure': MortalNeedsApp.#onConfigure,
      'history': MortalNeedsApp.#onHistory,
    },
  };

  static PARTS = {
    panel: {
      template: `modules/${MODULE_ID}/templates/panel.hbs`,
    },
  };

  constructor(store, engine, eventBus, configManager, adapter, app) {
    // Restore saved position before super() by merging into options
    const savedPos = game.settings.get(MODULE_ID, 'panelPosition');
    super({
      position: savedPos ? { top: savedPos.top, left: savedPos.left } : {},
    });
    this.#store = store;
    this.#engine = engine;
    this.#eventBus = eventBus;
    this.#configManager = configManager;
    this.#adapter = adapter;
    this.#app = app;
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Only subscribe once — avoid stacking listeners on every re-render
    if (this.#unsubscribers.length === 0) {
      this.#unsubscribers.push(
        this.#eventBus.on(Events.NEED_STRESSED, () => this.render(false)),
        this.#eventBus.on(Events.NEED_RELIEVED, () => this.render(false)),
        this.#eventBus.on(Events.NEED_SET, () => this.render(false)),
        this.#eventBus.on(Events.NEED_RESET, () => this.render(false)),
        this.#eventBus.on(Events.ACTORS_REFRESHED, () => this.render(false)),
        this.#eventBus.on(Events.ACTOR_TRACKED, () => this.render(false)),
        this.#eventBus.on(Events.ACTOR_UNTRACKED, () => this.render(false)),
        this.#eventBus.on(Events.CONFIG_CHANGED, () => this.render(false)),
      );
    }

    this.#eventBus.emit(Events.UI_RENDERED, {});
  }

  _onClose(options) {
    super._onClose(options);

    // Unsubscribe from all events
    for (const unsub of this.#unsubscribers) {
      if (typeof unsub === 'function') unsub();
    }
    this.#unsubscribers = [];

    // Save position
    if (this.position) {
      game.settings.set(MODULE_ID, 'panelPosition', {
        top: this.position.top,
        left: this.position.left,
      });
    }
  }

  async _prepareContext(options) {
    const tracked = this.#store.getAllTrackedActors();
    const enabledConfigs = this.#store.getEnabledNeedConfigs();
    const isGM = game.user.isGM;
    const criticalThreshold = game.settings.get(MODULE_ID, 'criticalThreshold');

    // Build actor data with need bar info
    const actors = tracked.map(entity => {
      const needs = enabledConfigs.map(config => {
        const state = entity.needs[config.id];
        const value = state?.value ?? 0;
        const max = state?.max ?? config.max ?? 100;
        const percentage = NeedsEngine.getPercentage(value, max);
        const severity = NeedsEngine.getSeverity(percentage);
        const decimal = max > 0 ? value / max : 0;
        const circumference = 2 * Math.PI * 18; // for radial bars (r=18)

        return {
          id: config.id,
          label: config.label,
          icon: config.icon,
          enabled: config.enabled,
          value, max, percentage, severity, decimal,
          circumference,
          dashOffset: circumference * (1 - decimal),
          entityId: entity.id,
        };
      });

      const worstSeverity = this.#getWorstSeverity(needs);

      return {
        id: entity.id,
        name: entity.name,
        img: entity.img,
        source: entity.source,
        expanded: this.#expandedActors.has(entity.id),
        needs,
        worstSeverity,
      };
    });

    // Count critical actors
    const criticalCount = actors.filter(a =>
      a.needs.some(n => n.percentage >= criticalThreshold)
    ).length;

    return {
      actors,
      hasTracked: actors.length > 0,
      trackedCount: actors.length,
      criticalCount,
      isGM,
    };
  }

  #getWorstSeverity(needs) {
    const order = [Severity.SAFE, Severity.LOW, Severity.MEDIUM, Severity.HIGH, Severity.CRITICAL];
    let worst = 0;
    for (const need of needs) {
      const idx = order.indexOf(need.severity);
      if (idx > worst) worst = idx;
    }
    return order[worst];
  }

  // --- Action Handlers ---

  static async #onStress(event, target) {
    const entityId = target.dataset.entityId;
    const needId = target.dataset.needId;
    const amount = game.settings.get(MODULE_ID, 'defaultStressAmount');
    await this.#engine.stressNeed(entityId, needId, amount);
  }

  static async #onRelieve(event, target) {
    const entityId = target.dataset.entityId;
    const needId = target.dataset.needId;
    const amount = game.settings.get(MODULE_ID, 'defaultStressAmount');
    await this.#engine.relieveNeed(entityId, needId, amount);
  }

  static #onToggleExpand(event, target) {
    const entityId = target.dataset.entityId;
    if (this.#expandedActors.has(entityId)) {
      this.#expandedActors.delete(entityId);
    } else {
      this.#expandedActors.add(entityId);
    }
    this.render(false);
  }

  static async #onResetAll(event, target) {
    const entityId = target.dataset.entityId;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Dialogs.ResetAllTitle') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.Dialogs.ResetAllContent')}</p>`,
    });
    if (confirmed) {
      await this.#engine.resetAll(entityId);
    }
  }

  static async #onUntrack(event, target) {
    const entityId = target.dataset.entityId;
    const api = game.modules.get(MODULE_ID).api;
    await api.actors.untrack(entityId);
  }

  static async #onAddActors() {
    const { ActorSelectionDialog } = await import('./dialogs/actor-selection-dialog.js');
    const dialog = new ActorSelectionDialog(this.#store, this.#app);
    dialog.render(true);
  }

  static async #onStressAll() {
    const { MultiStressDialog } = await import('./dialogs/multi-stress-dialog.js');
    const dialog = new MultiStressDialog(this.#store, this.#engine, 'stress');
    dialog.render(true);
  }

  static async #onRelieveAll() {
    const { MultiStressDialog } = await import('./dialogs/multi-stress-dialog.js');
    const dialog = new MultiStressDialog(this.#store, this.#engine, 'relieve');
    dialog.render(true);
  }

  static async #onConfigure() {
    const { NeedsConfigDialog } = await import('./dialogs/needs-config-dialog.js');
    const dialog = new NeedsConfigDialog(this.#store, this.#configManager, this.#eventBus);
    dialog.render(true);
  }

  static async #onHistory() {
    const { HistoryDialog } = await import('./dialogs/history-dialog.js');
    const dialog = new HistoryDialog(this.#store);
    dialog.render(true);
  }
}

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
  static #RING_RADIUS = 18;

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
      width: 1000,
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
      'broadcast-show': MortalNeedsApp.#onBroadcastShow,
      'broadcast-flash': MortalNeedsApp.#onBroadcastFlash,
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

    // Only subscribe once to avoid stacking listeners on every re-render.
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
    const atRiskThreshold = 60;
    let totalPercentage = 0;
    let totalNeeds = 0;
    let lastChange = 0;
    const crisisQueue = [];

    // Build actor data with need bar info
    const actors = tracked.map(entity => {
      let worstNeed = null;

      const needs = enabledConfigs.map(config => {
        const state = entity.needs[config.id];
        const value = NeedsEngine.normalizeNumber(state?.value, config.default ?? 0);
        const max = MortalNeedsApp.#normalizeMax(state?.max ?? config.max, config.min ?? 0);
        const percentage = MortalNeedsApp.#normalizePercentage(NeedsEngine.getPercentage(value, max));
        const severity = NeedsEngine.getSeverity(percentage);
        const decimal = MortalNeedsApp.#normalizeRatio(NeedsEngine.getRatio(value, max));
        const circumference = 2 * Math.PI * MortalNeedsApp.#RING_RADIUS;
        const dashOffset = MortalNeedsApp.#normalizeNumber(circumference * (1 - decimal), circumference);
        const localizedLabel = game.i18n.localize(config.label);
        const severityLabel = this.#getSeverityLabel(severity);
        const lastChangeTime = state?.lastChange ?? 0;

        totalPercentage += percentage;
        totalNeeds += 1;
        if (lastChangeTime > lastChange) lastChange = lastChangeTime;

        const needData = {
          id: config.id,
          label: config.label,
          localizedLabel,
          icon: config.icon,
          enabled: config.enabled,
          value, max, percentage, severity, decimal,
          percentageLabel: `${percentage}%`,
          displayValue: `${value}/${max}`,
          severityLabel,
          isCritical: percentage >= criticalThreshold,
          isAtRisk: percentage >= atRiskThreshold,
          hasConsequences: (config.consequences?.length ?? 0) > 0,
          consequenceCount: config.consequences?.length ?? 0,
          decayEnabled: !!config.decay?.enabled,
          circumference,
          dashOffset,
          entityId: entity.id,
        };

        if (!worstNeed || percentage > worstNeed.percentage) {
          worstNeed = needData;
        }

        if (percentage >= atRiskThreshold) {
          const activeConsequence = (config.consequences || [])
            .find(c => percentage >= (c.threshold ?? 100));
          const tickProgress = activeConsequence
            ? this.#app?.consequenceEngine?.getTickProgress?.(entity.id, config.id, activeConsequence)
            : null;

          crisisQueue.push({
            entityId: entity.id,
            actorName: entity.name,
            actorImg: entity.img,
            needId: config.id,
            needLabel: localizedLabel,
            needIcon: config.icon,
            percentage,
            percentageLabel: `${percentage}%`,
            severity,
            severityLabel,
            hasConsequence: !!activeConsequence,
            tickLabel: tickProgress ? `${tickProgress.current}/${tickProgress.max}` : null,
          });
        }

        return needData;
      });

      const worstSeverity = this.#getWorstSeverity(needs);
      const criticalNeedCount = needs.filter(n => n.isCritical).length;
      const atRiskNeedCount = needs.filter(n => n.isAtRisk).length;

      return {
        id: entity.id,
        name: entity.name,
        img: entity.img,
        source: entity.source,
        expanded: this.#expandedActors.has(entity.id),
        needs,
        worstSeverity,
        worstNeed,
        worstNeedLabel: worstNeed?.localizedLabel ?? '',
        worstNeedPercentage: worstNeed?.percentageLabel ?? '0%',
        criticalNeedCount,
        atRiskNeedCount,
      };
    });

    // Count critical actors
    const criticalCount = actors.filter(a =>
      a.needs.some(n => n.percentage >= criticalThreshold)
    ).length;
    const atRiskCount = actors.filter(a =>
      a.needs.some(n => n.percentage >= atRiskThreshold)
    ).length;
    const averageSeverity = totalNeeds > 0 ? Math.round(totalPercentage / totalNeeds) : 0;
    const decayActiveCount = enabledConfigs.filter(c => c.decay?.enabled).length;
    const lastChangeLabel = this.#formatRelativeTime(lastChange);

    crisisQueue.sort((a, b) => b.percentage - a.percentage);

    const nextDecay = enabledConfigs
      .filter(c => c.decay?.enabled)
      .slice(0, 3)
      .map(c => ({
        id: c.id,
        label: game.i18n.localize(c.label),
        icon: c.icon,
        rate: c.decay.rate,
        intervalLabel: this.#formatDuration(c.decay.interval),
      }));

    const barOrientation = game.settings.get(MODULE_ID, 'barOrientation') ?? 'horizontal';

    return {
      actors,
      hasTracked: actors.length > 0,
      isDense: actors.length >= 4,
      trackedCount: actors.length,
      criticalCount,
      atRiskCount,
      averageSeverity,
      decayActiveCount,
      lastChangeLabel,
      crisisQueue: crisisQueue.slice(0, 5),
      hasCrisis: crisisQueue.length > 0,
      nextDecay,
      hasDecay: nextDecay.length > 0,
      isGM,
      barOrientation,
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

  static #normalizeNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  static #normalizeMax(value, min = 0) {
    const safeMin = MortalNeedsApp.#normalizeNumber(min, 0);
    const safeMax = MortalNeedsApp.#normalizeNumber(value, 100);
    return safeMax > safeMin ? safeMax : Math.max(safeMin + 1, 100);
  }

  static #normalizePercentage(value) {
    const number = MortalNeedsApp.#normalizeNumber(value, 0);
    return Math.max(0, Math.min(100, number));
  }

  static #normalizeRatio(value) {
    const number = MortalNeedsApp.#normalizeNumber(value, 0);
    return Math.max(0, Math.min(1, number));
  }

  static #getActionTarget(event, target, action) {
    const candidate = target instanceof HTMLElement ? target : event?.target;
    return candidate?.closest?.(`[data-action="${action}"]`) ?? candidate;
  }

  #getSeverityLabel(severity) {
    return `MORTAL_NEEDS.Severity.${severity.charAt(0).toUpperCase()}${severity.slice(1)}`;
  }

  #formatRelativeTime(timestamp) {
    if (!timestamp) return game.i18n.localize('MORTAL_NEEDS.Panel.NoRecentChange');
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 30) return game.i18n.localize('MORTAL_NEEDS.Panel.Now');
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  #formatDuration(seconds) {
    if (!seconds) return '0m';
    if (seconds >= 3600) return `${Math.round(seconds / 3600)}h`;
    if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
    return `${seconds}s`;
  }

  // --- Action Handlers ---

  static async #onStress(event, target) {
    const actionTarget = MortalNeedsApp.#getActionTarget(event, target, 'stress');
    const entityId = actionTarget?.dataset.entityId;
    const needId = actionTarget?.dataset.needId;
    if (!entityId || !needId) return;
    await this.#engine.stressNeed(entityId, needId);
  }

  static async #onRelieve(event, target) {
    const actionTarget = MortalNeedsApp.#getActionTarget(event, target, 'relieve');
    const entityId = actionTarget?.dataset.entityId;
    const needId = actionTarget?.dataset.needId;
    if (!entityId || !needId) return;
    await this.#engine.relieveNeed(entityId, needId);
  }

  static #onToggleExpand(event, target) {
    event.preventDefault();
    event.stopPropagation();

    const actionTarget = MortalNeedsApp.#getActionTarget(event, target, 'toggle-expand');
    const entityId = actionTarget?.dataset.entityId;
    if (!entityId) return;

    if (this.#expandedActors.has(entityId)) {
      this.#expandedActors.delete(entityId);
    } else {
      this.#expandedActors.add(entityId);
    }
    this.render(false);
  }

  static async #onResetAll(event, target) {
    const actionTarget = MortalNeedsApp.#getActionTarget(event, target, 'reset-all');
    const entityId = actionTarget?.dataset.entityId;
    if (!entityId) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Dialogs.ResetAllTitle') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.Dialogs.ResetAllContent')}</p>`,
    });
    if (confirmed) {
      await this.#engine.resetAll(entityId);
    }
  }

  static async #onUntrack(event, target) {
    const actionTarget = MortalNeedsApp.#getActionTarget(event, target, 'untrack');
    const entityId = actionTarget?.dataset.entityId;
    if (!entityId) return;

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
    const dialog = new HistoryDialog(this.#store, this.#eventBus);
    dialog.render(true);
  }

  static #onBroadcastShow() {
    game.modules.get(MODULE_ID)?.api?.broadcast?.show();
  }

  static #onBroadcastFlash() {
    game.modules.get(MODULE_ID)?.api?.broadcast?.flash();
  }
}

import { MODULE_ID, Events } from '../../constants.js';
import { NeedsEngine } from '../../core/needs-engine.js';

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HistoryDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #eventBus;
  #unsubscribers = [];
  #renderQueued = false;
  #filters = {
    entityId: '',
    needId: '',
    query: '',
  };

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-history',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.History.Title',
      icon: 'fas fa-history',
      resizable: true,
    },
    position: {
      width: 880,
      height: 'auto',
    },
    actions: {
      'refresh-history': HistoryDialog.#onRefresh,
      'export-history': HistoryDialog.#onExport,
      'clear-history': HistoryDialog.#onClear,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/history.hbs`,
    },
  };

  constructor(store, eventBus) {
    super();
    this.#store = store;
    this.#eventBus = eventBus;
  }

  async _prepareContext(options) {
    const entries = this.#getEntries();
    const summary = this.#summarizeEntries(entries);
    const entities = this.#store.getAllTrackedActors()
      .map(entity => ({ id: entity.id, name: entity.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    const needs = this.#store.getAllNeedConfigs()
      .map(need => ({ id: need.id, label: game.i18n.localize(need.label) }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return {
      entries,
      entities,
      needs,
      summary,
      activityBars: this.#buildActivityBars(entries),
      hasEntries: entries.length > 0,
      isGM: game.user.isGM,
      canClear: game.user.isGM && entries.length > 0,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);
    this.#subscribeToHistory();

    const filterEntity = this.element.querySelector('[data-history-filter="entity"]');
    const filterNeed = this.element.querySelector('[data-history-filter="need"]');
    const search = this.element.querySelector('[data-history-filter="query"]');

    if (filterEntity) filterEntity.value = this.#filters.entityId;
    if (filterNeed) filterNeed.value = this.#filters.needId;
    if (search) search.value = this.#filters.query;

    filterEntity?.addEventListener('change', () => {
      this.#filters.entityId = filterEntity.value;
      this.#applyFilters();
    });
    filterNeed?.addEventListener('change', () => {
      this.#filters.needId = filterNeed.value;
      this.#applyFilters();
    });
    search?.addEventListener('input', () => {
      this.#filters.query = search.value.trim().toLocaleLowerCase();
      this.#applyFilters();
    });

    this.#applyFilters();
  }

  _onClose(options) {
    super._onClose(options);

    for (const unsubscribe of this.#unsubscribers) {
      if (typeof unsubscribe === 'function') unsubscribe();
    }
    this.#unsubscribers = [];
  }

  #getEntries() {
    const allHistory = this.#store.getAllHistory(300);
    let lastDateKey = null;

    return allHistory.map(entry => this.#buildEntry(entry))
      .reverse()
      .map(entry => {
        const showDate = entry.dateKey !== lastDateKey;
        lastDateKey = entry.dateKey;
        return { ...entry, showDate };
      });
  }

  #buildEntry(entry) {
    const entityInfo = this.#store.getTrackedEntityInfo(entry.entityId);
    const needConfig = this.#store.getNeedConfig(entry.needId);
    const max = entry.max ?? needConfig?.max ?? 100;
    const previousPercentage = NeedsEngine.getPercentage(entry.previousValue, max);
    const newPercentage = NeedsEngine.getPercentage(entry.newValue, max);
    const newSeverity = NeedsEngine.getSeverity(newPercentage);
    const previousSeverity = NeedsEngine.getSeverity(previousPercentage);
    const delta = entry.newValue - entry.previousValue;
    const timestamp = Number(entry.timestamp) || Date.now();
    const date = new Date(timestamp);
    const needLabel = needConfig ? game.i18n.localize(needConfig.label) : entry.needId;
    const entityName = entityInfo?.name || entry.entityId;
    const source = entry.source || 'manual';
    const sourceLabel = this.#getSourceLabel(source);

    return {
      id: entry.id || `${timestamp}-${entry.entityId}-${entry.needId}`,
      timestamp,
      isoTime: date.toISOString(),
      dateKey: this.#formatDateKey(date),
      dateLabel: date.toLocaleDateString(game.i18n.lang, { dateStyle: 'medium' }),
      time: date.toLocaleTimeString(game.i18n.lang, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      relativeTime: this.#formatRelativeTime(timestamp),
      entityId: entry.entityId,
      entityName,
      actorImg: entityInfo?.img || 'icons/svg/mystery-man.svg',
      needId: entry.needId,
      needLabel,
      needIcon: needConfig?.icon || 'fa-question',
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      previousPercentage,
      newPercentage,
      previousSeverity,
      newSeverity,
      severityLabel: this.#getSeverityLabel(newSeverity),
      source,
      sourceClass: this.#normalizeClass(source),
      sourceLabel,
      sourceIcon: this.#getSourceIcon(source),
      delta,
      deltaLabel: delta > 0 ? `+${delta}` : `${delta}`,
      direction: delta < 0 ? 'recovery' : 'worsening',
      searchText: `${entityName} ${needLabel} ${sourceLabel} ${entry.previousValue} ${entry.newValue}`.toLocaleLowerCase(),
    };
  }

  #summarizeEntries(entries) {
    const affectedNeeds = new Map();

    for (const entry of entries) {
      affectedNeeds.set(entry.needLabel, (affectedNeeds.get(entry.needLabel) || 0) + 1);
    }

    const mostAffected = [...affectedNeeds.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      || game.i18n.localize('MORTAL_NEEDS.History.None');

    return {
      total: entries.length,
      critical: entries.filter(entry => entry.newSeverity === 'critical').length,
      high: entries.filter(entry => entry.newSeverity === 'high').length,
      recoveries: entries.filter(entry => entry.delta < 0).length,
      mostAffected,
      lastChange: entries[0]?.relativeTime || game.i18n.localize('MORTAL_NEEDS.History.None'),
    };
  }

  #buildActivityBars(entries) {
    return entries.slice(0, 12).reverse().map(entry => ({
      severity: entry.newSeverity,
      height: Math.max(18, Math.min(100, entry.newPercentage)),
      label: `${entry.needLabel}: ${entry.newValue}`,
    }));
  }

  #subscribeToHistory() {
    if (!this.#eventBus || this.#unsubscribers.length > 0) return;

    this.#unsubscribers.push(
      this.#eventBus.on(Events.HISTORY_UPDATED, () => this.#queueRender()),
      this.#eventBus.on(Events.HISTORY_CLEARED, () => this.#queueRender()),
      this.#eventBus.on(Events.ACTOR_TRACKED, () => this.#queueRender()),
      this.#eventBus.on(Events.ACTOR_UNTRACKED, () => this.#queueRender()),
      this.#eventBus.on(Events.CONFIG_CHANGED, () => this.#queueRender()),
    );
  }

  #queueRender() {
    if (this.#renderQueued) return;
    this.#renderQueued = true;

    setTimeout(() => {
      this.#renderQueued = false;
      if (this.rendered) this.render(false);
    }, 75);
  }

  #applyFilters() {
    const rows = [...this.element.querySelectorAll('.mn-history-entry')];
    const separators = [...this.element.querySelectorAll('.mn-history-date')];
    const { entityId, needId, query } = this.#filters;
    let visibleCount = 0;

    for (const row of rows) {
      const matchesEntity = !entityId || row.dataset.entityId === entityId;
      const matchesNeed = !needId || row.dataset.needId === needId;
      const matchesQuery = !query || row.dataset.search?.includes(query);
      const visible = matchesEntity && matchesNeed && matchesQuery;

      row.classList.toggle('is-filtered', !visible);
      if (visible) visibleCount += 1;
    }

    for (const separator of separators) {
      const date = separator.dataset.historyDate;
      const hasVisibleRows = rows.some(row => row.dataset.date === date && !row.classList.contains('is-filtered'));
      separator.classList.toggle('is-filtered', !hasVisibleRows);
    }

    const list = this.element.querySelector('.mn-history-list');
    const filterEmpty = this.element.querySelector('[data-history-filter-empty]');
    list?.classList.toggle('is-filter-empty', rows.length > 0 && visibleCount === 0);
    if (filterEmpty) filterEmpty.hidden = rows.length === 0 || visibleCount > 0;

    const visibleRows = rows.filter(row => !row.classList.contains('is-filtered'));
    this.#updateSummary(visibleRows);
    this.#renderActivity(visibleRows);
  }

  #updateSummary(rows) {
    const critical = rows.filter(row => row.dataset.severity === 'critical').length;
    const high = rows.filter(row => row.dataset.severity === 'high').length;
    const recoveries = rows.filter(row => Number(row.dataset.delta) < 0).length;
    const affectedNeeds = new Map();

    for (const row of rows) {
      const needLabel = row.dataset.needLabel || game.i18n.localize('MORTAL_NEEDS.History.None');
      affectedNeeds.set(needLabel, (affectedNeeds.get(needLabel) || 0) + 1);
    }

    const mostAffected = [...affectedNeeds.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0]
      || game.i18n.localize('MORTAL_NEEDS.History.None');
    const lastChange = rows[0]?.dataset.relativeTime || game.i18n.localize('MORTAL_NEEDS.History.None');

    this.#setText('[data-history-stat="total"]', rows.length);
    this.#setText('[data-history-stat="critical"]', critical);
    this.#setText('[data-history-stat="high"]', high);
    this.#setText('[data-history-stat="recoveries"]', recoveries);
    this.#setText('[data-history-stat="mostAffected"]', mostAffected);
    this.#setText('[data-history-stat="lastChange"]', lastChange);
  }

  #renderActivity(rows) {
    const activity = this.element.querySelector('[data-history-activity]');
    if (!activity) return;

    activity.replaceChildren();
    for (const row of rows.slice(0, 12).reverse()) {
      const bar = document.createElement('span');
      const severity = row.dataset.severity || 'safe';
      const percentage = Number(row.dataset.percentage) || 0;

      bar.className = `mn-history-activity__bar mn-history-activity__bar--${severity}`;
      bar.style.height = `${Math.max(18, Math.min(100, percentage))}%`;
      bar.title = `${row.dataset.needLabel}: ${row.dataset.newValue}`;
      activity.append(bar);
    }
  }

  #setText(selector, value) {
    for (const element of this.element.querySelectorAll(selector)) {
      element.textContent = value;
    }
  }

  #getVisibleRows() {
    return [...this.element.querySelectorAll('.mn-history-entry')]
      .filter(row => !row.classList.contains('is-filtered'));
  }

  #getSourceLabel(source) {
    const key = {
      stress: 'SourceStress',
      relieve: 'SourceRelieve',
      manual: 'SourceManual',
      reset: 'SourceReset',
      decay: 'SourceDecay',
      socket: 'SourceSocket',
      registration: 'SourceRegistration',
    }[source] || 'SourceManual';

    return game.i18n.localize(`MORTAL_NEEDS.History.${key}`);
  }

  #getSourceIcon(source) {
    return {
      stress: 'fa-arrow-up',
      relieve: 'fa-arrow-down',
      manual: 'fa-pen',
      reset: 'fa-undo',
      decay: 'fa-clock',
      socket: 'fa-wifi',
      registration: 'fa-plus',
    }[source] || 'fa-pen';
  }

  #getSeverityLabel(severity) {
    const key = severity.charAt(0).toUpperCase() + severity.slice(1);
    return game.i18n.localize(`MORTAL_NEEDS.Severity.${key}`);
  }

  #formatRelativeTime(timestamp) {
    const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (seconds < 30) return game.i18n.localize('MORTAL_NEEDS.History.Now');
    if (seconds < 3600) return `${Math.max(1, Math.floor(seconds / 60))}m`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
    return `${Math.floor(seconds / 86400)}d`;
  }

  #formatDateKey(date) {
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  }

  #normalizeClass(value) {
    return String(value || 'manual').replace(/[^a-z0-9_-]/gi, '-').toLocaleLowerCase();
  }

  static #onRefresh() {
    this.render(false);
  }

  static #onExport() {
    this.#applyFilters();

    const entries = this.#getVisibleRows().map(row => ({
      timestamp: Number(row.dataset.timestamp),
      entityId: row.dataset.entityId,
      entityName: row.dataset.entityName,
      needId: row.dataset.needId,
      needLabel: row.dataset.needLabel,
      source: row.dataset.source,
      previousValue: Number(row.dataset.previousValue),
      newValue: Number(row.dataset.newValue),
      delta: Number(row.dataset.delta),
      severity: row.dataset.severity,
    }));
    const payload = {
      version: 1,
      module: MODULE_ID,
      exportedAt: new Date().toISOString(),
      filters: { ...this.#filters },
      entries,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `mortal-needs-history-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
    ui.notifications.info('MORTAL_NEEDS.History.Exported', { localize: true });
  }

  static async #onClear() {
    if (!game.user.isGM) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.GMOnly', { localize: true });
      return;
    }

    const confirmed = await DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.History.ClearTitle') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.History.ClearContent')}</p>`,
    });
    if (!confirmed) return;

    this.#store.clearHistory();
    ui.notifications.info('MORTAL_NEEDS.History.Cleared', { localize: true });
    this.render(false);
  }
}

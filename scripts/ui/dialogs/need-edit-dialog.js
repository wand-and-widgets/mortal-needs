import { MODULE_ID, Events, NeedCategory } from '../../constants.js';
import { getAllConsequenceTypes, getConsequenceType, getConsequenceDescription } from '../../consequences/consequence-type.js';
import { NeedsEngine } from '../../core/needs-engine.js';
import {
  NeedDisplayRule,
  NeedVisibility,
  normalizeNeedDisplayRule,
  normalizeNeedVisibility,
} from '../../core/need-visibility.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NeedEditDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #needId;
  #store;
  #configManager;
  #eventBus;
  #isNew;
  #isPersisting = false;
  #draftConfig = null;

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-need-edit',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.NeedEdit.Title',
      icon: 'fas fa-pen',
      resizable: false,
    },
    position: {
      width: 960,
      height: 'auto',
    },
    actions: {
      'save-need': NeedEditDialog.#onSave,
      'delete-need': NeedEditDialog.#onDelete,
      'add-consequence': NeedEditDialog.#onAddConsequence,
      'edit-consequence': NeedEditDialog.#onEditConsequence,
      'delete-consequence': NeedEditDialog.#onDeleteConsequence,
      'apply-suggestion': NeedEditDialog.#onApplySuggestion,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/need-edit.hbs`,
    },
  };

  constructor(needId, store, configManager, eventBus) {
    super();
    this.#needId = needId;
    this.#store = store;
    this.#configManager = configManager;
    this.#eventBus = eventBus;
    this.#isNew = !needId;
  }

  async _prepareContext(options) {
    const storedConfig = this.#needId ? this.#store.getNeedConfig(this.#needId) : null;
    const config = this.#draftConfig
      ? {
        ...this.#draftConfig,
        consequences: storedConfig?.consequences || this.#draftConfig.consequences || [],
      }
      : storedConfig;
    const categories = Object.values(NeedCategory);
    const consequenceTypes = getAllConsequenceTypes();

    // Enrich consequences with icon, label, and description
    const rawConsequences = config?.consequences || [];
    const enrichedConsequences = rawConsequences.map((c, index) => {
      const TypeClass = getConsequenceType(c.type);
      return {
        ...c,
        index,
        iconClass: TypeClass?.ICON || 'fas fa-bolt',
        localizedLabel: TypeClass?.LABEL ? game.i18n.localize(TypeClass.LABEL) : c.type,
        description: getConsequenceDescription(c.type, c.config || {}),
      };
    });

    // Get adapter suggestions for this need
    const api = game.modules.get(MODULE_ID)?.api;
    const allSuggestions = api?.system?.effectSuggestions || {};
    const needSuggestions = (allSuggestions[this.#needId] || []).map((s, idx) => ({
      ...s,
      index: idx,
      description: getConsequenceDescription(s.type, s.config || {}),
      iconClass: getConsequenceType(s.type)?.ICON || 'fas fa-bolt',
    }));

    const baseConfig = config || {
      id: '', label: '', icon: 'fa-question', iconType: 'fa',
      enabled: true, category: NeedCategory.CUSTOM, custom: true,
      min: 0, max: 100, default: 0, stressAmount: 10,
      inverted: false,
      attribute: null, consequences: [],
      decay: { enabled: false, rate: 5, interval: 3600 },
      movement: { enabled: false, metric: 'spaces', interval: 2, amount: 10, countTeleports: false },
    };
    const preparedConfig = {
      ...baseConfig,
      visibility: normalizeNeedVisibility(baseConfig),
      showWhen: normalizeNeedDisplayRule(baseConfig),
      color: this.#normalizeColor(baseConfig.color),
      inverted: baseConfig.inverted === true,
    };
    const criticalThreshold = game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80;
    const previewRiskPercentage = Math.min(100, Math.max(0, criticalThreshold));
    const previewValue = NeedsEngine.getValueForStressPercentage(previewRiskPercentage, preparedConfig.max ?? 100, preparedConfig);
    const previewPercentage = Math.min(100, Math.max(0, NeedsEngine.getPercentage(previewValue, preparedConfig.max ?? 100)));
    const previewSeverity = previewRiskPercentage >= 80 ? 'critical'
      : previewRiskPercentage >= 60 ? 'high'
        : previewRiskPercentage >= 40 ? 'medium'
          : previewRiskPercentage >= 20 ? 'low'
            : 'safe';

    return {
      isNew: this.#isNew,
      config: preparedConfig,
      localizedLabel: preparedConfig.label ? game.i18n.localize(preparedConfig.label) : '',
      categories,
      consequenceTypes,
      enrichedConsequences,
      suggestions: needSuggestions,
      hasSuggestions: needSuggestions.length > 0,
      canDelete: !!config?.custom,
      previewPercentage,
      previewRiskPercentage,
      previewSeverity,
      previewValue,
      criticalThreshold,
      colorValue: preparedConfig.color || '#d79524',
      movementMetrics: this.#getMovementMetricChoices(preparedConfig.movement?.metric),
      movementMetricShortLabel: this.#getMovementMetricLabel(preparedConfig.movement?.metric),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Listen for config changes to refresh consequence list
    if (this._configChangedHandler) {
      this.#eventBus.off(Events.CONFIG_CHANGED, this._configChangedHandler);
    }
    this._configChangedHandler = (event) => {
      if (this.#isPersisting) return;
      if (['need-edit', 'need-delete'].includes(event?.source)) return;
      if (event.needId === this.#needId || event.source?.startsWith('consequence')) {
        this.#captureFormDraft();
        this.render(false);
      }
    };
    this.#eventBus.on(Events.CONFIG_CHANGED, this._configChangedHandler);

    this.#bindLivePreview();
    this.#syncDecayVisualState();
    this.#syncMovementVisualState();
  }

  _onClose(options) {
    if (this._configChangedHandler) {
      this.#eventBus.off(Events.CONFIG_CHANGED, this._configChangedHandler);
    }
    super._onClose(options);
  }

  #bindLivePreview() {
    const fields = [
      '[name="label"]',
      '[name="icon"]',
      '[name="category"]',
      '[name="customColorEnabled"]',
      '[name="color"]',
      '[name="min"]',
      '[name="max"]',
      '[name="default"]',
      '[name="stressAmount"]',
      '[name="inverted"]',
      '[name="enabled"]',
      '[name="gmOnly"]',
      '[name="showAboveZeroOnly"]',
      '[name="decayEnabled"]',
      '[name="decayRate"]',
      '[name="decayInterval"]',
      '[name="movementEnabled"]',
      '[name="movementMetric"]',
      '[name="movementInterval"]',
      '[name="movementAmount"]',
    ];

    for (const selector of fields) {
      const input = this.element.querySelector(selector);
      input?.addEventListener('input', () => this.#refreshLivePreview());
      input?.addEventListener('change', () => this.#refreshLivePreview());
    }

    this.element.querySelector('[name="inverted"]')?.addEventListener('change', (event) => {
      if (!event.currentTarget.checked) return;
      const min = Number(this.element.querySelector('[name="min"]')?.value) || 0;
      const max = Number(this.element.querySelector('[name="max"]')?.value) || 100;
      const defaultInput = this.element.querySelector('[name="default"]');
      const currentDefault = Number(defaultInput?.value);
      if (defaultInput && (!Number.isFinite(currentDefault) || currentDefault <= min)) {
        defaultInput.value = String(max);
      }
      this.#refreshLivePreview();
    });

    this.#refreshLivePreview();
  }

  #refreshLivePreview() {
    const labelValue = this.element.querySelector('[name="label"]')?.value?.trim() ?? '';
    const iconValue = this.element.querySelector('[name="icon"]')?.value?.trim() || 'fa-question';
    const category = this.element.querySelector('[name="category"]')?.value || NeedCategory.CUSTOM;
    const min = Number(this.element.querySelector('[name="min"]')?.value) || 0;
    const max = Number(this.element.querySelector('[name="max"]')?.value) || 100;
    const inverted = this.element.querySelector('[name="inverted"]')?.checked ?? false;
    const stressAmount = Number(this.element.querySelector('[name="stressAmount"]')?.value) || 0;
    const enabled = this.element.querySelector('[name="enabled"]')?.checked ?? true;
    const decayEnabled = this.element.querySelector('[name="decayEnabled"]')?.checked ?? false;
    const decayRate = Number(this.element.querySelector('[name="decayRate"]')?.value) || 0;
    const decayInterval = Number(this.element.querySelector('[name="decayInterval"]')?.value) || 0;
    const movementEnabled = this.element.querySelector('[name="movementEnabled"]')?.checked ?? false;
    const movementAmount = Number(this.element.querySelector('[name="movementAmount"]')?.value) || 0;
    const movementInterval = Number(this.element.querySelector('[name="movementInterval"]')?.value) || 0;
    const movementMetric = this.element.querySelector('[name="movementMetric"]')?.value || 'spaces';
    const customColorEnabled = this.element.querySelector('[name="customColorEnabled"]')?.checked ?? false;
    const customColor = this.#normalizeColor(this.element.querySelector('[name="color"]')?.value);
    const previewRiskPercentage = Number(this.element.dataset.previewRiskPercentage) || 0;
    const previewValue = NeedsEngine.getValueForStressPercentage(previewRiskPercentage, max, { min, max, inverted });
    const previewPercentage = Math.min(100, Math.max(0, NeedsEngine.getPercentage(previewValue, max)));
    const fallbackName = this.element.querySelector('[name="needId"]')?.value?.trim() || 'Need';
    const displayName = labelValue ? game.i18n.localize(labelValue) : fallbackName;
    const iconClass = `fas ${iconValue}`;

    this.element.querySelectorAll('[data-live-hero-icon], [data-live-icon]').forEach(icon => {
      icon.className = iconClass;
    });

    this.element.querySelectorAll('[data-live-need-title], [data-live-preview-name]').forEach(node => {
      node.textContent = displayName;
    });

    const categoryChip = this.element.querySelector('[data-live-category]');
    if (categoryChip) {
      categoryChip.className = `mn-config-pill mn-config-pill--${category}`;
      categoryChip.textContent = category;
    }

    const statusText = game.i18n.localize(enabled ? 'MORTAL_NEEDS.NeedEdit.Enabled' : 'MORTAL_NEEDS.Config.Disabled');
    const heroStatus = this.element.querySelector('[data-live-status]');
    if (heroStatus) {
      heroStatus.textContent = statusText;
      heroStatus.classList.toggle('is-enabled', enabled);
      heroStatus.classList.toggle('is-disabled', !enabled);
    }

    const previewStatus = this.element.querySelector('[data-live-preview-status]');
    if (previewStatus) {
      previewStatus.textContent = statusText;
      previewStatus.classList.toggle('mn-badge--safe', enabled);
      previewStatus.classList.toggle('mn-badge--source', !enabled);
    }

    const meta = this.element.querySelector('[data-live-meta]');
    if (meta) meta.textContent = `${previewValue}/${max} \u00b7 ${category}`;

    const previewPercent = this.element.querySelector('[data-live-percent]');
    if (previewPercent) previewPercent.textContent = `${previewPercentage}%`;

    const previewRing = this.element.querySelector('.mn-need-preview__ring');
    if (previewRing) {
      previewRing.style.setProperty('--mn-preview-percent', `${previewPercentage}%`);
      if (customColorEnabled && customColor) {
        previewRing.style.setProperty('--mn-need-preview-color', customColor);
      } else {
        previewRing.style.removeProperty('--mn-need-preview-color');
      }
    }

    const stress = this.element.querySelector('[data-live-stress]');
    if (stress) stress.textContent = `${stressAmount} ${game.i18n.localize('MORTAL_NEEDS.NeedEdit.StressAmount')}`;

    const decay = this.element.querySelector('[data-live-decay]');
    const rawStressSign = inverted ? '-' : '+';

    if (decay) decay.textContent = decayEnabled ? `${rawStressSign}${decayRate} / ${decayInterval}s` : '-';

    const movement = this.element.querySelector('[data-live-movement]');
    if (movement) {
      movement.textContent = movementEnabled
        ? `${rawStressSign}${movementAmount} / ${movementInterval} ${this.#getMovementMetricLabel(movementMetric)}`
        : '-';
    }

    this.#syncDecayVisualState();
    this.#syncMovementVisualState();
  }

  #syncDecayVisualState() {
    const decayEnabled = this.element.querySelector('[name="decayEnabled"]')?.checked ?? false;
    this.element.querySelector('.mn-need-editor-panel--decay')?.classList.toggle('is-decay-disabled', !decayEnabled);
  }

  #syncMovementVisualState() {
    const movementEnabled = this.element.querySelector('[name="movementEnabled"]')?.checked ?? false;
    this.element.querySelector('.mn-need-editor-panel--movement')?.classList.toggle('is-movement-disabled', !movementEnabled);
  }

  #collectFormData() {
    const form = this.element;
    const existingConfig = this.#needId ? this.#store.getNeedConfig(this.#needId) : null;
    const id = (form.querySelector('[name="needId"]')?.value || this.#needId || '').trim();

    if (!id) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.NeedIdRequired', { localize: true });
      return null;
    }

    if (!/^[A-Za-z0-9._-]+$/.test(id)) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.NeedIdInvalid', { localize: true });
      return null;
    }

    if (this.#isNew && this.#store.getNeedConfig(id)) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.NeedIdDuplicate', { localize: true });
      return null;
    }

    const min = this.#readInteger('min', 0);
    const max = this.#readInteger('max', 100);
    const defaultValue = this.#readInteger('default', 0);
    const stressAmount = this.#readInteger('stressAmount', 10);
    const decayRate = this.#readInteger('decayRate', 5);
    const decayInterval = this.#readInteger('decayInterval', 3600);
    const movementInterval = this.#readInteger('movementInterval', 2);
    const movementAmount = this.#readInteger('movementAmount', 10);
    const movementMetric = this.#readMovementMetric('movementMetric', existingConfig?.movement?.metric || 'spaces');

    if (
      min < 0
      || max < 1
      || max < min
      || defaultValue < min
      || defaultValue > max
      || stressAmount < 1
      || stressAmount > 100
      || decayRate < 1
      || decayInterval < 60
      || movementInterval < 1
      || movementAmount < 1
      || movementAmount > 100
    ) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.InvalidValueRange', { localize: true });
      return null;
    }

    return {
      ...(existingConfig || {}),
      id,
      label: form.querySelector('[name="label"]')?.value?.trim() || 'Custom Need',
      icon: form.querySelector('[name="icon"]')?.value?.trim() || 'fa-question',
      iconType: 'fa',
      category: form.querySelector('[name="category"]')?.value || NeedCategory.CUSTOM,
      min,
      max,
      default: defaultValue,
      stressAmount,
      inverted: form.querySelector('[name="inverted"]')?.checked ?? false,
      enabled: form.querySelector('[name="enabled"]')?.checked ?? true,
      color: form.querySelector('[name="customColorEnabled"]')?.checked ? this.#normalizeColor(form.querySelector('[name="color"]')?.value) : null,
      visibility: form.querySelector('[name="gmOnly"]')?.checked ? NeedVisibility.GM : NeedVisibility.ALL,
      showWhen: form.querySelector('[name="showAboveZeroOnly"]')?.checked
        ? NeedDisplayRule.ABOVE_ZERO
        : NeedDisplayRule.ALWAYS,
      custom: existingConfig?.custom ?? true,
      consequences: existingConfig?.consequences || [],
      decay: {
        enabled: form.querySelector('[name="decayEnabled"]')?.checked ?? false,
        rate: decayRate,
        interval: decayInterval,
      },
      movement: {
        ...(existingConfig?.movement || {}),
        enabled: form.querySelector('[name="movementEnabled"]')?.checked ?? false,
        metric: movementMetric,
        interval: movementInterval,
        amount: movementAmount,
        countTeleports: existingConfig?.movement?.countTeleports ?? false,
      },
    };
  }

  #captureFormDraft() {
    if (!this.element) return;
    const existingConfig = this.#needId ? this.#store.getNeedConfig(this.#needId) : null;
    const form = this.element;

    this.#draftConfig = {
      ...(existingConfig || {}),
      id: (form.querySelector('[name="needId"]')?.value || this.#needId || '').trim(),
      label: form.querySelector('[name="label"]')?.value?.trim() || '',
      icon: form.querySelector('[name="icon"]')?.value?.trim() || 'fa-question',
      iconType: 'fa',
      category: form.querySelector('[name="category"]')?.value || NeedCategory.CUSTOM,
      min: this.#readInteger('min', existingConfig?.min ?? 0),
      max: this.#readInteger('max', existingConfig?.max ?? 100),
      default: this.#readInteger('default', existingConfig?.default ?? 0),
      stressAmount: this.#readInteger('stressAmount', existingConfig?.stressAmount ?? 10),
      inverted: form.querySelector('[name="inverted"]')?.checked ?? false,
      enabled: form.querySelector('[name="enabled"]')?.checked ?? true,
      color: form.querySelector('[name="customColorEnabled"]')?.checked ? this.#normalizeColor(form.querySelector('[name="color"]')?.value) : null,
      visibility: form.querySelector('[name="gmOnly"]')?.checked ? NeedVisibility.GM : NeedVisibility.ALL,
      showWhen: form.querySelector('[name="showAboveZeroOnly"]')?.checked
        ? NeedDisplayRule.ABOVE_ZERO
        : NeedDisplayRule.ALWAYS,
      custom: existingConfig?.custom ?? true,
      consequences: existingConfig?.consequences || [],
      decay: {
        enabled: form.querySelector('[name="decayEnabled"]')?.checked ?? false,
        rate: this.#readInteger('decayRate', existingConfig?.decay?.rate ?? 5),
        interval: this.#readInteger('decayInterval', existingConfig?.decay?.interval ?? 3600),
      },
      movement: {
        ...(existingConfig?.movement || {}),
        enabled: form.querySelector('[name="movementEnabled"]')?.checked ?? false,
        metric: this.#readMovementMetric('movementMetric', existingConfig?.movement?.metric || 'spaces'),
        interval: this.#readInteger('movementInterval', existingConfig?.movement?.interval ?? 2),
        amount: this.#readInteger('movementAmount', existingConfig?.movement?.amount ?? 10),
        countTeleports: existingConfig?.movement?.countTeleports ?? false,
      },
    };
  }

  #readInteger(name, fallback) {
    const value = Number.parseInt(this.element.querySelector(`[name="${name}"]`)?.value, 10);
    return Number.isFinite(value) ? value : fallback;
  }

  #normalizeColor(value) {
    if (typeof value !== 'string') return null;
    const color = value.trim();
    return /^#[0-9a-fA-F]{6}$/.test(color) ? color.toLowerCase() : null;
  }

  #readMovementMetric(name, fallback) {
    const value = this.element.querySelector(`[name="${name}"]`)?.value;
    return ['spaces', 'cost', 'distance'].includes(value) ? value : fallback;
  }

  #getMovementMetricChoices(selectedMetric = 'spaces') {
    return [
      { value: 'spaces', label: 'MORTAL_NEEDS.NeedEdit.MovementMetricSpaces' },
      { value: 'cost', label: 'MORTAL_NEEDS.NeedEdit.MovementMetricCost' },
      { value: 'distance', label: 'MORTAL_NEEDS.NeedEdit.MovementMetricDistance' },
    ].map(choice => ({
      ...choice,
      selected: choice.value === selectedMetric,
    }));
  }

  #getMovementMetricLabel(metric) {
    const key = {
      spaces: 'MovementMetricSpacesShort',
      cost: 'MovementMetricCostShort',
      distance: 'MovementMetricDistanceShort',
    }[metric] || 'MovementMetricSpacesShort';

    return game.i18n.localize(`MORTAL_NEEDS.NeedEdit.${key}`);
  }

  async #persistConfig(data) {
    let savedConfig = null;
    this.#isPersisting = true;
    try {
      if (this.#isNew) {
        savedConfig = this.#store.registerNeed(data);
        if (!savedConfig) {
          ui.notifications.warn('MORTAL_NEEDS.NeedEdit.NeedIdDuplicate', { localize: true });
          return false;
        }
        this.#needId = data.id;
        this.#isNew = false;
      } else {
        savedConfig = this.#store.updateNeedConfig(this.#needId, data);
        if (!savedConfig) return false;
      }

      const configs = this.#store.getAllNeedConfigs();
      await this.#configManager.saveNeedsConfig(configs);
      await this.#store.persistAllDirty?.();
      this.#draftConfig = null;
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'need-edit', needId: data.id });
      return true;
    } finally {
      this.#isPersisting = false;
    }
  }

  static async #onSave() {
    const data = this.#collectFormData();
    if (!data) return;
    if (await this.#persistConfig(data)) this.close();
  }

  static async #onDelete() {
    if (!this.#needId) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.NeedEdit.DeleteTitle') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.NeedEdit.DeleteConfirm')}</p>`,
    });
    if (confirmed) {
      this.#store.unregisterNeed(this.#needId);
      const configs = this.#store.getAllNeedConfigs();
      await this.#configManager.saveNeedsConfig(configs);
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'need-delete', needId: this.#needId });
      this.close();
    }
  }

  static async #onAddConsequence() {
    if (this.#isNew || !this.#needId || !this.#store.getNeedConfig(this.#needId)) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.SaveBeforeConsequences', { localize: true });
      return;
    }
    const { EffectConfigDialog } = await import('./effect-config-dialog.js');
    const dialog = new EffectConfigDialog(this.#needId, this.#store, this.#configManager, this.#eventBus);
    dialog.render(true);
  }

  static async #onEditConsequence(event, target) {
    if (!this.#needId || !this.#store.getNeedConfig(this.#needId)) return;
    const index = parseInt(target.closest('[data-index]')?.dataset.index);
    if (isNaN(index)) return;
    const { EffectConfigDialog } = await import('./effect-config-dialog.js');
    const dialog = new EffectConfigDialog(this.#needId, this.#store, this.#configManager, this.#eventBus, { editIndex: index });
    dialog.render(true);
  }

  static async #onDeleteConsequence(event, target) {
    if (!this.#needId || !this.#store.getNeedConfig(this.#needId)) return;
    const index = parseInt(target.closest('[data-index]')?.dataset.index);
    if (isNaN(index)) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.EffectConfig.DeleteConfirm') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.EffectConfig.DeleteConfirm')}</p>`,
    });
    if (!confirmed) return;

    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (!needConfig) return;
    const consequences = [...(needConfig.consequences || [])];
    consequences.splice(index, 1);
    const allConfigs = this.#getConfigsWithConsequences(consequences);
    await this.#configManager.saveNeedsConfig(allConfigs);
    this.#store.setNeedConfigs(allConfigs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-delete', needId: this.#needId });
  }

  static async #onApplySuggestion(event, target) {
    if (!this.#needId || !this.#store.getNeedConfig(this.#needId)) return;
    const index = parseInt(target.closest('[data-suggestion-index]')?.dataset.suggestionIndex);
    if (isNaN(index)) return;

    const api = game.modules.get(MODULE_ID)?.api;
    const allSuggestions = api?.system?.effectSuggestions || {};
    const needSuggestions = allSuggestions[this.#needId] || [];
    const suggestion = needSuggestions[index];
    if (!suggestion) return;

    const consequence = {
      id: this.#createConsequenceId(),
      type: suggestion.type,
      threshold: suggestion.threshold ?? 100,
      ticks: suggestion.ticks ?? 3,
      reversible: suggestion.reversible ?? true,
      config: { ...(suggestion.config || {}) },
    };

    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (!needConfig) return;
    const consequences = [...(needConfig.consequences || []), consequence];
    const allConfigs = this.#getConfigsWithConsequences(consequences);
    await this.#configManager.saveNeedsConfig(allConfigs);
    this.#store.setNeedConfigs(allConfigs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-add', needId: this.#needId });
  }

  #getConfigsWithConsequences(consequences) {
    return this.#store.getAllNeedConfigs().map(config => (
      config.id === this.#needId ? { ...config, consequences } : config
    ));
  }

  #createConsequenceId() {
    return foundry.utils?.randomID?.(16)
      ?? `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

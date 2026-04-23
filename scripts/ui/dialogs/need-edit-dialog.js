import { MODULE_ID, Events, NeedCategory } from '../../constants.js';
import { getAllConsequenceTypes, getConsequenceType, getConsequenceDescription } from '../../consequences/consequence-type.js';

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

    const preparedConfig = config || {
      id: '', label: '', icon: 'fa-question', iconType: 'fa',
      enabled: true, category: NeedCategory.CUSTOM, custom: true,
      min: 0, max: 100, default: 0, stressAmount: 10,
      attribute: null, consequences: [],
      decay: { enabled: false, rate: 5, interval: 3600 },
    };
    const criticalThreshold = game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80;
    const previewPercentage = Math.min(100, Math.max(0, criticalThreshold));
    const previewSeverity = previewPercentage >= 80 ? 'critical'
      : previewPercentage >= 60 ? 'high'
        : previewPercentage >= 40 ? 'medium'
          : previewPercentage >= 20 ? 'low'
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
      previewSeverity,
      previewValue: Math.round((preparedConfig.max ?? 100) * (previewPercentage / 100)),
      criticalThreshold,
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
      '[name="max"]',
      '[name="stressAmount"]',
      '[name="enabled"]',
      '[name="decayEnabled"]',
      '[name="decayRate"]',
      '[name="decayInterval"]',
    ];

    for (const selector of fields) {
      const input = this.element.querySelector(selector);
      input?.addEventListener('input', () => this.#refreshLivePreview());
      input?.addEventListener('change', () => this.#refreshLivePreview());
    }

    this.#refreshLivePreview();
  }

  #refreshLivePreview() {
    const labelValue = this.element.querySelector('[name="label"]')?.value?.trim() ?? '';
    const iconValue = this.element.querySelector('[name="icon"]')?.value?.trim() || 'fa-question';
    const category = this.element.querySelector('[name="category"]')?.value || NeedCategory.CUSTOM;
    const max = Number(this.element.querySelector('[name="max"]')?.value) || 100;
    const stressAmount = Number(this.element.querySelector('[name="stressAmount"]')?.value) || 0;
    const enabled = this.element.querySelector('[name="enabled"]')?.checked ?? true;
    const decayEnabled = this.element.querySelector('[name="decayEnabled"]')?.checked ?? false;
    const decayRate = Number(this.element.querySelector('[name="decayRate"]')?.value) || 0;
    const decayInterval = Number(this.element.querySelector('[name="decayInterval"]')?.value) || 0;
    const previewPercentage = Number(this.element.dataset.previewPercentage) || 0;
    const previewValue = Math.round(max * (previewPercentage / 100));
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

    const stress = this.element.querySelector('[data-live-stress]');
    if (stress) stress.textContent = `${stressAmount} ${game.i18n.localize('MORTAL_NEEDS.NeedEdit.StressAmount')}`;

    const decay = this.element.querySelector('[data-live-decay]');
    if (decay) decay.textContent = decayEnabled ? `+${decayRate} / ${decayInterval}s` : '-';

    this.#syncDecayVisualState();
  }

  #syncDecayVisualState() {
    const decayEnabled = this.element.querySelector('[name="decayEnabled"]')?.checked ?? false;
    this.element.querySelector('.mn-need-editor-panel--decay')?.classList.toggle('is-decay-disabled', !decayEnabled);
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
      enabled: form.querySelector('[name="enabled"]')?.checked ?? true,
      custom: existingConfig?.custom ?? true,
      consequences: existingConfig?.consequences || [],
      decay: {
        enabled: form.querySelector('[name="decayEnabled"]')?.checked ?? false,
        rate: decayRate,
        interval: decayInterval,
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
      enabled: form.querySelector('[name="enabled"]')?.checked ?? true,
      custom: existingConfig?.custom ?? true,
      consequences: existingConfig?.consequences || [],
      decay: {
        enabled: form.querySelector('[name="decayEnabled"]')?.checked ?? false,
        rate: this.#readInteger('decayRate', existingConfig?.decay?.rate ?? 5),
        interval: this.#readInteger('decayInterval', existingConfig?.decay?.interval ?? 3600),
      },
    };
  }

  #readInteger(name, fallback) {
    const value = Number.parseInt(this.element.querySelector(`[name="${name}"]`)?.value, 10);
    return Number.isFinite(value) ? value : fallback;
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

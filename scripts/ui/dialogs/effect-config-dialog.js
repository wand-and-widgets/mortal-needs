import { MODULE_ID, Events } from '../../constants.js';
import { getAllConsequenceTypes, getConsequenceType } from '../../consequences/consequence-type.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EffectConfigDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #needId;
  #store;
  #configManager;
  #eventBus;
  #selectedType = 'attribute-modify';
  #editIndex = null;
  #typeChangeHandler = null;
  #draftBehavior = null;
  #draftConfigs = new Map();
  #isSaving = false;

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-effect-config',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.EffectConfig.Title',
      icon: 'fas fa-bolt',
      resizable: false,
    },
    position: {
      width: 900,
      height: 'auto',
    },
    actions: {
      'save-consequence': EffectConfigDialog.#onSave,
      'cancel-consequence': EffectConfigDialog.#onCancel,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/effect-config.hbs`,
    },
  };

  constructor(needId, store, configManager, eventBus, { editIndex } = {}) {
    super();
    this.#needId = needId;
    this.#store = store;
    this.#configManager = configManager;
    this.#eventBus = eventBus;

    // Edit mode: load existing consequence data
    if (editIndex != null) {
      this.#editIndex = editIndex;
      const needConfig = this.#store.getNeedConfig(this.#needId);
      const existing = needConfig?.consequences?.[editIndex];
      if (existing) {
        this.#selectedType = existing.type;
      }
    }
  }

  get title() {
    return game.i18n.localize(
      this.#editIndex != null
        ? 'MORTAL_NEEDS.EffectConfig.EditTitle'
        : 'MORTAL_NEEDS.EffectConfig.Title'
    );
  }

  async _prepareContext(options) {
    const types = getAllConsequenceTypes();
    const isEdit = this.#editIndex != null;
    if (!types.some(type => type.type === this.#selectedType) && types[0]) {
      this.#selectedType = types[0].type;
    }

    // Load existing consequence for edit mode
    let existingConfig = null;
    if (isEdit) {
      const needConfig = this.#store.getNeedConfig(this.#needId);
      existingConfig = needConfig?.consequences?.[this.#editIndex] || null;
    }

    // Get available attributes for datalist autocomplete
    const api = game.modules.get(MODULE_ID)?.api;
    const availableAttributes = api?.system?.availableAttributes || [];

    const selectedTypeInfo = types.find(type => type.type === this.#selectedType) || types[0] || null;
    const existingValues = existingConfig?.type === this.#selectedType ? existingConfig.config : null;
    const configValues = this.#draftConfigs.get(this.#selectedType) ?? existingValues;
    const behaviorSource = this.#draftBehavior ?? existingConfig ?? {};

    return {
      types,
      selectedType: this.#selectedType,
      selectedTypeLabel: selectedTypeInfo ? game.i18n.localize(selectedTypeInfo.label) : this.#selectedType,
      selectedTypeIcon: selectedTypeInfo?.icon || 'fas fa-bolt',
      typeChips: types.map(type => ({
        ...type,
        label: game.i18n.localize(type.label),
        selected: type.type === this.#selectedType,
      })),
      configSchema: this.#getConfigSchema(this.#selectedType, configValues),
      threshold: behaviorSource.threshold ?? 100,
      ticks: behaviorSource.ticks ?? 3,
      reversible: behaviorSource.reversible ?? true,
      isEdit,
      availableAttributes,
    };
  }

  #getConfigSchema(type, existingValues = null) {
    const TypeClass = getConsequenceType(type);
    if (!TypeClass?.CONFIG_SCHEMA) return [];
    return TypeClass.CONFIG_SCHEMA.map(field => {
      const resolved = { ...field };
      if (resolved.type === 'boolean') {
        resolved.type = 'checkbox';
      }
      // Pre-populate from existing values in edit mode, otherwise use default
      resolved.value = existingValues?.[field.key] ?? field.default ?? '';
      resolved.placeholderText = field.placeholder ? game.i18n.localize(field.placeholder) : '';
      if (typeof resolved.options === 'string') {
        resolved.options = this.#resolveOptions(resolved.options, resolved.value);
      } else if (Array.isArray(resolved.options)) {
        // Mark the selected option
        resolved.options = resolved.options.map(opt => ({
          ...opt,
          selected: opt.value === resolved.value,
        }));
      }
      // Flag text fields that use attribute paths for datalist binding
      if (field.key === 'path' || field.key === 'changeKey') {
        resolved.useAttributeDatalist = true;
      }
      return resolved;
    });
  }

  #resolveOptions(source, currentValue) {
    let options = [];
    if (source === 'adapter:conditions') {
      const api = game.modules.get(MODULE_ID)?.api;
      if (api?.system?.availableConditions) {
        options = api.system.availableConditions.map(c => ({
          value: c.id,
          label: typeof c.label === 'string' ? game.i18n.localize(c.label) : c.label,
        }));
      }
    }
    if (source === 'game:macros') {
      options = (game.macros?.contents ?? [])
        .filter(m => m.canExecute)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(m => ({ value: m.id, label: m.name }));
    }
    // Mark selected
    return options.map(opt => ({ ...opt, selected: opt.value === currentValue }));
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // When consequence type changes, re-render config fields
    const typeSelect = this.element.querySelector('select[name="consequenceType"]');
    if (typeSelect) {
      this.#typeChangeHandler = (e) => {
        this.#captureFormDraft(this.#selectedType);
        this.#selectedType = e.target.value;
        this.render(false);
      };
      typeSelect.addEventListener('change', this.#typeChangeHandler);
    }

    this.#bindLiveBehaviorSummary();
  }

  #bindLiveBehaviorSummary() {
    const thresholdRange = this.element.querySelector('.mn-effect-threshold__range');
    const thresholdNumber = this.element.querySelector('input[name="threshold"]');
    const ticks = this.element.querySelector('input[name="ticks"]');
    const reversible = this.element.querySelector('input[name="reversible"]');

    thresholdRange?.addEventListener('input', () => {
      if (thresholdNumber) thresholdNumber.value = thresholdRange.value;
      this.#refreshBehaviorSummary();
    });

    thresholdNumber?.addEventListener('input', () => {
      const nextValue = this.#clampThreshold(thresholdNumber.value);
      thresholdNumber.value = String(nextValue);
      if (thresholdRange) thresholdRange.value = String(nextValue);
      this.#refreshBehaviorSummary();
    });

    ticks?.addEventListener('input', () => {
      const nextValue = this.#clampInteger(ticks.value, 3, 1, 20);
      ticks.value = String(nextValue);
      this.#refreshBehaviorSummary();
    });
    reversible?.addEventListener('change', () => this.#refreshBehaviorSummary());
    this.#refreshBehaviorSummary();
  }

  #refreshBehaviorSummary() {
    const threshold = this.#clampThreshold(this.element.querySelector('input[name="threshold"]')?.value);
    const ticks = this.#clampInteger(this.element.querySelector('input[name="ticks"]')?.value, 3, 1, 20);
    const reversible = this.element.querySelector('input[name="reversible"]')?.checked ?? true;

    const thresholdValue = this.element.querySelector('[data-effect-threshold-value]');
    if (thresholdValue) thresholdValue.textContent = `${threshold}%`;

    const thresholdSummary = this.element.querySelector('[data-effect-summary-threshold]');
    if (thresholdSummary) thresholdSummary.textContent = `${game.i18n.localize('MORTAL_NEEDS.EffectConfig.FiresAt')} ${threshold}%`;

    const ticksSummary = this.element.querySelector('[data-effect-summary-ticks]');
    if (ticksSummary) {
      ticksSummary.textContent = `${game.i18n.localize('MORTAL_NEEDS.EffectConfig.RepeatsAfter')} ${ticks} ${game.i18n.localize('MORTAL_NEEDS.EffectConfig.Checks')}`;
    }

    const reversibleSummary = this.element.querySelector('[data-effect-summary-reversible]');
    if (reversibleSummary) {
      reversibleSummary.textContent = game.i18n.localize(
        reversible
          ? 'MORTAL_NEEDS.EffectConfig.RemovesOnRecovery'
          : 'MORTAL_NEEDS.EffectConfig.StaysUntilManual'
      );
    }
  }

  #clampThreshold(value) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return 100;
    return Math.min(100, Math.max(0, numeric));
  }

  #captureFormDraft(type = this.#selectedType) {
    if (!this.element) return;
    this.#draftBehavior = {
      threshold: this.#clampThreshold(this.element.querySelector('input[name="threshold"]')?.value),
      ticks: this.#clampInteger(this.element.querySelector('input[name="ticks"]')?.value, 3, 1, 20),
      reversible: this.element.querySelector('input[name="reversible"]')?.checked ?? true,
    };
    this.#draftConfigs.set(type, this.#collectConfigFields());
  }

  #collectConfigFields() {
    const config = {};
    this.element.querySelectorAll('[name^="config."]').forEach(input => {
      const key = input.name.replace('config.', '');
      if (input.type === 'checkbox') {
        config[key] = input.checked;
      } else if (input.type === 'number') {
        config[key] = parseFloat(input.value) || 0;
      } else {
        config[key] = input.value;
      }
    });
    return config;
  }

  #validateConsequence(type, config, consequences) {
    if (!getConsequenceType(type)) {
      ui.notifications.warn('MORTAL_NEEDS.EffectConfig.InvalidType', { localize: true });
      return false;
    }

    if (this.#editIndex != null && this.#editIndex >= consequences.length) {
      ui.notifications.warn('MORTAL_NEEDS.EffectConfig.MissingConsequence', { localize: true });
      return false;
    }

    const missingFields = {
      'attribute-modify': ['path'],
      'condition-apply': ['statusId'],
      'active-effect': ['changeKey', 'changeValue'],
      'custom-callback': ['callbackId'],
      'macro-execute': ['macroId'],
    }[type] || [];

    const hasMissingField = missingFields.some(key => {
      const value = config[key];
      return value == null || String(value).trim() === '';
    });
    if (hasMissingField) {
      ui.notifications.warn('MORTAL_NEEDS.EffectConfig.RequiredConfigMissing', { localize: true });
      return false;
    }

    return true;
  }

  #setSavingState(isSaving) {
    this.#isSaving = isSaving;
    this.element?.querySelectorAll('[data-action="save-consequence"], [data-action="cancel-consequence"]')
      .forEach(button => {
        button.disabled = isSaving;
        button.classList.toggle('is-saving', isSaving);
      });
  }

  #getConfigsWithConsequences(consequences) {
    return this.#store.getAllNeedConfigs().map(config => (
      config.id === this.#needId ? { ...config, consequences } : config
    ));
  }

  static async #onSave() {
    if (this.#isSaving) return;
    const form = this.element;
    const type = form.querySelector('select[name="consequenceType"]').value;
    const threshold = this.#clampThreshold(form.querySelector('input[name="threshold"]')?.value);
    const ticks = this.#clampInteger(form.querySelector('input[name="ticks"]')?.value, 3, 1, 20);
    const reversible = form.querySelector('input[name="reversible"]')?.checked ?? true;

    const config = this.#collectConfigFields();

    const consequence = { type, threshold, ticks, reversible, config };

    // Add or update the consequence
    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (!needConfig) {
      ui.notifications.warn('MORTAL_NEEDS.NeedEdit.SaveBeforeConsequences', { localize: true });
      return;
    }

    const consequences = [...(needConfig.consequences || [])];
    if (!this.#validateConsequence(type, config, consequences)) return;

    this.#setSavingState(true);
    try {
      if (this.#editIndex != null) {
        // Edit mode: replace at index
        consequences[this.#editIndex] = consequence;
      } else {
        // Add mode: push new
        consequences.push(consequence);
      }

      const allConfigs = this.#getConfigsWithConsequences(consequences);
      await this.#configManager.saveNeedsConfig(allConfigs);
      this.#store.setNeedConfigs(allConfigs);

      const source = this.#editIndex != null ? 'consequence-edit' : 'consequence-add';
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source, needId: this.#needId });
      this.close();
    } catch (err) {
      console.error('Mortal Needs | Failed to save consequence configuration:', err);
      ui.notifications.error('MORTAL_NEEDS.EffectConfig.SaveFailed', { localize: true });
      this.#setSavingState(false);
    }
  }

  static #onCancel() {
    this.close();
  }

  #clampInteger(value, fallback, min, max) {
    const numeric = Number.parseInt(value, 10);
    if (!Number.isFinite(numeric)) return fallback;
    return Math.min(max, Math.max(min, numeric));
  }
}

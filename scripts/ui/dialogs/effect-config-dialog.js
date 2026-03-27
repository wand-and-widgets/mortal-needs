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
      width: 420,
      height: 'auto',
    },
    actions: {
      'save-consequence': EffectConfigDialog.#onSave,
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

    // Load existing consequence for edit mode
    let existingConfig = null;
    if (isEdit) {
      const needConfig = this.#store.getNeedConfig(this.#needId);
      existingConfig = needConfig?.consequences?.[this.#editIndex] || null;
    }

    // Get available attributes for datalist autocomplete
    const api = game.modules.get(MODULE_ID)?.api;
    const availableAttributes = api?.system?.availableAttributes || [];

    return {
      types,
      selectedType: this.#selectedType,
      configSchema: this.#getConfigSchema(this.#selectedType, existingConfig?.config),
      threshold: existingConfig?.threshold ?? 100,
      ticks: existingConfig?.ticks ?? 3,
      reversible: existingConfig?.reversible ?? true,
      isEdit,
      availableAttributes,
    };
  }

  #getConfigSchema(type, existingValues = null) {
    const TypeClass = getConsequenceType(type);
    if (!TypeClass?.CONFIG_SCHEMA) return [];
    return TypeClass.CONFIG_SCHEMA.map(field => {
      const resolved = { ...field };
      // Pre-populate from existing values in edit mode, otherwise use default
      resolved.value = existingValues?.[field.key] ?? field.default ?? '';
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
      options = game.macros.contents
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
        this.#selectedType = e.target.value;
        this.render(false);
      };
      typeSelect.addEventListener('change', this.#typeChangeHandler);
    }
  }

  static async #onSave() {
    const form = this.element;
    const type = form.querySelector('select[name="consequenceType"]').value;
    const threshold = parseInt(form.querySelector('input[name="threshold"]')?.value) || 100;
    const ticks = parseInt(form.querySelector('input[name="ticks"]')?.value) || 3;
    const reversible = form.querySelector('input[name="reversible"]')?.checked ?? true;

    // Gather config fields
    const config = {};
    form.querySelectorAll('[name^="config."]').forEach(input => {
      const key = input.name.replace('config.', '');
      if (input.type === 'checkbox') {
        config[key] = input.checked;
      } else if (input.type === 'number') {
        config[key] = parseFloat(input.value) || 0;
      } else {
        config[key] = input.value;
      }
    });

    const consequence = { type, threshold, ticks, reversible, config };

    // Add or update the consequence
    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (needConfig) {
      const consequences = [...(needConfig.consequences || [])];

      if (this.#editIndex != null && this.#editIndex < consequences.length) {
        // Edit mode: replace at index
        consequences[this.#editIndex] = consequence;
      } else {
        // Add mode: push new
        consequences.push(consequence);
      }

      this.#store.updateNeedConfig(this.#needId, { consequences });
      const allConfigs = this.#store.getAllNeedConfigs();
      await this.#configManager.saveNeedsConfig(allConfigs);

      const source = this.#editIndex != null ? 'consequence-edit' : 'consequence-add';
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source, needId: this.#needId });
    }

    this.close();
  }
}

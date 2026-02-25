import { MODULE_ID, Events } from '../../constants.js';
import { getAllConsequenceTypes, getConsequenceType } from '../../consequences/consequence-type.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class EffectConfigDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #needId;
  #store;
  #configManager;
  #eventBus;
  #selectedType = 'attribute-modify';

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

  constructor(needId, store, configManager, eventBus) {
    super();
    this.#needId = needId;
    this.#store = store;
    this.#configManager = configManager;
    this.#eventBus = eventBus;
  }

  async _prepareContext(options) {
    const types = getAllConsequenceTypes();

    return {
      types,
      selectedType: this.#selectedType,
      configSchema: this.#getConfigSchema(this.#selectedType),
      threshold: 100,
      ticks: 3,
      reversible: true,
    };
  }

  #getConfigSchema(type) {
    const TypeClass = getConsequenceType(type);
    if (!TypeClass?.CONFIG_SCHEMA) return [];
    return TypeClass.CONFIG_SCHEMA.map(field => {
      const resolved = { ...field, value: field.default ?? '' };
      if (typeof resolved.options === 'string') {
        resolved.options = this.#resolveOptions(resolved.options);
      }
      return resolved;
    });
  }

  #resolveOptions(source) {
    if (source === 'adapter:conditions') {
      const api = game.modules.get(MODULE_ID)?.api;
      if (api?.system?.availableConditions) {
        return api.system.availableConditions.map(c => ({
          value: c.id,
          label: typeof c.label === 'string' ? game.i18n.localize(c.label) : c.label,
        }));
      }
    }
    if (source === 'game:macros') {
      return game.macros.contents
        .filter(m => m.canExecute)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(m => ({ value: m.id, label: m.name }));
    }
    return [];
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // When consequence type changes, re-render config fields
    const typeSelect = this.element.querySelector('select[name="consequenceType"]');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        this.#selectedType = e.target.value;
        this.render(false);
      });
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

    // Add to need's consequences
    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (needConfig) {
      const consequences = [...(needConfig.consequences || []), consequence];
      this.#store.updateNeedConfig(this.#needId, { consequences });
      const allConfigs = this.#store.getAllNeedConfigs();
      await this.#configManager.saveNeedsConfig(allConfigs);
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-add', needId: this.#needId });
    }

    this.close();
  }
}

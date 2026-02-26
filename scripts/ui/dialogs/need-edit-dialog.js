import { MODULE_ID, Events, NeedCategory } from '../../constants.js';
import { getAllConsequenceTypes, getConsequenceType, getConsequenceDescription } from '../../consequences/consequence-type.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NeedEditDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #needId;
  #store;
  #configManager;
  #eventBus;
  #isNew;

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
      width: 440,
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
    const config = this.#needId ? this.#store.getNeedConfig(this.#needId) : null;
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

    return {
      isNew: this.#isNew,
      config: config || {
        id: '', label: '', icon: 'fa-question', iconType: 'fa',
        enabled: true, category: NeedCategory.CUSTOM, custom: true,
        min: 0, max: 100, default: 0, stressAmount: 10,
        attribute: null, consequences: [],
        decay: { enabled: false, rate: 5, interval: 3600 },
      },
      categories,
      consequenceTypes,
      enrichedConsequences,
      suggestions: needSuggestions,
      hasSuggestions: needSuggestions.length > 0,
      canDelete: config?.custom ?? true,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Listen for config changes to refresh consequence list
    this._configChangedHandler = (event) => {
      if (event.needId === this.#needId || event.source?.startsWith('consequence')) {
        this.render(false);
      }
    };
    this.#eventBus.on(Events.CONFIG_CHANGED, this._configChangedHandler);
  }

  _onClose(options) {
    if (this._configChangedHandler) {
      this.#eventBus.off(Events.CONFIG_CHANGED, this._configChangedHandler);
    }
    super._onClose(options);
  }

  static async #onSave() {
    const form = this.element;
    const existingConfig = this.#needId ? this.#store.getNeedConfig(this.#needId) : null;

    const data = {
      id: form.querySelector('[name="needId"]')?.value || `custom-${Date.now()}`,
      label: form.querySelector('[name="label"]')?.value || 'Custom Need',
      icon: form.querySelector('[name="icon"]')?.value || 'fa-question',
      iconType: 'fa',
      category: form.querySelector('[name="category"]')?.value || NeedCategory.CUSTOM,
      min: parseInt(form.querySelector('[name="min"]')?.value) || 0,
      max: parseInt(form.querySelector('[name="max"]')?.value) || 100,
      default: parseInt(form.querySelector('[name="default"]')?.value) || 0,
      stressAmount: parseInt(form.querySelector('[name="stressAmount"]')?.value) || 10,
      enabled: form.querySelector('[name="enabled"]')?.checked ?? true,
      custom: true,
      consequences: existingConfig?.consequences || [],
      decay: {
        enabled: form.querySelector('[name="decayEnabled"]')?.checked ?? false,
        rate: parseInt(form.querySelector('[name="decayRate"]')?.value) || 5,
        interval: parseInt(form.querySelector('[name="decayInterval"]')?.value) || 3600,
      },
    };

    if (this.#isNew) {
      this.#store.registerNeed(data);
    } else {
      this.#store.updateNeedConfig(this.#needId, data);
    }

    const configs = this.#store.getAllNeedConfigs();
    await this.#configManager.saveNeedsConfig(configs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'need-edit', needId: data.id });
    this.close();
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
    const { EffectConfigDialog } = await import('./effect-config-dialog.js');
    const dialog = new EffectConfigDialog(this.#needId, this.#store, this.#configManager, this.#eventBus);
    dialog.render(true);
  }

  static async #onEditConsequence(event, target) {
    const index = parseInt(target.closest('[data-index]')?.dataset.index);
    if (isNaN(index)) return;
    const { EffectConfigDialog } = await import('./effect-config-dialog.js');
    const dialog = new EffectConfigDialog(this.#needId, this.#store, this.#configManager, this.#eventBus, { editIndex: index });
    dialog.render(true);
  }

  static async #onDeleteConsequence(event, target) {
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
    this.#store.updateNeedConfig(this.#needId, { consequences });
    const allConfigs = this.#store.getAllNeedConfigs();
    await this.#configManager.saveNeedsConfig(allConfigs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-delete', needId: this.#needId });
  }

  static async #onApplySuggestion(event, target) {
    const index = parseInt(target.closest('[data-suggestion-index]')?.dataset.suggestionIndex);
    if (isNaN(index)) return;

    const api = game.modules.get(MODULE_ID)?.api;
    const allSuggestions = api?.system?.effectSuggestions || {};
    const needSuggestions = allSuggestions[this.#needId] || [];
    const suggestion = needSuggestions[index];
    if (!suggestion) return;

    const consequence = {
      type: suggestion.type,
      threshold: suggestion.threshold ?? 100,
      ticks: suggestion.ticks ?? 3,
      reversible: suggestion.reversible ?? true,
      config: { ...(suggestion.config || {}) },
    };

    const needConfig = this.#store.getNeedConfig(this.#needId);
    if (!needConfig) return;
    const consequences = [...(needConfig.consequences || []), consequence];
    this.#store.updateNeedConfig(this.#needId, { consequences });
    const allConfigs = this.#store.getAllNeedConfigs();
    await this.#configManager.saveNeedsConfig(allConfigs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-add', needId: this.#needId });
  }
}

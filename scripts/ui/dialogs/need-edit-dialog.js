import { MODULE_ID, Events, NeedCategory } from '../../constants.js';
import { getAllConsequenceTypes } from '../../consequences/consequence-type.js';

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
      canDelete: config?.custom ?? true,
    };
  }

  static async #onSave() {
    const form = this.element;
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
}

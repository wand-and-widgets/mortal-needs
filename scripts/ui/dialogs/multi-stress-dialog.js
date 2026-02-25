import { MODULE_ID } from '../../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MultiStressDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #engine;
  #mode; // 'stress' or 'relieve'

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-multi-stress',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.MultiStress.Title',
      icon: 'fas fa-arrows-alt-v',
      resizable: false,
    },
    position: {
      width: 380,
      height: 'auto',
    },
    actions: {
      'apply': MultiStressDialog.#onApply,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/multi-stress.hbs`,
    },
  };

  constructor(store, engine, mode = 'stress') {
    super();
    this.#store = store;
    this.#engine = engine;
    this.#mode = mode;

    if (mode === 'relieve') {
      this.options.window.title = 'MORTAL_NEEDS.MultiStress.RelieveTitle';
      this.options.window.icon = 'fas fa-arrow-down';
    }
  }

  async _prepareContext(options) {
    const tracked = this.#store.getAllTrackedActors();
    const needs = this.#store.getEnabledNeedConfigs();
    const defaultAmount = game.settings.get(MODULE_ID, 'defaultStressAmount');

    return {
      actors: tracked.map(e => ({ id: e.id, name: e.name, img: e.img })),
      needs,
      defaultAmount,
      mode: this.#mode,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Sync range and number inputs
    const range = this.element.querySelector('input[name="amount"]');
    const number = this.element.querySelector('input[name="amountDisplay"]');
    if (range && number) {
      range.addEventListener('input', () => { number.value = range.value; });
      number.addEventListener('input', () => { range.value = number.value; });
    }
  }

  static async #onApply() {
    const form = this.element;
    const needId = form.querySelector('select[name="needId"]').value;
    const amount = parseInt(form.querySelector('input[name="amount"]').value) || 10;

    const targetCheckboxes = form.querySelectorAll('input[name="targets"]:checked');
    const entityIds = [...targetCheckboxes].map(cb => cb.value);

    if (entityIds.length === 0) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.NoTargetsSelected', { localize: true });
      return;
    }

    const needAmounts = [{ needId, amount }];

    if (this.#mode === 'stress') {
      await this.#engine.stressMultiple(entityIds, needAmounts);
    } else {
      await this.#engine.relieveMultiple(entityIds, needAmounts);
    }

    this.close();
  }
}

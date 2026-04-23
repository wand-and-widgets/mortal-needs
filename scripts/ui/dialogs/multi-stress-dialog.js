import { MODULE_ID } from '../../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class MultiStressDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #engine;
  #mode; // 'stress' or 'relieve'
  #isApplying = false;

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
      width: 860,
      height: 'auto',
    },
    actions: {
      'cancel': MultiStressDialog.#onCancel,
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
    this.#mode = mode === 'relieve' ? 'relieve' : 'stress';

    if (this.#mode === 'relieve') {
      this.options.window.title = 'MORTAL_NEEDS.MultiStress.RelieveTitle';
      this.options.window.icon = 'fas fa-arrow-down';
    } else {
      this.options.window.icon = 'fas fa-arrow-up';
    }
  }

  async _prepareContext(options) {
    const tracked = this.#store.getAllTrackedActors();
    const needs = this.#store.getEnabledNeedConfigs();
    const defaultAmount = game.settings.get(MODULE_ID, 'defaultStressAmount');
    const selectedNeedCount = needs.length ? 1 : 0;
    const targetCount = tracked.length;

    return {
      actors: tracked.map(e => ({ id: e.id, name: e.name, img: e.img })),
      needs: needs.map(n => ({
        ...n,
        localizedLabel: game.i18n.localize(n.label),
        defaultAmount: n.stressAmount ?? defaultAmount,
      })),
      defaultAmount,
      mode: this.#mode,
      isStress: this.#mode === 'stress',
      selectedNeedCount,
      targetCount,
      initialChangeCount: targetCount * selectedNeedCount,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    const clampAmount = value => Math.min(100, Math.max(1, parseInt(value) || 1));

    const updateRangeFill = range => {
      const min = Number(range.min) || 1;
      const max = Number(range.max) || 100;
      const value = Number(range.value) || min;
      const percent = ((value - min) / (max - min)) * 100;
      range.style.setProperty('--mn-batch-range-fill', `${percent}%`);
    };

    const updatePreview = () => {
      const targetInputs = [...this.element.querySelectorAll('input[name="targets"]')];
      const needInputs = [...this.element.querySelectorAll('input[name="selectedNeeds"]')];
      const selectedTargets = targetInputs.filter(input => input.checked).length;
      const selectedNeeds = needInputs.filter(input => input.checked);
      const targetCounts = this.element.querySelectorAll('.mn-batch-selected-targets-count');
      const needCounts = this.element.querySelectorAll('.mn-batch-selected-needs-count');
      const changeCounts = this.element.querySelectorAll('.mn-batch-total-changes-count');
      const applyButton = this.element.querySelector('[data-action="apply"]');
      const previewList = this.element.querySelector('[data-preview-list]');
      const changeSign = this.#mode === 'stress' ? '+' : '-';
      const amountPrefix = this.#mode === 'stress'
        ? `${game.i18n.localize('MORTAL_NEEDS.MultiStress.BaseAmount')} `
        : '';
      const totalChanges = selectedTargets * selectedNeeds.length;

      targetCounts.forEach(node => { node.textContent = String(selectedTargets); });
      needCounts.forEach(node => { node.textContent = String(selectedNeeds.length); });
      changeCounts.forEach(node => { node.textContent = String(totalChanges); });
      if (applyButton) applyButton.disabled = this.#isApplying || selectedTargets === 0 || selectedNeeds.length === 0;

      this.element.querySelectorAll('.mn-batch-target, .mn-batch-need').forEach(row => {
        const checkbox = row.querySelector('input[type="checkbox"]');
        row.classList.toggle('is-selected', !!checkbox?.checked);
      });

      if (!previewList) return;

      if (!selectedTargets || !selectedNeeds.length) {
        const empty = document.createElement('li');
        empty.className = 'mn-batch-preview__empty';
        empty.textContent = game.i18n.localize('MORTAL_NEEDS.MultiStress.EmptyPreview');
        previewList.replaceChildren(empty);
        return;
      }

      const items = selectedNeeds.map(input => {
        const row = input.closest('[data-need-amount]');
        const label = row?.dataset.needLabel ?? input.value;
        const amountInput = row?.querySelector(`input[name="amount-${input.value}"]`);
        const amount = clampAmount(amountInput?.value);
        const item = document.createElement('li');
        const name = document.createElement('span');
        const detail = document.createElement('strong');
        name.textContent = label;
        detail.textContent = `${amountPrefix}${changeSign}${amount} x ${selectedTargets}`;
        item.append(name, detail);
        return item;
      });
      previewList.replaceChildren(...items);
    };

    this.element.querySelectorAll('[data-need-amount]').forEach(row => {
      const range = row.querySelector('input[type="range"]');
      const number = row.querySelector('input[type="number"]');
      if (range && number) {
        updateRangeFill(range);
        range.addEventListener('input', () => {
          number.value = range.value;
          updateRangeFill(range);
          updatePreview();
        });
        number.addEventListener('input', () => {
          const amount = clampAmount(number.value);
          number.value = String(amount);
          range.value = String(amount);
          updateRangeFill(range);
          updatePreview();
        });
      }
    });

    this.element.querySelectorAll('input[name="targets"], input[name="selectedNeeds"]').forEach(input => {
      input.addEventListener('change', updatePreview);
    });

    this.element.querySelectorAll('[data-target-select]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const checked = button.dataset.targetSelect === 'all';
        this.element.querySelectorAll('input[name="targets"]').forEach(input => {
          input.checked = checked;
        });
        updatePreview();
      });
    });

    this.element.querySelectorAll('[data-need-select]').forEach(button => {
      button.addEventListener('click', event => {
        event.preventDefault();
        const checked = button.dataset.needSelect === 'all';
        this.element.querySelectorAll('input[name="selectedNeeds"]').forEach(input => {
          input.checked = checked;
        });
        updatePreview();
      });
    });

    updatePreview();
  }

  static #onCancel() {
    if (this.#isApplying) return;
    this.close();
  }

  static async #onApply() {
    if (this.#isApplying) return;

    const form = this.element;
    const selectedNeeds = [...form.querySelectorAll('input[name="selectedNeeds"]:checked')];
    const needAmounts = selectedNeeds.map(cb => {
      const needId = cb.value;
      const amountInput = form.querySelector(`input[name="amount-${needId}"]`);
      return {
        needId,
        amount: Math.min(100, Math.max(1, parseInt(amountInput?.value) || 10)),
      };
    });

    const targetCheckboxes = form.querySelectorAll('input[name="targets"]:checked');
    const entityIds = [...targetCheckboxes].map(cb => cb.value);

    if (entityIds.length === 0) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.NoTargetsSelected', { localize: true });
      return;
    }

    if (needAmounts.length === 0) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.NoNeedsSelected', { localize: true });
      return;
    }

    const actionButtons = form.querySelectorAll('[data-action="apply"], [data-action="cancel"]');

    try {
      this.#isApplying = true;
      actionButtons.forEach(button => { button.disabled = true; });

      if (this.#mode === 'stress') {
        await this.#engine.stressMultiple(entityIds, needAmounts);
      } else {
        await this.#engine.relieveMultiple(entityIds, needAmounts);
      }

      this.close();
    } catch (error) {
      console.error('Mortal Needs | Failed to apply batch need update', error);
      ui.notifications.error('MORTAL_NEEDS.Notifications.BatchApplyFailed', { localize: true });
      this.#isApplying = false;
      actionButtons.forEach(button => { button.disabled = false; });
    }
  }
}

import { MODULE_ID, Events } from '../../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class NeedsConfigDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #configManager;
  #eventBus;

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-config',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.Config.Title',
      icon: 'fas fa-cog',
      resizable: true,
    },
    position: {
      width: 480,
      height: 'auto',
    },
    actions: {
      'save': NeedsConfigDialog.#onSave,
      'edit-need': NeedsConfigDialog.#onEditNeed,
      'add-custom-need': NeedsConfigDialog.#onAddCustomNeed,
      'export-config': NeedsConfigDialog.#onExport,
      'import-config': NeedsConfigDialog.#onImport,
      'save-preset': NeedsConfigDialog.#onSavePreset,
      'delete-preset': NeedsConfigDialog.#onDeletePreset,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/needs-config.hbs`,
    },
  };

  constructor(store, configManager, eventBus) {
    super();
    this.#store = store;
    this.#configManager = configManager;
    this.#eventBus = eventBus;
  }

  async _prepareContext(options) {
    const needs = this.#store.getAllNeedConfigs();
    const presets = this.#configManager.getAllPresets();

    return { needs, presets };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Tab switching
    this.element.querySelectorAll('.mn-dialog__tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;
        this.element.querySelectorAll('.mn-dialog__tab').forEach(t => t.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        this.element.querySelectorAll('.mn-dialog__tab-content').forEach(c => c.style.display = 'none');
        this.element.querySelector(`[data-tab-content="${tabName}"]`).style.display = '';
      });
    });

    // Preset card selection
    this.element.querySelectorAll('.mn-dialog__grid-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        const presetId = e.currentTarget.dataset.presetId;
        const confirmed = await foundry.applications.api.DialogV2.confirm({
          window: { title: game.i18n.localize('MORTAL_NEEDS.Config.ApplyPresetTitle') },
          content: `<p>${game.i18n.localize('MORTAL_NEEDS.Config.ApplyPresetConfirm')}</p>`,
        });
        if (confirmed) {
          const currentConfigs = this.#store.getAllNeedConfigs();
          const updated = this.#configManager.applyPreset(presetId, currentConfigs);
          this.#store.setNeedConfigs(updated);
          await this.#configManager.saveNeedsConfig(updated);
          this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'preset', presetId });
          this.render(false);
          ui.notifications.info('MORTAL_NEEDS.Notifications.PresetApplied', { localize: true });
        }
      });
    });
  }

  static async #onSave() {
    const configs = this.#store.getAllNeedConfigs();

    // Read enabled state from checkboxes
    this.element.querySelectorAll('.mn-need-config-row').forEach(row => {
      const needId = row.dataset.needId;
      const checkbox = row.querySelector('input[type="checkbox"]');
      const config = configs.find(c => c.id === needId);
      if (config && checkbox) {
        config.enabled = checkbox.checked;
      }
    });

    this.#store.setNeedConfigs(configs);
    await this.#configManager.saveNeedsConfig(configs);
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'dialog' });
    this.close();
    ui.notifications.info('MORTAL_NEEDS.Notifications.ConfigSaved', { localize: true });
  }

  static async #onEditNeed(event, target) {
    const needId = target.dataset.needId;
    const { NeedEditDialog } = await import('./need-edit-dialog.js');
    const dialog = new NeedEditDialog(needId, this.#store, this.#configManager, this.#eventBus);
    dialog.render(true);
  }

  static async #onAddCustomNeed() {
    const { NeedEditDialog } = await import('./need-edit-dialog.js');
    const dialog = new NeedEditDialog(null, this.#store, this.#configManager, this.#eventBus);
    dialog.render(true);
  }

  static #onExport() {
    const json = this.#configManager.exportConfig(this.#store.getAllNeedConfigs());
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mortal-needs-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.notifications.info('MORTAL_NEEDS.Notifications.ConfigExported', { localize: true });
  }

  static async #onImport() {
    const textarea = this.element.querySelector('textarea[name="importJson"]');
    const json = textarea?.value;
    if (!json?.trim()) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.ImportEmpty', { localize: true });
      return;
    }

    const configs = this.#configManager.importConfig(json);
    if (configs) {
      this.#store.setNeedConfigs(configs);
      await this.#configManager.saveNeedsConfig(configs);
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'import' });
      this.render(false);
      ui.notifications.info('MORTAL_NEEDS.Notifications.ConfigImported', { localize: true });
    }
  }

  static async #onSavePreset() {
    const result = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Config.SavePresetTitle') },
      content: `
        <div style="padding: 12px;">
          <div style="margin-bottom: 8px;">
            <label>${game.i18n.localize('MORTAL_NEEDS.Config.PresetName')}</label>
            <input type="text" name="presetName" style="width: 100%;">
          </div>
          <div>
            <label>${game.i18n.localize('MORTAL_NEEDS.Config.PresetDescription')}</label>
            <input type="text" name="presetDesc" style="width: 100%;">
          </div>
        </div>
      `,
      ok: {
        label: game.i18n.localize('Save'),
        callback: (event, button, dialog) => {
          const form = button.form;
          return {
            name: form.elements.presetName.value,
            description: form.elements.presetDesc.value,
          };
        },
      },
    });

    if (result?.name) {
      const enabledNeeds = this.#store.getEnabledNeedConfigs().map(c => c.id);
      await this.#configManager.saveCustomPreset({
        id: `custom-${Date.now()}`,
        label: result.name,
        description: result.description,
        needs: enabledNeeds,
      });
      this.render(false);
      ui.notifications.info('MORTAL_NEEDS.Notifications.PresetSaved', { localize: true });
    }
  }

  static async #onDeletePreset(event, target) {
    const presetId = target.dataset.presetId;
    await this.#configManager.deleteCustomPreset(presetId);
    this.render(false);
  }
}

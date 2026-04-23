import { MODULE_ID, Events } from '../../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const CRITICAL_THRESHOLD_MIN = 50;
const CRITICAL_THRESHOLD_MAX = 100;
const CRITICAL_THRESHOLD_STEP = 5;

export class NeedsConfigDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #configManager;
  #eventBus;
  #activeTab = 'needs';
  #selectedNeedId = null;
  #selectedPresetId = null;
  #enabledDraft = new Map();
  #enabledDirty = new Set();
  #criticalThresholdDraft = null;
  #criticalThresholdDirty = false;
  #configChangedUnsubscribe = null;

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
      width: 1240,
      height: 'auto',
    },
    actions: {
      'save': NeedsConfigDialog.#onSave,
      'edit-need': NeedsConfigDialog.#onEditNeed,
      'add-custom-need': NeedsConfigDialog.#onAddCustomNeed,
      'export-config': NeedsConfigDialog.#onExport,
      'import-config': NeedsConfigDialog.#onImport,
      'clear-import-json': NeedsConfigDialog.#onClearImportJson,
      'format-import-json': NeedsConfigDialog.#onFormatImportJson,
      'apply-preset': NeedsConfigDialog.#onApplyPreset,
      'apply-selected-preset': NeedsConfigDialog.#onApplySelectedPreset,
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
    this.#syncEnabledDraft(needs);
    this.#syncCriticalThresholdDraft();

    const presets = this.#configManager.getAllPresets();
    this.#syncPresetSelection(presets);

    const enabledCount = needs.filter(n => this.#getDraftEnabled(n)).length;
    const customCount = needs.filter(n => n.custom).length;
    const decayCount = needs.filter(n => n.decay?.enabled).length;
    const previewNeed = needs.find(n => n.id === this.#selectedNeedId)
      || needs.find(n => this.#getDraftEnabled(n))
      || needs[0]
      || null;
    const criticalThreshold = this.#criticalThresholdDraft;
    const previewPercentage = Math.min(100, Math.max(0, criticalThreshold));
    const previewSeverity = this.#getSeverityForPercentage(previewPercentage);

    this.#selectedNeedId = previewNeed?.id ?? null;

    return {
      needs: needs.map(n => ({
        ...n,
        enabled: this.#getDraftEnabled(n),
        localizedLabel: game.i18n.localize(n.label),
        hasConsequences: (n.consequences?.length ?? 0) > 0,
        consequenceCount: n.consequences?.length ?? 0,
        decayEnabled: !!n.decay?.enabled,
        isPreview: n.id === previewNeed?.id,
      })),
      presets: this.#preparePresetViews(presets, needs),
      presetPreview: this.#preparePresetView(presets.find(p => p.id === this.#selectedPresetId), needs),
      activeTab: this.#activeTab,
      enabledCount,
      totalCount: needs.length,
      customCount,
      decayCount,
      criticalThreshold,
      thresholdMin: CRITICAL_THRESHOLD_MIN,
      thresholdMax: CRITICAL_THRESHOLD_MAX,
      thresholdStep: CRITICAL_THRESHOLD_STEP,
      previewPercentage,
      previewSeverity,
      previewNeed: previewNeed ? {
        ...previewNeed,
        enabled: this.#getDraftEnabled(previewNeed),
        localizedLabel: game.i18n.localize(previewNeed.label),
        consequenceCount: previewNeed.consequences?.length ?? 0,
        decayRate: previewNeed.decay?.rate ?? 0,
        decayInterval: previewNeed.decay?.interval ?? 0,
        decayEnabled: !!previewNeed.decay?.enabled,
      } : null,
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    this.element.querySelectorAll('.mn-dialog__tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        this.#showTab(e.currentTarget.dataset.tab);
      });
    });
    this.#showTab(this.#activeTab);

    if (!this.#configChangedUnsubscribe) {
      this.#configChangedUnsubscribe = this.#eventBus.on(Events.CONFIG_CHANGED, (event) => {
        if (['dialog', 'preset', 'import'].includes(event?.source)) return;
        this.render(false);
      });
    }

    this.element.querySelectorAll('.mn-need-config-row').forEach(row => {
      const needId = row.dataset.needId;
      row.addEventListener('click', (event) => {
        if (event.target.closest('button, label, input')) return;
        this.#selectNeed(needId);
      });

      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox?.addEventListener('change', () => {
        this.#enabledDraft.set(needId, checkbox.checked);
        this.#enabledDirty.add(needId);
        row.classList.toggle('is-disabled', !checkbox.checked);
        this.#refreshEnabledCount();
        if (this.#selectedNeedId === needId) {
          this.#renderPreview(needId);
        }
      });
    });

    this.element.querySelectorAll('.mn-dialog__grid-card').forEach(card => {
      card.addEventListener('click', async (e) => {
        if (e.target.closest('button')) return;
        this.#selectPreset(e.currentTarget.dataset.presetId);
      });
    });

    const search = this.element.querySelector('.mn-config-search');
    if (search) {
      search.addEventListener('input', (e) => {
        const query = e.currentTarget.value.trim().toLowerCase();
        this.element.querySelectorAll('.mn-need-config-row').forEach(row => {
          const haystack = row.textContent.toLowerCase();
          row.style.display = haystack.includes(query) ? '' : 'none';
        });
        this.element.querySelectorAll('.mn-preset-card').forEach(card => {
          const haystack = card.textContent.toLowerCase();
          card.style.display = haystack.includes(query) ? '' : 'none';
        });
      });
    }

    const threshold = this.element.querySelector('.mn-config-threshold__range');
    threshold?.addEventListener('input', (event) => {
      this.#setCriticalThresholdDraft(event.currentTarget.value);
    });

    const importTextarea = this.element.querySelector('textarea[name="importJson"]');
    if (importTextarea) {
      importTextarea.addEventListener('input', () => {
        this.#refreshImportStatus(importTextarea.value);
      });
      this.#refreshImportStatus(importTextarea.value);
    }
  }

  _onClose(options) {
    if (this.#configChangedUnsubscribe) {
      this.#configChangedUnsubscribe();
      this.#configChangedUnsubscribe = null;
    }
    super._onClose(options);
  }

  #showTab(tabName = 'needs') {
    this.#activeTab = tabName;
    this.element.querySelectorAll('.mn-dialog__tab').forEach(tab => {
      tab.classList.toggle('is-active', tab.dataset.tab === tabName);
    });
    this.element.querySelectorAll('.mn-dialog__tab-content').forEach(content => {
      content.style.display = content.dataset.tabContent === tabName ? '' : 'none';
    });
  }

  #syncEnabledDraft(needs) {
    const validIds = new Set(needs.map(n => n.id));
    for (const id of this.#enabledDraft.keys()) {
      if (!validIds.has(id)) this.#enabledDraft.delete(id);
    }
    for (const id of this.#enabledDirty) {
      if (!validIds.has(id)) this.#enabledDirty.delete(id);
    }
    for (const need of needs) {
      if (!this.#enabledDraft.has(need.id) || !this.#enabledDirty.has(need.id)) {
        this.#enabledDraft.set(need.id, !!need.enabled);
      }
    }
  }

  #getDraftEnabled(need) {
    return this.#enabledDraft.has(need.id) ? this.#enabledDraft.get(need.id) : !!need.enabled;
  }

  #syncPresetSelection(presets) {
    if (presets.some(preset => preset.id === this.#selectedPresetId)) return;
    this.#selectedPresetId = presets[0]?.id ?? null;
  }

  #preparePresetViews(presets, needConfigs) {
    return presets.map(preset => this.#preparePresetView(preset, needConfigs));
  }

  #preparePresetView(preset, needConfigs) {
    if (!preset) return null;

    const needMap = new Map(needConfigs.map(need => [need.id, need]));
    const rawNeeds = preset.needs.map(needId => needMap.get(needId)).filter(Boolean);
    const categories = this.#getPresetCategoryBreakdown(rawNeeds);
    const categoryCount = categories.filter(category => category.count > 0).length;
    const decayCount = rawNeeds.filter(need => need.decay?.enabled).length;
    const needs = rawNeeds.map(need => ({
      ...need,
      localizedLabel: game.i18n.localize(need.label),
    }));

    return {
      ...preset,
      icon: this.#getPresetIcon(preset.id),
      localizedLabel: game.i18n.localize(preset.label),
      localizedDescription: game.i18n.localize(preset.description),
      isSelected: preset.id === this.#selectedPresetId,
      needs,
      needCount: needs.length,
      totalCount: needConfigs.length,
      categoryCount,
      decayCount,
      categories,
    };
  }

  #getPresetIcon(presetId) {
    const icons = {
      survival: 'fa-mountain',
      horror: 'fa-skull',
      scifi: 'fa-rocket',
      'dark-fantasy': 'fa-shield-alt',
      minimalist: 'fa-feather-alt',
    };
    return icons[presetId] || 'fa-star';
  }

  #getPresetCategoryBreakdown(needs) {
    const definitions = [
      { id: 'physical', label: 'physical', icon: 'fa-utensils' },
      { id: 'environmental', label: 'environmental', icon: 'fa-leaf' },
      { id: 'mental', label: 'mental', icon: 'fa-brain' },
      { id: 'custom', label: 'custom', icon: 'fa-star' },
    ];
    const total = Math.max(1, needs.length);

    return definitions.map(definition => {
      const count = needs.filter(need => need.category === definition.id).length;
      return {
        ...definition,
        count,
        percent: Math.round((count / total) * 100),
      };
    });
  }

  #syncCriticalThresholdDraft() {
    if (this.#criticalThresholdDirty && this.#criticalThresholdDraft !== null) return;
    const configured = game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80;
    this.#criticalThresholdDraft = this.#clampCriticalThreshold(configured);
  }

  #clampCriticalThreshold(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 80;
    const stepped = Math.round(numeric / CRITICAL_THRESHOLD_STEP) * CRITICAL_THRESHOLD_STEP;
    return Math.min(CRITICAL_THRESHOLD_MAX, Math.max(CRITICAL_THRESHOLD_MIN, stepped));
  }

  #getSeverityForPercentage(percentage) {
    return percentage >= 80 ? 'critical'
      : percentage >= 60 ? 'high'
        : percentage >= 40 ? 'medium'
          : percentage >= 20 ? 'low'
            : 'safe';
  }

  #getConfigsWithEnabledDraft() {
    return this.#store.getAllNeedConfigs().map(config => ({
      ...config,
      enabled: this.#getDraftEnabled(config),
    }));
  }

  #selectPreset(presetId) {
    if (!presetId || this.#selectedPresetId === presetId) return;
    this.#selectedPresetId = presetId;
    this.#activeTab = 'presets';
    this.render(false);
  }

  async #applyPreset(presetId) {
    if (!presetId) return;
    const preset = this.#configManager.getAllPresets().find(p => p.id === presetId);
    if (!preset) return;

    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.localize('MORTAL_NEEDS.Config.ApplyPresetTitle') },
      content: `<p>${game.i18n.localize('MORTAL_NEEDS.Config.ApplyPresetConfirm')}</p>`,
    });
    if (!confirmed) return;

    const updated = this.#configManager.applyPreset(presetId, this.#getConfigsWithEnabledDraft());
    this.#store.setNeedConfigs(updated);
    await this.#configManager.saveNeedsConfig(updated);
    this.#enabledDraft.clear();
    this.#enabledDirty.clear();
    this.#selectedNeedId = null;
    this.#selectedPresetId = presetId;
    this.#activeTab = 'presets';
    this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'preset', presetId });
    this.render(false);
    ui.notifications.info('MORTAL_NEEDS.Notifications.PresetApplied', { localize: true });
  }

  #selectNeed(needId) {
    if (!needId) return;
    this.#selectedNeedId = needId;
    this.element.querySelectorAll('.mn-need-config-row').forEach(row => {
      row.classList.toggle('is-selected', row.dataset.needId === needId);
    });
    this.#renderPreview(needId);
  }

  #renderPreview(needId) {
    const config = this.#store.getNeedConfig(needId);
    if (!config) return;

    const enabled = this.#enabledDraft.has(needId) ? this.#enabledDraft.get(needId) : !!config.enabled;
    const previewPercentage = this.#criticalThresholdDraft ?? this.#clampCriticalThreshold(game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80);
    const previewSeverity = this.#getSeverityForPercentage(previewPercentage);
    const localizedLabel = game.i18n.localize(config.label);
    const consequenceCount = config.consequences?.length ?? 0;
    const decayEnabled = !!config.decay?.enabled;
    const decayText = decayEnabled
      ? `+${config.decay?.rate ?? 0} / ${config.decay?.interval ?? 0}s`
      : game.i18n.localize('MORTAL_NEEDS.Config.DecayOff');

    const statusBadge = this.element.querySelector('.mn-config-preview__enabled-badge');
    if (statusBadge) {
      statusBadge.textContent = game.i18n.localize(enabled ? 'MORTAL_NEEDS.NeedEdit.Enabled' : 'MORTAL_NEEDS.Config.Disabled');
      statusBadge.classList.toggle('mn-badge--safe', enabled);
      statusBadge.classList.toggle('mn-badge--source', !enabled);
    }

    const icon = this.element.querySelector('.mn-config-preview__ring-core i');
    if (icon) icon.className = `fas ${config.icon}`;

    const ring = this.element.querySelector('.mn-config-preview__ring');
    ring?.style.setProperty('--mn-preview-percent', `${previewPercentage}%`);
    ring?.setAttribute('data-severity', previewSeverity);

    const percentage = this.element.querySelector('.mn-config-preview__ring-core strong');
    if (percentage) percentage.textContent = `${previewPercentage}%`;

    const name = this.element.querySelector('.mn-config-preview__name');
    if (name) name.textContent = localizedLabel;

    const pills = this.element.querySelector('.mn-config-preview__pills');
    if (pills) {
      const traitKey = config.custom ? 'MORTAL_NEEDS.Config.CustomTrait' : 'MORTAL_NEEDS.Config.DefaultTrait';
      const traitClass = config.custom ? 'custom' : 'default';
      pills.innerHTML = `
        <span class="mn-config-pill mn-config-pill--${config.category}">${config.category}</span>
        <span class="mn-config-pill mn-config-pill--${traitClass}">${game.i18n.localize(traitKey)}</span>
      `;
    }

    const stress = this.element.querySelector('.mn-config-preview__stress');
    if (stress) stress.textContent = `${config.stressAmount ?? 0} ${game.i18n.localize('MORTAL_NEEDS.Config.StressPerClick')}`;

    const consequences = this.element.querySelector('.mn-config-preview__consequences');
    if (consequences) consequences.textContent = `${consequenceCount} ${game.i18n.localize('MORTAL_NEEDS.Config.ConsequenceCount')}`;

    const decay = this.element.querySelector('.mn-config-preview__decay');
    if (decay) decay.textContent = decayText;
  }

  #setCriticalThresholdDraft(value) {
    const nextValue = this.#clampCriticalThreshold(value);
    this.#criticalThresholdDraft = nextValue;
    this.#criticalThresholdDirty = true;

    const severity = this.#getSeverityForPercentage(nextValue);
    const ring = this.element.querySelector('.mn-config-preview__ring');
    ring?.style.setProperty('--mn-preview-percent', `${nextValue}%`);
    ring?.setAttribute('data-severity', severity);

    const ringValue = this.element.querySelector('.mn-config-preview__ring-core strong');
    if (ringValue) ringValue.textContent = `${nextValue}%`;

    const thresholdValue = this.element.querySelector('.mn-config-threshold__labels strong');
    if (thresholdValue) thresholdValue.textContent = `${nextValue}%`;

    const thresholdInput = this.element.querySelector('.mn-config-threshold__range');
    if (thresholdInput) thresholdInput.value = String(nextValue);
  }

  #refreshEnabledCount() {
    const enabled = this.element.querySelectorAll('.mn-need-config-row input[type="checkbox"]:checked').length;
    const total = this.element.querySelectorAll('.mn-need-config-row input[type="checkbox"]').length;
    const count = this.element.querySelector('.mn-config-enabled-count');
    if (count) count.textContent = `${enabled}/${total}`;
  }

  #refreshImportStatus(value) {
    const status = this.element.querySelector('.mn-import-status');
    if (!status) return;

    const result = this.#getImportPayloadStatus(value);
    let state = 'empty';
    let icon = 'fa-circle-info';
    let labelKey = 'MORTAL_NEEDS.Config.ImportStatusEmpty';
    let hintKey = 'MORTAL_NEEDS.Config.ImportStatusEmptyHint';

    if (result.state === 'valid') {
      state = 'valid';
      icon = 'fa-check-circle';
      labelKey = 'MORTAL_NEEDS.Config.ImportStatusValid';
      hintKey = 'MORTAL_NEEDS.Config.ImportStatusValidHint';
    } else if (result.state === 'invalid') {
      state = 'invalid';
      icon = 'fa-triangle-exclamation';
      labelKey = 'MORTAL_NEEDS.Config.ImportStatusInvalid';
      hintKey = 'MORTAL_NEEDS.Config.ImportStatusInvalidHint';
    }

    status.dataset.state = state;
    const statusIcon = status.querySelector('i');
    if (statusIcon) statusIcon.className = `fas ${icon}`;

    const label = status.querySelector('strong');
    if (label) label.textContent = game.i18n.localize(labelKey);

    const hint = status.querySelector('span');
    if (hint) hint.textContent = game.i18n.localize(hintKey);

    const importButton = this.element.querySelector('[data-action="import-config"]');
    if (importButton) importButton.disabled = state !== 'valid';
  }

  #getImportPayloadStatus(value) {
    const json = value?.trim() ?? '';
    if (!json) return { state: 'empty', data: null };

    try {
      const data = JSON.parse(json);
      if (!data?.needs || !Array.isArray(data.needs)) {
        return { state: 'invalid', data: null };
      }
      const hasValidNeeds = data.needs.every(need => (
        need
        && typeof need === 'object'
        && typeof need.id === 'string'
        && need.id.trim()
      ));
      if (!hasValidNeeds) return { state: 'invalid', data: null };
      return { state: 'valid', data };
    } catch (error) {
      return { state: 'invalid', data: null };
    }
  }

  static async #onSave() {
    const configs = this.#getConfigsWithEnabledDraft();

    this.#store.setNeedConfigs(configs);
    await this.#configManager.saveNeedsConfig(configs);
    if (this.#criticalThresholdDirty) {
      await game.settings.set(MODULE_ID, 'criticalThreshold', this.#criticalThresholdDraft);
      this.#criticalThresholdDirty = false;
    }
    this.#enabledDraft.clear();
    this.#enabledDirty.clear();
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
    const json = this.#configManager.exportConfig(this.#getConfigsWithEnabledDraft());
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

    if (this.#getImportPayloadStatus(json).state !== 'valid') {
      this.#refreshImportStatus(json);
      ui.notifications.warn('MORTAL_NEEDS.Notifications.ImportFailed', { localize: true });
      return;
    }

    const configs = this.#configManager.importConfig(json);
    if (configs) {
      this.#store.setNeedConfigs(configs);
      await this.#configManager.saveNeedsConfig(configs);
      this.#enabledDraft.clear();
      this.#enabledDirty.clear();
      this.#selectedNeedId = null;
      this.#criticalThresholdDirty = false;
      textarea.value = '';
      this.#eventBus.emit(Events.CONFIG_CHANGED, { source: 'import' });
      this.render(false);
      ui.notifications.info('MORTAL_NEEDS.Notifications.ConfigImported', { localize: true });
    }
  }

  static #onClearImportJson() {
    const textarea = this.element.querySelector('textarea[name="importJson"]');
    if (!textarea) return;

    textarea.value = '';
    this.#refreshImportStatus('');
    textarea.focus();
  }

  static #onFormatImportJson() {
    const textarea = this.element.querySelector('textarea[name="importJson"]');
    const json = textarea?.value;
    if (!json?.trim()) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.ImportEmpty', { localize: true });
      return;
    }

    try {
      textarea.value = JSON.stringify(JSON.parse(json), null, 2);
      this.#refreshImportStatus(textarea.value);
      ui.notifications.info('MORTAL_NEEDS.Notifications.ImportFormatted', { localize: true });
    } catch (error) {
      this.#refreshImportStatus(json);
      ui.notifications.warn('MORTAL_NEEDS.Notifications.ImportFailed', { localize: true });
    }
  }

  static async #onApplyPreset(event, target) {
    await this.#applyPreset(target.dataset.presetId);
  }

  static async #onApplySelectedPreset() {
    await this.#applyPreset(this.#selectedPresetId);
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
      const enabledNeeds = this.#getConfigsWithEnabledDraft().filter(c => c.enabled).map(c => c.id);
      const preset = {
        id: `custom-${Date.now()}`,
        label: result.name,
        description: result.description,
        needs: enabledNeeds,
      };
      await this.#configManager.saveCustomPreset(preset);
      this.#selectedPresetId = preset.id;
      this.#activeTab = 'presets';
      this.render(false);
      ui.notifications.info('MORTAL_NEEDS.Notifications.PresetSaved', { localize: true });
    }
  }

  static async #onDeletePreset(event, target) {
    const presetId = target.dataset.presetId;
    await this.#configManager.deleteCustomPreset(presetId);
    if (this.#selectedPresetId === presetId) this.#selectedPresetId = null;
    this.#activeTab = 'presets';
    this.render(false);
  }
}

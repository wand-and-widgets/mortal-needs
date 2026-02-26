import { MODULE_ID, DEFAULT_NEEDS, BUILT_IN_PRESETS } from '../constants.js';

export class ConfigManager {
  #eventBus;
  #customPresets = [];

  constructor(eventBus) {
    this.#eventBus = eventBus;
  }

  registerAllSettings() {
    // --- World Settings (GM-only) ---

    game.settings.register(MODULE_ID, 'needsConfig', {
      scope: 'world', config: false, type: Array, default: [],
    });

    game.settings.register(MODULE_ID, 'trackedActors', {
      scope: 'world', config: false, type: Array, default: [],
    });

    game.settings.register(MODULE_ID, 'esCharacterNeeds', {
      scope: 'world', config: false, type: Object, default: {},
    });

    game.settings.register(MODULE_ID, 'customPresets', {
      scope: 'world', config: false, type: Array, default: [],
    });

    game.settings.register(MODULE_ID, 'dataVersion', {
      scope: 'world', config: false, type: Number, default: 0,
    });

    game.settings.register(MODULE_ID, 'defaultStressAmount', {
      name: 'MORTAL_NEEDS.Settings.DefaultStress',
      hint: 'MORTAL_NEEDS.Settings.DefaultStressHint',
      scope: 'world', config: true, type: Number,
      default: 20, range: { min: 1, max: 50, step: 1 },
    });

    game.settings.register(MODULE_ID, 'playerVisibility', {
      name: 'MORTAL_NEEDS.Settings.PlayerVisibility',
      hint: 'MORTAL_NEEDS.Settings.PlayerVisibilityHint',
      scope: 'world', config: true, type: String,
      default: 'own',
      choices: {
        none: 'MORTAL_NEEDS.Settings.VisibilityNone',
        own: 'MORTAL_NEEDS.Settings.VisibilityOwn',
        all: 'MORTAL_NEEDS.Settings.VisibilityAll',
      },
    });

    game.settings.register(MODULE_ID, 'playerControl', {
      name: 'MORTAL_NEEDS.Settings.PlayerControl',
      hint: 'MORTAL_NEEDS.Settings.PlayerControlHint',
      scope: 'world', config: true, type: Boolean,
      default: false,
    });

    game.settings.register(MODULE_ID, 'notifyOnCritical', {
      name: 'MORTAL_NEEDS.Settings.NotifyCritical',
      hint: 'MORTAL_NEEDS.Settings.NotifyCriticalHint',
      scope: 'world', config: true, type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'criticalThreshold', {
      name: 'MORTAL_NEEDS.Settings.CriticalThreshold',
      hint: 'MORTAL_NEEDS.Settings.CriticalThresholdHint',
      scope: 'world', config: true, type: Number,
      default: 80, range: { min: 50, max: 100, step: 5 },
    });

    game.settings.register(MODULE_ID, 'consequenceRemovalMode', {
      name: 'MORTAL_NEEDS.Settings.ConsequenceRemoval',
      hint: 'MORTAL_NEEDS.Settings.ConsequenceRemovalHint',
      scope: 'world', config: true, type: String,
      default: 'ask_gm',
      choices: {
        ask_gm: 'MORTAL_NEEDS.Settings.RemovalAskGM',
        immediate: 'MORTAL_NEEDS.Settings.RemovalImmediate',
        manual: 'MORTAL_NEEDS.Settings.RemovalManual',
      },
    });

    game.settings.register(MODULE_ID, 'showConsequenceChat', {
      name: 'MORTAL_NEEDS.Settings.ShowConsequenceChat',
      hint: 'MORTAL_NEEDS.Settings.ShowConsequenceChatHint',
      scope: 'world', config: true, type: Boolean,
      default: true,
    });

    // --- Flavor Message Settings ---

    game.settings.register(MODULE_ID, 'flavorMessages', {
      name: 'MORTAL_NEEDS.Settings.FlavorMessages',
      hint: 'MORTAL_NEEDS.Settings.FlavorMessagesHint',
      scope: 'world', config: true, type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'flavorVerbosity', {
      name: 'MORTAL_NEEDS.Settings.FlavorVerbosity',
      hint: 'MORTAL_NEEDS.Settings.FlavorVerbosityHint',
      scope: 'world', config: true, type: String,
      default: 'normal',
      choices: {
        minimal: 'MORTAL_NEEDS.Settings.VerbosityMinimal',
        normal: 'MORTAL_NEEDS.Settings.VerbosityNormal',
        verbose: 'MORTAL_NEEDS.Settings.VerbosityVerbose',
      },
    });

    game.settings.register(MODULE_ID, 'flavorVisibility', {
      name: 'MORTAL_NEEDS.Settings.FlavorVisibility',
      hint: 'MORTAL_NEEDS.Settings.FlavorVisibilityHint',
      scope: 'world', config: true, type: String,
      default: 'all',
      choices: {
        gm: 'MORTAL_NEEDS.Settings.FlavorVisibilityGM',
        all: 'MORTAL_NEEDS.Settings.FlavorVisibilityAll',
      },
    });

    game.settings.register(MODULE_ID, 'flavorBatchMode', {
      name: 'MORTAL_NEEDS.Settings.FlavorBatchMode',
      hint: 'MORTAL_NEEDS.Settings.FlavorBatchModeHint',
      scope: 'world', config: true, type: Boolean,
      default: true,
    });

    // --- Client Settings (per-user) ---

    game.settings.register(MODULE_ID, 'animateBars', {
      name: 'MORTAL_NEEDS.Settings.AnimateBars',
      hint: 'MORTAL_NEEDS.Settings.AnimateBarsHint',
      scope: 'client', config: true, type: Boolean,
      default: true,
    });

    game.settings.register(MODULE_ID, 'barOrientation', {
      name: 'MORTAL_NEEDS.Settings.BarOrientation',
      hint: 'MORTAL_NEEDS.Settings.BarOrientationHint',
      scope: 'client', config: true, type: String,
      default: 'horizontal',
      choices: {
        horizontal: 'MORTAL_NEEDS.Settings.OrientationHorizontal',
        vertical: 'MORTAL_NEEDS.Settings.OrientationVertical',
        radial: 'MORTAL_NEEDS.Settings.OrientationRadial',
      },
      onChange: () => {
        const app = game.modules.get(MODULE_ID)?.api;
        app?.ui?.refresh();
      },
    });

    game.settings.register(MODULE_ID, 'panelPosition', {
      scope: 'client', config: false, type: Object,
      default: { top: 100, left: 120 },
    });

    game.settings.register(MODULE_ID, 'uiScale', {
      name: 'MORTAL_NEEDS.Settings.UIScale',
      hint: 'MORTAL_NEEDS.Settings.UIScaleHint',
      scope: 'client', config: true, type: Number,
      default: 100, range: { min: 80, max: 200, step: 5 },
    });

    game.settings.register(MODULE_ID, 'compactMode', {
      name: 'MORTAL_NEEDS.Settings.CompactMode',
      hint: 'MORTAL_NEEDS.Settings.CompactModeHint',
      scope: 'client', config: true, type: Boolean,
      default: false,
    });

    // --- Deprecated v1 settings (kept for migration) ---

    game.settings.register(MODULE_ID, 'applyConModifier', {
      scope: 'world', config: false, type: Boolean, default: false,
    });

    game.settings.register(MODULE_ID, 'punishmentRemovalMode', {
      scope: 'world', config: false, type: String, default: 'ask_gm',
    });

    game.settings.register(MODULE_ID, 'showPunishmentChat', {
      scope: 'world', config: false, type: Boolean, default: true,
    });
  }

  // --- Needs Configuration ---

  async loadNeedsConfig() {
    const saved = game.settings.get(MODULE_ID, 'needsConfig');
    if (saved && saved.length > 0) {
      return this.mergeWithDefaults(saved);
    }
    return DEFAULT_NEEDS.map(n => ({ ...n }));
  }

  mergeWithDefaults(savedConfig) {
    const merged = [];
    const savedMap = new Map(savedConfig.map(c => [c.id, c]));

    // Add all defaults, merging with saved overrides
    for (const defaultNeed of DEFAULT_NEEDS) {
      const saved = savedMap.get(defaultNeed.id);
      if (saved) {
        merged.push({
          ...defaultNeed,
          ...saved,
          // Deep merge flavor: fill empty severity bands from defaults
          flavor: ConfigManager.#mergeFlavorStructure(defaultNeed.flavor, saved.flavor),
          // Ensure new v2 fields exist
          consequences: saved.consequences || saved.effects || [],
          decay: saved.decay || { enabled: false, rate: 5, interval: 3600 },
          category: saved.category || defaultNeed.category,
          iconType: saved.iconType || 'fa',
        });
        savedMap.delete(defaultNeed.id);
      } else {
        merged.push({ ...defaultNeed });
      }
    }

    // Add remaining custom needs
    for (const [, custom] of savedMap) {
      merged.push({
        ...custom,
        custom: true,
        consequences: custom.consequences || custom.effects || [],
        decay: custom.decay || { enabled: false, rate: 5, interval: 3600 },
        category: custom.category || 'custom',
        iconType: custom.iconType || 'fa',
      });
    }

    return merged;
  }

  async saveNeedsConfig(configs) {
    await game.settings.set(MODULE_ID, 'needsConfig', configs);
  }

  // --- Presets ---

  getBuiltInPresets() {
    return BUILT_IN_PRESETS.map(p => ({ ...p, builtIn: true }));
  }

  async loadCustomPresets() {
    this.#customPresets = game.settings.get(MODULE_ID, 'customPresets') || [];
    return this.#customPresets.map(p => ({ ...p, builtIn: false }));
  }

  getAllPresets() {
    return [
      ...this.getBuiltInPresets(),
      ...this.#customPresets.map(p => ({ ...p, builtIn: false })),
    ];
  }

  async saveCustomPreset(preset) {
    this.#customPresets.push(preset);
    await game.settings.set(MODULE_ID, 'customPresets', this.#customPresets);
  }

  async deleteCustomPreset(presetId) {
    this.#customPresets = this.#customPresets.filter(p => p.id !== presetId);
    await game.settings.set(MODULE_ID, 'customPresets', this.#customPresets);
  }

  registerExternalPreset(presetDef) {
    this.#customPresets.push({ ...presetDef, external: true });
  }

  applyPreset(presetId, currentConfigs) {
    const preset = this.getAllPresets().find(p => p.id === presetId);
    if (!preset) return currentConfigs;

    return currentConfigs.map(config => ({
      ...config,
      enabled: preset.needs.includes(config.id),
    }));
  }

  // --- Flavor Merge ---

  /**
   * Deep-merge flavor structures: fills empty severity bands from defaults.
   * Also normalizes legacy flat format (apply/remove) to the new severity-keyed format.
   */
  static #mergeFlavorStructure(defaultFlavor, savedFlavor) {
    if (!savedFlavor) return defaultFlavor;

    // Legacy flat format — return defaults (migration handles conversion)
    if ((savedFlavor.apply || savedFlavor.remove) && !savedFlavor.worsening) {
      return defaultFlavor;
    }

    // New format — deep merge each severity band
    const result = { worsening: {}, improving: {} };
    const worseningBands = ['low', 'medium', 'high', 'critical'];
    const improvingBands = ['high', 'medium', 'low', 'safe'];

    for (const band of worseningBands) {
      const saved = savedFlavor?.worsening?.[band];
      const fallback = defaultFlavor?.worsening?.[band];
      result.worsening[band] = (saved && saved.length > 0) ? saved : (fallback || []);
    }

    for (const band of improvingBands) {
      const saved = savedFlavor?.improving?.[band];
      const fallback = defaultFlavor?.improving?.[band];
      result.improving[band] = (saved && saved.length > 0) ? saved : (fallback || []);
    }

    return result;
  }

  // --- Import/Export ---

  exportConfig(configs) {
    return JSON.stringify({
      version: 2,
      module: MODULE_ID,
      exportDate: new Date().toISOString(),
      needs: configs,
    }, null, 2);
  }

  importConfig(json) {
    try {
      const data = typeof json === 'string' ? JSON.parse(json) : json;
      if (!data.needs || !Array.isArray(data.needs)) {
        throw new Error('Invalid config format: missing needs array');
      }
      return this.mergeWithDefaults(data.needs);
    } catch (err) {
      console.error('Mortal Needs | Failed to import config:', err);
      ui.notifications.error('MORTAL_NEEDS.Notifications.ImportFailed', { localize: true });
      return null;
    }
  }
}

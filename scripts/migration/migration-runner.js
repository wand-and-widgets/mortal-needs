import { MODULE_ID, MODULE_TITLE } from '../constants.js';

/**
 * Handles v1 -> v2 data migration.
 *
 * v1 used:
 * - `punishment` instead of `consequences` in need configs
 * - `punishmentTicks_*` flags on actors
 * - `punishmentRemovalMode` and `showPunishmentChat` settings
 * - `applyConModifier` setting
 *
 * v2 uses:
 * - `consequences` arrays
 * - `consequenceTicks_*` flags
 * - `consequenceRemovalMode` and `showConsequenceChat` settings
 */
export class MigrationRunner {
  static DATA_VERSION = 3;

  static async run() {
    if (!game.user.isGM) return;

    const currentVersion = game.settings.get(MODULE_ID, 'dataVersion') || 0;
    if (currentVersion >= MigrationRunner.DATA_VERSION) return;

    console.log(`${MODULE_TITLE} | Running migration from v${currentVersion} to v${MigrationRunner.DATA_VERSION}...`);

    try {
      if (currentVersion < 2) {
        await MigrationRunner.#migrateV1toV2();
      }
      if (currentVersion < 3) {
        await MigrationRunner.#migrateV2toV3();
      }

      await game.settings.set(MODULE_ID, 'dataVersion', MigrationRunner.DATA_VERSION);
      console.log(`${MODULE_TITLE} | Migration complete.`);

      // Notify user
      ui.notifications.info('MORTAL_NEEDS.Migration.Complete', { localize: true });
    } catch (err) {
      console.error(`${MODULE_TITLE} | Migration failed:`, err);
      ui.notifications.error('MORTAL_NEEDS.Migration.Failed', { localize: true });
    }
  }

  static async #migrateV1toV2() {
    // 1. Migrate settings
    await MigrationRunner.#migrateSettings();

    // 2. Migrate needs config
    await MigrationRunner.#migrateNeedsConfig();

    // 3. Migrate actor flags
    await MigrationRunner.#migrateActorFlags();
  }

  static async #migrateSettings() {
    try {
      // Migrate punishmentRemovalMode -> consequenceRemovalMode
      const oldRemovalMode = game.settings.get(MODULE_ID, 'punishmentRemovalMode');
      if (oldRemovalMode && oldRemovalMode !== 'ask_gm') {
        await game.settings.set(MODULE_ID, 'consequenceRemovalMode', oldRemovalMode);
      }

      // Migrate showPunishmentChat -> showConsequenceChat
      const oldShowChat = game.settings.get(MODULE_ID, 'showPunishmentChat');
      if (oldShowChat !== undefined) {
        await game.settings.set(MODULE_ID, 'showConsequenceChat', oldShowChat);
      }

      console.log(`${MODULE_TITLE} | Settings migrated.`);
    } catch (err) {
      // Settings may not exist in fresh installs, that's fine
      console.log(`${MODULE_TITLE} | No v1 settings to migrate.`);
    }
  }

  static async #migrateNeedsConfig() {
    try {
      const savedConfig = game.settings.get(MODULE_ID, 'needsConfig') || [];
      if (savedConfig.length === 0) return;

      let changed = false;
      const migrated = savedConfig.map(config => {
        const newConfig = { ...config };

        // Rename `punishment` to `consequences`
        if (config.punishment && !config.consequences) {
          newConfig.consequences = MigrationRunner.#migratePunishment(config.punishment);
          delete newConfig.punishment;
          changed = true;
        }

        // Rename `effects` to `consequences` (intermediate naming)
        if (config.effects && !config.consequences) {
          newConfig.consequences = config.effects;
          delete newConfig.effects;
          changed = true;
        }

        // Ensure new v2 fields
        if (!newConfig.decay) {
          newConfig.decay = { enabled: false, rate: 5, interval: 3600 };
          changed = true;
        }
        if (!newConfig.category) {
          newConfig.category = MigrationRunner.#inferCategory(config.id);
          changed = true;
        }
        if (!newConfig.iconType) {
          newConfig.iconType = 'fa';
          changed = true;
        }

        return newConfig;
      });

      if (changed) {
        await game.settings.set(MODULE_ID, 'needsConfig', migrated);
        console.log(`${MODULE_TITLE} | Needs config migrated.`);
      }
    } catch (err) {
      console.warn(`${MODULE_TITLE} | Failed to migrate needs config:`, err);
    }
  }

  static #migratePunishment(punishment) {
    if (!punishment) return [];

    const consequences = [];

    // v1 punishment had: { type, enabled, ticks, ... }
    if (punishment.damageEnabled) {
      consequences.push({
        type: 'attribute-modify',
        threshold: 100,
        ticks: punishment.damageTicks ?? 3,
        reversible: false,
        config: {
          path: 'system.attributes.hp.value',
          operation: 'subtract',
          amount: punishment.damageAmount ?? 5,
        },
      });
    }

    if (punishment.exhaustionEnabled) {
      consequences.push({
        type: 'attribute-modify',
        threshold: 100,
        ticks: punishment.exhaustionTicks ?? 3,
        reversible: true,
        config: {
          path: 'system.attributes.exhaustion',
          operation: 'add',
          amount: 1,
        },
      });
    }

    if (punishment.conditionEnabled && punishment.conditionId) {
      consequences.push({
        type: 'condition-apply',
        threshold: 100,
        ticks: punishment.conditionTicks ?? 3,
        reversible: true,
        config: {
          conditionId: punishment.conditionId,
        },
      });
    }

    return consequences;
  }

  static async #migrateActorFlags() {
    const trackedIds = game.settings.get(MODULE_ID, 'trackedActors') || [];

    for (const actorId of trackedIds) {
      const actor = game.actors.get(actorId);
      if (!actor) continue;

      const flags = actor.flags?.[MODULE_ID] || {};
      let changed = false;
      const updates = {};

      // Rename punishmentTicks_* to consequenceTicks_*
      for (const [key, value] of Object.entries(flags)) {
        if (key.startsWith('punishmentTicks_')) {
          const newKey = key.replace('punishmentTicks_', 'consequenceTicks_');
          updates[`flags.${MODULE_ID}.${newKey}`] = value;
          updates[`flags.${MODULE_ID}.-=${key}`] = null;
          changed = true;
        }
      }

      if (changed) {
        await actor.update(updates);
        console.log(`${MODULE_TITLE} | Migrated actor flags: ${actor.name}`);
      }
    }
  }

  /**
   * v2 -> v3: Migrate flavor structure from flat (apply/remove) to severity-keyed (worsening/improving).
   * Old `apply[]` maps to `worsening.critical`, old `remove[]` maps to `improving.safe`.
   */
  static async #migrateV2toV3() {
    try {
      const savedConfig = game.settings.get(MODULE_ID, 'needsConfig') || [];
      if (savedConfig.length === 0) return;

      let changed = false;
      const migrated = savedConfig.map(config => {
        const newConfig = { ...config };

        // Check for old flavor format (has apply/remove but not worsening/improving)
        if (config.flavor && (config.flavor.apply || config.flavor.remove) && !config.flavor.worsening) {
          newConfig.flavor = {
            worsening: {
              low: [],
              medium: [],
              high: [],
              critical: config.flavor.apply || [],
            },
            improving: {
              high: [],
              medium: [],
              low: [],
              safe: config.flavor.remove || [],
            },
          };
          changed = true;
        }

        return newConfig;
      });

      if (changed) {
        await game.settings.set(MODULE_ID, 'needsConfig', migrated);
        console.log(`${MODULE_TITLE} | Flavor structure migrated to v3.`);
      }
    } catch (err) {
      console.warn(`${MODULE_TITLE} | Failed to migrate flavor structure:`, err);
    }
  }

  static #inferCategory(needId) {
    const envNeeds = ['cold', 'heat', 'radiation', 'environmental'];
    const mentalNeeds = ['sanity', 'morale', 'corruption'];
    if (envNeeds.includes(needId)) return 'environmental';
    if (mentalNeeds.includes(needId)) return 'mental';
    return 'physical';
  }
}

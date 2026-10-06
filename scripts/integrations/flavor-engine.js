import { MODULE_ID, MODULE_TITLE, Events, SEVERITY_ORDER, mnRenderTemplate } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';
import { isGMOnlyNeed } from '../core/need-visibility.js';
import { shouldDisplayNeed } from '../core/need-visibility.js';
import { isResponsibleGM } from '../core/access.js';
import { conditionView } from '../ui/condition-view.js';
import { needIconPath } from '../ui/need-icons.js';

/**
 * FlavorEngine — Severity-aware narrative flavor message system.
 *
 * Listens to THRESHOLD_CROSSED events and sends styled chat cards with
 * creative flavor text appropriate to the severity level and direction
 * (worsening / improving).
 *
 * Features:
 * - Severity-keyed flavor pools (different messages per severity band)
 * - Debounce batching (100ms) to coalesce simultaneous events
 * - Per-entity+need cooldown (10s) to prevent spam
 * - Round-robin deduplication within batches (no two actors get same message)
 * - Recently-used tracking to avoid repeating messages across batches
 * - Verbosity setting to control which transitions fire
 * - Source suppression (no flavor on load/init/socket/reset)
 */
export class FlavorEngine {
  #eventBus;
  #store;

  /** @type {Map<string, string[]>} key: "needId:severity:direction" → array of recently used i18n keys */
  #recentlyUsed = new Map();

  /** @type {Array<Object>} pending events awaiting batch flush */
  #pendingBatch = [];

  /** @type {number|null} setTimeout handle for debounce */
  #batchTimeout = null;

  /** @type {Map<string, number>} key: "entityId:needId" → timestamp of last flavor sent */
  #cooldowns = new Map();

  static BATCH_DELAY = 100;    // ms — debounce window
  static COOLDOWN_MS = 10_000; // ms — per entity+need cooldown

  /** Sources that should never produce flavor messages */
  static SUPPRESSED_SOURCES = new Set(['load', 'initialization', 'socket', 'reset']);

  constructor(eventBus, store) {
    this.#eventBus = eventBus;
    this.#store = store;

    this.#eventBus.on(Events.THRESHOLD_CROSSED, this.#onThresholdCrossed.bind(this));
    for (const event of [Events.THRESHOLD_CRITICAL, Events.THRESHOLD_RECOVERED]) {
      this.#eventBus.on(event, data => {
        if (data.sustained) return;
        this.#onThresholdCrossed({ ...data, crucial: true,
          severity: NeedsEngine.getSeverity(data.percentage),
          previousSeverity: NeedsEngine.getSeverity(data.previousPercentage) });
      });
    }
  }

  // --- Event Handler ---

  getWorstVisibleNeed(entityId) {
    const entity = this.#store.getTrackedEntityInfo(entityId);
    if (!entity) return null;
    return this.#store.getEnabledNeedConfigs()
      .filter(config => shouldDisplayNeed(config, this.#store.getActorNeedState(entityId, config.id), { user: { isGM: false } }))
      .map(config => ({ config, ...conditionView(config, this.#store.getActorNeedState(entityId, config.id)) }))
      .sort((a, b) => b.stress - a.stress)[0] || null;
  }

  async narrateWorst(entityId) {
    if (!game.user.isGM) return false;
    const worst = this.getWorstVisibleNeed(entityId);
    if (!worst) return false;
    const pool = this.#getFlavorPool(worst.config.id, worst.severity, worst.severity === 'safe' ? 'improving' : 'worsening');
    const flavorText = pool?.length ? game.i18n.localize(this.#shuffle([...pool])[0])
      : game.i18n.format('MORTAL_NEEDS.Dock.ConditionSummary', { need: game.i18n.localize(worst.config.label), state: worst.label });
    await this.#sendSingleCard({ entityId, needId: worst.config.id, ...worst, percentage: worst.stress, direction: 'current', flavorText });
    return true;
  }

  #onThresholdCrossed(data) {
    if (!isResponsibleGM()) return;
    if (!game.settings.get(MODULE_ID, 'flavorMessages')) return;

    // Suppress system-generated changes
    if (FlavorEngine.SUPPRESSED_SOURCES.has(data.source)) return;

    const { entityId, needId, severity, previousSeverity } = data;

    // Determine direction
    const newOrder = SEVERITY_ORDER[severity];
    const oldOrder = SEVERITY_ORDER[previousSeverity];
    if (newOrder === undefined || oldOrder === undefined) return;

    const direction = data.percentage > data.previousPercentage ? 'worsening' : 'improving';

    // Check verbosity filter
    if (!data.crucial && !this.#passesVerbosityFilter(severity, previousSeverity, direction)) return;

    // Check cooldown
    const cooldownKey = `${entityId}:${needId}`;
    const now = Date.now();
    const lastFlavor = this.#cooldowns.get(cooldownKey);
    const critical = game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80;
    const crucial = data.crucial || severity === 'critical' || previousSeverity === 'critical'
      || (data.percentage >= critical) !== (data.previousPercentage >= critical);
    if (!crucial && lastFlavor && (now - lastFlavor) < FlavorEngine.COOLDOWN_MS) return;

    // Queue for batching
    this.#pendingBatch = this.#pendingBatch.filter(entry => entry.entityId !== entityId || entry.needId !== needId);
    this.#pendingBatch.push({
      entityId, needId, severity, previousSeverity, direction,
      percentage: data.percentage,
      previousPercentage: data.previousPercentage,
      value: data.value,
      max: data.max,
    });

    // Debounce: reset timer on each new event
    if (this.#batchTimeout !== null) clearTimeout(this.#batchTimeout);
    this.#batchTimeout = setTimeout(() => this.#flushBatch().catch(error => console.error('Mortal Needs | Narration failed:', error)), FlavorEngine.BATCH_DELAY);
  }

  // --- Verbosity Filter ---

  #passesVerbosityFilter(severity, previousSeverity, direction) {
    const verbosity = game.settings.get(MODULE_ID, 'flavorVerbosity');

    // Verbose: everything passes
    if (verbosity === 'verbose') return true;

    // Minimal: only HIGH↔CRITICAL and full recovery (→SAFE) or sudden onset (SAFE→)
    if (verbosity === 'minimal') {
      if (direction === 'worsening') {
        return severity === 'critical' || severity === 'high' || previousSeverity === 'safe';
      } else {
        return severity === 'safe' || severity === 'high' || previousSeverity === 'critical';
      }
    }

    // Normal (default): all single-band crossings pass
    return true;
  }

  // --- Batch Processing ---

  async #flushBatch() {
    this.#batchTimeout = null;
    const batch = this.#pendingBatch.splice(0);
    if (batch.length === 0 || !isResponsibleGM()) return;

    const useBatch = game.settings.get(MODULE_ID, 'flavorBatchMode');

    // Group events by needId + severity + direction for dedup
    const groups = new Map();
    for (const event of batch) {
      const groupKey = `${event.needId}:${event.severity}:${event.direction}`;
      if (!groups.has(groupKey)) groups.set(groupKey, []);
      groups.get(groupKey).push(event);
    }

    // For each group, assign flavors: one shared flavor for batch groups, unique for singles
    const resolvedEntries = [];
    for (const [groupKey, events] of groups) {
      const { needId, severity, direction } = events[0];
      const pool = this.#getFlavorPool(needId, severity, direction) || [];

      // Get available messages (filter recently used)
      const recentKey = groupKey;
      const available = this.#getAvailableFlavors(pool, recentKey);
      const shuffled = this.#shuffle([...available]);

      // Pick ONE shared flavor for the group
      const flavorKey = shuffled[0];
      const flavorText = flavorKey ? game.i18n.localize(flavorKey)
        : game.i18n.format('MORTAL_NEEDS.Dock.ConditionSummary', { need: game.i18n.localize(this.#store.getNeedConfig(needId)?.label || needId), state: game.i18n.localize(`MORTAL_NEEDS.Severity.${severity[0].toUpperCase() + severity.slice(1)}`) });
      if (flavorKey) this.#markUsed(recentKey, flavorKey);

      for (const event of events) {
        // Mark cooldown
        const cooldownKey = `${event.entityId}:${event.needId}`;
        this.#cooldowns.set(cooldownKey, Date.now());

        resolvedEntries.push({ ...event, flavorKey, flavorText });
      }
    }

    if (resolvedEntries.length === 0) return;

    // Send chat cards
    if (useBatch && resolvedEntries.length > 1) {
      // Check if all entries share same need+severity+direction for a clean batch
      const firstEntry = resolvedEntries[0];
      const allSameGroup = resolvedEntries.every(e =>
        e.needId === firstEntry.needId &&
        e.severity === firstEntry.severity &&
        e.direction === firstEntry.direction
      );

      if (allSameGroup) {
        await this.#sendBatchCard(resolvedEntries);
      } else {
        // Mixed batch: group by need+severity+direction, send batch cards per group
        const subGroups = new Map();
        for (const entry of resolvedEntries) {
          const key = `${entry.needId}:${entry.severity}:${entry.direction}`;
          if (!subGroups.has(key)) subGroups.set(key, []);
          subGroups.get(key).push(entry);
        }
        for (const entries of subGroups.values()) {
          if (entries.length > 1) {
            await this.#sendBatchCard(entries);
          } else {
            await this.#sendSingleCard(entries[0]);
          }
        }
      }
    } else {
      for (const entry of resolvedEntries) {
        await this.#sendSingleCard(entry);
      }
    }
  }

  // --- Flavor Pool & Selection ---

  #getFlavorPool(needId, severity, direction) {
    const needConfig = this.#store.getNeedConfig(needId);
    if (!needConfig?.flavor) return null;

    const flavor = needConfig.flavor;

    // Handle new severity-keyed format
    if (flavor.worsening || flavor.improving) {
      return flavor[direction]?.[severity] || null;
    }

    // Handle legacy flat format: apply → worsening.critical, remove → improving.safe
    if (flavor.apply || flavor.remove) {
      if (direction === 'worsening') return flavor.apply || null;
      if (direction === 'improving') return flavor.remove || null;
    }

    return null;
  }

  #getAvailableFlavors(pool, recentKey) {
    const used = this.#recentlyUsed.get(recentKey);
    if (!used || used.length === 0) return [...pool];

    const available = pool.filter(key => !used.includes(key));

    // If all used, reset and return full pool
    if (available.length === 0) {
      this.#recentlyUsed.delete(recentKey);
      return [...pool];
    }

    return available;
  }

  #markUsed(recentKey, flavorKey) {
    if (!this.#recentlyUsed.has(recentKey)) {
      this.#recentlyUsed.set(recentKey, []);
    }
    this.#recentlyUsed.get(recentKey).push(flavorKey);
  }

  #shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  // --- Chat Card Rendering ---

  async #sendSingleCard(entry) {
    const entityInfo = this.#store.getTrackedEntityInfo(entry.entityId);
    if (!entityInfo) return;

    const needConfig = this.#store.getNeedConfig(entry.needId);
    if (!needConfig) return;

    const directionIcon = entry.direction === 'current' ? 'fa-feather-alt' : entry.direction === 'worsening' ? 'fa-arrow-up' : 'fa-arrow-down';
    const directionLabel = entry.direction === 'current' ? 'MORTAL_NEEDS.Dock.CurrentCondition' : entry.direction === 'worsening'
      ? 'MORTAL_NEEDS.Chat.FlavorWorsening'
      : 'MORTAL_NEEDS.Chat.FlavorImproving';
    const severityLabel = `MORTAL_NEEDS.Severity.${entry.severity.charAt(0).toUpperCase() + entry.severity.slice(1)}`;

    const templateData = {
      actorName: entityInfo.name,
      actorImg: entityInfo.img,
      needName: game.i18n.localize(needConfig.label),
      needIcon: needConfig.icon,
      needConfig,
      needImage: needIconPath(needConfig.id),
      directionIcon,
      directionLabel,
      severity: entry.severity,
      severityLabel,
      value: entry.value,
      max: entry.max,
      percentage: entry.percentage,
      flavor: entry.flavorText,
      isWorsening: entry.direction === 'worsening',
    };

    const content = await mnRenderTemplate(
      `modules/${MODULE_ID}/templates/chat/flavor-card.hbs`,
      templateData,
    );

    const visibility = game.settings.get(MODULE_ID, 'flavorVisibility');
    const messageData = {
      content,
      speaker: { alias: MODULE_TITLE },
      flags: { [MODULE_ID]: { type: 'flavor', entityId: entry.entityId, needId: entry.needId } },
    };

    if (visibility === 'gm' || isGMOnlyNeed(needConfig)) {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(messageData);
  }

  async #sendBatchCard(entries) {
    if (entries.length === 0) return;

    const first = entries[0];
    const needConfig = this.#store.getNeedConfig(first.needId);
    if (!needConfig) return;

    const directionIcon = first.direction === 'worsening' ? 'fa-arrow-up' : 'fa-arrow-down';
    const directionLabel = first.direction === 'worsening'
      ? 'MORTAL_NEEDS.Chat.FlavorWorsening'
      : 'MORTAL_NEEDS.Chat.FlavorImproving';
    const severityLabel = `MORTAL_NEEDS.Severity.${first.severity.charAt(0).toUpperCase() + first.severity.slice(1)}`;

    const actors = entries.map(entry => {
      const entityInfo = this.#store.getTrackedEntityInfo(entry.entityId);
      return {
        actorName: entityInfo?.name || 'Unknown',
        actorImg: entityInfo?.img || 'modules/mortal-needs/assets/icons/fallback-portrait.svg',
        value: entry.value,
        max: entry.max,
        percentage: entry.percentage,
      };
    }).filter(a => a);

    const templateData = {
      needName: game.i18n.localize(needConfig.label),
      needIcon: needConfig.icon,
      needConfig,
      needImage: needIconPath(needConfig.id),
      directionIcon,
      directionLabel,
      severity: first.severity,
      severityLabel,
      actors,
      flavor: first.flavorText,
      isWorsening: first.direction === 'worsening',
    };

    const content = await mnRenderTemplate(
      `modules/${MODULE_ID}/templates/chat/flavor-batch-card.hbs`,
      templateData,
    );

    const visibility = game.settings.get(MODULE_ID, 'flavorVisibility');
    const messageData = {
      content,
      speaker: { alias: MODULE_TITLE },
      flags: { [MODULE_ID]: { type: 'flavor-batch', needId: first.needId } },
    };

    if (visibility === 'gm' || isGMOnlyNeed(needConfig)) {
      messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(messageData);
  }
}

import { MODULE_ID, MODULE_TITLE, Events, DEFAULT_MOVEMENT_ADVANCEMENT } from '../constants.js';

const MOVEMENT_SOURCE = 'movement';
const IGNORED_MOVEMENT_METHODS = new Set(['config', 'paste', 'undo']);
const MOVEMENT_METRICS = new Set(['spaces', 'cost', 'distance']);
const PROGRESS_PRECISION = 100000;

export class MovementEngine {
  #eventBus;
  #store;
  #needsEngine;
  #hookIds = [];
  #progress = new Map();
  #loadedEntities = new Set();

  constructor(eventBus, store, needsEngine) {
    this.#eventBus = eventBus;
    this.#store = store;
    this.#needsEngine = needsEngine;
  }

  initialize() {
    const moveTokenHook = Hooks.on('moveToken', (document, movement, operation, user) => {
      this.#onMoveToken(document, movement, operation, user);
    });
    this.#hookIds.push({ hook: 'moveToken', id: moveTokenHook });
  }

  destroy() {
    for (const { hook, id } of this.#hookIds) {
      Hooks.off(hook, id);
    }
    this.#hookIds = [];
    this.#progress.clear();
    this.#loadedEntities.clear();
  }

  async #onMoveToken(document, movement, operation, user) {
    try {
      if (!this.#isActiveGM()) return;
      if (operation?.mortalNeedsIgnoreMovement) return;

      const entityId = this.#resolveTrackedEntityId(document);
      if (!entityId) return;

      const rules = this.#getMovementRules();
      if (rules.length === 0) return;

      if (this.#isIgnoredMovementMethod(movement)) return;

      await this.#ensureProgressLoaded(entityId);
      const metrics = this.#extractMovementMetrics(document, movement);
      const isTeleport = this.#isTeleportMovement(movement);
      const applications = [];
      let progressChanged = false;

      for (const { needId, movement: rule } of rules) {
        if (isTeleport && !rule.countTeleports) continue;

        const travelled = metrics[rule.metric] ?? 0;
        if (travelled <= 0) continue;

        const key = this.#progressKey(entityId, needId, rule.metric);
        const previousProgress = this.#progress.get(key) || 0;
        const totalProgress = previousProgress + travelled;
        const ticks = Math.floor(totalProgress / rule.interval);
        const remainder = this.#roundProgress(totalProgress - (ticks * rule.interval));

        this.#progress.set(key, remainder);
        progressChanged = true;

        const amount = Math.round(ticks * rule.amount);
        if (amount <= 0) continue;

        const result = await this.#needsEngine.stressNeed(entityId, needId, amount, {
          skipModifier: true,
          skipSceneModifier: true,
          source: MOVEMENT_SOURCE,
        });
        if (!result) continue;

        applications.push({
          needId,
          amount,
          ticks,
          metric: rule.metric,
          travelled,
          interval: rule.interval,
          remainder,
          value: result.value,
          previousValue: result.previousValue,
        });
      }

      if (progressChanged) {
        await this.#persistProgress(entityId);
      }

      if (applications.length > 0) {
        this.#eventBus.emit(Events.MOVEMENT_STRESS_TICK, {
          entityId,
          tokenId: document?.id || null,
          sceneId: document?.parent?.id || canvas?.scene?.id || null,
          movementId: movement?.id || null,
          userId: user?.id || null,
          metrics,
          applications,
        });
      }
    } catch (err) {
      console.warn(`${MODULE_TITLE} | Failed to process movement-based need advancement:`, err);
    }
  }

  #getMovementRules() {
    return this.#store.getEnabledNeedConfigs()
      .map(config => ({
        needId: config.id,
        movement: this.#normalizeMovementRule(config.movement),
      }))
      .filter(({ movement }) => movement.enabled && movement.interval > 0 && movement.amount > 0);
  }

  #normalizeMovementRule(rule = {}) {
    const metric = MOVEMENT_METRICS.has(rule.metric)
      ? rule.metric
      : DEFAULT_MOVEMENT_ADVANCEMENT.metric;

    return {
      ...DEFAULT_MOVEMENT_ADVANCEMENT,
      ...rule,
      enabled: !!rule.enabled,
      metric,
      interval: Math.max(1, this.#toNumber(rule.interval, DEFAULT_MOVEMENT_ADVANCEMENT.interval)),
      amount: Math.min(100, Math.max(1, this.#toNumber(rule.amount, DEFAULT_MOVEMENT_ADVANCEMENT.amount))),
      countTeleports: !!rule.countTeleports,
    };
  }

  #resolveTrackedEntityId(document) {
    const actorIds = [
      document?.baseActor?.id,
      document?.actor?.baseActor?.id,
      document?.actor?.id,
      document?.actorId,
    ].filter(Boolean);

    const directActorId = actorIds.find(id => this.#store.isTracked(id));
    if (directActorId) return directActorId;

    const linkedEntity = this.#store.getAllTrackedActors()
      .find(entity => entity.linkedActorId && actorIds.includes(entity.linkedActorId));
    return linkedEntity?.id || null;
  }

  #isIgnoredMovementMethod(movement) {
    const method = String(movement?.method || '').toLowerCase();
    return IGNORED_MOVEMENT_METHODS.has(method);
  }

  #isTeleportMovement(movement) {
    const waypoints = [
      ...(movement?.passed?.waypoints || []),
      ...(movement?.pending?.waypoints || []),
      ...(movement?.history?.recorded?.waypoints || []),
      ...(movement?.history?.unrecorded?.waypoints || []),
    ];

    const segments = [
      ...(movement?.passed?.segments || []),
      ...(movement?.pending?.segments || []),
      ...(movement?.history?.recorded?.segments || []),
      ...(movement?.history?.unrecorded?.segments || []),
    ];

    return waypoints.some(waypoint => waypoint?.teleport || this.#isTeleportAction(waypoint?.action))
      || segments.some(segment => segment?.teleport || this.#isTeleportAction(segment?.action));
  }

  #isTeleportAction(action) {
    if (!action) return false;

    const actionId = String(action);
    const normalized = actionId.toLowerCase();
    if (normalized === 'teleport' || normalized.includes('teleport')) return true;

    const movementActions = globalThis.CONFIG?.Token?.movement?.actions;
    const actionConfig = movementActions?.[actionId] || movementActions?.get?.(actionId);
    return actionConfig?.teleport === true;
  }

  #extractMovementMetrics(document, movement) {
    const section = movement?.passed || movement?.history?.recorded || null;
    const fallback = this.#fallbackMetricsFromPositions(document, movement);

    return {
      spaces: this.#resolveMetric(section?.spaces, fallback.spaces),
      cost: this.#resolveMetric(section?.cost, fallback.cost),
      distance: this.#resolveMetric(section?.distance, fallback.distance),
    };
  }

  #fallbackMetricsFromPositions(document, movement) {
    const origin = movement?.origin || null;
    const destination = movement?.destination || null;
    if (!origin || !destination) return { spaces: 0, cost: 0, distance: 0 };

    const dx = this.#toNumber(destination.x, 0) - this.#toNumber(origin.x, 0);
    const dy = this.#toNumber(destination.y, 0) - this.#toNumber(origin.y, 0);
    const pixelDistance = Math.hypot(dx, dy);
    const scene = document?.parent || canvas?.scene || game.scenes?.active || null;
    const gridSize = Math.max(1, this.#toNumber(scene?.grid?.size, canvas?.grid?.size || 100));
    const gridDistance = Math.max(1, this.#toNumber(scene?.grid?.distance, 1));
    const spaces = pixelDistance / gridSize;

    return {
      spaces: this.#roundProgress(spaces),
      cost: this.#roundProgress(spaces),
      distance: this.#roundProgress(spaces * gridDistance),
    };
  }

  #resolveMetric(value, fallback) {
    const metric = this.#toNumber(value, fallback);
    if (!Number.isFinite(metric) || metric <= 0) return 0;
    return this.#roundProgress(metric);
  }

  async #ensureProgressLoaded(entityId) {
    if (this.#loadedEntities.has(entityId)) return;
    this.#loadedEntities.add(entityId);

    const actor = game.actors.get(entityId);
    const worldProgress = game.settings.get(MODULE_ID, 'movementProgress') || {};
    const progress = actor?.getFlag(MODULE_ID, 'movementProgress') || worldProgress[entityId] || {};
    if (!progress || typeof progress !== 'object') return;

    for (const [needId, rawValue] of Object.entries(progress)) {
      if (rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue)) {
        for (const metric of MOVEMENT_METRICS) {
          const value = this.#toNumber(rawValue[metric], null);
          if (value !== null) {
            this.#progress.set(this.#progressKey(entityId, needId, metric), this.#roundProgress(value));
          }
        }
      } else {
        const value = this.#toNumber(rawValue, null);
        if (value !== null) {
          this.#progress.set(this.#progressKey(entityId, needId, DEFAULT_MOVEMENT_ADVANCEMENT.metric), this.#roundProgress(value));
        }
      }
    }
  }

  async #persistProgress(entityId) {
    const actor = game.actors.get(entityId);

    const data = {};
    for (const [key, value] of this.#progress) {
      const [progressEntityId, needId, metric] = key.split('|');
      if (progressEntityId !== entityId) continue;
      if (!data[needId]) data[needId] = {};
      data[needId][metric] = value;
    }

    if (actor) {
      await actor.setFlag(MODULE_ID, 'movementProgress', data);
    } else {
      const worldProgress = game.settings.get(MODULE_ID, 'movementProgress') || {};
      worldProgress[entityId] = data;
      await game.settings.set(MODULE_ID, 'movementProgress', worldProgress);
    }
  }

  #progressKey(entityId, needId, metric) {
    return `${entityId}|${needId}|${metric}`;
  }

  #isActiveGM() {
    if (!game.user?.isGM) return false;
    if (typeof game.user.isActiveGM === 'boolean') return game.user.isActiveGM;

    const activeGMs = game.users?.filter?.(user => user.active && user.isGM) || [];
    if (activeGMs.length === 0) return game.user.isGM;
    return activeGMs[0]?.id === game.user.id;
  }

  #toNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  #roundProgress(value) {
    if (!Number.isFinite(value)) return 0;
    return Math.round(Math.max(0, value) * PROGRESS_PRECISION) / PROGRESS_PRECISION;
  }
}

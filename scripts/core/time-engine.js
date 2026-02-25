import { Events } from '../constants.js';

export class TimeEngine {
  #eventBus;
  #store;
  #needsEngine;
  #hookIds = [];
  #lastWorldTime = 0;

  /** @type {Map<string, number>} needId → accumulated seconds since last tick */
  #accumulated = new Map();

  constructor(eventBus, store, needsEngine) {
    this.#eventBus = eventBus;
    this.#store = store;
    this.#needsEngine = needsEngine;
  }

  initialize() {
    this.#lastWorldTime = game.time.worldTime;

    // Listen for world time changes
    const hookId = Hooks.on('updateWorldTime', (worldTime, dt) => {
      this.#onTimeAdvance(worldTime, dt);
    });
    this.#hookIds.push({ hook: 'updateWorldTime', id: hookId });

    // Simple Calendar integration
    if (game.modules.get('foundryvtt-simple-calendar')?.active) {
      const scHookId = Hooks.on('simple-calendar-date-time-change', (data) => {
        this.#onSimpleCalendarChange(data);
      });
      this.#hookIds.push({ hook: 'simple-calendar-date-time-change', id: scHookId });
    }
  }

  destroy() {
    for (const { hook, id } of this.#hookIds) {
      Hooks.off(hook, id);
    }
    this.#hookIds = [];
    this.#accumulated.clear();
  }

  async #onTimeAdvance(worldTime, dt) {
    if (!game.user.isGM) return;
    if (dt <= 0) return;

    const configs = this.#store.getEnabledNeedConfigs();
    const decayNeeds = configs.filter(c => c.decay?.enabled && c.decay.rate > 0 && c.decay.interval > 0);
    if (decayNeeds.length === 0) return;

    const entities = this.#store.getTrackedEntityIds();

    for (const needConfig of decayNeeds) {
      const interval = needConfig.decay.interval;
      const rate = needConfig.decay.rate;

      // Accumulate time for this need
      const prev = this.#accumulated.get(needConfig.id) || 0;
      const total = prev + dt;
      const ticks = Math.floor(total / interval);
      this.#accumulated.set(needConfig.id, total % interval);

      if (ticks <= 0) continue;

      const decayAmount = rate * ticks;
      const sceneMod = this.#needsEngine.getSceneDecayMultiplier(needConfig.id);
      const finalAmount = Math.round(decayAmount * sceneMod);
      if (finalAmount <= 0) continue;

      for (const entityId of entities) {
        await this.#needsEngine.stressNeed(entityId, needConfig.id, finalAmount, {
          skipModifier: true,
          skipSceneModifier: true,
          source: 'decay',
        });
      }
    }

    this.#lastWorldTime = worldTime;
    this.#eventBus.emit(Events.TIME_DECAY_TICK, { worldTime, dt });
  }

  #onSimpleCalendarChange(data) {
    // Simple Calendar provides more granular time tracking
    // For now, we rely on updateWorldTime which Simple Calendar also triggers
    // This hook is available for future enhancement
  }
}

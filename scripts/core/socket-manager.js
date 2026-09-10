import { MODULE_ID, Events } from '../constants.js';

// Actor documents and world settings are the authority. A module socket payload
// has no authenticated sender, so it must never supply state or execute effects.
export class SocketManager {
  #eventBus;
  #initialized = false;

  constructor(eventBus) { this.#eventBus = eventBus; }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;
    Hooks.on('mortalNeeds.settingsChanged', ({ key }) => {
      if (key !== 'broadcastState') return;
      const state = game.settings.get(MODULE_ID, 'broadcastState') || {};
      const payload = game.modules.get(MODULE_ID)?.api?.broadcast?._buildPayload();
      if (!payload) return;
      if (state.flash) Hooks.callAll('mortalNeeds.broadcast.flash', payload);
      else Hooks.callAll(`mortalNeeds.broadcast.${state.visible ? 'show' : 'hide'}`, payload);
    });
    this.#eventBus.on(Events.ACTORS_REFRESHED, () => this.refreshBroadcast());
    this.#eventBus.on(Events.CONFIG_CHANGED, () => this.refreshBroadcast());
    for (const event of [Events.NEED_SET, Events.NEED_STRESSED, Events.NEED_RELIEVED]) {
      this.#eventBus.on(event, () => this.refreshBroadcast());
    }
  }

  refreshBroadcast() {
    if (!game.settings.get(MODULE_ID, 'broadcastState')?.visible) return;
    const payload = game.modules.get(MODULE_ID)?.api?.broadcast?._buildPayload();
    if (payload) Hooks.callAll('mortalNeeds.broadcast.update', payload);
  }

  // Retained for existing integrations. Values already arrive through Foundry.
  broadcastFullSync() { this.#eventBus.emit(Events.ACTORS_REFRESHED, {}); }
  requestSync() { this.#eventBus.emit(Events.ACTORS_REFRESHED, {}); }
}

import { MODULE_ID, Events } from '../constants.js';

export class SocketManager {
  #eventBus;
  #store;
  #initialized = false;

  constructor(eventBus, store) {
    this.#eventBus = eventBus;
    this.#store = store;
  }

  initialize() {
    if (this.#initialized) return;
    this.#initialized = true;

    // Listen for remote messages
    game.socket.on(`module.${MODULE_ID}`, this.#handleMessage.bind(this));

    // Subscribe to local state changes (GM broadcasts)
    if (game.user.isGM) {
      this.#eventBus.on(Events.NEED_STRESSED, (data) => this.#broadcast('updateNeed', data));
      this.#eventBus.on(Events.NEED_RELIEVED, (data) => this.#broadcast('updateNeed', data));
      this.#eventBus.on(Events.NEED_SET, (data) => this.#broadcast('updateNeed', data));
      this.#eventBus.on(Events.NEED_RESET, (data) => this.#broadcast('updateNeed', data));
      this.#eventBus.on(Events.CONFIG_CHANGED, (data) => this.#broadcast('configChanged', data));
      this.#eventBus.on(Events.NEED_ENABLED, (data) => this.#broadcast('needToggled', data));
      this.#eventBus.on(Events.NEED_DISABLED, (data) => this.#broadcast('needToggled', data));
      this.#eventBus.on(Events.ACTOR_TRACKED, (data) => this.#broadcast('actorTracked', data));
      this.#eventBus.on(Events.ACTOR_UNTRACKED, (data) => this.#broadcast('actorUntracked', data));
    }
  }

  #broadcast(action, payload) {
    if (!game.user.isGM) return;
    game.socket.emit(`module.${MODULE_ID}`, {
      action,
      senderId: game.user.id,
      ...payload,
    });
  }

  #handleMessage(data) {
    if (data.senderId === game.user.id) return;

    switch (data.action) {
      case 'updateNeed':
        this.#store.setNeedValue(
          data.entityId, data.needId, data.value, 'socket'
        );
        // Re-emit locally for UI updates (without triggering another broadcast)
        this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
        break;

      case 'fullSync':
        this.#store.syncFromRemote(data.state);
        break;

      case 'configChanged':
      case 'needToggled':
        // Reload config from settings and refresh
        this.#eventBus.emit(Events.CONFIG_CHANGED, data);
        break;

      case 'actorTracked':
      case 'actorUntracked':
        this.#eventBus.emit(Events.ACTORS_REFRESHED, {});
        break;

      case 'requestSync':
        if (game.user.isGM) {
          this.broadcastFullSync();
        }
        break;

      // Broadcast display actions (forwarded to Hooks for HUD/Flash)
      case 'showNeeds':
        Hooks.callAll('mortalNeeds.broadcast.show', data);
        break;
      case 'updateNeeds':
        Hooks.callAll('mortalNeeds.broadcast.update', data);
        break;
      case 'hideNeeds':
        Hooks.callAll('mortalNeeds.broadcast.hide', data);
        break;
      case 'flashNeeds':
        Hooks.callAll('mortalNeeds.broadcast.flash', data);
        break;
    }
  }

  broadcastFullSync() {
    if (!game.user.isGM) return;
    this.#broadcast('fullSync', { state: this.#store.getSerializableState() });
  }

  requestSync() {
    if (game.user.isGM) return;
    game.socket.emit(`module.${MODULE_ID}`, {
      action: 'requestSync',
      senderId: game.user.id,
    });
  }
}

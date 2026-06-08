import { MODULE_ID, Events } from '../constants.js';
import { isGMOnlyNeed } from './need-visibility.js';

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
      this.#eventBus.on(Events.NEED_STRESSED, (data) => this.#broadcastNeedUpdate(data));
      this.#eventBus.on(Events.NEED_RELIEVED, (data) => this.#broadcastNeedUpdate(data));
      this.#eventBus.on(Events.NEED_SET, (data) => this.#broadcastNeedUpdate(data));
      this.#eventBus.on(Events.NEED_RESET, (data) => this.#broadcastNeedUpdate(data));
      this.#eventBus.on(Events.CONFIG_CHANGED, (data) => this.#broadcastConfigChanged(data));
      this.#eventBus.on(Events.NEED_ENABLED, (data) => this.#broadcastNeedToggle(data));
      this.#eventBus.on(Events.NEED_DISABLED, (data) => this.#broadcastNeedToggle(data));
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

  #broadcastNeedUpdate(data) {
    if (isGMOnlyNeed(this.#store.getNeedConfig(data?.needId))) return;
    this.#broadcast('updateNeed', data);
  }

  #broadcastNeedToggle(data) {
    if (isGMOnlyNeed(this.#store.getNeedConfig(data?.needId))) return;
    this.#broadcast('needToggled', data);
  }

  #broadcastConfigChanged(data) {
    const payload = isGMOnlyNeed(this.#store.getNeedConfig(data?.needId))
      ? { source: data?.source }
      : data;
    this.#broadcast('configChanged', payload);
    this.broadcastFullSync();
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
        this.#store.syncFromRemote(data.state, { replace: true });
        break;

      case 'configChanged':
      case 'needToggled':
        this.#reloadConfigFromSettings();
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
    this.#broadcast('fullSync', { state: this.#store.getSerializableState({ includeGMOnly: false }) });
  }

  #reloadConfigFromSettings() {
    const configs = game.settings.get(MODULE_ID, 'needsConfig');
    if (Array.isArray(configs) && configs.length > 0) {
      this.#store.setNeedConfigs(configs);
    }
  }

  requestSync() {
    if (game.user.isGM) return;
    game.socket.emit(`module.${MODULE_ID}`, {
      action: 'requestSync',
      senderId: game.user.id,
    });
  }
}

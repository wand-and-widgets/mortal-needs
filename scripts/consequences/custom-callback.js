import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class CustomCallbackConsequence extends ConsequenceType {
  static TYPE = 'custom-callback';
  static LABEL = 'MORTAL_NEEDS.Consequences.CustomCallback';
  static ICON = 'fas fa-code';
  static CONFIG_SCHEMA = [
    { key: 'callbackId', type: 'text', label: 'MORTAL_NEEDS.Consequences.CallbackId' },
  ];

  static #callbacks = new Map();

  static registerCallback(id, { apply, remove, isActive, description }) {
    CustomCallbackConsequence.#callbacks.set(id, { apply, remove, isActive, description });
  }

  static unregisterCallback(id) {
    CustomCallbackConsequence.#callbacks.delete(id);
  }

  async apply(actor, needId, config) {
    const cb = CustomCallbackConsequence.#callbacks.get(config.callbackId);
    if (cb?.apply) {
      try {
        return await cb.apply(actor, needId, config);
      } catch (err) {
        console.error(`Mortal Needs | Custom callback "${config.callbackId}" apply error:`, err);
        return { success: false, reason: 'callback-error' };
      }
    }
    return { success: false, reason: 'callback-not-found' };
  }

  async remove(actor, needId, config) {
    const cb = CustomCallbackConsequence.#callbacks.get(config.callbackId);
    if (cb?.remove) {
      try {
        return await cb.remove(actor, needId, config);
      } catch (err) {
        console.error(`Mortal Needs | Custom callback "${config.callbackId}" remove error:`, err);
        return false;
      }
    }
    return false;
  }

  async isActive(actor, needId, config) {
    const cb = CustomCallbackConsequence.#callbacks.get(config.callbackId);
    if (cb?.isActive) {
      try {
        return await cb.isActive(actor, needId, config);
      } catch (err) {
        return false;
      }
    }
    return false;
  }

  getDescription(config) {
    const cb = CustomCallbackConsequence.#callbacks.get(config.callbackId);
    if (cb?.description) {
      return typeof cb.description === 'function' ? cb.description(config) : cb.description;
    }
    return `Callback: ${config.callbackId}`;
  }
}

registerConsequenceType(CustomCallbackConsequence.TYPE, CustomCallbackConsequence);

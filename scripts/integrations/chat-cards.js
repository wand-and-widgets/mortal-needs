import { MODULE_ID, MODULE_TITLE, Events, mnRenderTemplate } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

/**
 * Chat card system for Mortal Needs.
 * Sends styled consequence and summary notifications to chat.
 */
export class ChatCards {
  #eventBus;
  #store;

  constructor(eventBus, store) {
    this.#eventBus = eventBus;
    this.#store = store;

    // Listen for consequence events
    this.#eventBus.on(Events.CONSEQUENCE_APPLIED, this.#onConsequenceApplied.bind(this));
    this.#eventBus.on(Events.THRESHOLD_CRITICAL, this.#onThresholdCritical.bind(this));
  }

  async #onConsequenceApplied({ entityId, needId, consequenceType, config, result }) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, 'showConsequenceChat')) return;

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return;

    const needConfig = this.#store.getNeedConfig(needId);
    if (!needConfig) return;

    const needState = this.#store.getActorNeedState(entityId, needId);
    const value = needState?.value ?? 0;
    const max = needState?.max ?? 100;
    const percentage = NeedsEngine.getPercentage(value, max);
    const severity = NeedsEngine.getSeverity(percentage);

    const templateData = {
      actorName: entityInfo.name,
      actorImg: entityInfo.img,
      needName: game.i18n.localize(needConfig.label),
      needIcon: needConfig.icon,
      value, max, percentage, severity,
      severityLabel: `MORTAL_NEEDS.Severity.${severity.charAt(0).toUpperCase() + severity.slice(1)}`,
      consequenceDescription: result?.description || consequenceType,
      flavor: null, // FlavorEngine handles flavor messages separately
    };

    const content = await mnRenderTemplate(
      `modules/${MODULE_ID}/templates/chat/effect-card.hbs`,
      templateData,
    );

    await ChatMessage.create({
      content,
      speaker: { alias: MODULE_TITLE },
      whisper: game.users.filter(u => u.isGM).map(u => u.id),
      flags: { [MODULE_ID]: { type: 'consequence', entityId, needId } },
    });
  }

  async #onThresholdCritical({ entityId, needId, value, max, percentage, sustained }) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE_ID, 'notifyOnCritical')) return;
    if (sustained) return; // Only notify on first crossing

    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return;

    const needConfig = this.#store.getNeedConfig(needId);
    if (!needConfig) return;

    const severity = NeedsEngine.getSeverity(percentage);

    const templateData = {
      actorName: entityInfo.name,
      actorImg: entityInfo.img,
      needName: game.i18n.localize(needConfig.label),
      needIcon: needConfig.icon,
      value, max, percentage, severity,
      severityLabel: `MORTAL_NEEDS.Severity.${severity.charAt(0).toUpperCase() + severity.slice(1)}`,
      consequenceDescription: null,
      flavor: null, // FlavorEngine handles flavor messages separately
    };

    const content = await mnRenderTemplate(
      `modules/${MODULE_ID}/templates/chat/effect-card.hbs`,
      templateData,
    );

    await ChatMessage.create({
      content,
      speaker: { alias: MODULE_TITLE },
      flags: { [MODULE_ID]: { type: 'threshold-critical', entityId, needId } },
    });
  }

  /**
   * Send a summary card for an entity showing all its needs.
   */
  async sendSummary(entityId) {
    const entityInfo = this.#store.getTrackedEntityInfo(entityId);
    if (!entityInfo) return;

    const enabledConfigs = this.#store.getEnabledNeedConfigs();
    const needs = enabledConfigs.map(config => {
      const state = this.#store.getActorNeedState(entityId, config.id);
      const value = state?.value ?? 0;
      const max = state?.max ?? config.max ?? 100;
      const percentage = NeedsEngine.getPercentage(value, max);
      const severity = NeedsEngine.getSeverity(percentage);

      return {
        id: config.id,
        label: config.label,
        icon: config.icon,
        value, max, percentage, severity,
      };
    });

    const templateData = {
      actorName: entityInfo.name,
      actorImg: entityInfo.img,
      needs,
    };

    const content = await mnRenderTemplate(
      `modules/${MODULE_ID}/templates/chat/summary-card.hbs`,
      templateData,
    );

    await ChatMessage.create({
      content,
      speaker: { alias: MODULE_TITLE },
      flags: { [MODULE_ID]: { type: 'summary', entityId } },
    });
  }

}

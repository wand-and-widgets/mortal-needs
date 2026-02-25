import { MODULE_ID } from '../constants.js';
import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class ChatNotifyConsequence extends ConsequenceType {
  static TYPE = 'chat-notify';
  static LABEL = 'MORTAL_NEEDS.Consequences.ChatNotify';
  static ICON = 'fas fa-comment-alt';
  static CONFIG_SCHEMA = [
    { key: 'message', type: 'text', label: 'MORTAL_NEEDS.Consequences.Message' },
    { key: 'whisperGM', type: 'boolean', label: 'MORTAL_NEEDS.Consequences.WhisperGM', default: false },
  ];

  async apply(actor, needId, config) {
    const message = config.message || `${needId} consequence triggered`;

    const chatData = {
      content: `<div class="mn-chat-notify"><p>${message}</p></div>`,
      speaker: actor ? ChatMessage.getSpeaker({ actor }) : { alias: 'Mortal Needs' },
      flags: { [MODULE_ID]: { type: 'consequence-notify', needId } },
    };

    if (config.whisperGM) {
      chatData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
    }

    await ChatMessage.create(chatData);
    return { success: true };
  }

  async remove() {
    // Chat messages are not reversible
    return false;
  }

  async isActive() {
    // A chat notification is a one-shot action, never "active"
    return false;
  }

  getDescription(config) {
    return config.message || 'Send chat notification';
  }
}

registerConsequenceType(ChatNotifyConsequence.TYPE, ChatNotifyConsequence);

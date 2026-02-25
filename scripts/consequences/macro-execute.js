import { ConsequenceType, registerConsequenceType } from './consequence-type.js';

export class MacroExecuteConsequence extends ConsequenceType {
  static TYPE = 'macro-execute';
  static LABEL = 'MORTAL_NEEDS.Consequences.MacroExecute';
  static ICON = 'fas fa-terminal';
  static CONFIG_SCHEMA = [
    { key: 'macroId', type: 'select', label: 'MORTAL_NEEDS.Consequences.MacroSelect', options: 'game:macros' },
  ];

  async apply(actor, needId, config) {
    const macro = game.macros.get(config.macroId);
    if (!macro) return { success: false, reason: 'macro-not-found' };

    try {
      await macro.execute({
        actor,
        needId,
        speaker: actor ? { alias: actor.name } : undefined,
      });
      return { success: true, macroId: config.macroId };
    } catch (err) {
      console.error(`Mortal Needs | Macro "${macro.name}" execution failed:`, err);
      return { success: false, reason: 'execution-error' };
    }
  }

  async remove(actor, needId, config) {
    return false;
  }

  getDescription(config) {
    const macro = game.macros?.get(config.macroId);
    return macro ? `Macro: ${macro.name}` : 'Macro: (unknown)';
  }
}

registerConsequenceType(MacroExecuteConsequence.TYPE, MacroExecuteConsequence);

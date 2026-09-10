import { MODULE_ID } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

export function conditionView(config, state) {
  const value = state?.value ?? config.default ?? 0;
  const max = state?.max ?? config.max ?? 100;
  const stress = NeedsEngine.getStressPercentage(value, max, config);
  const severity = NeedsEngine.getSeverity(stress);
  const key = `MORTAL_NEEDS.Conditions.${config.id}.${severity}`;
  const specific = game.i18n.localize(key);
  const fallback = `MORTAL_NEEDS.Severity.${severity[0].toUpperCase() + severity.slice(1)}`;
  return { value, min: config.min ?? 0, max, stress, severity, label: specific === key ? game.i18n.localize(fallback) : specific };
}

export function recoveryDescription(config) {
  const mode = game.settings.get(MODULE_ID, 'consequenceRemovalMode');
  const key = mode === 'immediate' ? 'AutomaticRecovery' : mode === 'ask_gm' ? 'AskRecovery' : 'ManualRecovery';
  return game.i18n.localize(`MORTAL_NEEDS.Dock.${key}`);
}

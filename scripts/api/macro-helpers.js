import { MODULE_ID } from '../constants.js';

/**
 * Convenience functions for use in Foundry macros.
 * These wrap the public API with simpler signatures and user-facing notifications.
 */

export function getMortalNeedsAPI() {
  return game.modules.get(MODULE_ID)?.api;
}

/**
 * Stress a need for the selected token's actor.
 * Usage in a macro: MortalNeeds.macro.stressSelected('hunger', 15)
 */
export async function stressSelected(needId, amount) {
  const api = getMortalNeedsAPI();
  if (!api) return;

  const tokens = canvas.tokens?.controlled || [];
  if (tokens.length === 0) {
    ui.notifications.warn('MORTAL_NEEDS.Notifications.NoTokenSelected', { localize: true });
    return;
  }

  for (const token of tokens) {
    const actorId = token.actor?.id;
    if (actorId && api.actors.isTracked(actorId)) {
      await api.needs.stress(actorId, needId, amount);
    }
  }
}

/**
 * Relieve a need for the selected token's actor.
 */
export async function relieveSelected(needId, amount) {
  const api = getMortalNeedsAPI();
  if (!api) return;

  const tokens = canvas.tokens?.controlled || [];
  if (tokens.length === 0) {
    ui.notifications.warn('MORTAL_NEEDS.Notifications.NoTokenSelected', { localize: true });
    return;
  }

  for (const token of tokens) {
    const actorId = token.actor?.id;
    if (actorId && api.actors.isTracked(actorId)) {
      await api.needs.relieve(actorId, needId, amount);
    }
  }
}

/**
 * Stress all tracked entities for a specific need.
 */
export async function stressParty(needId, amount) {
  const api = getMortalNeedsAPI();
  if (!api) return;
  await api.batch.stressAll(needId, amount);
}

/**
 * Relieve all tracked entities for a specific need.
 */
export async function relieveParty(needId, amount) {
  const api = getMortalNeedsAPI();
  if (!api) return;
  await api.batch.relieveAll(needId, amount);
}

/**
 * Full rest: reset all needs for all tracked entities.
 */
export async function longRest() {
  const api = getMortalNeedsAPI();
  if (!api) return;
  await api.macro.longRest();
  ui.notifications.info('MORTAL_NEEDS.Notifications.LongRestComplete', { localize: true });
}

/**
 * Short rest: relieve a percentage of all needs.
 */
export async function shortRest(reliefPercentage = 25) {
  const api = getMortalNeedsAPI();
  if (!api) return;
  await api.macro.shortRest(reliefPercentage);
  ui.notifications.info('MORTAL_NEEDS.Notifications.ShortRestComplete', { localize: true });
}

/**
 * Set a scene modifier for a need.
 * Usage: MortalNeeds.macro.setSceneModifier('thirst', { stressMultiplier: 2.0, decayMultiplier: 1.5 })
 */
export async function setSceneModifier(needId, modifiers) {
  const api = getMortalNeedsAPI();
  if (!api) return;
  await api.macro.setSceneModifier(needId, modifiers);
  ui.notifications.info('MORTAL_NEEDS.Notifications.SceneModifierSet', { localize: true });
}

/**
 * Quick dialog to stress a need for selected token.
 */
export async function quickStressDialog() {
  const api = getMortalNeedsAPI();
  if (!api) return;

  const needs = api.config.getEnabledNeeds();
  if (needs.length === 0) {
    ui.notifications.warn('MORTAL_NEEDS.Notifications.NoNeedsEnabled', { localize: true });
    return;
  }

  const tokens = canvas.tokens?.controlled || [];
  if (tokens.length === 0) {
    ui.notifications.warn('MORTAL_NEEDS.Notifications.NoTokenSelected', { localize: true });
    return;
  }

  const options = needs.map(n =>
    `<option value="${n.id}">${game.i18n.localize(n.label)}</option>`
  ).join('');

  const content = `
    <form>
      <div class="form-group">
        <label>${game.i18n.localize('MORTAL_NEEDS.Dialogs.SelectNeed')}</label>
        <select name="needId">${options}</select>
      </div>
      <div class="form-group">
        <label>${game.i18n.localize('MORTAL_NEEDS.Dialogs.Amount')}</label>
        <input type="number" name="amount" value="10" min="1" max="100">
      </div>
    </form>
  `;

  const result = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize('MORTAL_NEEDS.Dialogs.QuickStressTitle') },
    content,
    ok: {
      label: game.i18n.localize('MORTAL_NEEDS.Dialogs.Apply'),
      callback: (event, button, dialog) => {
        const form = button.form;
        return {
          needId: form.elements.needId.value,
          amount: parseInt(form.elements.amount.value) || 10,
        };
      },
    },
  });

  if (result) {
    for (const token of tokens) {
      const actorId = token.actor?.id;
      if (actorId && api.actors.isTracked(actorId)) {
        await api.needs.stress(actorId, result.needId, result.amount);
      }
    }
  }
}

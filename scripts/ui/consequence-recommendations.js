import { MODULE_ID, Events } from '../constants.js';
import { escapeHTML, normalizeAttributePath } from '../core/consequence-identity.js';
import { getConsequenceDescription, getConsequenceType } from '../consequences/consequence-type.js';

const pending = new WeakMap();
const localize = key => game.i18n.localize(`MORTAL_NEEDS.Recommendations.${key}`);

function signature(rule) {
  const config = { ...(rule.config || {}) };
  for (const key of ['path', 'changeKey']) if (config[key]) config[key] = normalizeAttributePath(config[key]);
  for (const key of ['amount', 'changeMode', 'changeValue']) {
    if (config[key] !== undefined && config[key] !== '' && Number.isFinite(Number(config[key]))) config[key] = Number(config[key]);
  }
  // An existing rule for this attribute remains the place to edit its strength.
  if (rule.type === 'attribute-modify') delete config.amount;
  return JSON.stringify([rule.type, Object.entries(config).sort(([a], [b]) => a.localeCompare(b))]);
}

export function recommendationViews(need) {
  const api = game.modules.get(MODULE_ID)?.api;
  return (api?.system?.effectSuggestions?.[need?.id] || [])
    .map((suggestion, index) => {
      const existingIndex = (need.consequences || []).findIndex(rule => signature(rule) === signature(suggestion));
      const rule = existingIndex < 0 ? suggestion : need.consequences[existingIndex];
      return {
        index, existingIndex, suggestion, description: getConsequenceDescription(rule.type, rule.config || {}),
        threshold: rule.threshold ?? 100, ticks: rule.ticks ?? 3, reversible: rule.reversible !== false,
      };
    });
}

export function renderRecommendations(need) {
  const views = recommendationViews(need);
  if (!views.length) return '';
  return `<section class="mn-recommendations" aria-label="${escapeHTML(localize('Title'))}">
    <h4>${escapeHTML(localize('Title'))}</h4>
    ${views.map(view => `<article class="mn-recommendation" data-need-id="${escapeHTML(need.id)}" data-suggestion-index="${view.index}">
      <strong>${escapeHTML(view.description)}</strong>
      <span>${escapeHTML(game.i18n.format('MORTAL_NEEDS.Recommendations.Trigger', { threshold: view.threshold }))}</span>
      <small>${escapeHTML(localize(view.reversible ? 'Recovery' : 'ManualRecovery'))}</small>
      ${view.existingIndex >= 0 ? `<span class="mn-recommendation__saved">${escapeHTML(localize('Configured'))}</span>` : ''}
      <button type="button" class="mn-btn ${view.existingIndex >= 0 ? 'mn-btn--secondary' : 'mn-btn--primary'} mn-btn--sm"
        data-action="${view.existingIndex >= 0 ? 'edit-recommendation' : 'apply-suggestion'}">${escapeHTML(localize(view.existingIndex >= 0 ? 'Edit' : 'Use'))}</button>
    </article>`).join('')}
    <p>${escapeHTML(localize(views.every(view => view.existingIndex >= 0) ? 'SavedHint' : 'Hint'))}</p>
  </section>`;
}

/** Serialize additions across open configuration windows; save before changing local state. */
export async function applyRecommendation({ store, configManager, eventBus, needId, index }) {
  if (!game.user.isGM) return { status: 'unavailable' };
  const previous = pending.get(store) || Promise.resolve();
  const task = previous.catch(() => {}).then(async () => {
    const need = store.getNeedConfig(needId);
    if (!need) return { status: 'unavailable' };
    const view = recommendationViews(need).find(item => item.index === index);
    if (!view || !getConsequenceType(view.suggestion.type)) return { status: 'unavailable' };
    if (view.existingIndex >= 0) return { status: 'exists', index: view.existingIndex };
    const rule = {
      id: foundry.utils.randomID?.(16) || `mn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      type: view.suggestion.type, threshold: view.threshold, ticks: view.ticks, reversible: view.reversible,
      config: structuredClone(view.suggestion.config || {}),
    };
    const consequences = [...(need.consequences || []), rule];
    const configs = store.getAllNeedConfigs().map(config => config.id === needId ? { ...config, consequences } : config);
    await configManager.saveNeedsConfig(configs);
    store.setNeedConfigs(configs);
    eventBus.emit(Events.CONFIG_CHANGED, { source: 'consequence-add', needId });
    return { status: 'added', index: consequences.length - 1 };
  });
  pending.set(store, task);
  try { return await task; }
  finally { if (pending.get(store) === task) pending.delete(store); }
}

export const NeedVisibility = Object.freeze({
  ALL: 'all',
  GM: 'gm',
});

export const NeedDisplayRule = Object.freeze({
  ALWAYS: 'always',
  ABOVE_ZERO: 'aboveZero',
});

export function normalizeNeedVisibility(config = {}) {
  config = config || {};
  if (config.visibility === NeedVisibility.GM || config.gmOnly === true) return NeedVisibility.GM;
  return NeedVisibility.ALL;
}

export function normalizeNeedDisplayRule(config = {}) {
  config = config || {};
  return config.showWhen === NeedDisplayRule.ABOVE_ZERO
    ? NeedDisplayRule.ABOVE_ZERO
    : NeedDisplayRule.ALWAYS;
}

export function isGMOnlyNeed(config = {}) {
  return normalizeNeedVisibility(config) === NeedVisibility.GM;
}

export function isNeedVisibleToUser(config = {}, user = getCurrentUser()) {
  if (!config) return false;
  if (isGMOnlyNeed(config) && !user?.isGM) return false;
  return true;
}

export function shouldDisplayNeed(config = {}, state = null, options = {}) {
  const user = options.user ?? getCurrentUser();
  if (!options.includeDisabled && config.enabled === false) return false;
  if (!isNeedVisibleToUser(config, user)) return false;

  if (normalizeNeedDisplayRule(config) === NeedDisplayRule.ABOVE_ZERO) {
    const value = state && typeof state === 'object' && !Array.isArray(state) ? state.value : state;
    return normalizeNeedValue(value ?? config.default, 0) > 0;
  }

  return true;
}

export function filterNeedsForUser(configs = [], user = getCurrentUser()) {
  return configs.filter(config => isNeedVisibleToUser(config, user));
}

export function filterDisplayNeedsForEntity(configs = [], entityNeeds = {}, options = {}) {
  return configs.filter(config => shouldDisplayNeed(config, entityNeeds?.[config.id], options));
}

function normalizeNeedValue(value, fallback = 0) {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value.value
    : value;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : fallback;
}

function getCurrentUser() {
  return globalThis.game?.user;
}

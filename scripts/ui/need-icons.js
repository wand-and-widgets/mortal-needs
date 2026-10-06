import { MODULE_ID, DEFAULT_NEEDS } from '../constants.js';
import { escapeHTML } from '../core/consequence-identity.js';

export const NEED_COLORS = Object.freeze({
  hunger: '#e8b24e', thirst: '#65b8dc', cold: '#b2e2de', fear: '#b299d1', comfort: '#efb85f',
  heat: '#ed8356', exhaustion: '#b7aaa1', sanity: '#a28acb', morale: '#d9c376', pain: '#e4736d',
  radiation: '#b9cf65', corruption: '#ac75ba', fatigue: '#abafbd', environmental: '#8ab298',
});

export function needIconPath(needId) {
  return `modules/${MODULE_ID}/assets/icons/${Object.hasOwn(NEED_COLORS, needId) ? needId : 'seal'}.svg`;
}

export function needIcon(config, className = 'mn-need-icon') {
  className = escapeHTML(className);
  const builtin = DEFAULT_NEEDS.find(need => need.id === config?.id);
  // A built-in need can have custom rules without having custom artwork.
  if (config?.icon && (!builtin || config.icon !== builtin.icon || config.iconType === 'img' || config.iconType === 'image')) {
    if (['image', 'img'].includes(config.iconType) && isSafeImagePath(config.icon)) {
      return `<img class="${className}" src="${escapeHTML(config.icon)}" alt="" aria-hidden="true">`;
    }
    if (/^(?:(?:fa[srlbd]?|fa-[a-z0-9-]+)\s*)+$/.test(config.icon)) {
      return `<i class="${className} fas ${escapeHTML(config.icon)}" aria-hidden="true"></i>`;
    }
  }
  return `<img class="${className}" src="${needIconPath(config?.id)}" alt="" aria-hidden="true">`;
}

export function isSafeImagePath(value) {
  return typeof value === 'string' && /^(?:https?:\/\/|(?:modules|systems|worlds|icons|assets)\/|[^:/\\]+\/)/i.test(value)
    && !/[<>"'\x00-\x1f]/.test(value);
}

export function needColor(config) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(config?.color || '') ? config.color : NEED_COLORS[config?.id] || '#c89a54';
}

function stableStringify(value) {
  if (!value || typeof value !== 'object') return String(value ?? '');
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const ordered = {};
  for (const key of Object.keys(value).sort()) ordered[key] = stableStringify(value[key]);
  return JSON.stringify(ordered);
}

// Match the v2 identity before storing it, so existing effects remain removable.
export function consequenceId(needId, consequence) {
  let hash = 2166136261;
  const value = stableStringify(consequence.config || {});
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const rawThreshold = Number(consequence.threshold);
  const threshold = Number.isFinite(rawThreshold) ? Math.min(100, Math.max(0, rawThreshold)) : 100;
  return String(consequence.id || `${needId}_${consequence.type}_${threshold}_${(hash >>> 0).toString(36)}`)
    .replace(/[^A-Za-z0-9_-]/g, '_');
}

export function normalizeAttributePath(path) {
  if (typeof path !== 'string') return null;
  const parts = path.trim().split('.');
  if (!parts.length || parts.some(p => !/^[A-Za-z0-9_-]+$/.test(p)
    || ['__proto__', 'prototype', 'constructor'].includes(p))) return null;
  const normalized = parts.join('.');
  return normalized.startsWith('system.') ? normalized : `system.${normalized}`;
}

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

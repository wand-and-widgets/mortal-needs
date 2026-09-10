import { normalizeAttributePath } from './consequence-identity.js';

/** Resolve the same field name for configuration, chat, and applied consequences. */
export function attributeLabel(path, adapter) {
  const normalized = normalizeAttributePath(path);
  const attribute = (adapter?.getAvailableAttributes?.() || [])
    .find(item => normalizeAttributePath(item.key) === normalized);
  if (attribute?.label) {
    const label = game.i18n.localize(attribute.label);
    if (label !== attribute.label || !label.includes('.')) return label;
  }
  const known = {
    'system.attributes.exhaustion': 'MORTAL_NEEDS.Needs.Exhaustion',
    'system.attributes.hp.value': 'MORTAL_NEEDS.Dock.CurrentHP',
    'system.attributes.hp.max': 'MORTAL_NEEDS.Dock.MaximumHP',
    'system.attributes.movement.walk': 'MORTAL_NEEDS.Dock.WalkingSpeed',
    'system.fatigue.value': 'MORTAL_NEEDS.Needs.Fatigue',
    'system.status.fatigue.value': 'MORTAL_NEEDS.Needs.Fatigue',
  };
  return game.i18n.localize(known[normalized] || 'MORTAL_NEEDS.Consequences.CustomAttribute');
}

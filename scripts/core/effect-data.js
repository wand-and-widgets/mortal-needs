const TYPES = { 2: 'add', 3: 'downgrade', 4: 'upgrade', 5: 'override' };

export function effectChanges(effect) {
  return effect.system?.changes ?? effect.changes ?? [];
}

export function effectChangeMode(change) {
  return change?.type ? Number(Object.keys(TYPES).find(key => TYPES[key] === change.type)) : Number(change?.mode);
}

export function effectChangeData(key, mode, value) {
  const generation = Number(game.release?.generation ?? String(game.version || '').split('.')[0]);
  if (generation >= 14) {
    const numeric = Number(value);
    return { system: { changes: [{ key, type: TYPES[mode], value: String(value).trim() && Number.isFinite(numeric) ? numeric : value }] } };
  }
  return { changes: [{ key, mode, value: String(value) }] };
}

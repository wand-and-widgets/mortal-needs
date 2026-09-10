import { MODULE_ID, EntitySource } from '../constants.js';
import { isNeedVisibleToUser } from './need-visibility.js';

export function isResponsibleGM() {
  const user = globalThis.game?.user;
  if (!user?.isGM) return false;
  const users = game.users;
  const responsible = users?.activeGM ?? [...(users ?? [])]
    .filter(u => u.active && u.isGM).sort((a, b) => a.id.localeCompare(b.id))[0];
  return responsible ? responsible.id === user.id : false;
}

export function resolveEntityActor(entityId, info) {
  if (!info) return null;
  return game.actors?.get(info.source === EntitySource.EXALTED_SCENES ? info.linkedActorId : entityId) ?? null;
}

export function ownsEntity(entityId, info, user = globalThis.game?.user) {
  const actor = resolveEntityActor(entityId, info);
  return !!actor && !!user && (actor.testUserPermission?.(user, 'OWNER') ?? (user.id === game.user?.id && actor.isOwner));
}

export function canViewEntity(entityId, info, user = globalThis.game?.user) {
  if (!user) return false;
  if (user.isGM) return true;
  const mode = game.settings.get(MODULE_ID, 'playerVisibility');
  if (mode === 'none') return false;
  return mode === 'all' || ownsEntity(entityId, info, user);
}

export function canEditNeed(entityId, needId, store, user = globalThis.game?.user) {
  const info = store.getTrackedEntityInfo(entityId);
  const config = store.getNeedConfig(needId);
  if (!user || !info || !config) return false;
  if (user.isGM) return true;
  return !!game.settings.get(MODULE_ID, 'playerControl')
    && info.source === EntitySource.ACTOR
    && isNeedVisibleToUser(config, user)
    && canViewEntity(entityId, info, user)
    && ownsEntity(entityId, info, user);
}

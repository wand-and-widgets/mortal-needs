import { SystemAdapter } from './system-adapter.js';

export class Dnd5eAdapter extends SystemAdapter {
  static get systemId() { return 'dnd5e'; }

  getCapabilities() {
    return {
      hasExhaustion: true,
      hasConditions: true,
      hasActiveEffects: true,
      hasDamageTypes: true,
      supportsAttributeModifiers: true,
    };
  }

  getAvailableAttributes() {
    const abilities = [
      { key: 'abilities.str.value', label: 'DND5E.AbilityStr', group: 'abilities' },
      { key: 'abilities.dex.value', label: 'DND5E.AbilityDex', group: 'abilities' },
      { key: 'abilities.con.value', label: 'DND5E.AbilityCon', group: 'abilities' },
      { key: 'abilities.int.value', label: 'DND5E.AbilityInt', group: 'abilities' },
      { key: 'abilities.wis.value', label: 'DND5E.AbilityWis', group: 'abilities' },
      { key: 'abilities.cha.value', label: 'DND5E.AbilityCha', group: 'abilities' },
    ];

    const skills = [
      { key: 'skills.acr.total', label: 'DND5E.SkillAcr', group: 'skills' },
      { key: 'skills.ani.total', label: 'DND5E.SkillAni', group: 'skills' },
      { key: 'skills.arc.total', label: 'DND5E.SkillArc', group: 'skills' },
      { key: 'skills.ath.total', label: 'DND5E.SkillAth', group: 'skills' },
      { key: 'skills.dec.total', label: 'DND5E.SkillDec', group: 'skills' },
      { key: 'skills.his.total', label: 'DND5E.SkillHis', group: 'skills' },
      { key: 'skills.ins.total', label: 'DND5E.SkillIns', group: 'skills' },
      { key: 'skills.itm.total', label: 'DND5E.SkillItm', group: 'skills' },
      { key: 'skills.inv.total', label: 'DND5E.SkillInv', group: 'skills' },
      { key: 'skills.med.total', label: 'DND5E.SkillMed', group: 'skills' },
      { key: 'skills.nat.total', label: 'DND5E.SkillNat', group: 'skills' },
      { key: 'skills.prc.total', label: 'DND5E.SkillPrc', group: 'skills' },
      { key: 'skills.prf.total', label: 'DND5E.SkillPrf', group: 'skills' },
      { key: 'skills.per.total', label: 'DND5E.SkillPer', group: 'skills' },
      { key: 'skills.rel.total', label: 'DND5E.SkillRel', group: 'skills' },
      { key: 'skills.slt.total', label: 'DND5E.SkillSlt', group: 'skills' },
      { key: 'skills.ste.total', label: 'DND5E.SkillSte', group: 'skills' },
      { key: 'skills.sur.total', label: 'DND5E.SkillSur', group: 'skills' },
    ];

    return [...abilities, ...skills];
  }

  getAvailableDamageTypes() {
    const cfg = CONFIG.DND5E?.damageTypes ?? {};
    return Object.entries(cfg).map(([key, data]) => ({
      id: key,
      label: data.label ?? key,
    }));
  }

  getModifierTable() {
    return [
      { maxScore: 6, multiplier: 1.5 },
      { maxScore: 9, multiplier: 1.3 },
      { maxScore: 12, multiplier: 1.0 },
      { maxScore: 15, multiplier: 0.8 },
      { maxScore: 18, multiplier: 0.6 },
      { maxScore: Infinity, multiplier: 0.5 },
    ];
  }

  getEffectSuggestions() {
    return {
      hunger: [{ type: 'attribute-modify', config: { path: 'system.attributes.exhaustion', operation: 'add', amount: 1 }, ticks: 3 }],
      thirst: [{ type: 'attribute-modify', config: { path: 'system.attributes.exhaustion', operation: 'add', amount: 1 }, ticks: 2 }],
      exhaustion: [{ type: 'attribute-modify', config: { path: 'system.attributes.exhaustion', operation: 'add', amount: 1 }, ticks: 3 }],
      cold: [{ type: 'attribute-modify', config: { path: 'system.attributes.hp.value', operation: 'subtract', amount: 5 }, ticks: 3 }],
      heat: [{ type: 'attribute-modify', config: { path: 'system.attributes.hp.value', operation: 'subtract', amount: 5 }, ticks: 3 }],
    };
  }

  isPlayerCharacter(actor) {
    return actor?.hasPlayerOwner && (actor?.type === 'character' || actor?.type === 'npc');
  }
}

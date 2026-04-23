export const MODULE_ID = 'mortal-needs';
export const MODULE_TITLE = 'Mortal Needs';

export const Events = Object.freeze({
  NEED_STRESSED:       'mortalNeeds.need.stressed',
  NEED_RELIEVED:       'mortalNeeds.need.relieved',
  NEED_SET:            'mortalNeeds.need.set',
  NEED_RESET:          'mortalNeeds.need.reset',

  THRESHOLD_CROSSED:   'mortalNeeds.threshold.crossed',
  THRESHOLD_CRITICAL:  'mortalNeeds.threshold.critical',
  THRESHOLD_RECOVERED: 'mortalNeeds.threshold.recovered',

  CONSEQUENCE_APPLIED: 'mortalNeeds.consequence.applied',
  CONSEQUENCE_REMOVED: 'mortalNeeds.consequence.removed',
  CONSEQUENCE_TICK:    'mortalNeeds.consequence.tick',

  CONFIG_CHANGED:      'mortalNeeds.config.changed',
  NEED_REGISTERED:     'mortalNeeds.need.registered',
  NEED_UNREGISTERED:   'mortalNeeds.need.unregistered',
  NEED_ENABLED:        'mortalNeeds.need.enabled',
  NEED_DISABLED:       'mortalNeeds.need.disabled',

  ACTOR_TRACKED:       'mortalNeeds.actor.tracked',
  ACTOR_UNTRACKED:     'mortalNeeds.actor.untracked',
  ACTORS_REFRESHED:    'mortalNeeds.actors.refreshed',

  HISTORY_UPDATED:     'mortalNeeds.history.updated',
  HISTORY_CLEARED:     'mortalNeeds.history.cleared',

  UI_RENDERED:         'mortalNeeds.ui.rendered',
  UI_TOGGLED:          'mortalNeeds.ui.toggled',

  TIME_DECAY_TICK:     'mortalNeeds.time.decayTick',

  CONSEQUENCE_TYPE_REGISTERED: 'mortalNeeds.consequenceType.registered',
  PRESET_REGISTERED:           'mortalNeeds.preset.registered',
});

export const EntitySource = Object.freeze({
  ACTOR: 'actor',
  EXALTED_SCENES: 'exalted-scenes',
});

export const Severity = Object.freeze({
  SAFE: 'safe',
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

export const SEVERITY_ORDER = Object.freeze({
  [Severity.SAFE]: 0,
  [Severity.LOW]: 1,
  [Severity.MEDIUM]: 2,
  [Severity.HIGH]: 3,
  [Severity.CRITICAL]: 4,
});

/**
 * Generate localization-key-based flavor structure for a need.
 * Keys follow: MORTAL_NEEDS.Flavor.{NeedId}.{Direction}.{Severity}.{1|2|3}
 */
function buildFlavorKeys(needId) {
  const id = needId.charAt(0).toUpperCase() + needId.slice(1);
  const k = (dir, sev, n) => `MORTAL_NEEDS.Flavor.${id}.${dir}.${sev}.${n}`;
  return {
    worsening: {
      low:      [k('Worsening','Low',1), k('Worsening','Low',2), k('Worsening','Low',3)],
      medium:   [k('Worsening','Medium',1), k('Worsening','Medium',2), k('Worsening','Medium',3)],
      high:     [k('Worsening','High',1), k('Worsening','High',2), k('Worsening','High',3)],
      critical: [k('Worsening','Critical',1), k('Worsening','Critical',2), k('Worsening','Critical',3)],
    },
    improving: {
      high:   [k('Improving','High',1), k('Improving','High',2), k('Improving','High',3)],
      medium: [k('Improving','Medium',1), k('Improving','Medium',2), k('Improving','Medium',3)],
      low:    [k('Improving','Low',1), k('Improving','Low',2), k('Improving','Low',3)],
      safe:   [k('Improving','Safe',1), k('Improving','Safe',2), k('Improving','Safe',3)],
    },
  };
}

export const NeedCategory = Object.freeze({
  PHYSICAL: 'physical',
  ENVIRONMENTAL: 'environmental',
  MENTAL: 'mental',
  CUSTOM: 'custom',
});

export const DEFAULT_NEEDS = [
  {
    id: 'hunger', label: 'MORTAL_NEEDS.Needs.Hunger', icon: 'fa-utensils', iconType: 'fa',
    enabled: true, category: NeedCategory.PHYSICAL, order: 0,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 5, interval: 3600 },
    flavor: buildFlavorKeys('hunger')
  },
  {
    id: 'thirst', label: 'MORTAL_NEEDS.Needs.Thirst', icon: 'fa-tint', iconType: 'fa',
    enabled: true, category: NeedCategory.PHYSICAL, order: 1,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 15,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 8, interval: 3600 },
    flavor: buildFlavorKeys('thirst')
  },
  {
    id: 'exhaustion', label: 'MORTAL_NEEDS.Needs.Exhaustion', icon: 'fa-bed', iconType: 'fa',
    enabled: true, category: NeedCategory.PHYSICAL, order: 2,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 5, interval: 3600 },
    flavor: buildFlavorKeys('exhaustion')
  },
  {
    id: 'cold', label: 'MORTAL_NEEDS.Needs.Cold', icon: 'fa-snowflake', iconType: 'fa',
    enabled: false, category: NeedCategory.ENVIRONMENTAL, order: 3,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 10, interval: 3600 },
    flavor: buildFlavorKeys('cold')
  },
  {
    id: 'heat', label: 'MORTAL_NEEDS.Needs.Heat', icon: 'fa-sun', iconType: 'fa',
    enabled: false, category: NeedCategory.ENVIRONMENTAL, order: 4,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 10, interval: 3600 },
    flavor: buildFlavorKeys('heat')
  },
  {
    id: 'comfort', label: 'MORTAL_NEEDS.Needs.Comfort', icon: 'fa-couch', iconType: 'fa',
    enabled: false, category: NeedCategory.PHYSICAL, order: 5,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 3, interval: 3600 },
    flavor: buildFlavorKeys('comfort')
  },
  {
    id: 'sanity', label: 'MORTAL_NEEDS.Needs.Sanity', icon: 'fa-brain', iconType: 'fa',
    enabled: false, category: NeedCategory.MENTAL, order: 6,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 5,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 2, interval: 3600 },
    flavor: buildFlavorKeys('sanity')
  },
  {
    id: 'morale', label: 'MORTAL_NEEDS.Needs.Morale', icon: 'fa-smile', iconType: 'fa',
    enabled: false, category: NeedCategory.MENTAL, order: 7,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 5,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 2, interval: 3600 },
    flavor: buildFlavorKeys('morale')
  },
  {
    id: 'pain', label: 'MORTAL_NEEDS.Needs.Pain', icon: 'fa-band-aid', iconType: 'fa',
    enabled: false, category: NeedCategory.PHYSICAL, order: 8,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 3, interval: 3600 },
    flavor: buildFlavorKeys('pain')
  },
  {
    id: 'radiation', label: 'MORTAL_NEEDS.Needs.Radiation', icon: 'fa-radiation', iconType: 'fa',
    enabled: false, category: NeedCategory.ENVIRONMENTAL, order: 9,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 5,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 1, interval: 3600 },
    flavor: buildFlavorKeys('radiation')
  },
  {
    id: 'corruption', label: 'MORTAL_NEEDS.Needs.Corruption', icon: 'fa-skull', iconType: 'fa',
    enabled: false, category: NeedCategory.MENTAL, order: 10,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 2,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 1, interval: 7200 },
    flavor: buildFlavorKeys('corruption')
  },
  {
    id: 'fatigue', label: 'MORTAL_NEEDS.Needs.Fatigue', icon: 'fa-moon', iconType: 'fa',
    enabled: false, category: NeedCategory.PHYSICAL, order: 11,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 5, interval: 3600 },
    flavor: buildFlavorKeys('fatigue')
  },
  {
    id: 'environmental', label: 'MORTAL_NEEDS.Needs.Environmental', icon: 'fa-cloud', iconType: 'fa',
    enabled: false, category: NeedCategory.ENVIRONMENTAL, order: 12,
    min: 0, max: 100, default: 0, custom: false, stressAmount: 10,
    attribute: null, consequences: [],
    decay: { enabled: false, rate: 5, interval: 3600 },
    flavor: buildFlavorKeys('environmental')
  },
];

/**
 * v12/v13 compatible renderTemplate.
 * v13 moved it to foundry.applications.handlebars.renderTemplate.
 */
export function mnRenderTemplate(path, data) {
  if (foundry.applications?.handlebars?.renderTemplate) {
    return foundry.applications.handlebars.renderTemplate(path, data);
  }
  return renderTemplate(path, data);
}

export const BUILT_IN_PRESETS = [
  {
    id: 'survival', label: 'MORTAL_NEEDS.Presets.Survival',
    description: 'MORTAL_NEEDS.Presets.SurvivalDesc',
    needs: ['hunger', 'thirst', 'exhaustion', 'cold', 'heat'],
  },
  {
    id: 'horror', label: 'MORTAL_NEEDS.Presets.Horror',
    description: 'MORTAL_NEEDS.Presets.HorrorDesc',
    needs: ['sanity', 'morale', 'pain', 'corruption'],
  },
  {
    id: 'scifi', label: 'MORTAL_NEEDS.Presets.SciFi',
    description: 'MORTAL_NEEDS.Presets.SciFiDesc',
    needs: ['radiation', 'fatigue', 'morale'],
  },
  {
    id: 'dark-fantasy', label: 'MORTAL_NEEDS.Presets.DarkFantasy',
    description: 'MORTAL_NEEDS.Presets.DarkFantasyDesc',
    needs: ['hunger', 'thirst', 'exhaustion', 'corruption', 'sanity'],
  },
  {
    id: 'minimalist', label: 'MORTAL_NEEDS.Presets.Minimalist',
    description: 'MORTAL_NEEDS.Presets.MinimalistDesc',
    needs: ['hunger', 'thirst'],
  },
];

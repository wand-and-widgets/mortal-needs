const CONSEQUENCE_TYPE_REGISTRY = new Map();

export function registerConsequenceType(type, ConsequenceTypeClass) {
  CONSEQUENCE_TYPE_REGISTRY.set(type, ConsequenceTypeClass);
}

export function getConsequenceType(type) {
  return CONSEQUENCE_TYPE_REGISTRY.get(type) ?? null;
}

export function getAllConsequenceTypes() {
  return [...CONSEQUENCE_TYPE_REGISTRY.entries()].map(([type, cls]) => ({
    type,
    label: cls.LABEL,
    icon: cls.ICON,
    configSchema: cls.CONFIG_SCHEMA,
  }));
}

export class ConsequenceType {
  static TYPE = '';
  static LABEL = 'Consequence';
  static ICON = 'fas fa-bolt';
  static CONFIG_SCHEMA = [];

  constructor(adapter) {
    this.adapter = adapter;
  }

  async apply(actor, needId, config) {
    throw new Error('Subclass must implement apply()');
  }

  async remove(actor, needId, config) {
    return false;
  }

  async isActive(actor, needId, config) {
    return false;
  }

  getDescription(config) {
    return game.i18n.localize(this.constructor.LABEL);
  }
}

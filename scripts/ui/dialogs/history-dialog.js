import { MODULE_ID } from '../../constants.js';
import { NeedsEngine } from '../../core/needs-engine.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class HistoryDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-history',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.History.Title',
      icon: 'fas fa-history',
      resizable: true,
    },
    position: {
      width: 480,
      height: 'auto',
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/history.hbs`,
    },
  };

  constructor(store) {
    super();
    this.#store = store;
  }

  async _prepareContext(options) {
    const allHistory = this.#store.getAllHistory(200);
    const entities = this.#store.getAllTrackedActors();
    const needs = this.#store.getAllNeedConfigs();

    const entries = allHistory.map(entry => {
      const entityInfo = this.#store.getTrackedEntityInfo(entry.entityId);
      const needConfig = this.#store.getNeedConfig(entry.needId);
      const newPct = needConfig ? NeedsEngine.getPercentage(entry.newValue, needConfig.max) : 0;

      return {
        time: new Date(entry.timestamp).toLocaleTimeString(),
        entityId: entry.entityId,
        entityName: entityInfo?.name || entry.entityId,
        needId: entry.needId,
        needLabel: needConfig ? game.i18n.localize(needConfig.label) : entry.needId,
        needIcon: needConfig?.icon || 'fa-question',
        previousValue: entry.previousValue,
        newValue: entry.newValue,
        newSeverity: NeedsEngine.getSeverity(newPct),
        source: entry.source,
      };
    }).reverse(); // Most recent first

    return {
      entries,
      entities: entities.map(e => ({ id: e.id, name: e.name })),
      needs: needs.map(n => ({ id: n.id, label: n.label })),
    };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Filter handlers
    const filterEntity = this.element.querySelector('select[name="filterEntity"]');
    const filterNeed = this.element.querySelector('select[name="filterNeed"]');

    const applyFilter = () => {
      const entityId = filterEntity?.value || '';
      const needId = filterNeed?.value || '';

      this.element.querySelectorAll('.mn-history-entry').forEach(entry => {
        let show = true;
        if (entityId && entry.dataset.entityId !== entityId) {
          show = false;
        }
        if (show && needId && entry.dataset.needId !== needId) {
          show = false;
        }
        entry.style.display = show ? '' : 'none';
      });
    };

    if (filterEntity) filterEntity.addEventListener('change', applyFilter);
    if (filterNeed) filterNeed.addEventListener('change', applyFilter);
  }
}

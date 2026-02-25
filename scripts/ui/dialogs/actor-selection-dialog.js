import { MODULE_ID, EntitySource } from '../../constants.js';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class ActorSelectionDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  #store;
  #app;

  static DEFAULT_OPTIONS = {
    id: 'mortal-needs-actor-selection',
    classes: ['mortal-needs-panel', 'mn-dialog'],
    tag: 'div',
    window: {
      title: 'MORTAL_NEEDS.ActorSelection.Title',
      icon: 'fas fa-user-plus',
      resizable: true,
    },
    position: {
      width: 380,
      height: 'auto',
    },
    actions: {
      'confirm': ActorSelectionDialog.#onConfirm,
    },
  };

  static PARTS = {
    content: {
      template: `modules/${MODULE_ID}/templates/dialogs/actor-selection.hbs`,
    },
  };

  constructor(store, app) {
    super();
    this.#store = store ?? null;
    this.#app = app ?? null;
  }

  async _prepareContext(options) {
    let trackedIds;
    if (this.#store) {
      trackedIds = new Set(this.#store.getTrackedEntityIds());
    } else {
      const api = game.modules.get(MODULE_ID).api;
      trackedIds = new Set(api.actors.getTracked().map(e => e.id));
    }

    // Foundry Actors (all player characters + NPCs with tokens)
    const actors = game.actors.contents
      .filter(a => a.type === 'character' || a.hasPlayerOwner)
      .map(a => ({
        id: a.id,
        name: a.name,
        img: a.img || a.prototypeToken?.texture?.src || 'icons/svg/mystery-man.svg',
        tracked: trackedIds.has(a.id),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Exalted Scenes characters
    const esModule = game.modules.get('exalted-scenes');
    const hasES = esModule?.active && esModule.api?.characters;
    let esCharacters = [];

    if (hasES) {
      const allChars = esModule.api.characters.getAll?.() || [];
      esCharacters = allChars.map(char => ({
        id: char.id,
        name: char.name,
        img: char.thumbnail || char.image || 'icons/svg/mystery-man.svg',
        linkedActorId: char.actorId || null,
        linkedActorName: char.actorId ? game.actors.get(char.actorId)?.name : null,
        tracked: trackedIds.has(char.id),
      }));
    }

    return { actors, esCharacters, hasES };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    // Tab switching
    this.element.querySelectorAll('.mn-dialog__tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;
        this.element.querySelectorAll('.mn-dialog__tab').forEach(t => t.classList.remove('is-active'));
        e.currentTarget.classList.add('is-active');
        this.element.querySelectorAll('.mn-dialog__tab-content').forEach(c => c.style.display = 'none');
        this.element.querySelector(`[data-tab-content="${tabName}"]`).style.display = '';
      });
    });

    // Search filter
    const search = this.element.querySelector('input[name="actorSearch"]');
    if (search) {
      search.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        this.element.querySelectorAll('[data-list="actors"] .mn-dialog__list-item').forEach(item => {
          const name = item.querySelector('.mn-dialog__list-item-name')?.textContent?.toLowerCase() || '';
          item.style.display = name.includes(query) ? '' : 'none';
        });
      });
    }
  }

  static async #onConfirm() {
    const api = game.modules.get(MODULE_ID).api;

    // Selected Foundry Actors
    const actorCheckboxes = this.element.querySelectorAll('input[name="selectedActors"]:checked:not(:disabled)');
    for (const cb of actorCheckboxes) {
      await api.actors.track(cb.value, EntitySource.ACTOR);
    }

    // Selected ES Characters
    const esCheckboxes = this.element.querySelectorAll('input[name="selectedESChars"]:checked:not(:disabled)');
    for (const cb of esCheckboxes) {
      await api.actors.track(cb.value, EntitySource.EXALTED_SCENES);
    }

    this.close();
  }
}

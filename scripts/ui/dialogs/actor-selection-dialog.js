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
      width: 640,
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

    const actorStats = ActorSelectionDialog.#getSelectionStats(actors);
    const esStats = ActorSelectionDialog.#getSelectionStats(esCharacters);
    const totalStats = {
      total: actorStats.total + esStats.total,
      tracked: actorStats.tracked + esStats.tracked,
      available: actorStats.available + esStats.available,
    };

    return { actors, esCharacters, hasES, actorStats, esStats, totalStats };
  }

  _onRender(context, options) {
    super._onRender(context, options);

    this.#activateTabs();
    this.#activateSearch();
    this.#activateSelectionState();
  }

  static #getSelectionStats(entries) {
    const tracked = entries.filter(entry => entry.tracked).length;

    return {
      total: entries.length,
      tracked,
      available: entries.length - tracked,
    };
  }

  #activateTabs() {
    this.element.querySelectorAll('.mn-actor-select__tab').forEach(tab => {
      tab.addEventListener('click', (e) => {
        const tabName = e.currentTarget.dataset.tab;

        this.element.querySelectorAll('.mn-actor-select__tab').forEach(t => {
          t.classList.remove('is-active');
          t.setAttribute('aria-selected', 'false');
        });

        e.currentTarget.classList.add('is-active');
        e.currentTarget.setAttribute('aria-selected', 'true');

        this.element.querySelectorAll('.mn-actor-select__tab-content').forEach(content => {
          content.hidden = content.dataset.tabContent !== tabName;
        });
      });
    });
  }

  #activateSearch() {
    const search = this.element.querySelector('input[name="actorSearch"]');
    if (!search) return;

    search.addEventListener('input', (e) => {
      const query = e.target.value.trim().toLocaleLowerCase();
      this.element.querySelectorAll('.mn-actor-select__row').forEach(item => {
        const text = item.textContent?.toLocaleLowerCase() || '';
        item.hidden = query.length > 0 && !text.includes(query);
      });
    });
  }

  #activateSelectionState() {
    this.element
      .querySelectorAll('input[name="selectedActors"], input[name="selectedESChars"]')
      .forEach(checkbox => checkbox.addEventListener('change', () => this.#syncSelectionState()));

    this.#syncSelectionState();
  }

  #syncSelectionState() {
    const selected = this.element.querySelectorAll(
      'input[name="selectedActors"]:checked:not(:disabled), input[name="selectedESChars"]:checked:not(:disabled)'
    );

    this.element.querySelectorAll('.mn-actor-select__row').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      row.classList.toggle('is-selected', !!checkbox?.checked && !checkbox.disabled);
    });

    const selectedCount = selected.length;
    const count = this.element.querySelector('[data-selected-count]');
    const confirm = this.element.querySelector('[data-action="confirm"]');

    if (count) count.textContent = String(selectedCount);
    if (confirm) confirm.disabled = selectedCount === 0;
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

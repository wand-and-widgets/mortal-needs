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
    const inputs = [...this.element.querySelectorAll('input[name="selectedActors"], input[name="selectedESChars"]')];
    let selectedCount = 0;
    let addedCount = 0;
    let removedCount = 0;

    this.element.querySelectorAll('.mn-actor-select__row').forEach(row => {
      const checkbox = row.querySelector('input[type="checkbox"]');
      if (!checkbox) return;

      const wasTracked = checkbox.dataset.tracked === 'true';
      const isChecked = checkbox.checked;
      const isAdded = !wasTracked && isChecked;
      const isRemoved = wasTracked && !isChecked;
      const badge = row.querySelector('[data-state-badge]');

      row.classList.toggle('is-selected', isChecked);
      row.classList.toggle('is-new', isAdded);
      row.classList.toggle('is-removing', isRemoved);

      if (badge) {
        if (isRemoved) {
          badge.hidden = false;
          badge.textContent = game.i18n.localize('MORTAL_NEEDS.ActorSelection.WillRemove');
          badge.dataset.state = 'remove';
        } else if (isAdded) {
          badge.hidden = false;
          badge.textContent = game.i18n.localize('MORTAL_NEEDS.ActorSelection.WillAdd');
          badge.dataset.state = 'add';
        } else if (wasTracked) {
          badge.hidden = false;
          badge.textContent = game.i18n.localize('MORTAL_NEEDS.ActorSelection.AlreadyTracked');
          badge.dataset.state = 'tracked';
        } else {
          badge.hidden = true;
          badge.textContent = '';
          delete badge.dataset.state;
        }
      }
    });

    for (const input of inputs) {
      const wasTracked = input.dataset.tracked === 'true';
      if (input.checked) selectedCount += 1;
      if (!wasTracked && input.checked) addedCount += 1;
      if (wasTracked && !input.checked) removedCount += 1;
    }

    const count = this.element.querySelector('[data-selected-count]');
    const added = this.element.querySelector('[data-added-count]');
    const removed = this.element.querySelector('[data-removed-count]');
    const confirm = this.element.querySelector('[data-action="confirm"]');
    const hasChanges = addedCount > 0 || removedCount > 0;

    if (count) count.textContent = String(selectedCount);
    if (added) added.textContent = String(addedCount);
    if (removed) removed.textContent = String(removedCount);
    if (confirm) confirm.disabled = !hasChanges;
  }

  static async #onConfirm() {
    const api = game.modules.get(MODULE_ID).api;
    let addedCount = 0;
    let removedCount = 0;

    // Foundry Actors
    const actorCheckboxes = this.element.querySelectorAll('input[name="selectedActors"]');
    for (const cb of actorCheckboxes) {
      const wasTracked = cb.dataset.tracked === 'true';
      if (cb.checked && !wasTracked) {
        await api.actors.track(cb.value, EntitySource.ACTOR);
        addedCount += 1;
      } else if (!cb.checked && wasTracked) {
        await api.actors.untrack(cb.value);
        removedCount += 1;
      }
    }

    // Exalted Scenes Characters
    const esCheckboxes = this.element.querySelectorAll('input[name="selectedESChars"]');
    for (const cb of esCheckboxes) {
      const wasTracked = cb.dataset.tracked === 'true';
      if (cb.checked && !wasTracked) {
        await api.actors.track(cb.value, EntitySource.EXALTED_SCENES);
        addedCount += 1;
      } else if (!cb.checked && wasTracked) {
        await api.actors.untrack(cb.value);
        removedCount += 1;
      }
    }

    if (addedCount || removedCount) {
      ui.notifications.info(
        game.i18n.format('MORTAL_NEEDS.Notifications.ActorTrackingUpdated', {
          added: addedCount,
          removed: removedCount,
        }),
      );
    }

    this.close();
  }
}

import { MODULE_ID } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

const FLASH_DURATION_MS = 3500;
const FLASH_EXIT_MS = 400;

/**
 * Dramatic temporary popup overlay.
 * Shows all tracked actors + needs with a cinematic entrance,
 * pulsing glow, and auto-dismiss.
 * Works for ALL clients (no SessionFlow dependency).
 */
export class FlashPopup {
  #activePopup = null;
  #dismissTimer = null;

  constructor() {
    Hooks.on('mortalNeeds.broadcast.flash', (data) => this.flash(data.needsData));
  }

  flash(needsData) {
    // Remove any existing popup
    this.#cleanup();

    const popup = this.#buildPopup(needsData);
    document.body.appendChild(popup);
    this.#activePopup = popup;

    // Entry animation
    requestAnimationFrame(() => {
      popup.classList.add('mn-flash--visible');
    });

    // Auto-dismiss
    this.#dismissTimer = setTimeout(() => {
      popup.classList.remove('mn-flash--visible');
      popup.classList.add('mn-flash--exit');
      setTimeout(() => {
        if (this.#activePopup === popup) {
          popup.remove();
          this.#activePopup = null;
        }
      }, FLASH_EXIT_MS);
    }, FLASH_DURATION_MS);
  }

  #cleanup() {
    if (this.#dismissTimer) {
      clearTimeout(this.#dismissTimer);
      this.#dismissTimer = null;
    }
    if (this.#activePopup) {
      this.#activePopup.remove();
      this.#activePopup = null;
    }
  }

  #buildPopup(needsData) {
    const { actors, needs } = needsData;

    const popup = document.createElement('div');
    popup.className = 'mn-flash';

    // Content card
    const content = document.createElement('div');
    content.className = 'mn-flash__content';

    // Title
    const title = document.createElement('div');
    title.className = 'mn-flash__title';
    title.innerHTML = `<i class="fas fa-heartbeat"></i> ${game.i18n.localize('MORTAL_NEEDS.SessionFlow.FlashTitle')}`;
    content.appendChild(title);

    // Actors
    const actorsEl = document.createElement('div');
    actorsEl.className = 'mn-flash__actors';

    if (actors?.length && needs?.length) {
      for (const actor of actors) {
        actorsEl.appendChild(this.#buildActorCard(actor, needs));
      }
    }

    content.appendChild(actorsEl);
    popup.appendChild(content);

    return popup;
  }

  #buildActorCard(actor, needs) {
    const card = document.createElement('div');
    card.className = 'mn-flash__actor';

    // Portrait
    const portrait = document.createElement('img');
    portrait.className = 'mn-flash__portrait';
    portrait.src = actor.img;
    portrait.alt = actor.name;
    card.appendChild(portrait);

    // Info
    const info = document.createElement('div');
    info.className = 'mn-flash__actor-info';

    const name = document.createElement('span');
    name.className = 'mn-flash__actor-name';
    name.textContent = actor.name;
    info.appendChild(name);

    // Need bars
    const needsEl = document.createElement('div');
    needsEl.className = 'mn-flash__needs';

    for (const config of needs) {
      const state = actor.needs[config.id];
      if (!state) continue;

      const value = state.value ?? 0;
      const max = state.max ?? config.max ?? 100;
      const percentage = NeedsEngine.getPercentage(value, max);
      const severity = NeedsEngine.getSeverity(percentage);
      const decimal = max > 0 ? value / max : 0;

      const needEl = document.createElement('div');
      needEl.className = 'mn-flash__need';

      const icon = document.createElement('span');
      icon.className = 'mn-flash__need-icon';
      icon.innerHTML = `<i class="fas ${config.icon}"></i>`;
      needEl.appendChild(icon);

      const track = document.createElement('div');
      track.className = 'mn-flash__need-track';

      const fill = document.createElement('div');
      fill.className = 'mn-flash__need-fill';
      fill.dataset.severity = severity;
      fill.style.transform = `scaleX(${decimal})`;
      track.appendChild(fill);
      needEl.appendChild(track);

      const valueEl = document.createElement('span');
      valueEl.className = 'mn-flash__need-value';
      valueEl.dataset.severity = severity;
      valueEl.textContent = `${percentage}%`;
      needEl.appendChild(valueEl);

      needsEl.appendChild(needEl);
    }

    info.appendChild(needsEl);
    card.appendChild(info);

    return card;
  }
}

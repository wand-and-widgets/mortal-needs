import { MODULE_ID, Events } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

const DOCK_POS_KEY = 'mn-broadcast-position';
const UPDATE_DEBOUNCE_MS = 200;

/**
 * Persistent broadcast HUD overlay.
 * Shows actor need bars in a draggable dock at the bottom-left.
 * Works for ALL clients (no SessionFlow dependency).
 */
export class BroadcastHUD {
  #element = null;
  #visible = false;
  #data = null;
  #updateTimer = null;
  #dragState = null;
  #onDragMove = null;
  #onDragUp = null;

  constructor() {
    // Listen for broadcast events
    Hooks.on('mortalNeeds.broadcast.show', (data) => this.show(data.needsData));
    Hooks.on('mortalNeeds.broadcast.update', (data) => this.update(data.needsData));
    Hooks.on('mortalNeeds.broadcast.hide', () => this.hide());

    // GM auto-update: when broadcasting, push changes to all clients
    if (game.user.isGM) {
      const autoUpdate = () => {
        if (!this.#visible) return;
        if (this.#updateTimer) clearTimeout(this.#updateTimer);
        this.#updateTimer = setTimeout(() => {
          const api = game.modules.get(MODULE_ID)?.api;
          if (api) api.broadcast.update();
        }, UPDATE_DEBOUNCE_MS);
      };

      Hooks.on(Events.NEED_STRESSED, autoUpdate);
      Hooks.on(Events.NEED_RELIEVED, autoUpdate);
      Hooks.on(Events.NEED_SET, autoUpdate);
      Hooks.on(Events.NEED_RESET, autoUpdate);
      Hooks.on(Events.ACTORS_REFRESHED, autoUpdate);
    }
  }

  get isVisible() {
    return this.#visible;
  }

  show(needsData) {
    this.#data = needsData;
    if (!this.#element) this.#createElement();
    this.#render();
    this.#element.style.display = '';
    this.#visible = true;

    // Entry animation
    requestAnimationFrame(() => {
      this.#element.classList.remove('mn-broadcast--exit');
      this.#element.classList.add('mn-broadcast--visible');
    });
  }

  update(needsData) {
    if (!this.#visible) return;
    this.#data = needsData;
    this.#render();
  }

  hide() {
    if (!this.#element || !this.#visible) return;
    this.#visible = false;

    // Cancel any active drag to prevent orphaned listeners
    if (this.#dragState) {
      document.removeEventListener('mousemove', this.#onDragMove);
      document.removeEventListener('mouseup', this.#onDragUp);
      this.#dragState = null;
    }

    this.#element.classList.remove('mn-broadcast--visible');
    this.#element.classList.add('mn-broadcast--exit');
    setTimeout(() => {
      if (this.#element) this.#element.style.display = 'none';
      this.#element?.classList.remove('mn-broadcast--exit');
    }, 300);
  }

  // ─── DOM Creation ───────────────────────────────────────

  #createElement() {
    const el = document.createElement('div');
    el.className = 'mn-broadcast';
    el.id = 'mn-broadcast-hud';
    el.style.display = 'none';

    // Restore position
    const pos = this.#loadPosition();
    if (pos) {
      el.style.left = `${pos.x}px`;
      el.style.bottom = `${pos.y}px`;
    }

    // Header (drag handle + close)
    const header = document.createElement('div');
    header.className = 'mn-broadcast__header';

    const title = document.createElement('span');
    title.className = 'mn-broadcast__title';
    title.innerHTML = `<i class="fas fa-heartbeat"></i> ${game.i18n.localize('MORTAL_NEEDS.SessionFlow.BroadcastTitle')}`;
    header.appendChild(title);

    // GM-only close button
    if (game.user.isGM) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'mn-broadcast__close';
      closeBtn.innerHTML = '<i class="fas fa-times"></i>';
      closeBtn.title = game.i18n.localize('MORTAL_NEEDS.SessionFlow.BroadcastStop');
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const api = game.modules.get(MODULE_ID)?.api;
        if (api) api.broadcast.hide();
      });
      header.appendChild(closeBtn);
    }

    el.appendChild(header);

    // Body (rendered dynamically)
    const body = document.createElement('div');
    body.className = 'mn-broadcast__body';
    el.appendChild(body);

    document.body.appendChild(el);
    this.#element = el;

    // Make draggable by header
    this.#initDrag(header, el);
  }

  // ─── Rendering ──────────────────────────────────────────

  #render() {
    if (!this.#element || !this.#data) return;

    const body = this.#element.querySelector('.mn-broadcast__body');
    if (!body) return;
    body.innerHTML = '';

    const { actors, needs } = this.#data;
    if (!actors?.length || !needs?.length) return;

    for (const actor of actors) {
      const actorEl = document.createElement('div');
      actorEl.className = 'mn-broadcast__actor';

      // Portrait
      const portrait = document.createElement('img');
      portrait.className = 'mn-broadcast__portrait';
      portrait.src = actor.img;
      portrait.alt = actor.name;
      portrait.loading = 'lazy';
      actorEl.appendChild(portrait);

      // Info column
      const info = document.createElement('div');
      info.className = 'mn-broadcast__actor-info';

      const name = document.createElement('span');
      name.className = 'mn-broadcast__actor-name';
      name.textContent = actor.name;
      info.appendChild(name);

      // Need bars
      const orientation = game.settings.get(MODULE_ID, 'barOrientation') ?? 'horizontal';
      const needsEl = document.createElement('div');
      needsEl.className = 'mn-broadcast__needs';
      if (orientation === 'vertical') needsEl.classList.add('mn-broadcast__needs--vertical');
      else if (orientation === 'radial') needsEl.classList.add('mn-broadcast__needs--radial');

      for (const config of needs) {
        const state = actor.needs[config.id];
        if (!state) continue;

        const value = state.value ?? 0;
        const max = state.max ?? config.max ?? 100;
        const percentage = NeedsEngine.getPercentage(value, max);
        const severity = NeedsEngine.getSeverity(percentage);
        const decimal = max > 0 ? value / max : 0;
        const tooltip = `${game.i18n.localize(config.label)}: ${value}/${max} (${percentage}%)`;

        if (orientation === 'radial') {
          needsEl.appendChild(this.#buildRadialNeed(config, severity, decimal, tooltip));
        } else if (orientation === 'vertical') {
          needsEl.appendChild(this.#buildVerticalNeed(config, severity, decimal, percentage, tooltip));
        } else {
          needsEl.appendChild(this.#buildHorizontalNeed(config, severity, decimal, tooltip));
        }
      }

      info.appendChild(needsEl);
      actorEl.appendChild(info);
      body.appendChild(actorEl);
    }
  }

  // ─── Need Bar Builders ─────────────────────────────────

  #buildHorizontalNeed(config, severity, decimal, tooltip) {
    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need';
    needEl.title = tooltip;

    const icon = document.createElement('span');
    icon.className = 'mn-broadcast__need-icon';
    icon.innerHTML = `<i class="fas ${config.icon}"></i>`;
    needEl.appendChild(icon);

    const track = document.createElement('div');
    track.className = 'mn-broadcast__need-track';

    const fill = document.createElement('div');
    fill.className = 'mn-broadcast__need-fill';
    fill.dataset.severity = severity;
    fill.style.transform = `scaleX(${decimal})`;
    track.appendChild(fill);
    needEl.appendChild(track);

    return needEl;
  }

  #buildVerticalNeed(config, severity, decimal, percentage, tooltip) {
    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need mn-broadcast__need--vertical';
    needEl.title = tooltip;

    const icon = document.createElement('span');
    icon.className = 'mn-broadcast__need-icon';
    icon.dataset.severity = severity;
    icon.innerHTML = `<i class="fas ${config.icon}"></i>`;
    needEl.appendChild(icon);

    const track = document.createElement('div');
    track.className = 'mn-broadcast__need-track mn-broadcast__need-track--vertical';

    const fill = document.createElement('div');
    fill.className = 'mn-broadcast__need-fill mn-broadcast__need-fill--vertical';
    fill.dataset.severity = severity;
    fill.style.transform = `scaleY(${decimal})`;
    track.appendChild(fill);
    needEl.appendChild(track);

    const pct = document.createElement('span');
    pct.className = 'mn-broadcast__need-pct';
    pct.dataset.severity = severity;
    pct.textContent = percentage;
    needEl.appendChild(pct);

    return needEl;
  }

  #buildRadialNeed(config, severity, decimal, tooltip) {
    const r = 16;
    const circumference = 2 * Math.PI * r;
    const dashOffset = circumference * (1 - decimal);

    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need mn-broadcast__need--radial';
    needEl.title = tooltip;

    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'mn-broadcast__ring');
    svg.setAttribute('viewBox', '0 0 36 36');

    const trackCircle = document.createElementNS(svgNS, 'circle');
    trackCircle.setAttribute('class', 'mn-broadcast__ring-track');
    trackCircle.setAttribute('cx', '18');
    trackCircle.setAttribute('cy', '18');
    trackCircle.setAttribute('r', String(r));
    svg.appendChild(trackCircle);

    const fillCircle = document.createElementNS(svgNS, 'circle');
    fillCircle.setAttribute('class', 'mn-broadcast__ring-fill');
    fillCircle.dataset.severity = severity;
    fillCircle.setAttribute('cx', '18');
    fillCircle.setAttribute('cy', '18');
    fillCircle.setAttribute('r', String(r));
    fillCircle.setAttribute('stroke-dasharray', String(circumference));
    fillCircle.setAttribute('stroke-dashoffset', String(dashOffset));
    svg.appendChild(fillCircle);

    const ringWrap = document.createElement('div');
    ringWrap.className = 'mn-broadcast__ring-wrap';
    ringWrap.appendChild(svg);

    const iconEl = document.createElement('span');
    iconEl.className = 'mn-broadcast__radial-icon';
    iconEl.innerHTML = `<i class="fas ${config.icon}"></i>`;
    ringWrap.appendChild(iconEl);

    needEl.appendChild(ringWrap);

    return needEl;
  }

  // ─── Drag ───────────────────────────────────────────────

  #initDrag(handle, el) {
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      handle.style.cursor = 'grabbing';

      const rect = el.getBoundingClientRect();
      this.#dragState = {
        startX: e.clientX,
        startY: e.clientY,
        startLeft: rect.left,
        startBottom: window.innerHeight - rect.bottom,
      };

      this.#onDragMove = (ev) => {
        if (!this.#dragState) return;
        const dx = ev.clientX - this.#dragState.startX;
        const dy = ev.clientY - this.#dragState.startY;
        el.style.left = `${this.#dragState.startLeft + dx}px`;
        el.style.bottom = `${this.#dragState.startBottom - dy}px`;
      };

      this.#onDragUp = () => {
        handle.style.cursor = 'grab';
        document.removeEventListener('mousemove', this.#onDragMove);
        document.removeEventListener('mouseup', this.#onDragUp);

        if (this.#dragState) {
          const rect2 = el.getBoundingClientRect();
          this.#savePosition(rect2.left, window.innerHeight - rect2.bottom);
          this.#dragState = null;
        }
      };

      document.addEventListener('mousemove', this.#onDragMove);
      document.addEventListener('mouseup', this.#onDragUp);
    });
  }

  // ─── Position Persistence ───────────────────────────────

  #loadPosition() {
    try {
      const saved = localStorage.getItem(DOCK_POS_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return null;
  }

  #savePosition(x, y) {
    try {
      localStorage.setItem(DOCK_POS_KEY, JSON.stringify({ x, y }));
    } catch { /* ignore */ }
  }
}

import { MODULE_ID, Events } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

const DOCK_POS_KEY = 'mn-broadcast-position';
const UPDATE_DEBOUNCE_MS = 200;
const AT_RISK_THRESHOLD = 60;
const ATTENTION_MS = 1800;
const VIEWPORT_MARGIN = 8;
const DENSITIES = ['normal', 'compact', 'micro'];
const LAYOUTS = ['horizontal', 'vertical', 'radial'];

/**
 * Persistent broadcast HUD overlay.
 * Shows actor need bars in a draggable dock and gives the GM compact controls.
 */
export class BroadcastHUD {
  #element = null;
  #visible = false;
  #data = null;
  #updateTimer = null;
  #attentionTimer = null;
  #riskSignature = '';
  #dragState = null;
  #onDragMove = null;
  #onDragUp = null;

  constructor() {
    Hooks.on('mortalNeeds.broadcast.show', (data) => this.show(data.needsData));
    Hooks.on('mortalNeeds.broadcast.update', (data) => this.update(data.needsData));
    Hooks.on('mortalNeeds.broadcast.hide', () => this.hide());
    Hooks.on('mortalNeeds.broadcast.settingsChanged', () => this.refresh());
    window.addEventListener('resize', () => {
      if (this.#visible) this.#clampToViewport({ save: true });
    });

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
    this.#element.style.display = '';
    this.#visible = true;
    this.#render();

    requestAnimationFrame(() => {
      this.#clampToViewport({ save: true });
      this.#element.classList.remove('mn-broadcast--exit');
      this.#element.classList.add('mn-broadcast--visible');
    });
  }

  update(needsData) {
    if (!this.#visible) return;
    this.#data = needsData;
    this.#render();
  }

  refresh() {
    if (!this.#visible) return;
    this.#render();
  }

  hide() {
    if (!this.#element || !this.#visible) return;
    this.#visible = false;

    if (this.#dragState) {
      document.removeEventListener('mousemove', this.#onDragMove);
      document.removeEventListener('mouseup', this.#onDragUp);
      this.#dragState = null;
    }

    if (this.#attentionTimer) {
      clearTimeout(this.#attentionTimer);
      this.#attentionTimer = null;
    }

    this.#element.classList.remove(
      'mn-broadcast--visible',
      'mn-broadcast--attention',
      'mn-broadcast--dragging',
    );
    this.#element.classList.add('mn-broadcast--exit');
    setTimeout(() => {
      if (this.#element) this.#element.style.display = 'none';
      this.#element?.classList.remove('mn-broadcast--exit');
    }, 300);
  }

  #createElement() {
    const el = document.createElement('div');
    el.className = 'mn-broadcast';
    el.id = 'mn-broadcast-hud';
    el.style.display = 'none';

    const pos = this.#loadPosition();
    if (pos) {
      el.style.left = `${pos.x}px`;
      el.style.bottom = `${pos.y}px`;
    }

    const header = document.createElement('div');
    header.className = 'mn-broadcast__header';

    const title = document.createElement('span');
    title.className = 'mn-broadcast__title';
    title.innerHTML = `<i class="fas fa-heartbeat"></i> <span class="mn-broadcast__title-text">${game.i18n.localize('MORTAL_NEEDS.SessionFlow.BroadcastTitle')}</span>`;
    header.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'mn-broadcast__header-actions';

    const densityBtn = this.#buildHeaderButton({
      action: 'cycle-density',
      icon: 'fa-compress-arrows-alt',
      title: game.i18n.localize('MORTAL_NEEDS.Broadcast.CycleDensity'),
    });
    actions.appendChild(densityBtn);

    actions.appendChild(this.#buildHeaderButton({
      action: 'reset-position',
      icon: 'fa-crosshairs',
      title: game.i18n.localize('MORTAL_NEEDS.Broadcast.ResetPosition'),
    }));

    if (game.user.isGM) {
      actions.appendChild(this.#buildHeaderButton({
        action: 'open-panel',
        icon: 'fa-window-restore',
        title: game.i18n.localize('MORTAL_NEEDS.Broadcast.OpenPanel'),
      }));

      actions.appendChild(this.#buildHeaderButton({
        action: 'hide',
        icon: 'fa-times',
        title: game.i18n.localize('MORTAL_NEEDS.SessionFlow.BroadcastStop'),
        extraClass: 'mn-broadcast__close',
      }));
    }

    header.appendChild(actions);
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'mn-broadcast__body';
    el.appendChild(body);

    el.addEventListener('click', (event) => this.#onActionClick(event));
    document.body.appendChild(el);
    this.#element = el;

    this.#initDrag(header, el);
  }

  #buildHeaderButton({ action, icon, title, extraClass = '' }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mn-broadcast__header-btn ${extraClass}`.trim();
    button.dataset.mnBroadcastAction = action;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i class="fas ${icon}"></i>`;
    return button;
  }

  #render() {
    if (!this.#element || !this.#data) return;

    const settings = this.#getSettings();
    this.#syncSettingsClasses(settings);

    const body = this.#element.querySelector('.mn-broadcast__body');
    if (!body) return;
    body.innerHTML = '';

    const { actors, needs } = this.#data;
    if (!actors?.length || !needs?.length) {
      this.#syncAlertState(false, false, '');
      return;
    }

    let hasRisk = false;
    let hasCritical = false;
    const riskParts = [];
    const criticalThreshold = this.#getCriticalThreshold();

    for (const actor of actors) {
      const needViews = needs
        .map(config => this.#buildNeedView(actor, config))
        .filter(Boolean);

      if (!needViews.length) continue;

      for (const need of needViews) {
        if (need.percentage >= AT_RISK_THRESHOLD) {
          hasRisk = true;
          riskParts.push(`${actor.id}:${need.config.id}:${need.percentage}`);
        }
        if (need.percentage >= criticalThreshold) hasCritical = true;
      }

      const visibleNeeds = this.#selectVisibleNeeds(needViews, settings.contentMode);
      if (!visibleNeeds.length) continue;

      const worstNeed = this.#getWorstNeed(needViews);
      const actorEl = document.createElement('div');
      actorEl.className = 'mn-broadcast__actor';
      actorEl.dataset.worstSeverity = worstNeed?.severity ?? 'safe';
      actorEl.classList.toggle('mn-broadcast__actor--focused', settings.contentMode !== 'all');

      const portrait = document.createElement('img');
      portrait.className = 'mn-broadcast__portrait';
      portrait.src = actor.img;
      portrait.alt = actor.name;
      portrait.loading = 'lazy';
      portrait.dataset.severity = worstNeed?.severity ?? 'safe';
      actorEl.appendChild(portrait);

      const info = document.createElement('div');
      info.className = 'mn-broadcast__actor-info';

      const name = document.createElement('span');
      name.className = 'mn-broadcast__actor-name';
      name.textContent = actor.name;
      info.appendChild(name);

      const needsEl = document.createElement('div');
      needsEl.className = 'mn-broadcast__needs';
      if (settings.layout === 'vertical') needsEl.classList.add('mn-broadcast__needs--vertical');
      else if (settings.layout === 'radial') needsEl.classList.add('mn-broadcast__needs--radial');

      for (const need of visibleNeeds) {
        if (settings.layout === 'radial') {
          needsEl.appendChild(this.#buildRadialNeed(need));
        } else if (settings.layout === 'vertical') {
          needsEl.appendChild(this.#buildVerticalNeed(need));
        } else {
          needsEl.appendChild(this.#buildHorizontalNeed(need));
        }
      }

      info.appendChild(needsEl);
      actorEl.appendChild(info);
      body.appendChild(actorEl);
    }

    this.#syncAlertState(hasRisk, hasCritical, riskParts.join('|'));
  }

  #buildNeedView(actor, config) {
    const state = actor.needs?.[config.id];
    if (!state) return null;

    const value = NeedsEngine.normalizeNumber(state.value, config.default ?? 0);
    const max = Math.max(1, NeedsEngine.normalizeNumber(state.max ?? config.max, 100));
    const percentage = Math.max(0, Math.min(100, NeedsEngine.getPercentage(value, max)));
    const severity = NeedsEngine.getSeverity(percentage);
    const decimal = NeedsEngine.getRatio(value, max);
    const label = game.i18n.localize(config.label);

    return {
      actorId: actor.id,
      config,
      value,
      max,
      percentage,
      severity,
      decimal,
      label,
      tooltip: `${label}: ${value}/${max} (${percentage}%)`,
    };
  }

  #selectVisibleNeeds(needs, contentMode) {
    if (contentMode === 'worst') {
      const worst = this.#getWorstNeed(needs);
      return worst ? [worst] : [];
    }

    if (contentMode === 'crisis') {
      const riskNeeds = needs
        .filter(need => need.percentage >= AT_RISK_THRESHOLD)
        .sort((a, b) => b.percentage - a.percentage);
      if (riskNeeds.length) return riskNeeds;

      const worst = this.#getWorstNeed(needs);
      return worst ? [worst] : [];
    }

    return needs;
  }

  #getWorstNeed(needs) {
    return needs.reduce((worst, need) => {
      if (!worst || need.percentage > worst.percentage) return need;
      return worst;
    }, null);
  }

  #buildHorizontalNeed(need) {
    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need';
    needEl.title = need.tooltip;

    const icon = document.createElement('span');
    icon.className = 'mn-broadcast__need-icon';
    icon.dataset.severity = need.severity;
    icon.innerHTML = `<i class="fas ${need.config.icon}"></i>`;
    needEl.appendChild(icon);

    const track = document.createElement('div');
    track.className = 'mn-broadcast__need-track';

    const fill = document.createElement('div');
    fill.className = 'mn-broadcast__need-fill';
    fill.dataset.severity = need.severity;
    fill.style.transform = `scaleX(${need.decimal})`;
    track.appendChild(fill);
    needEl.appendChild(track);

    this.#appendGMControls(needEl, need);
    return needEl;
  }

  #buildVerticalNeed(need) {
    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need mn-broadcast__need--vertical';
    needEl.title = need.tooltip;

    const icon = document.createElement('span');
    icon.className = 'mn-broadcast__need-icon';
    icon.dataset.severity = need.severity;
    icon.innerHTML = `<i class="fas ${need.config.icon}"></i>`;
    needEl.appendChild(icon);

    const track = document.createElement('div');
    track.className = 'mn-broadcast__need-track mn-broadcast__need-track--vertical';

    const fill = document.createElement('div');
    fill.className = 'mn-broadcast__need-fill mn-broadcast__need-fill--vertical';
    fill.dataset.severity = need.severity;
    fill.style.transform = `scaleY(${need.decimal})`;
    track.appendChild(fill);
    needEl.appendChild(track);

    const pct = document.createElement('span');
    pct.className = 'mn-broadcast__need-pct';
    pct.dataset.severity = need.severity;
    pct.textContent = need.percentage;
    needEl.appendChild(pct);

    this.#appendGMControls(needEl, need);
    return needEl;
  }

  #buildRadialNeed(need) {
    const r = 16;
    const circumference = 2 * Math.PI * r;
    const dashOffset = circumference * (1 - need.decimal);

    const needEl = document.createElement('div');
    needEl.className = 'mn-broadcast__need mn-broadcast__need--radial';
    needEl.title = need.tooltip;

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
    fillCircle.dataset.severity = need.severity;
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
    iconEl.innerHTML = `<i class="fas ${need.config.icon}"></i>`;
    ringWrap.appendChild(iconEl);

    needEl.appendChild(ringWrap);
    this.#appendGMControls(needEl, need);
    return needEl;
  }

  #appendGMControls(needEl, need) {
    if (!game.user.isGM) return;

    needEl.classList.add('mn-broadcast__need--gm');

    const controls = document.createElement('div');
    controls.className = 'mn-broadcast__need-controls';

    controls.appendChild(this.#buildNeedButton({
      action: 'relieve',
      icon: 'fa-minus',
      title: game.i18n.format('MORTAL_NEEDS.Broadcast.RelieveNeed', { need: need.label }),
      actorId: need.actorId,
      needId: need.config.id,
    }));

    controls.appendChild(this.#buildNeedButton({
      action: 'stress',
      icon: 'fa-plus',
      title: game.i18n.format('MORTAL_NEEDS.Broadcast.StressNeed', { need: need.label }),
      actorId: need.actorId,
      needId: need.config.id,
    }));

    needEl.appendChild(controls);
  }

  #buildNeedButton({ action, icon, title, actorId, needId }) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `mn-broadcast__need-btn mn-broadcast__need-btn--${action}`;
    button.dataset.mnBroadcastAction = action;
    button.dataset.entityId = actorId;
    button.dataset.needId = needId;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<i class="fas ${icon}"></i>`;
    return button;
  }

  async #onActionClick(event) {
    const button = event.target?.closest?.('[data-mn-broadcast-action]');
    if (!button || !this.#element?.contains(button)) return;

    event.preventDefault();
    event.stopPropagation();

    const action = button.dataset.mnBroadcastAction;
    if (action === 'cycle-density') {
      await this.#cycleDensity();
      return;
    }

    if (action === 'reset-position') {
      this.#resetPosition();
      return;
    }

    if (action === 'hide') {
      if (game.user.isGM) game.modules.get(MODULE_ID)?.api?.broadcast?.hide();
      return;
    }

    if (action === 'open-panel') {
      if (game.user.isGM) game.modules.get(MODULE_ID)?.api?.ui?.show();
      return;
    }

    if (action === 'stress' || action === 'relieve') {
      await this.#applyNeedAction(action, button);
    }
  }

  async #applyNeedAction(action, button) {
    if (!game.user.isGM) {
      ui.notifications.warn('MORTAL_NEEDS.Notifications.GMOnly', { localize: true });
      return;
    }

    const entityId = button.dataset.entityId;
    const needId = button.dataset.needId;
    if (!entityId || !needId) return;

    const api = game.modules.get(MODULE_ID)?.api;
    if (!api?.needs) return;

    button.disabled = true;
    try {
      if (action === 'stress') await api.needs.stress(entityId, needId);
      else await api.needs.relieve(entityId, needId);
      this.#wakeAttention();
    } catch (error) {
      console.error('Mortal Needs | Broadcast HUD action failed', error);
      ui.notifications.error('MORTAL_NEEDS.Notifications.BroadcastActionFailed', { localize: true });
    } finally {
      if (button.isConnected) button.disabled = false;
    }
  }

  async #cycleDensity() {
    const current = this.#getSettings().density;
    const index = DENSITIES.indexOf(current);
    const next = DENSITIES[(index + 1) % DENSITIES.length];
    await game.settings.set(MODULE_ID, 'broadcastDensity', next);
    this.#render();
  }

  #getSettings() {
    const getSetting = (key, fallback) => {
      try {
        return game.settings.get(MODULE_ID, key) ?? fallback;
      } catch {
        return fallback;
      }
    };

    const layoutSetting = getSetting('broadcastLayout', 'inherit');
    const inheritedLayout = getSetting('barOrientation', 'horizontal');
    const layout = layoutSetting === 'inherit' ? inheritedLayout : layoutSetting;
    const density = getSetting('broadcastDensity', 'normal');
    const contentMode = getSetting('broadcastContentMode', 'all');
    const idleOpacity = Number(getSetting('broadcastIdleOpacity', 55));

    return {
      layout: LAYOUTS.includes(layout) ? layout : 'horizontal',
      density: DENSITIES.includes(density) ? density : 'normal',
      contentMode: ['all', 'worst', 'crisis'].includes(contentMode) ? contentMode : 'all',
      autoFade: !!getSetting('broadcastAutoFade', true),
      idleOpacity: Math.max(0.2, Math.min(1, (Number.isFinite(idleOpacity) ? idleOpacity : 55) / 100)),
    };
  }

  #syncSettingsClasses(settings = this.#getSettings()) {
    if (!this.#element) return;

    for (const density of DENSITIES) {
      this.#element.classList.toggle(`mn-broadcast--density-${density}`, settings.density === density);
    }

    for (const layout of LAYOUTS) {
      this.#element.classList.toggle(`mn-broadcast--layout-${layout}`, settings.layout === layout);
    }

    for (const mode of ['all', 'worst', 'crisis']) {
      this.#element.classList.toggle(`mn-broadcast--content-${mode}`, settings.contentMode === mode);
    }

    this.#element.classList.toggle('mn-broadcast--fade', settings.autoFade);
    this.#element.style.setProperty('--mn-broadcast-idle-opacity', String(settings.idleOpacity));
  }

  #getCriticalThreshold() {
    try {
      return Number(game.settings.get(MODULE_ID, 'criticalThreshold')) || 80;
    } catch {
      return 80;
    }
  }

  #syncAlertState(hasRisk, hasCritical, signature) {
    if (!this.#element) return;

    this.#element.classList.toggle('mn-broadcast--has-risk', hasRisk);
    this.#element.classList.toggle('mn-broadcast--has-critical', hasCritical);

    if (signature && signature !== this.#riskSignature) {
      this.#wakeAttention();
    }
    this.#riskSignature = signature;
  }

  #wakeAttention() {
    if (!this.#element || !this.#visible) return;

    this.#element.classList.add('mn-broadcast--attention');
    if (this.#attentionTimer) clearTimeout(this.#attentionTimer);
    this.#attentionTimer = setTimeout(() => {
      this.#element?.classList.remove('mn-broadcast--attention');
      this.#attentionTimer = null;
    }, ATTENTION_MS);
  }

  #resetPosition() {
    if (!this.#element) return;

    const position = this.#clampPosition(16, 140);
    this.#applyPosition(position);
    this.#savePosition(position.x, position.y);
    this.#wakeAttention();
  }

  #initDrag(handle, el) {
    handle.style.cursor = 'grab';

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target?.closest?.('[data-mn-broadcast-action]')) return;
      e.preventDefault();
      handle.style.cursor = 'grabbing';
      el.classList.add('mn-broadcast--dragging');

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
        const position = this.#clampPosition(
          this.#dragState.startLeft + dx,
          this.#dragState.startBottom - dy,
        );
        this.#applyPosition(position);
      };

      this.#onDragUp = () => {
        handle.style.cursor = 'grab';
        el.classList.remove('mn-broadcast--dragging');
        document.removeEventListener('mousemove', this.#onDragMove);
        document.removeEventListener('mouseup', this.#onDragUp);

        if (this.#dragState) {
          this.#clampToViewport({ save: true });
          this.#dragState = null;
        }
      };

      document.addEventListener('mousemove', this.#onDragMove);
      document.addEventListener('mouseup', this.#onDragUp);
    });
  }

  #clampToViewport({ save = false } = {}) {
    if (!this.#element) return null;

    const rect = this.#element.getBoundingClientRect();
    const position = this.#clampPosition(rect.left, window.innerHeight - rect.bottom);
    this.#applyPosition(position);
    if (save) this.#savePosition(position.x, position.y);
    return position;
  }

  #clampPosition(x, y) {
    const rect = this.#element?.getBoundingClientRect();
    const width = Math.max(1, rect?.width || 240);
    const height = Math.max(1, rect?.height || 120);
    const maxX = Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN);
    const maxY = Math.max(VIEWPORT_MARGIN, window.innerHeight - height - VIEWPORT_MARGIN);

    return {
      x: Math.min(Math.max(Number(x) || VIEWPORT_MARGIN, VIEWPORT_MARGIN), maxX),
      y: Math.min(Math.max(Number(y) || VIEWPORT_MARGIN, VIEWPORT_MARGIN), maxY),
    };
  }

  #applyPosition({ x, y }) {
    if (!this.#element) return;
    this.#element.style.left = `${x}px`;
    this.#element.style.bottom = `${y}px`;
  }

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

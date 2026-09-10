import { MODULE_ID, Events } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';
import { canViewEntity, canEditNeed, ownsEntity, resolveEntityActor } from '../core/access.js';
import { shouldDisplayNeed, isGMOnlyNeed } from '../core/need-visibility.js';
import { escapeHTML as h } from '../core/consequence-identity.js';
import { needIcon, needColor, isSafeImagePath } from './need-icons.js';
import { conditionView, recoveryDescription } from './condition-view.js';
import { ScrubSession } from './scrub-session.js';

const t = key => game.i18n.localize(`MORTAL_NEEDS.Dock.${key}`);
const action = (name, icon, label, extra = '') => `<button type="button" data-action="${name}" aria-label="${h(label)}" title="${h(label)}" ${extra}><i class="fas ${icon}" aria-hidden="true"></i></button>`;

/** A small persistent play surface. Configuration remains in Foundry windows. */
export class MortalNeedsDock {
  #store; #engine; #bus; #config; #adapter; #app;
  #element = null; #inspector = null; #selected = null; #pinned = false;
  #unsubscribers = []; #renderFrame = null; #gesture = null; #hoverTimer = null;
  #collapsed = false; #position = { left: 100, top: 120 }; #personalActor = null;
  #inspectionVersion = 0; #busy = new Set(); #abort = null;

  constructor(store, engine, eventBus, configManager, adapter, app) {
    this.#store = store; this.#engine = engine; this.#bus = eventBus;
    this.#config = configManager; this.#adapter = adapter; this.#app = app;
    const saved = this.#readState();
    this.#collapsed = !!saved.collapsed;
    this.#personalActor = saved.actorId || null;
    if (Number.isFinite(saved.left) && Number.isFinite(saved.top)) this.#position = { left: saved.left, top: saved.top };
  }

  get rendered() { return !!this.#element?.isConnected; }
  get element() { return this.#element; }
  get position() { return { ...this.#position }; }
  get #storageKey() { return `mortal-needs:dock:${game.world?.id || 'world'}:${game.user.id}`; }

  restore() { if (this.#readState().visible !== false) this.render(true); }

  render(force = false) {
    if (!this.rendered && !force) return this;
    if (!this.rendered) this.#mount();
    if (this.#gesture || this.#renderFrame) return this;
    this.#renderFrame = requestAnimationFrame(() => {
      this.#renderFrame = null;
      if (!this.rendered || this.#gesture) return;
      this.#paint();
    });
    return this;
  }

  #mount() {
    this.#abort = new AbortController();
    const signal = this.#abort.signal;
    const element = document.createElement('section');
    element.id = 'mortal-needs-dock';
    element.className = `mn-embers-dock${game.user.isGM ? '' : ' mn-embers-dock--personal'}`;
    element.setAttribute('aria-label', 'Mortal Needs');
    element.addEventListener('click', event => this.#onClick(event), { signal });
    element.addEventListener('pointerdown', event => this.#onPointerDown(event), { signal });
    element.addEventListener('keydown', event => this.#onKeyDown(event), { signal });
    element.addEventListener('pointerover', event => this.#onHover(event), { signal });
    element.addEventListener('pointerout', event => {
      if (!element.contains(event.relatedTarget)) this.#scheduleInspectorClose();
    }, { signal });
    element.addEventListener('change', event => {
      if (event.target.matches('[data-personal-actor]')) {
        this.#personalActor = event.target.value; this.#closeInspector(); this.#saveState(); this.render();
      }
    }, { signal });
    document.body.append(element);
    this.#element = element;
    window.addEventListener('resize', () => { this.#clamp(); this.#positionInspector(); }, { signal });
    window.addEventListener('blur', () => this.#endGesture(true), { signal });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && this.#gesture) { event.stopPropagation(); this.#endGesture(true); }
      else if (event.key === 'Escape' && this.#inspector) { event.stopPropagation(); this.#closeInspector(true); }
    }, { signal });
    for (const event of [Events.NEED_SET, Events.NEED_STRESSED, Events.NEED_RELIEVED, Events.ACTOR_TRACKED,
      Events.ACTOR_UNTRACKED, Events.CONFIG_CHANGED, Events.ACTORS_REFRESHED, Events.CONSEQUENCE_APPLIED, Events.CONSEQUENCE_REMOVED]) {
      this.#unsubscribers.push(this.#bus.on(event, () => this.render()));
    }
    this.#saveState();
  }

  #entities() {
    const all = this.#store.getAllTrackedActors().filter(entity => canViewEntity(entity.id, entity));
    if (game.user.isGM) return { rows: all, choices: [] };
    const owned = all.filter(entity => ownsEntity(entity.id, entity));
    const choices = owned.length ? owned : all;
    const selected = choices.find(entity => entity.id === this.#personalActor)
      || choices.find(entity => entity.id === game.user.character?.id) || choices[0];
    if (selected) this.#personalActor = selected.id;
    return { rows: selected ? [selected] : [], choices };
  }

  #paint() {
    const hidden = !game.user.isGM && game.settings.get(MODULE_ID, 'playerVisibility') === 'none';
    this.#element.style.display = hidden ? 'none' : '';
    if (hidden) { this.#closeInspector(); return; }
    const focus = this.#element.contains(document.activeElement) ? document.activeElement?.dataset?.focus : null;
    const scroll = this.#element.querySelector('.mn-dock-company')?.scrollTop || 0;
    const { rows, choices } = this.#entities();
    const configs = this.#store.getEnabledNeedConfigs();
    const critical = rows.filter(entity => configs.some(config => shouldDisplayNeed(config, entity.needs[config.id])
      && conditionView(config, entity.needs[config.id]).stress >= (game.settings.get(MODULE_ID, 'criticalThreshold') ?? 80))).length;
    this.#element.classList.toggle('is-collapsed', this.#collapsed);
    this.#element.innerHTML = `<header class="mn-dock-header" data-drag-handle>
      <img class="mn-dock-seal" src="modules/${MODULE_ID}/assets/icons/seal.svg" alt="">
      <div class="mn-dock-heading"><span class="mn-dock-wordmark">Mortal Needs</span><span class="mn-dock-caption">${h(game.user.isGM ? t('Company') : t('Personal'))}${critical ? ` · ${critical} ${h(t('AtRisk'))}` : ''}</span></div>
      ${game.user.isGM ? action('configure', 'fa-cog', t('Configure')) : ''}
      ${action('collapse', this.#collapsed ? 'fa-chevron-down' : 'fa-chevron-up', this.#collapsed ? t('Expand') : t('Collapse'), `aria-expanded="${!this.#collapsed}"`)}
      ${action('close', 'fa-times', t('Close'))}
    </header>
    ${this.#collapsed ? '' : `${choices.length > 1 ? `<label class="mn-personal-select">${h(t('Character'))}<select data-personal-actor>${choices.map(entity => `<option value="${h(entity.id)}" ${entity.id === this.#personalActor ? 'selected' : ''}>${h(entity.name)}</option>`).join('')}</select></label>` : ''}
      <div class="mn-dock-company">${rows.length ? rows.map(entity => this.#row(entity, configs)).join('') : `<div class="mn-dock-empty"><p>${h(game.user.isGM ? t('EmptyGM') : t('EmptyPlayer'))}</p>${game.user.isGM ? `<button type="button" data-action="actors">${h(t('ChooseCharacters'))}</button>` : ''}</div>`}</div>
      ${game.user.isGM ? `<footer class="mn-dock-footer"><button type="button" data-action="actors"><i class="fas fa-users" aria-hidden="true"></i> ${h(t('Company'))}</button><button type="button" data-action="stress">${h(t('Stress'))}</button><button type="button" data-action="relieve">${h(t('Relief'))}</button>${action('history', 'fa-history', t('History'))}${action('broadcast', 'fa-bullhorn', t('Broadcast'))}</footer>` : ''}`}`;
    this.#element.querySelector('.mn-dock-company')?.scrollTo({ top: scroll });
    if (focus) [...this.#element.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === focus)?.focus({ preventScroll: true });
    this.#clamp();
    if (this.#selected && !this.#collapsed) this.#inspect(this.#selected.entityId, this.#selected.needId, this.#pinned, true).catch(error => this.#error(error));
    this.#bus.emit(Events.UI_RENDERED, { compact: true });
  }

  #row(entity, configs) {
    // Hidden-at-zero needs stay available to the GM as faint controls.
    const visible = configs.filter(config => game.user.isGM || shouldDisplayNeed(config, entity.needs[config.id]));
    const worst = visible.map(config => ({ config, ...conditionView(config, entity.needs[config.id]) })).sort((a, b) => b.stress - a.stress)[0];
    const narratable = this.#app.flavorEngine?.getWorstVisibleNeed(entity.id);
    const portrait = isSafeImagePath(entity.img) ? entity.img : 'icons/svg/mystery-man.svg';
    return `<article class="mn-dock-actor" data-entity="${h(entity.id)}">
      <div class="mn-dock-portrait"><button type="button" data-action="sheet" data-entity="${h(entity.id)}" title="${h(t('OpenSheet'))}" aria-label="${h(t('OpenSheet') + ': ' + entity.name)}"><img src="${h(portrait)}" alt="${h(entity.name)}"></button>
      ${game.user.isGM && narratable ? action('narrate', 'fa-feather-alt', `${t('Narrate')}: ${game.i18n.localize(narratable.config.label)} · ${narratable.label}`, `data-entity="${h(entity.id)}"`) : ''}</div>
      <div class="mn-dock-actor-body"><div class="mn-dock-name"><strong>${h(entity.name)}</strong><span class="mn-state-${worst?.severity || 'safe'}">${h(worst?.label || t('NoNeeds'))}</span></div>
      <div class="mn-dock-needs">${visible.map(config => {
        const view = conditionView(config, entity.needs[config.id]);
        const editable = canEditNeed(entity.id, config.id, this.#store);
        const selected = this.#selected?.entityId === entity.id && this.#selected.needId === config.id;
        const label = game.i18n.localize(config.label);
        return `<div class="mn-dock-need mn-state-${view.severity}${selected ? ' is-selected' : ''}" style="--need-color:${needColor(config)}" data-need="${h(config.id)}" data-entity="${h(entity.id)}">
          <button type="button" class="mn-dock-need-button" data-action="inspect" data-focus="${h(entity.id + ':' + config.id)}" aria-label="${h(`${label}: ${view.value}/${view.max}. ${view.label}`)}" aria-pressed="${selected}">${needIcon(config)}${isGMOnlyNeed(config) ? '<i class="fas fa-lock mn-private-mark" aria-hidden="true"></i>' : ''}<span class="mn-need-critical-mark" aria-hidden="true">${view.severity === 'critical' ? '!' : ''}</span></button>
          <div class="mn-dock-meter" ${editable ? `role="slider" tabindex="0" aria-valuemin="${view.min}" aria-valuemax="${view.max}" aria-valuenow="${view.value}" aria-label="${h(label + '. ' + t('DragHint'))}" data-scrub data-focus="${h(entity.id + ':' + config.id + ':meter')}"` : `role="meter" aria-label="${h(label)}" aria-valuemin="${view.min}" aria-valuemax="${view.max}" aria-valuenow="${view.value}"`} style="--fill:${100 * (view.value - view.min) / Math.max(1, view.max - view.min)}%"><span></span><b></b></div>
        </div>`;
      }).join('')}</div></div></article>`;
  }

  async #onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    const cmd = button.dataset.action;
    const cell = button.closest('[data-need]');
    const entityId = button.dataset.entity || cell?.dataset.entity;
    try {
      if (cmd === 'inspect') return this.#inspect(entityId, cell.dataset.need, true);
      if (cmd === 'close') return this.close();
      if (cmd === 'collapse') { this.#collapsed = !this.#collapsed; this.#closeInspector(); this.#saveState(); return this.render(); }
      if (cmd === 'sheet') return resolveEntityActor(entityId, this.#store.getTrackedEntityInfo(entityId))?.sheet?.render(true);
      if (cmd === 'narrate') { button.disabled = true; await this.#app.flavorEngine.narrateWorst(entityId); button.disabled = false; return; }
      if (!game.user.isGM) return;
      if (cmd === 'configure') {
        const { NeedsConfigDialog } = await import('./dialogs/needs-config-dialog.js');
        new NeedsConfigDialog(this.#store, this.#config, this.#bus).render(true);
      } else if (cmd === 'actors') {
        const { ActorSelectionDialog } = await import('./dialogs/actor-selection-dialog.js');
        new ActorSelectionDialog(this.#store, this.#app).render(true);
      } else if (cmd === 'stress' || cmd === 'relieve') {
        const { MultiStressDialog } = await import('./dialogs/multi-stress-dialog.js');
        new MultiStressDialog(this.#store, this.#engine, cmd).render(true);
      } else if (cmd === 'history') {
        const { HistoryDialog } = await import('./dialogs/history-dialog.js');
        new HistoryDialog(this.#store, this.#bus).render(true);
      } else if (cmd === 'broadcast') {
        const api = game.modules.get(MODULE_ID).api;
        await (game.settings.get(MODULE_ID, 'broadcastState')?.visible ? api.broadcast.hide() : api.broadcast.show());
      }
    } catch (error) { this.#error(error); button.disabled = false; }
  }

  #onHover(event) {
    const cell = event.target.closest('[data-need]');
    if (!cell || cell.contains(event.relatedTarget) || this.#pinned || this.#gesture) return;
    clearTimeout(this.#hoverTimer);
    this.#hoverTimer = setTimeout(() => this.#inspect(cell.dataset.entity, cell.dataset.need, false), 350);
  }

  async #inspect(entityId, needId, pinned = false, refresh = false) {
    const config = this.#store.getNeedConfig(needId);
    const entity = this.#store.getTrackedEntityInfo(entityId);
    if (!entity || !config || !canViewEntity(entityId, entity)
      || (!game.user.isGM && !shouldDisplayNeed(config, this.#store.getActorNeedState(entityId, needId)))) return this.#closeInspector();
    clearTimeout(this.#hoverTimer);
    this.#selected = { entityId, needId }; this.#pinned = pinned;
    const version = ++this.#inspectionVersion;
    const state = conditionView(config, this.#store.getActorNeedState(entityId, needId));
    const editable = canEditNeed(entityId, needId, this.#store);
    const effects = await this.#app.consequenceEngine.getConsequenceStatus(entityId, needId);
    if (version !== this.#inspectionVersion || !this.rendered) return;
    if (!this.#inspector) {
      this.#inspector = document.createElement('aside');
      this.#inspector.className = 'mn-condition-inspector';
      this.#inspector.setAttribute('role', 'dialog');
      this.#inspector.addEventListener('pointerenter', () => clearTimeout(this.#hoverTimer));
      this.#inspector.addEventListener('pointerleave', () => this.#scheduleInspectorClose());
      this.#inspector.addEventListener('click', event => this.#inspectorAction(event));
      this.#inspector.addEventListener('submit', event => {
        event.preventDefault();
        const input = this.#inspector.querySelector('[name="value"]');
        if (input?.checkValidity() && this.#selected) {
          input.dataset.dirty = '';
          this.#commit(this.#selected.entityId, this.#selected.needId, Number(input.value));
        }
      });
      this.#inspector.addEventListener('input', event => { if (event.target.name === 'value') event.target.dataset.dirty = 'true'; });
      this.#inspector.addEventListener('focusin', () => { this.#pinned = true; clearTimeout(this.#hoverTimer); });
      document.body.append(this.#inspector);
    }
    this.#inspector.setAttribute('aria-label', `${entity.name}: ${game.i18n.localize(config.label)}`);
    this.#inspector.style.setProperty('--need-color', needColor(config));
    // Keep an in-progress exact-value edit intact during unrelated updates.
    const editing = refresh && document.activeElement?.matches('[name="value"][data-dirty="true"]') && this.#inspector.contains(document.activeElement);
    if (!editing) this.#inspector.innerHTML = `<header>${needIcon(config)}<div><small>${h(entity.name)}</small><h3>${h(game.i18n.localize(config.label))}</h3></div>${action('dismiss', 'fa-times', t('Close'))}</header>
      <div class="mn-condition-state mn-state-${state.severity}"><strong>${h(state.label)}</strong><span>${state.value}<small> / ${state.max}</small></span></div>
      <div class="mn-condition-track" style="--fill:${state.stress}%"><span></span></div>
      <p class="mn-condition-direction">${h(t(config.inverted ? 'LowerWorse' : 'HigherWorse'))}</p>
      ${editable ? `<form class="mn-condition-controls">${action('minus', 'fa-minus', t('Decrease'))}<input name="value" type="number" min="${state.min}" max="${state.max}" step="1" value="${state.value}" aria-label="${h(t('ExactValue'))}"><button type="submit">${h(t('Set'))}</button>${action('plus', 'fa-plus', t('Increase'))}</form><p class="mn-condition-hint">${h(t('DragHint'))}</p>` : ''}
      <section class="mn-condition-effects"><h4>${h(t('Effects'))}</h4>${effects.length ? effects.map(effect => `<div class="mn-condition-effect ${effect.active ? 'is-active' : ''}"><span class="mn-effect-dot" aria-hidden="true"></span><div><strong>${h(effect.description)}</strong><small>${h(effect.error ? t('EffectFailed') : effect.active ? t('Active') : t('Inactive'))} · ${effect.threshold}% ${h(t('StressWord'))}</small>${effect.error ? `<small>${h(effect.error)}</small>` : ''}</div>${game.user.isGM && effect.removable ? action('remove', 'fa-times', t('RemoveEffect'), `data-effect="${h(effect.id)}"`) : ''}</div>`).join('') : `<p>${h(t('NarrativeOnly'))}</p>`}</section>
      <section class="mn-condition-recovery"><h4>${h(t('Recovery'))}</h4><p>${h(config.recovery || recoveryDescription(config))}</p></section>
      ${game.user.isGM ? `<footer><button type="button" data-action="edit-rule"><i class="fas fa-cog" aria-hidden="true"></i> ${h(t('EditRule'))}</button>${isGMOnlyNeed(config) ? `<small><i class="fas fa-lock" aria-hidden="true"></i> ${h(t('Private'))}</small>` : ''}</footer>` : ''}`;
    this.#positionInspector();
    if (pinned && !refresh) this.#inspector.querySelector('[name="value"], button')?.focus({ preventScroll: true });
    for (const cell of this.#element.querySelectorAll('[data-need]')) {
      const selected = cell.dataset.entity === entityId && cell.dataset.need === needId;
      cell.classList.toggle('is-selected', selected);
      cell.querySelector('[aria-pressed]')?.setAttribute('aria-pressed', String(selected));
    }
  }

  async #inspectorAction(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !this.#selected) return;
    const { entityId, needId } = this.#selected;
    try {
      if (button.dataset.action === 'dismiss') return this.#closeInspector(true);
      if (button.dataset.action === 'minus' || button.dataset.action === 'plus') {
        const value = this.#store.getActorNeedState(entityId, needId).value;
        return this.#commit(entityId, needId, value + (button.dataset.action === 'plus' ? 1 : -1) * (event.shiftKey ? 5 : 1));
      }
      if (!game.user.isGM) return;
      if (button.dataset.action === 'edit-rule') {
        const { NeedEditDialog } = await import('./dialogs/need-edit-dialog.js');
        new NeedEditDialog(needId, this.#store, this.#config, this.#bus).render(true);
      } else if (button.dataset.action === 'remove') {
        button.disabled = true;
        const effects = await this.#app.consequenceEngine.getConsequenceStatus(entityId, needId);
        const effect = effects.find(entry => entry.id === button.dataset.effect);
        if (effect) await this.#app.consequenceEngine.removeConsequence(resolveEntityActor(entityId, this.#store.getTrackedEntityInfo(entityId)), entityId, needId, effect.config);
        this.#inspect(entityId, needId, true);
      }
    } catch (error) { this.#error(error); }
  }

  #onPointerDown(event) {
    if (event.button !== 0 || this.#gesture) return;
    const handle = event.target.closest('[data-drag-handle]');
    const meter = event.target.closest('[data-scrub]');
    if (!meter && (!handle || event.target.closest('button,select,input'))) return;
    event.preventDefault();
    const target = meter || handle;
    if (meter) {
      const { entity, need } = meter.closest('[data-need]').dataset;
      if (!canEditNeed(entity, need, this.#store)) return;
      const state = this.#store.getActorNeedState(entity, need);
      const config = this.#store.getNeedConfig(need);
      this.#gesture = { type: 'scrub', entityId: entity, needId: need, session: new ScrubSession(state.value, event.clientX, config), target, pointerId: event.pointerId };
      meter.focus({ preventScroll: true });
      this.#closeInspector();
    } else {
      this.#gesture = { type: 'dock', x: event.clientX, y: event.clientY, origin: { ...this.#position }, target, pointerId: event.pointerId };
    }
    target.setPointerCapture(event.pointerId);
    const move = moveEvent => this.#moveGesture(moveEvent);
    const up = () => this.#endGesture(false);
    const cancel = () => this.#endGesture(true);
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', cancel);
    target.addEventListener('lostpointercapture', cancel);
    this.#gesture.cleanup = () => {
      target.removeEventListener('pointermove', move); target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', cancel); target.removeEventListener('lostpointercapture', cancel);
      if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    };
    this.#element.classList.add('is-dragging');
  }

  #moveGesture(event) {
    const gesture = this.#gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    if (gesture.type === 'dock') {
      this.#position = { left: gesture.origin.left + event.clientX - gesture.x, top: gesture.origin.top + event.clientY - gesture.y };
      this.#clamp(); this.#positionInspector();
    } else {
      const value = gesture.session.move(event.clientX, event.shiftKey);
      gesture.target.style.setProperty('--fill', `${100 * (value - gesture.session.min) / Math.max(1, gesture.session.max - gesture.session.min)}%`);
      gesture.target.setAttribute('aria-valuenow', value);
      gesture.target.dataset.preview = `${value}`;
    }
  }

  #endGesture(cancelled) {
    const gesture = this.#gesture;
    if (!gesture) return;
    this.#gesture = null;
    gesture.cleanup?.(); this.#element?.classList.remove('is-dragging');
    if (gesture.type === 'dock') {
      if (cancelled) this.#position = gesture.origin;
      this.#clamp(); this.#saveState();
    } else {
      const value = gesture.session.finish(cancelled);
      const current = this.#store.getActorNeedState(gesture.entityId, gesture.needId)?.value;
      if (value !== null && current === gesture.session.startValue) this.#commit(gesture.entityId, gesture.needId, value);
      else if (value !== null) ui.notifications.warn(t('ChangedDuringDrag'));
      else if (!cancelled && !gesture.session.moved) this.#inspect(gesture.entityId, gesture.needId, true);
    }
    this.render();
  }

  #onKeyDown(event) {
    const meter = event.target.closest('[data-scrub]');
    if (!meter) return;
    const { entity, need } = meter.closest('[data-need]').dataset;
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); return this.#inspect(entity, need, true); }
    const state = this.#store.getActorNeedState(entity, need), config = this.#store.getNeedConfig(need);
    const step = event.shiftKey ? 5 : 1;
    const values = { ArrowRight: state.value + step, ArrowUp: state.value + step, ArrowLeft: state.value - step, ArrowDown: state.value - step, Home: config.min, End: config.max };
    if (Object.hasOwn(values, event.key)) { event.preventDefault(); this.#commit(entity, need, values[event.key]); }
  }

  async #commit(entityId, needId, value) {
    if (!canEditNeed(entityId, needId, this.#store)) return;
    const key = `${entityId}:${needId}`;
    this.#busy.add(key); this.#element?.setAttribute('aria-busy', 'true');
    try { await this.#engine.setNeed(entityId, needId, value, { source: 'dock' }); }
    catch (error) { this.#error(error); }
    finally { this.#busy.delete(key); this.#element?.setAttribute('aria-busy', String(this.#busy.size > 0)); this.render(); }
  }

  #scheduleInspectorClose() {
    clearTimeout(this.#hoverTimer);
    if (!this.#pinned) this.#hoverTimer = setTimeout(() => this.#closeInspector(), 200);
  }
  #closeInspector(focus = false) {
    clearTimeout(this.#hoverTimer); this.#inspectionVersion++;
    const selected = this.#selected;
    this.#selected = null; this.#pinned = false;
    this.#inspector?.remove(); this.#inspector = null;
    for (const cell of this.#element?.querySelectorAll('.is-selected') || []) {
      cell.classList.remove('is-selected');
      cell.querySelector('[aria-pressed]')?.setAttribute('aria-pressed', 'false');
    }
    if (focus && selected) [...this.#element.querySelectorAll('[data-focus]')].find(el => el.dataset.focus === `${selected.entityId}:${selected.needId}`)?.focus();
  }
  #positionInspector() {
    if (!this.#inspector || !this.#element) return;
    const anchor = [...this.#element.querySelectorAll('[data-need]')].find(el => el.dataset.entity === this.#selected?.entityId && el.dataset.need === this.#selected?.needId);
    const rect = anchor?.getBoundingClientRect() || this.#element.getBoundingClientRect();
    const dock = this.#element.getBoundingClientRect();
    const width = this.#inspector.offsetWidth, height = this.#inspector.offsetHeight;
    const left = dock.right + width + 18 < window.innerWidth ? dock.right + 10 : dock.left - width - 10;
    this.#inspector.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, left))}px`;
    this.#inspector.style.top = `${Math.max(8, Math.min(window.innerHeight - height - 8, rect.top - 12))}px`;
  }
  #clamp() {
    if (!this.#element) return;
    this.#position.left = Math.max(8, Math.min(window.innerWidth - this.#element.offsetWidth - 8, this.#position.left));
    this.#position.top = Math.max(8, Math.min(window.innerHeight - this.#element.offsetHeight - 8, this.#position.top));
    Object.assign(this.#element.style, { left: `${this.#position.left}px`, top: `${this.#position.top}px` });
  }
  #readState() { try { return JSON.parse(localStorage.getItem(this.#storageKey)) || {}; } catch { return {}; } }
  #saveState(visible = true) { try { localStorage.setItem(this.#storageKey, JSON.stringify({ ...this.#position, collapsed: this.#collapsed, actorId: this.#personalActor, visible })); } catch { /* Storage may be disabled by the browser. */ } }
  #error(error) { console.error('Mortal Needs | Dock action failed:', error); ui.notifications.error(t('SaveFailed')); }
  async close() {
    this.#endGesture(true); this.#closeInspector();
    if (this.#renderFrame) cancelAnimationFrame(this.#renderFrame);
    this.#renderFrame = null; this.#abort?.abort();
    for (const unsubscribe of this.#unsubscribers) unsubscribe();
    this.#unsubscribers = []; this.#saveState(false);
    this.#element?.remove(); this.#element = null;
  }
}

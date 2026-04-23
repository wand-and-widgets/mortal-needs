import { MODULE_ID, Events } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';

/**
 * SessionFlow widget for Mortal Needs.
 * Full-featured control center: actor management, per-need controls,
 * broadcast to players, and flash popup.
 *
 * Uses a factory function because the Widget base class is only
 * available when SessionFlow is active.
 */
export function createMortalNeedsWidgetClass() {
  const sf = game.modules.get('sessionflow');
  if (!sf?.active || !sf.api?.Widget) return null;

  const Widget = sf.api.Widget;

  class MortalNeedsWidget extends Widget {
    static TYPE = 'mortal-needs';
    static LABEL = 'MORTAL_NEEDS.SessionFlow.WidgetLabel';
    static ICON = 'fas fa-skull';
    static MIN_WIDTH = 220;
    static MIN_HEIGHT = 120;
    static DEFAULT_WIDTH = 340;
    static DEFAULT_HEIGHT = 320;
    static MAX_INSTANCES = 1;

    #hookIds = [];
    #restored = false;

    renderBody(bodyEl) {
      bodyEl.innerHTML = '';

      const container = document.createElement('div');
      container.className = 'mn-sf-widget';

      const api = game.modules.get(MODULE_ID)?.api;
      if (!api) {
        container.innerHTML = `<p class="mn-sf-widget__empty">Mortal Needs not ready</p>`;
        bodyEl.appendChild(container);
        return;
      }

      // --- GM Toolbar ---
      if (game.user.isGM) {
        container.appendChild(this.#buildToolbar(api));
      }

      const tracked = api.actors.getTracked();
      const enabledNeeds = api.config.getEnabledNeeds();

      if (tracked.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'mn-sf-widget__empty';
        empty.textContent = game.i18n.localize('MORTAL_NEEDS.SessionFlow.NoTracked');
        container.appendChild(empty);
        bodyEl.appendChild(container);
        this.#setupHooks();
        this.#restoreBroadcast(api);
        return;
      }

      // --- Actor Cards ---
      for (const entity of tracked) {
        container.appendChild(this.#buildActorCard(entity, enabledNeeds, api));
      }

      bodyEl.appendChild(container);
      this.#setupHooks();
      this.#restoreBroadcast(api);
    }

    // ─── Toolbar ──────────────────────────────────────────────

    #buildToolbar(api) {
      const toolbar = document.createElement('div');
      toolbar.className = 'mn-sf-widget__toolbar';

      // Add Actors
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-user-plus', 'MORTAL_NEEDS.SessionFlow.AddActors',
        () => this.#openActorSelection(),
      ));

      // Toggle Needs
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-sliders-h', 'MORTAL_NEEDS.SessionFlow.ToggleNeeds',
        () => this.#openNeedsToggle(api),
      ));

      // Stress All (opens multi-stress dialog)
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-arrow-up', 'MORTAL_NEEDS.Toolbar.StressAll',
        () => this.#openMultiStress('stress'),
      ));

      // Relieve All (opens multi-stress dialog)
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-arrow-down', 'MORTAL_NEEDS.Toolbar.RelieveAll',
        () => this.#openMultiStress('relieve'),
      ));

      // Reset All
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-undo-alt', 'MORTAL_NEEDS.SessionFlow.ResetAll',
        () => this.#resetAllNeeds(api),
      ));

      // Separator
      const sep = document.createElement('div');
      sep.className = 'mn-sf-widget__toolbar-sep';
      toolbar.appendChild(sep);

      // Broadcast (toggle)
      const broadcastBtn = this.#createToolbarBtn(
        'fa-tv', 'MORTAL_NEEDS.SessionFlow.Broadcast',
        () => this.#toggleBroadcast(api),
      );
      if (this.config?.broadcasting) broadcastBtn.classList.add('is-active');
      broadcastBtn.dataset.role = 'broadcast';
      toolbar.appendChild(broadcastBtn);

      // Flash (one-shot)
      toolbar.appendChild(this.#createToolbarBtn(
        'fa-bolt', 'MORTAL_NEEDS.SessionFlow.Flash',
        () => this.#flashNeeds(api),
      ));

      return toolbar;
    }

    #createToolbarBtn(icon, locKey, onClick) {
      const btn = document.createElement('button');
      btn.className = 'mn-sf-widget__toolbar-btn';
      btn.innerHTML = `<i class="fas ${icon}"></i>`;
      btn.title = game.i18n.localize(locKey);
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return btn;
    }

    // ─── Actor Card ───────────────────────────────────────────

    #buildActorCard(entity, enabledNeeds, api) {
      const orientation = game.settings.get(MODULE_ID, 'barOrientation') ?? 'horizontal';
      const actorEl = document.createElement('div');
      actorEl.className = 'mn-sf-widget__actor';

      // Portrait
      const portrait = document.createElement('img');
      portrait.className = 'mn-sf-widget__portrait';
      portrait.src = entity.img;
      portrait.alt = entity.name;
      actorEl.appendChild(portrait);

      // Info column (name + needs)
      const infoCol = document.createElement('div');
      infoCol.className = 'mn-sf-widget__info';

      // Header row (name + reset button)
      const header = document.createElement('div');
      header.className = 'mn-sf-widget__actor-header';

      const nameEl = document.createElement('span');
      nameEl.className = 'mn-sf-widget__name';
      nameEl.textContent = entity.name;
      header.appendChild(nameEl);

      if (game.user.isGM) {
        const resetBtn = document.createElement('button');
        resetBtn.className = 'mn-sf-widget__reset-btn';
        resetBtn.innerHTML = '<i class="fas fa-undo"></i>';
        resetBtn.title = game.i18n.localize('MORTAL_NEEDS.SessionFlow.ResetActor');
        resetBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.resetAll(entity.id);
        });
        header.appendChild(resetBtn);
      }

      infoCol.appendChild(header);

      // Needs
      const needsCol = document.createElement('div');
      needsCol.className = 'mn-sf-widget__needs';
      if (orientation === 'vertical') needsCol.classList.add('mn-sf-widget__needs--vertical');
      else if (orientation === 'radial') needsCol.classList.add('mn-sf-widget__needs--radial');

      for (const config of enabledNeeds) {
        needsCol.appendChild(this.#buildNeedRow(entity, config, api, orientation));
      }

      infoCol.appendChild(needsCol);
      actorEl.appendChild(infoCol);

      return actorEl;
    }

    // ─── Need Row (with per-need +/- controls) ───────────────

    #buildNeedRow(entity, config, api, orientation = 'horizontal') {
      const state = entity.needs[config.id];
      const value = NeedsEngine.normalizeNumber(state?.value, 0);
      const max = NeedsEngine.normalizeNumber(state?.max ?? config.max, 100);
      const percentage = NeedsEngine.getPercentage(value, max);
      const severity = NeedsEngine.getSeverity(percentage);
      const decimal = NeedsEngine.getRatio(value, max);
      const tooltip = `${game.i18n.localize(config.label)}: ${value}/${max} (${percentage}%)`;

      if (orientation === 'radial') return this.#buildNeedRadial(entity, config, api, severity, decimal, tooltip);
      if (orientation === 'vertical') return this.#buildNeedVertical(entity, config, api, severity, decimal, percentage, tooltip);
      return this.#buildNeedHorizontal(entity, config, api, severity, decimal, tooltip);
    }

    #buildNeedHorizontal(entity, config, api, severity, decimal, tooltip) {
      const needEl = document.createElement('div');
      needEl.className = 'mn-sf-widget__need';
      needEl.title = tooltip;

      // Icon
      const icon = document.createElement('span');
      icon.className = 'mn-sf-widget__need-icon';
      icon.innerHTML = `<i class="fas ${config.icon}"></i>`;
      needEl.appendChild(icon);

      // Track + fill
      const track = document.createElement('div');
      track.className = 'mn-sf-widget__need-track';

      const fill = document.createElement('div');
      fill.className = 'mn-sf-widget__need-fill';
      fill.dataset.severity = severity;
      fill.style.transform = `scaleX(${decimal})`;
      track.appendChild(fill);
      needEl.appendChild(track);

      // Per-need +/- controls (GM only)
      if (game.user.isGM) {
        const controls = document.createElement('div');
        controls.className = 'mn-sf-widget__need-controls';

        const relieveBtn = document.createElement('button');
        relieveBtn.className = 'mn-sf-widget__need-btn';
        relieveBtn.innerHTML = '<i class="fas fa-minus"></i>';
        relieveBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Relieve');
        relieveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.relieve(entity.id, config.id);
        });

        const stressBtn = document.createElement('button');
        stressBtn.className = 'mn-sf-widget__need-btn';
        stressBtn.innerHTML = '<i class="fas fa-plus"></i>';
        stressBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Stress');
        stressBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.stress(entity.id, config.id);
        });

        controls.appendChild(relieveBtn);
        controls.appendChild(stressBtn);
        needEl.appendChild(controls);
      }

      return needEl;
    }

    #buildNeedVertical(entity, config, api, severity, decimal, percentage, tooltip) {
      const needEl = document.createElement('div');
      needEl.className = 'mn-sf-widget__need mn-sf-widget__need--vertical';
      needEl.title = tooltip;

      // Icon
      const icon = document.createElement('span');
      icon.className = 'mn-sf-widget__need-icon';
      icon.dataset.severity = severity;
      icon.innerHTML = `<i class="fas ${config.icon}"></i>`;
      needEl.appendChild(icon);

      // Vertical track + fill
      const track = document.createElement('div');
      track.className = 'mn-sf-widget__need-track mn-sf-widget__need-track--vertical';

      const fill = document.createElement('div');
      fill.className = 'mn-sf-widget__need-fill mn-sf-widget__need-fill--vertical';
      fill.dataset.severity = severity;
      fill.style.transform = `scaleY(${decimal})`;
      track.appendChild(fill);
      needEl.appendChild(track);

      // Percentage
      const pct = document.createElement('span');
      pct.className = 'mn-sf-widget__need-pct';
      pct.dataset.severity = severity;
      pct.textContent = percentage;
      needEl.appendChild(pct);

      // +/- controls (GM only)
      if (game.user.isGM) {
        const controls = document.createElement('div');
        controls.className = 'mn-sf-widget__need-controls';

        const relieveBtn = document.createElement('button');
        relieveBtn.className = 'mn-sf-widget__need-btn';
        relieveBtn.innerHTML = '<i class="fas fa-minus"></i>';
        relieveBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Relieve');
        relieveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.relieve(entity.id, config.id);
        });

        const stressBtn = document.createElement('button');
        stressBtn.className = 'mn-sf-widget__need-btn';
        stressBtn.innerHTML = '<i class="fas fa-plus"></i>';
        stressBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Stress');
        stressBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.stress(entity.id, config.id);
        });

        controls.appendChild(relieveBtn);
        controls.appendChild(stressBtn);
        needEl.appendChild(controls);
      }

      return needEl;
    }

    #buildNeedRadial(entity, config, api, severity, decimal, tooltip) {
      const r = 14;
      const circumference = 2 * Math.PI * r;
      const dashOffset = circumference * (1 - decimal);

      const needEl = document.createElement('div');
      needEl.className = 'mn-sf-widget__need mn-sf-widget__need--radial';
      needEl.title = tooltip;

      // SVG ring
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'mn-sf-widget__ring');
      svg.setAttribute('viewBox', '0 0 32 32');

      const trackCircle = document.createElementNS(svgNS, 'circle');
      trackCircle.setAttribute('class', 'mn-sf-widget__ring-track');
      trackCircle.setAttribute('cx', '16');
      trackCircle.setAttribute('cy', '16');
      trackCircle.setAttribute('r', String(r));
      svg.appendChild(trackCircle);

      const fillCircle = document.createElementNS(svgNS, 'circle');
      fillCircle.setAttribute('class', 'mn-sf-widget__ring-fill');
      fillCircle.dataset.severity = severity;
      fillCircle.setAttribute('cx', '16');
      fillCircle.setAttribute('cy', '16');
      fillCircle.setAttribute('r', String(r));
      fillCircle.setAttribute('stroke-dasharray', String(circumference));
      fillCircle.setAttribute('stroke-dashoffset', String(dashOffset));
      svg.appendChild(fillCircle);

      // Wrap SVG + icon in a positioned container
      const ringWrap = document.createElement('div');
      ringWrap.className = 'mn-sf-widget__ring-wrap';
      ringWrap.appendChild(svg);

      const iconEl = document.createElement('span');
      iconEl.className = 'mn-sf-widget__radial-icon';
      iconEl.innerHTML = `<i class="fas ${config.icon}"></i>`;
      ringWrap.appendChild(iconEl);

      needEl.appendChild(ringWrap);

      // +/- controls (GM only)
      if (game.user.isGM) {
        const controls = document.createElement('div');
        controls.className = 'mn-sf-widget__need-controls';

        const relieveBtn = document.createElement('button');
        relieveBtn.className = 'mn-sf-widget__need-btn';
        relieveBtn.innerHTML = '<i class="fas fa-minus"></i>';
        relieveBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Relieve');
        relieveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.relieve(entity.id, config.id);
        });

        const stressBtn = document.createElement('button');
        stressBtn.className = 'mn-sf-widget__need-btn';
        stressBtn.innerHTML = '<i class="fas fa-plus"></i>';
        stressBtn.title = game.i18n.localize('MORTAL_NEEDS.Actions.Stress');
        stressBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await api.needs.stress(entity.id, config.id);
        });

        controls.appendChild(relieveBtn);
        controls.appendChild(stressBtn);
        needEl.appendChild(controls);
      }

      return needEl;
    }

    // ─── Toolbar Actions ──────────────────────────────────────

    async #openMultiStress(mode) {
      const api = game.modules.get(MODULE_ID)?.api;
      if (!api) return;

      // Duck-typed proxies matching what MultiStressDialog expects
      const storeProxy = {
        getAllTrackedActors: () => api.actors.getTracked(),
        getEnabledNeedConfigs: () => api.config.getEnabledNeeds(),
      };
      const engineProxy = {
        stressMultiple: (ids, amounts) => api.batch.stressMultiple(ids, amounts),
        relieveMultiple: (ids, amounts) => api.batch.relieveMultiple(ids, amounts),
      };

      const { MultiStressDialog } = await import('../ui/dialogs/multi-stress-dialog.js');
      new MultiStressDialog(storeProxy, engineProxy, mode).render(true);
    }

    async #openActorSelection() {
      const { ActorSelectionDialog } = await import('../ui/dialogs/actor-selection-dialog.js');
      new ActorSelectionDialog().render(true);
    }

    async #openNeedsToggle(api) {
      const allNeeds = api.config.getAllNeeds();

      const content = allNeeds.map(n => {
        const label = game.i18n.localize(n.label);
        const checked = n.enabled ? 'checked' : '';
        return `<label style="display:flex; align-items:center; gap:6px; padding:4px 6px; cursor:pointer;">
          <input type="checkbox" name="need-${n.id}" value="${n.id}" ${checked}>
          <i class="fas ${n.icon}" style="width:16px; text-align:center; color:#b3b3b3;"></i>
          <span style="color:#e0e0e0; font-size:12px;">${label}</span>
        </label>`;
      }).join('');

      const wrapper = `<div style="max-height:300px; overflow-y:auto; display:flex; flex-direction:column; gap:2px;">${content}</div>`;

      const result = await foundry.applications.api.DialogV2.wait({
        window: {
          title: game.i18n.localize('MORTAL_NEEDS.SessionFlow.ToggleNeeds'),
          icon: 'fas fa-sliders-h',
        },
        content: wrapper,
        buttons: [{
          action: 'apply',
          label: game.i18n.localize('MORTAL_NEEDS.SessionFlow.Apply'),
          icon: 'fas fa-check',
          callback: (event, button, dialog) => {
            const checked = new Set();
            // In Foundry v13, dialog is an ApplicationV2 instance — use .element for the HTMLElement
            dialog.element.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => checked.add(cb.value));
            return checked;
          },
        }, {
          action: 'cancel',
          label: game.i18n.localize('Cancel'),
        }],
        classes: ['mortal-needs-panel'],
      });

      if (result instanceof Set) {
        let changed = false;
        for (const need of allNeeds) {
          if (result.has(need.id) && !need.enabled) {
            api.config.enableNeed(need.id);
            changed = true;
          } else if (!result.has(need.id) && need.enabled) {
            api.config.disableNeed(need.id);
            changed = true;
          }
        }
        if (changed) {
          await game.settings.set(MODULE_ID, 'needsConfig', api.config.getAllNeeds());
        }
      }
    }

    async #resetAllNeeds(api) {
      const tracked = api.actors.getTracked();
      if (tracked.length === 0) return;
      for (const entity of tracked) {
        await api.needs.resetAll(entity.id);
      }
    }

    // ─── Broadcast / Flash ────────────────────────────────────

    #toggleBroadcast(api) {
      if (this.config?.broadcasting) {
        api.broadcast.hide();
        this.updateConfig({ broadcasting: false });
      } else {
        api.broadcast.show();
        this.updateConfig({ broadcasting: true });
      }
      // Update button visual immediately
      const btn = this.element?.querySelector('[data-role="broadcast"]');
      if (btn) btn.classList.toggle('is-active', this.config.broadcasting);
    }

    #flashNeeds(api) {
      api.broadcast.flash();
    }

    #restoreBroadcast(api) {
      if (this.#restored) return;
      this.#restored = true;

      // On first render, re-show broadcast if it was active but the HUD
      // is gone (e.g. after page refresh). Check the HUD DOM element directly.
      if (this.config?.broadcasting && game.user.isGM) {
        const hud = document.getElementById('mn-broadcast-hud');
        const isHudVisible = hud && hud.style.display !== 'none';
        if (!isHudVisible) {
          requestAnimationFrame(() => api.broadcast.show());
        }
      }
    }

    // ─── Lifecycle ────────────────────────────────────────────

    getTitle() {
      return game.i18n.localize('MORTAL_NEEDS.SessionFlow.WidgetLabel');
    }

    beforeSave() {
      // Persist broadcast state
    }

    #setupHooks() {
      this.#cleanupHooks();
      const refresh = () => {
        if (this.element) this.refreshBody();
      };
      const events = [
        Events.NEED_STRESSED, Events.NEED_RELIEVED,
        Events.NEED_SET, Events.NEED_RESET,
        Events.ACTORS_REFRESHED, Events.ACTOR_TRACKED, Events.ACTOR_UNTRACKED,
        Events.CONFIG_CHANGED, Events.NEED_ENABLED, Events.NEED_DISABLED,
      ];
      for (const event of events) {
        const id = Hooks.on(event, refresh);
        this.#hookIds.push({ event, id });
      }
    }

    #cleanupHooks() {
      for (const { event, id } of this.#hookIds) {
        Hooks.off(event, id);
      }
      this.#hookIds = [];
    }

    destroy() {
      // Broadcast HUD lives independently in the DOM — don't hide it
      // when SessionFlow is just toggled closed. The GM can hide it
      // via the toggle button or the close button on the HUD itself.
      this.#cleanupHooks();
      super.destroy();
    }
  }

  return MortalNeedsWidget;
}

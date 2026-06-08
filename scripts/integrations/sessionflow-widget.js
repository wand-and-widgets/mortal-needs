import { MODULE_ID, Events } from '../constants.js';
import { NeedsEngine } from '../core/needs-engine.js';
import { filterDisplayNeedsForEntity } from '../core/need-visibility.js';

const AT_RISK_THRESHOLD = 60;
const RING_RADIUS = 14;

/**
 * SessionFlow widget for Mortal Needs.
 * Compact GM cockpit: triage summary, crisis queue, focused actor rows,
 * direct need controls, batch actions, broadcast, and flash.
 *
 * Uses a factory function because the Widget base class is only available
 * when SessionFlow is active.
 */
export function createMortalNeedsWidgetClass() {
  const sf = game.modules.get('sessionflow');
  if (!sf?.active || !sf.api?.Widget) return null;

  const Widget = sf.api.Widget;

  class MortalNeedsWidget extends Widget {
    static TYPE = 'mortal-needs';
    static LABEL = 'MORTAL_NEEDS.SessionFlow.WidgetLabel';
    static ICON = 'fas fa-skull';
    static MIN_WIDTH = 340;
    static MIN_HEIGHT = 420;
    static DEFAULT_WIDTH = 430;
    static DEFAULT_HEIGHT = 560;
    static MAX_INSTANCES = 1;

    #hookIds = [];
    #restored = false;
    #resizeObserver = null;
    #expandedActors = new Set();

    renderBody(bodyEl) {
      bodyEl.innerHTML = '';

      const container = document.createElement('div');
      container.className = 'mn-sf-widget mn-sf-widget--cockpit';

      const api = game.modules.get(MODULE_ID)?.api;
      if (!api) {
        container.appendChild(this.#buildEmptyState({
          icon: 'fa-heartbeat',
          title: 'Mortal Needs not ready',
          detail: null,
        }));
        bodyEl.appendChild(container);
        this.#observeSize(bodyEl, container);
        return;
      }

      if (game.user.isGM) {
        container.appendChild(this.#buildToolbar(api));
      }

      const tracked = api.actors.getTracked();
      const enabledNeeds = api.config.getEnabledNeeds();

      if (tracked.length === 0) {
        container.appendChild(this.#buildEmptyState({
          icon: 'fa-user-plus',
          title: game.i18n.localize('MORTAL_NEEDS.SessionFlow.NoTracked'),
          detail: game.user.isGM ? game.i18n.localize('MORTAL_NEEDS.SessionFlow.AddActors') : null,
          onAction: game.user.isGM ? () => this.#openActorSelection() : null,
        }));
        bodyEl.appendChild(container);
        this.#observeSize(bodyEl, container);
        this.#setupHooks();
        this.#restoreBroadcast(api);
        return;
      }

      const model = this.#buildCockpitModel(tracked, enabledNeeds);
      container.dataset.worstSeverity = model.worstSeverity;

      container.appendChild(this.#buildTriage(model));
      if (game.user.isGM) {
        container.appendChild(this.#buildCrisisQueue(model, api));
      }
      container.appendChild(this.#buildActorList(model, api));
      if (game.user.isGM) {
        container.appendChild(this.#buildQuickFooter(api));
      }

      bodyEl.appendChild(container);
      this.#observeSize(bodyEl, container);
      this.#setupHooks();
      this.#restoreBroadcast(api);
    }

    #buildCockpitModel(tracked, enabledNeeds) {
      const criticalThreshold = this.#getSetting('criticalThreshold', 80);
      const barOrientation = this.#getBarOrientation();
      let totalStress = 0;
      let totalNeeds = 0;
      const crisisQueue = [];

      const actors = tracked.map(entity => {
        const displayConfigs = filterDisplayNeedsForEntity(enabledNeeds, entity.needs, { user: game.user });
        const needs = displayConfigs
          .map(config => this.#buildNeedView(entity, config, criticalThreshold))
          .filter(Boolean);

        let worstNeed = null;
        for (const need of needs) {
          totalStress += need.stressPercentage;
          totalNeeds += 1;

          if (!worstNeed || need.stressPercentage > worstNeed.stressPercentage) {
            worstNeed = need;
          }

          if (need.stressPercentage >= AT_RISK_THRESHOLD) {
            crisisQueue.push({
              actorId: entity.id,
              actorName: entity.name,
              actorImg: entity.img,
              needId: need.id,
              needLabel: need.localizedLabel,
              needIcon: need.icon,
              stressPercentage: need.stressPercentage,
              stressPercentageLabel: need.stressPercentageLabel,
              severity: need.severity,
              severityLabel: need.severityLabel,
            });
          }
        }

        const criticalNeedCount = needs.filter(need => need.isCritical).length;
        const atRiskNeedCount = needs.filter(need => need.isAtRisk).length;
        const focusedNeeds = this.#selectFocusedNeeds(needs, worstNeed);

        return {
          id: entity.id,
          name: entity.name,
          img: entity.img,
          source: entity.source,
          needs,
          focusedNeeds,
          hiddenNeedCount: Math.max(0, needs.length - focusedNeeds.length),
          worstNeed,
          worstSeverity: worstNeed?.severity ?? 'safe',
          worstNeedLabel: worstNeed?.localizedLabel ?? game.i18n.localize('MORTAL_NEEDS.Panel.Stable'),
          worstNeedPercent: worstNeed?.stressPercentageLabel ?? '0%',
          criticalNeedCount,
          atRiskNeedCount,
          expanded: this.#expandedActors.has(entity.id),
        };
      });

      crisisQueue.sort((a, b) => b.stressPercentage - a.stressPercentage || a.actorName.localeCompare(b.actorName));

      const criticalCount = actors.filter(actor => actor.criticalNeedCount > 0).length;
      const atRiskCount = actors.filter(actor => actor.atRiskNeedCount > 0).length;
      const averageSeverity = totalNeeds > 0 ? Math.round(totalStress / totalNeeds) : 0;
      const worstSeverity = this.#getWorstSeverity(actors.map(actor => actor.worstSeverity));

      return {
        actors,
        trackedCount: actors.length,
        criticalCount,
        atRiskCount,
        averageSeverity,
        criticalThreshold,
        barOrientation,
        crisisQueue: crisisQueue.slice(0, 4),
        fullCrisisCount: crisisQueue.length,
        hasCrisis: crisisQueue.length > 0,
        worstSeverity,
      };
    }

    #buildNeedView(entity, config, criticalThreshold) {
      const state = entity.needs?.[config.id];
      if (!state) return null;

      const min = NeedsEngine.normalizeNumber(state.min ?? config.min, 0);
      const max = Math.max(min + 1, NeedsEngine.normalizeNumber(state.max ?? config.max, 100));
      const value = Math.max(min, Math.min(max, NeedsEngine.normalizeNumber(state.value, config.default ?? min)));
      const percentage = this.#normalizePercentage(NeedsEngine.getPercentage(value, max));
      const stressPercentage = this.#normalizePercentage(NeedsEngine.getStressPercentage(value, max, { ...config, min }));
      const severity = NeedsEngine.getSeverity(stressPercentage);
      const valueRatio = this.#normalizeRatio(NeedsEngine.getRatio(value, max));
      const stressRatio = this.#normalizeRatio(stressPercentage / 100);
      const localizedLabel = game.i18n.localize(config.label);
      const severityLabel = this.#getSeverityLabel(severity);

      return {
        id: config.id,
        label: config.label,
        localizedLabel,
        icon: config.icon,
        color: config.color || null,
        hasCustomColor: !!config.color,
        inverted: NeedsEngine.isInvertedNeed(config),
        value,
        min,
        max,
        percentage,
        percentageLabel: `${percentage}%`,
        stressPercentage,
        stressPercentageLabel: `${stressPercentage}%`,
        severity,
        severityLabel,
        valueRatio,
        stressRatio,
        isCritical: stressPercentage >= criticalThreshold,
        isAtRisk: stressPercentage >= AT_RISK_THRESHOLD,
        tooltip: `${localizedLabel}: ${value}/${max} (${percentage}%)`,
        entityId: entity.id,
      };
    }

    #selectFocusedNeeds(needs, worstNeed) {
      if (needs.length <= 4) return needs;

      const selected = [];
      if (worstNeed) selected.push(worstNeed);

      for (const need of needs) {
        if (selected.length >= 4) break;
        if (selected.some(existing => existing.id === need.id)) continue;
        selected.push(need);
      }

      return selected;
    }

    #buildToolbar(api) {
      const toolbar = document.createElement('div');
      toolbar.className = 'mn-sf-widget__toolbar';

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-user-plus',
        locKey: 'MORTAL_NEEDS.SessionFlow.AddActors',
        onClick: () => this.#openActorSelection(),
      }));

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-sliders-h',
        locKey: 'MORTAL_NEEDS.SessionFlow.ToggleNeeds',
        onClick: () => this.#openNeedsToggle(api),
      }));

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-arrow-up',
        locKey: 'MORTAL_NEEDS.Toolbar.StressAll',
        tone: 'stress',
        onClick: () => this.#openMultiStress('stress'),
      }));

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-arrow-down',
        locKey: 'MORTAL_NEEDS.Toolbar.RelieveAll',
        tone: 'relieve',
        onClick: () => this.#openMultiStress('relieve'),
      }));

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-undo-alt',
        locKey: 'MORTAL_NEEDS.SessionFlow.ResetAll',
        onClick: () => this.#resetAllNeeds(api),
      }));

      const sep = document.createElement('div');
      sep.className = 'mn-sf-widget__toolbar-sep';
      toolbar.appendChild(sep);

      const broadcastBtn = this.#createToolbarBtn({
        icon: 'fa-tv',
        locKey: 'MORTAL_NEEDS.SessionFlow.Broadcast',
        onClick: () => this.#toggleBroadcast(api),
      });
      broadcastBtn.dataset.role = 'broadcast';
      broadcastBtn.classList.toggle('is-active', !!this.config?.broadcasting);
      toolbar.appendChild(broadcastBtn);

      toolbar.appendChild(this.#createToolbarBtn({
        icon: 'fa-bolt',
        locKey: 'MORTAL_NEEDS.SessionFlow.Flash',
        tone: 'flash',
        onClick: () => this.#flashNeeds(api),
      }));

      return toolbar;
    }

    #createToolbarBtn({ icon, locKey, tone = '', onClick }) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `mn-sf-widget__toolbar-btn ${tone ? `mn-sf-widget__toolbar-btn--${tone}` : ''}`.trim();
      btn.innerHTML = `<i class="fas ${icon}"></i>`;
      btn.title = game.i18n.localize(locKey);
      btn.setAttribute('aria-label', btn.title);
      btn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        await onClick();
      });
      return btn;
    }

    #buildTriage(model) {
      const triage = document.createElement('section');
      triage.className = 'mn-sf-widget__triage';

      triage.appendChild(this.#buildMetric({
        icon: 'fa-users',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.Tracked'),
        value: model.trackedCount,
        tone: 'tracked',
      }));

      triage.appendChild(this.#buildMetric({
        icon: 'fa-exclamation-triangle',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.Crisis'),
        value: model.criticalCount,
        tone: model.criticalCount ? 'critical' : 'stable',
      }));

      triage.appendChild(this.#buildMetric({
        icon: 'fa-fire',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.AtRisk'),
        value: model.atRiskCount,
        tone: model.atRiskCount ? 'risk' : 'stable',
      }));

      triage.appendChild(this.#buildMetric({
        icon: 'fa-chart-bar',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.Average'),
        value: `${model.averageSeverity}%`,
        tone: model.averageSeverity >= model.criticalThreshold ? 'critical' : model.averageSeverity >= AT_RISK_THRESHOLD ? 'risk' : 'stable',
      }));

      return triage;
    }

    #buildMetric({ icon, label, value, tone }) {
      const metric = document.createElement('div');
      metric.className = `mn-sf-widget__metric mn-sf-widget__metric--${tone}`;
      metric.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>${label}</span>
        <strong>${value}</strong>
      `;
      return metric;
    }

    #buildCrisisQueue(model, api) {
      const section = document.createElement('section');
      section.className = 'mn-sf-widget__crisis';

      const header = document.createElement('header');
      header.className = 'mn-sf-widget__section-header';
      header.innerHTML = `
        <span>${game.i18n.localize('MORTAL_NEEDS.Panel.CrisisQueue')}</span>
        <strong>${model.fullCrisisCount}</strong>
      `;
      section.appendChild(header);

      const body = document.createElement('div');
      body.className = 'mn-sf-widget__crisis-list';

      if (!model.hasCrisis) {
        const empty = document.createElement('p');
        empty.className = 'mn-sf-widget__crisis-empty';
        empty.textContent = game.i18n.localize('MORTAL_NEEDS.Panel.NoCrisis');
        body.appendChild(empty);
      } else {
        for (const item of model.crisisQueue) {
          body.appendChild(this.#buildCrisisItem(item, api));
        }
      }

      section.appendChild(body);
      return section;
    }

    #buildCrisisItem(item, api) {
      const row = document.createElement('div');
      row.className = 'mn-sf-widget__crisis-item';
      row.dataset.severity = item.severity;

      const img = document.createElement('img');
      img.src = item.actorImg;
      img.alt = item.actorName;
      img.loading = 'lazy';
      row.appendChild(img);

      const text = document.createElement('div');
      text.className = 'mn-sf-widget__crisis-copy';

      const name = document.createElement('strong');
      name.textContent = item.actorName;
      text.appendChild(name);

      const detail = document.createElement('span');
      detail.innerHTML = `<i class="fas ${item.needIcon}"></i> ${item.needLabel} - ${item.stressPercentageLabel}`;
      text.appendChild(detail);
      row.appendChild(text);

      const badge = document.createElement('span');
      badge.className = `mn-sf-widget__badge mn-sf-widget__badge--${item.severity}`;
      badge.textContent = game.i18n.localize(item.severityLabel);
      row.appendChild(badge);

      const actions = document.createElement('div');
      actions.className = 'mn-sf-widget__crisis-actions';
      actions.appendChild(this.#createNeedActionButton({
        icon: 'fa-minus',
        action: 'relieve',
        title: game.i18n.format('MORTAL_NEEDS.Broadcast.RelieveNeed', { need: item.needLabel }),
        onClick: button => this.#runNeedAction(button, () => api.needs.relieve(item.actorId, item.needId)),
      }));
      actions.appendChild(this.#createNeedActionButton({
        icon: 'fa-plus',
        action: 'stress',
        title: game.i18n.format('MORTAL_NEEDS.Broadcast.StressNeed', { need: item.needLabel }),
        onClick: button => this.#runNeedAction(button, () => api.needs.stress(item.actorId, item.needId)),
      }));
      row.appendChild(actions);

      return row;
    }

    #buildActorList(model, api) {
      const list = document.createElement('div');
      list.className = `mn-sf-widget__actors mn-sf-widget__actors--${model.barOrientation}`;

      for (const actor of model.actors) {
        list.appendChild(this.#buildActorCard(actor, api, model.barOrientation));
      }

      return list;
    }

    #buildActorCard(actor, api, orientation) {
      const card = document.createElement('article');
      card.className = 'mn-sf-widget__actor';
      card.dataset.worstSeverity = actor.worstSeverity;
      card.dataset.expanded = actor.expanded ? 'true' : 'false';
      card.classList.toggle('is-expanded', actor.expanded);

      const portrait = document.createElement('img');
      portrait.className = 'mn-sf-widget__portrait';
      portrait.src = actor.img;
      portrait.alt = actor.name;
      portrait.loading = 'lazy';
      portrait.dataset.severity = actor.worstSeverity;
      card.appendChild(portrait);

      const main = document.createElement('div');
      main.className = 'mn-sf-widget__actor-main';

      const header = document.createElement('header');
      header.className = 'mn-sf-widget__actor-header';

      const title = document.createElement('div');
      title.className = 'mn-sf-widget__actor-title';

      const name = document.createElement('strong');
      name.className = 'mn-sf-widget__name';
      name.textContent = actor.name;
      title.appendChild(name);

      const subtitle = document.createElement('span');
      subtitle.className = 'mn-sf-widget__subtitle';
      subtitle.textContent = actor.worstNeed
        ? `${game.i18n.localize('MORTAL_NEEDS.Panel.WorstNeed')}: ${actor.worstNeedLabel} - ${actor.worstNeedPercent}`
        : game.i18n.localize('MORTAL_NEEDS.Panel.Stable');
      title.appendChild(subtitle);
      header.appendChild(title);

      const headerActions = document.createElement('div');
      headerActions.className = 'mn-sf-widget__actor-header-actions';
      headerActions.appendChild(this.#buildActorBadges(actor));
      headerActions.appendChild(this.#buildActorToggle(actor));
      header.appendChild(headerActions);
      main.appendChild(header);

      const details = document.createElement('div');
      details.className = 'mn-sf-widget__actor-details';

      if (actor.focusedNeeds.length) {
        const needs = document.createElement('div');
        needs.className = `mn-sf-widget__needs mn-sf-widget__needs-full mn-sf-widget__needs--${orientation}`;
        for (const need of actor.focusedNeeds) {
          needs.appendChild(this.#buildNeedMeter(need, api, orientation));
        }
        if (actor.hiddenNeedCount > 0) {
          const more = document.createElement('span');
          more.className = 'mn-sf-widget__more-needs';
          more.textContent = `+${actor.hiddenNeedCount}`;
          more.title = game.i18n.localize('MORTAL_NEEDS.SessionFlow.MoreNeeds');
          needs.appendChild(more);
        }
        details.appendChild(needs);

        const safeNeeds = document.createElement('div');
        safeNeeds.className = 'mn-sf-widget__needs mn-sf-widget__needs-safe';
        for (const need of actor.focusedNeeds) {
          safeNeeds.appendChild(this.#buildNeedHorizontal(need, api));
        }
        if (actor.hiddenNeedCount > 0) {
          const more = document.createElement('span');
          more.className = 'mn-sf-widget__more-needs';
          more.textContent = `+${actor.hiddenNeedCount}`;
          more.title = game.i18n.localize('MORTAL_NEEDS.SessionFlow.MoreNeeds');
          safeNeeds.appendChild(more);
        }
        details.appendChild(safeNeeds);
      } else {
        const empty = document.createElement('p');
        empty.className = 'mn-sf-widget__no-needs';
        empty.textContent = game.i18n.localize('MORTAL_NEEDS.SessionFlow.NoVisibleNeeds');
        details.appendChild(empty);
      }

      main.appendChild(details);
      card.appendChild(main);

      if (game.user.isGM) {
        card.appendChild(this.#buildActorActions(actor, api));
      }

      return card;
    }

    #buildActorToggle(actor) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mn-sf-widget__actor-toggle';
      button.title = game.i18n.localize('MORTAL_NEEDS.Actions.ToggleDetails');
      button.setAttribute('aria-label', button.title);
      button.setAttribute('aria-expanded', actor.expanded ? 'true' : 'false');
      button.innerHTML = '<i class="fas fa-chevron-down"></i>';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (this.#expandedActors.has(actor.id)) this.#expandedActors.delete(actor.id);
        else this.#expandedActors.add(actor.id);
        this.refreshBody();
      });
      return button;
    }

    #buildActorBadges(actor) {
      const badges = document.createElement('div');
      badges.className = 'mn-sf-widget__actor-badges';

      if (actor.criticalNeedCount > 0) {
        badges.appendChild(this.#buildBadge('critical', game.i18n.localize('MORTAL_NEEDS.Severity.Critical')));
        badges.appendChild(this.#buildBadge('critical', actor.criticalNeedCount, true));
      } else if (actor.atRiskNeedCount > 0) {
        badges.appendChild(this.#buildBadge('high', game.i18n.localize('MORTAL_NEEDS.Severity.High')));
        badges.appendChild(this.#buildBadge('high', actor.atRiskNeedCount, true));
      } else {
        badges.appendChild(this.#buildBadge('safe', game.i18n.localize('MORTAL_NEEDS.Panel.Stable')));
      }

      return badges;
    }

    #buildBadge(tone, value, isCount = false) {
      const badge = document.createElement('span');
      badge.className = `mn-sf-widget__badge mn-sf-widget__badge--${tone}${isCount ? ' mn-sf-widget__badge--count' : ''}`;
      badge.textContent = String(value);
      return badge;
    }

    #buildNeedMeter(need, api, orientation) {
      if (orientation === 'radial') return this.#buildNeedRadial(need, api);
      if (orientation === 'vertical') return this.#buildNeedVertical(need, api);
      return this.#buildNeedHorizontal(need, api);
    }

    #buildNeedHorizontal(need, api) {
      const needEl = this.#createNeedShell(need, 'horizontal');

      const icon = document.createElement('span');
      icon.className = 'mn-sf-widget__need-icon';
      icon.dataset.severity = need.severity;
      icon.innerHTML = `<i class="fas ${need.icon}"></i>`;
      needEl.appendChild(icon);

      const body = document.createElement('div');
      body.className = 'mn-sf-widget__need-body';

      const label = document.createElement('span');
      label.className = 'mn-sf-widget__need-label';
      label.textContent = need.localizedLabel;
      body.appendChild(label);

      const track = this.#buildTrack(need, 'x');
      body.appendChild(track);
      needEl.appendChild(body);

      const pct = document.createElement('span');
      pct.className = 'mn-sf-widget__need-pct';
      pct.dataset.severity = need.severity;
      pct.textContent = need.stressPercentageLabel;
      needEl.appendChild(pct);

      this.#appendNeedControls(needEl, need, api);
      return needEl;
    }

    #buildNeedVertical(need, api) {
      const needEl = this.#createNeedShell(need, 'vertical');

      const icon = document.createElement('span');
      icon.className = 'mn-sf-widget__need-icon';
      icon.dataset.severity = need.severity;
      icon.innerHTML = `<i class="fas ${need.icon}"></i>`;
      needEl.appendChild(icon);

      needEl.appendChild(this.#buildTrack(need, 'y'));

      const pct = document.createElement('span');
      pct.className = 'mn-sf-widget__need-pct';
      pct.dataset.severity = need.severity;
      pct.textContent = need.stressPercentageLabel;
      needEl.appendChild(pct);

      this.#appendNeedControls(needEl, need, api);
      return needEl;
    }

    #buildNeedRadial(need, api) {
      const needEl = this.#createNeedShell(need, 'radial');
      const circumference = 2 * Math.PI * RING_RADIUS;
      const dashOffset = circumference * (1 - need.stressRatio);

      const svgNS = 'http://www.w3.org/2000/svg';
      const ringWrap = document.createElement('div');
      ringWrap.className = 'mn-sf-widget__ring-wrap';

      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'mn-sf-widget__ring');
      svg.setAttribute('viewBox', '0 0 32 32');

      const track = document.createElementNS(svgNS, 'circle');
      track.setAttribute('class', 'mn-sf-widget__ring-track');
      track.setAttribute('cx', '16');
      track.setAttribute('cy', '16');
      track.setAttribute('r', String(RING_RADIUS));
      svg.appendChild(track);

      const fill = document.createElementNS(svgNS, 'circle');
      fill.setAttribute('class', 'mn-sf-widget__ring-fill');
      fill.dataset.severity = need.severity;
      fill.setAttribute('cx', '16');
      fill.setAttribute('cy', '16');
      fill.setAttribute('r', String(RING_RADIUS));
      fill.setAttribute('stroke-dasharray', String(circumference));
      fill.setAttribute('stroke-dashoffset', String(dashOffset));
      svg.appendChild(fill);

      ringWrap.appendChild(svg);

      const icon = document.createElement('span');
      icon.className = 'mn-sf-widget__radial-icon';
      icon.dataset.severity = need.severity;
      icon.innerHTML = `<i class="fas ${need.icon}"></i>`;
      ringWrap.appendChild(icon);
      needEl.appendChild(ringWrap);

      const pct = document.createElement('span');
      pct.className = 'mn-sf-widget__need-pct';
      pct.dataset.severity = need.severity;
      pct.textContent = need.stressPercentageLabel;
      needEl.appendChild(pct);

      this.#appendNeedControls(needEl, need, api);
      return needEl;
    }

    #createNeedShell(need, orientation) {
      const needEl = document.createElement('div');
      needEl.className = `mn-sf-widget__need mn-sf-widget__need--${orientation}`;
      needEl.dataset.severity = need.severity;
      needEl.title = need.tooltip;
      if (need.hasCustomColor) {
        needEl.classList.add('mn-sf-widget__need--custom-color');
        needEl.style.setProperty('--mn-need-color', need.color);
      }
      return needEl;
    }

    #buildTrack(need, axis) {
      const track = document.createElement('div');
      track.className = `mn-sf-widget__need-track ${axis === 'y' ? 'mn-sf-widget__need-track--vertical' : ''}`.trim();

      const fill = document.createElement('div');
      fill.className = `mn-sf-widget__need-fill ${axis === 'y' ? 'mn-sf-widget__need-fill--vertical' : ''}`.trim();
      fill.dataset.severity = need.severity;
      fill.style.transform = axis === 'y' ? `scaleY(${need.stressRatio})` : `scaleX(${need.stressRatio})`;
      track.appendChild(fill);
      return track;
    }

    #appendNeedControls(needEl, need, api) {
      if (!game.user.isGM) return;

      const controls = document.createElement('div');
      controls.className = 'mn-sf-widget__need-controls';
      controls.appendChild(this.#createNeedActionButton({
        icon: 'fa-minus',
        action: 'relieve',
        title: game.i18n.format('MORTAL_NEEDS.Broadcast.RelieveNeed', { need: need.localizedLabel }),
        onClick: button => this.#runNeedAction(button, () => api.needs.relieve(need.entityId, need.id)),
      }));
      controls.appendChild(this.#createNeedActionButton({
        icon: 'fa-plus',
        action: 'stress',
        title: game.i18n.format('MORTAL_NEEDS.Broadcast.StressNeed', { need: need.localizedLabel }),
        onClick: button => this.#runNeedAction(button, () => api.needs.stress(need.entityId, need.id)),
      }));
      needEl.appendChild(controls);
    }

    #buildActorActions(actor, api) {
      const actions = document.createElement('div');
      actions.className = 'mn-sf-widget__actor-actions';

      if (actor.worstNeed) {
        actions.appendChild(this.#createNeedActionButton({
          icon: 'fa-minus',
          action: 'relieve',
          title: game.i18n.format('MORTAL_NEEDS.Broadcast.RelieveNeed', { need: actor.worstNeed.localizedLabel }),
          onClick: button => this.#runNeedAction(button, () => api.needs.relieve(actor.id, actor.worstNeed.id)),
        }));

        actions.appendChild(this.#createNeedActionButton({
          icon: 'fa-plus',
          action: 'stress',
          title: game.i18n.format('MORTAL_NEEDS.Broadcast.StressNeed', { need: actor.worstNeed.localizedLabel }),
          onClick: button => this.#runNeedAction(button, () => api.needs.stress(actor.id, actor.worstNeed.id)),
        }));
      }

      actions.appendChild(this.#createNeedActionButton({
        icon: 'fa-undo',
        action: 'reset',
        title: game.i18n.localize('MORTAL_NEEDS.SessionFlow.ResetActor'),
        onClick: button => this.#runNeedAction(button, () => api.needs.resetAll(actor.id)),
      }));

      return actions;
    }

    #createNeedActionButton({ icon, action, title, onClick }) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `mn-sf-widget__action-btn mn-sf-widget__action-btn--${action}`;
      button.title = title;
      button.setAttribute('aria-label', title);
      button.innerHTML = `<i class="fas ${icon}"></i>`;
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await onClick(button);
      });
      return button;
    }

    async #runNeedAction(button, callback) {
      if (button?.disabled) return;
      if (button) button.disabled = true;
      try {
        await callback();
      } catch (error) {
        console.error('Mortal Needs | SessionFlow widget action failed', error);
        ui.notifications.error('MORTAL_NEEDS.Notifications.WidgetActionFailed', { localize: true });
      } finally {
        if (button?.isConnected) button.disabled = false;
      }
    }

    #buildQuickFooter(api) {
      const footer = document.createElement('footer');
      footer.className = 'mn-sf-widget__footer';

      footer.appendChild(this.#createFooterCommand({
        icon: 'fa-route',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.Journey'),
        detail: game.i18n.localize('MORTAL_NEEDS.Toolbar.StressAll'),
        onClick: () => this.#openMultiStress('stress'),
      }));

      footer.appendChild(this.#createFooterCommand({
        icon: 'fa-campground',
        label: game.i18n.localize('MORTAL_NEEDS.Panel.Rest'),
        detail: game.i18n.localize('MORTAL_NEEDS.Toolbar.RelieveAll'),
        onClick: () => this.#openMultiStress('relieve'),
      }));

      const aux = document.createElement('div');
      aux.className = 'mn-sf-widget__footer-icons';
      const footerBroadcast = this.#createToolbarBtn({
        icon: 'fa-tv',
        locKey: 'MORTAL_NEEDS.SessionFlow.Broadcast',
        onClick: () => this.#toggleBroadcast(api),
      });
      footerBroadcast.dataset.role = 'broadcast';
      footerBroadcast.classList.toggle('is-active', !!this.config?.broadcasting);
      aux.appendChild(footerBroadcast);
      aux.appendChild(this.#createToolbarBtn({
        icon: 'fa-bolt',
        locKey: 'MORTAL_NEEDS.SessionFlow.Flash',
        tone: 'flash',
        onClick: () => this.#flashNeeds(api),
      }));
      footer.appendChild(aux);

      return footer;
    }

    #createFooterCommand({ icon, label, detail, onClick }) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'mn-sf-widget__footer-command';
      button.innerHTML = `
        <i class="fas ${icon}"></i>
        <span>
          <strong>${label}</strong>
          <small>${detail}</small>
        </span>
      `;
      button.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await onClick();
      });
      return button;
    }

    #buildEmptyState({ icon, title, detail, onAction }) {
      const empty = document.createElement('div');
      empty.className = 'mn-sf-widget__empty';

      const iconEl = document.createElement('i');
      iconEl.className = `fas ${icon}`;
      empty.appendChild(iconEl);

      const titleEl = document.createElement('strong');
      titleEl.textContent = title;
      empty.appendChild(titleEl);

      if (detail) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'mn-sf-widget__empty-action';
        button.textContent = detail;
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          onAction?.();
        });
        empty.appendChild(button);
      }

      return empty;
    }

    async #openMultiStress(mode) {
      const api = game.modules.get(MODULE_ID)?.api;
      if (!api) return;

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
        return `<label class="mn-sf-toggle-need">
          <input type="checkbox" name="need-${n.id}" value="${n.id}" ${checked}>
          <i class="fas ${n.icon}"></i>
          <span>${label}</span>
        </label>`;
      }).join('');

      const wrapper = `<div class="mn-sf-toggle-needs">${content}</div>`;

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

    #toggleBroadcast(api) {
      const nextBroadcasting = !this.config?.broadcasting;
      if (nextBroadcasting) {
        api.broadcast.show();
      } else {
        api.broadcast.hide();
      }
      this.updateConfig({ broadcasting: nextBroadcasting });

      const buttons = this.element?.querySelectorAll('[data-role="broadcast"]');
      buttons?.forEach(button => button.classList.toggle('is-active', nextBroadcasting));
    }

    #flashNeeds(api) {
      api.broadcast.flash();
    }

    #restoreBroadcast(api) {
      if (this.#restored) return;
      this.#restored = true;

      if (this.config?.broadcasting && game.user.isGM) {
        const hud = document.getElementById('mn-broadcast-hud');
        const isHudVisible = hud && hud.style.display !== 'none';
        if (!isHudVisible) {
          requestAnimationFrame(() => api.broadcast.show());
        }
      }
    }

    #observeSize(bodyEl, container) {
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = null;
      this.#applySizeGuard(bodyEl);

      const sync = () => {
        if (!container.isConnected) return;
        const bodyRect = bodyEl.getBoundingClientRect?.();
        const containerRect = container.getBoundingClientRect?.();
        const height = bodyRect?.height || containerRect?.height || 0;
        const width = bodyRect?.width || containerRect?.width || 0;
        const mode = height <= 480 || width <= 335
          ? 'micro'
          : height <= 840 || width <= 420
            ? 'compact'
            : 'roomy';

        container.dataset.sizeMode = mode;
        for (const sizeMode of ['roomy', 'compact', 'micro']) {
          container.classList.toggle(`mn-sf-widget--${sizeMode}`, sizeMode === mode);
        }
      };

      requestAnimationFrame(sync);
      if (typeof ResizeObserver === 'undefined') return;

      this.#resizeObserver = new ResizeObserver(sync);
      this.#resizeObserver.observe(bodyEl);
    }

    #applySizeGuard(bodyEl) {
      const widgetEl = this.element ?? bodyEl.closest?.('.sessionflow-widget[data-widget-type="mortal-needs"]');
      if (!widgetEl) return;

      widgetEl.style.setProperty('min-width', `${this.constructor.MIN_WIDTH}px`);
      widgetEl.style.setProperty('min-height', `${this.constructor.MIN_HEIGHT}px`);
      bodyEl.style.setProperty('min-width', `${this.constructor.MIN_WIDTH}px`);
      bodyEl.style.setProperty('min-height', '0');
    }

    getTitle() {
      return game.i18n.localize('MORTAL_NEEDS.SessionFlow.WidgetLabel');
    }

    beforeSave() {
      // Broadcast state is persisted through widget config.
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
      this.#resizeObserver?.disconnect();
      this.#resizeObserver = null;
      this.#cleanupHooks();
      super.destroy();
    }

    #getBarOrientation() {
      const orientation = this.#getSetting('barOrientation', 'horizontal');
      return ['horizontal', 'vertical', 'radial'].includes(orientation) ? orientation : 'horizontal';
    }

    #getSetting(key, fallback) {
      try {
        return game.settings.get(MODULE_ID, key) ?? fallback;
      } catch {
        return fallback;
      }
    }

    #getWorstSeverity(severities) {
      const order = { safe: 0, low: 1, medium: 2, high: 3, critical: 4 };
      return severities.reduce((worst, severity) => (
        (order[severity] ?? 0) > (order[worst] ?? 0) ? severity : worst
      ), 'safe');
    }

    #getSeverityLabel(severity) {
      const labels = {
        safe: 'MORTAL_NEEDS.Severity.Safe',
        low: 'MORTAL_NEEDS.Severity.Low',
        medium: 'MORTAL_NEEDS.Severity.Medium',
        high: 'MORTAL_NEEDS.Severity.High',
        critical: 'MORTAL_NEEDS.Severity.Critical',
      };
      return labels[severity] ?? labels.safe;
    }

    #normalizePercentage(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.max(0, Math.min(100, Math.round(number)));
    }

    #normalizeRatio(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return 0;
      return Math.max(0, Math.min(1, number));
    }
  }

  return MortalNeedsWidget;
}

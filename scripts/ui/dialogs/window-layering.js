const BODY_FRONT_CLASS = 'mortal-needs-dialog-open';
const WINDOW_FRONT_CLASS = 'mn-dialog--front';
const WINDOW_SELECTOR = '.mortal-needs-panel.mn-dialog';
const MAX_FRONT_Z_INDEX = 100180;
const MIN_FRONT_Z_INDEX = 100170;

const LAYERED_SELECTORS = [
  '.application',
  '.app',
  '.window-app',
  '.dialog',
  '.sessionflow-gm-panel',
  '.sessionflow-player-panel',
  '.sessionflow-scene-panel',
  '.sessionflow-beat-panel',
  '.sessionflow-widget',
  '.sessionflow-character-detail',
  '.sessionflow-player-detail',
  '.sessionflow-foundry-window--on-top',
].join(', ');

const trackedElements = new WeakSet();

function getLayerElement(target) {
  if (target instanceof HTMLElement) return target;
  if (target?.element instanceof HTMLElement) return target.element;
  return null;
}

function scheduleBodyLayerCleanup() {
  requestAnimationFrame(() => {
    if (document.querySelector(`.${WINDOW_FRONT_CLASS}`)) return;
    document.body?.classList.remove(BODY_FRONT_CLASS);
  });
}

function trackElementLifecycle(element) {
  if (!element || trackedElements.has(element) || typeof MutationObserver === 'undefined') return;
  trackedElements.add(element);

  const observer = new MutationObserver(() => {
    if (element.isConnected) return;
    observer.disconnect();
    scheduleBodyLayerCleanup();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

export function bringMortalNeedsWindowToFront(target) {
  const element = getLayerElement(target);
  if (!element) return;

  const foundryBringToTop = target?.bringToTop ?? target?.bringToFront;
  if (typeof foundryBringToTop === 'function') {
    try {
      foundryBringToTop.call(target);
    } catch (error) {
      console.warn('Mortal Needs | Could not use Foundry window focus helper', error);
    }
  }

  document.body?.classList.add(BODY_FRONT_CLASS);
  element.classList.add(WINDOW_FRONT_CLASS);

  const topZ = [...document.querySelectorAll(LAYERED_SELECTORS)]
    .filter(el => el !== element)
    .map(el => Number.parseInt(getComputedStyle(el).zIndex, 10))
    .filter(zIndex => Number.isFinite(zIndex) && zIndex > 0 && zIndex < MAX_FRONT_Z_INDEX)
    .reduce((highest, zIndex) => Math.max(highest, zIndex), 0);

  const nextZ = Math.min(Math.max(MIN_FRONT_Z_INDEX, topZ + 20), MAX_FRONT_Z_INDEX);
  element.style.setProperty('z-index', String(nextZ), 'important');
  trackElementLifecycle(element);
}

export function releaseMortalNeedsWindowLayer(target) {
  const element = getLayerElement(target);
  if (element) {
    element.classList.remove(WINDOW_FRONT_CLASS);
    element.style.removeProperty('z-index');
  }
  scheduleBodyLayerCleanup();
}

export function watchNextMortalNeedsDialogRender(selector = WINDOW_SELECTOR) {
  if (typeof MutationObserver === 'undefined' || !document?.body) return;

  const known = new Set(document.querySelectorAll(selector));
  let observer = null;
  let timeoutId = null;

  const cleanup = () => {
    observer?.disconnect();
    observer = null;
    if (timeoutId) window.clearTimeout(timeoutId);
    timeoutId = null;
  };

  const findNewDialog = root => {
    const candidates = [];
    if (root instanceof HTMLElement && root.matches(selector)) candidates.push(root);
    if (root instanceof HTMLElement) candidates.push(...root.querySelectorAll(selector));
    return candidates.find(candidate => !known.has(candidate)) ?? null;
  };

  observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        const dialog = findNewDialog(node);
        if (!dialog) continue;
        bringMortalNeedsWindowToFront(dialog);
        cleanup();
        return;
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
  timeoutId = window.setTimeout(cleanup, 3000);
}

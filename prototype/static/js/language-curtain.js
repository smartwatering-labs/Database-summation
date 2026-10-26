import { getLanguage, setLanguage } from './i18n.js';

const easing = 'cubic-bezier(.76,0,.24,1)';
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const entranceSelector = [
  '#main .hero-copy', '#main .hero-side-stack',
  '#main .hero-visual-region figcaption', '#main .panel-scroll',
  '#main .workspace-label', '#main .panel-toggle span',
  '#navigation .nav-link span', '#breadcrumb', '.sidebar-bottom',
].join(',');

let curtain, button, renderLanguage;
let busy = false, interrupted = false, applied = false, pendingLanguage;
let cover, reveal, entrances = [], restoreAnnouncements;

function visibleContainers() {
  return [...document.querySelectorAll(entranceSelector)].filter(node =>
    node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden');
}

function cancelEntrances() {
  entrances.forEach(animation => animation.cancel());
  entrances = [];
}

function commitLanguage(next) {
  if (applied) return;
  const main = document.querySelector('#main');
  const wasBusy = main?.getAttribute('aria-busy');
  const liveRegions = ['#sidebar-connection', '#toast']
    .map(selector => document.querySelector(selector)).filter(Boolean)
    .map(node => [node, node.getAttribute('aria-live')]);
  main?.setAttribute('aria-busy', 'true');
  liveRegions.forEach(([node]) => node.setAttribute('aria-live', 'off'));
  restoreAnnouncements = () => {
    if (main) {
      if (wasBusy === null) main.removeAttribute('aria-busy');
      else main.setAttribute('aria-busy', wasBusy);
    }
    liveRegions.forEach(([node, value]) => {
      if (value === null) node.removeAttribute('aria-live');
      else node.setAttribute('aria-live', value);
    });
  };
  setLanguage(next);
  applied = true;
  renderLanguage();
}

function interrupt(commit = false) {
  if (!busy) {
    cancelEntrances();
    return;
  }
  interrupted = true;
  if (commit && !applied) commitLanguage(pendingLanguage);
  cover?.cancel();
  reveal?.cancel();
  cancelEntrances();
}

export function initLanguageCurtain(renderPage) {
  if (curtain) return;
  renderLanguage = renderPage;
  button = document.querySelector('#language-toggle');
  curtain = document.createElement('div');
  curtain.className = 'language-curtain';
  curtain.setAttribute('aria-hidden', 'true');
  document.body.append(curtain);
  addEventListener('hashchange', () => interrupt());
  addEventListener('pagehide', () => interrupt());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) interrupt();
  });
  const onMotionChange = () => {
    if (reducedMotion.matches) interrupt(true);
  };
  if (reducedMotion.addEventListener) reducedMotion.addEventListener('change', onMotionChange);
  else reducedMotion.addListener(onMotionChange);
}

export async function switchLanguage(next) {
  if (busy || next === getLanguage()) return;
  if (!curtain) throw new Error('Language curtain has not been initialized');
  busy = true;
  interrupted = false;
  applied = false;
  pendingLanguage = next;
  button.dataset.switchingTo = next;
  cancelEntrances();

  try {
    if (reducedMotion.matches || document.hidden || typeof curtain.animate !== 'function') {
      commitLanguage(next);
      return;
    }

    document.documentElement.dataset.languageChanging = 'cover';
    curtain.style.transformOrigin = 'left center';
    cover = curtain.animate(
      [{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }],
      { duration: 300, easing, fill: 'forwards' });
    await cover.finished;
    if (interrupted) return;

    commitLanguage(next);
    document.documentElement.dataset.languageChanging = 'reveal';
    curtain.style.transformOrigin = 'right center';
    reveal = curtain.animate(
      [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }],
      { duration: 460, easing, fill: 'forwards' });
    const currentEntrances = visibleContainers().map((node, index) => node.animate(
      [{ opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'translateY(0)' }],
      { duration: 520, delay: index * 34, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' }));
    entrances = currentEntrances;
    void Promise.allSettled(currentEntrances.map(animation => animation.finished)).then(() => {
      currentEntrances.forEach(animation => animation.cancel());
      if (entrances === currentEntrances) entrances = [];
    });
    await reveal.finished;
  } catch (error) {
    if (!interrupted && !applied) commitLanguage(next);
  } finally {
    cover?.cancel();
    reveal?.cancel();
    cover = reveal = undefined;
    curtain.style.transformOrigin = 'left center';
    restoreAnnouncements?.();
    restoreAnnouncements = undefined;
    delete document.documentElement.dataset.languageChanging;
    delete button.dataset.switchingTo;
    pendingLanguage = undefined;
    busy = false;
  }
}

import { getLanguage } from './i18n.js';

const HOLD_MS = 1000;
const HIT_PAD = 10;
const armedLabels = {
  zh: { restart: '长按确认重启', 'factory-reset': '长按确认恢复' },
  en: { restart: 'Hold to restart', 'factory-reset': 'Hold to reset' },
};

function setLabel(button, label) {
  button.querySelector('.device-hold-content').textContent = label;
  button.querySelector('.device-hold-fill-content').textContent = label;
}

export function initDeviceHold(execute) {
  const root = document.querySelector('#main');
  let armed = null;
  let input = null;
  let timer = 0;
  let started = 0;
  let executing = false;
  let ignoreClickUntil = 0;
  let ignoredButton = null;
  let originalLabel = '';
  const clearHold = () => {
    clearTimeout(timer);
    timer = 0;
    input = null;
    armed?.classList.remove('is-holding');
  };
  const disarm = () => {
    clearHold();
    if (armed) {
      armed.classList.remove('is-armed', 'is-complete');
      setLabel(armed, originalLabel);
    }
    armed = null;
    originalLabel = '';
  };
  const arm = button => {
    disarm();
    armed = button;
    originalLabel = button.querySelector('.device-hold-content').textContent;
    setLabel(button, armedLabels[getLanguage()][button.dataset.action]);
    button.classList.add('is-armed');
  };
  const complete = () => {
    if (!armed || !input || !armed.isConnected || armed.disabled || performance.now() - started < HOLD_MS - 20) return;
    const button = armed;
    const completedLabel = originalLabel;
    clearHold();
    armed = null;
    originalLabel = '';
    button.classList.remove('is-armed');
    button.classList.add('is-complete');
    ignoredButton = button;
    ignoreClickUntil = performance.now() + 450;
    executing = true;
    Promise.resolve().then(() => execute(button)).finally(() => {
      executing = false;
      button.classList.remove('is-complete');
      setLabel(button, completedLabel);
    }).catch(() => {});
  };
  const start = (button, kind, pointerId = null) => {
    if (executing || button !== armed || input || button.disabled) return;
    input = { kind, pointerId };
    started = performance.now();
    button.classList.add('is-holding');
    timer = setTimeout(complete, HOLD_MS);
  };
  const release = () => {
    if (!input) return;
    clearHold();
  };

  document.addEventListener('click', event => {
    const button = event.target.closest?.('[data-device-hold]');
    if (!button) { if (armed) disarm(); return; }
    event.preventDefault();
    event.stopImmediatePropagation();
    if (button.disabled || executing || (button === ignoredButton && performance.now() < ignoreClickUntil)) return;
    if (armed !== button) arm(button);
  }, true);
  root.addEventListener('pointerdown', event => {
    const button = event.target.closest?.('[data-device-hold]');
    if (!button || event.button !== 0 || !event.isPrimary || button !== armed) return;
    start(button, 'pointer', event.pointerId);
    try { button.setPointerCapture(event.pointerId); } catch {}
  }, true);
  document.addEventListener('pointermove', event => {
    if (input?.kind !== 'pointer' || input.pointerId !== event.pointerId || !armed) return;
    const bounds = armed.getBoundingClientRect();
    if (event.clientX < bounds.left - HIT_PAD || event.clientX > bounds.right + HIT_PAD ||
        event.clientY < bounds.top - HIT_PAD || event.clientY > bounds.bottom + HIT_PAD) release();
  }, true);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, event => {
    if (input?.kind === 'pointer' && input.pointerId === event.pointerId) release();
  }, true);
  root.addEventListener('keydown', event => {
    if (event.target !== armed || ![' ', 'Enter'].includes(event.key)) return;
    event.preventDefault();
    if (!event.repeat) start(armed, 'keyboard');
  }, true);
  root.addEventListener('keyup', event => {
    if (input?.kind === 'keyboard' && [' ', 'Enter'].includes(event.key)) {
      event.preventDefault();
      release();
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && armed) {
      event.preventDefault();
      event.stopImmediatePropagation();
      disarm();
    }
  }, true);
  document.addEventListener('workspace:render', () => { if (armed && (!armed.isConnected || armed.disabled)) disarm(); });
  window.addEventListener('blur', disarm);
  window.addEventListener('hashchange', disarm);
  window.addEventListener('pagehide', disarm);
  document.addEventListener('visibilitychange', () => { if (document.hidden) disarm(); });
}

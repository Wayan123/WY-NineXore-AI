// theme.js — dark / light / system theme selector with system-media watching.
//
// Design:
//  • Three user-selectable modes: 'dark', 'light', 'system'.
//  • `data-theme` attribute on <html> is always either 'dark' or 'light'
//    (resolved from the mode + OS preference); CSS only keys off the
//    resolved value.
//  • Preference persists in localStorage key 'wy-nine-theme'.
//  • When mode is 'system' we watch `prefers-color-scheme` and re-resolve
//    on change — no reload needed.

const KEY = 'wy-nine-theme';
const MODES = ['dark', 'light', 'system'];
const listeners = new Set();

function systemPref() {
  if (typeof matchMedia !== 'function') return 'dark';
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function resolve(mode) {
  return mode === 'system' ? systemPref() : mode;
}

function apply(mode) {
  const resolved = resolve(mode);
  document.documentElement.setAttribute('data-theme', resolved);
  // Help the browser render form controls / scrollbars with the right palette.
  try { document.documentElement.style.colorScheme = resolved; } catch (_) {}
  for (const fn of listeners) {
    try { fn({ mode, resolved }); } catch (_) {}
  }
}

export function currentMode() {
  // URL param wins once, then persists — handy for shareable screenshots
  // and for headless-browser previews. Accepts ?theme=dark|light|system.
  try {
    const p = new URLSearchParams(window.location.search);
    const q = p.get('theme');
    if (q && MODES.includes(q)) {
      try { localStorage.setItem(KEY, q); } catch (_) {}
      return q;
    }
  } catch (_) {}
  const stored = (typeof localStorage !== 'undefined') && localStorage.getItem(KEY);
  return MODES.includes(stored) ? stored : 'dark';
}

export function resolvedTheme(mode = currentMode()) {
  return resolve(mode);
}

export function setMode(mode) {
  if (!MODES.includes(mode)) mode = 'dark';
  try { localStorage.setItem(KEY, mode); } catch (_) {}
  apply(mode);
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initTheme() {
  // Apply immediately (pre-script already set a matching attribute so this
  // is idempotent but covers SSR / fresh reloads without the pre-script).
  apply(currentMode());

  // Follow OS changes only when mode is 'system'.
  if (typeof matchMedia === 'function') {
    const mq = matchMedia('(prefers-color-scheme: light)');
    const onChange = () => { if (currentMode() === 'system') apply('system'); };
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange);
    else if (typeof mq.addListener === 'function')  mq.addListener(onChange);
  }
}

export const THEME_MODES = MODES.slice();

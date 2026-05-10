// Main bootstrap + hash router.
import { bootstrap, getState, onChange, refreshUpstream } from './store.js';
import { $, $$, toast } from './ui.js';
import { initTheme, currentMode, setMode, onThemeChange, resolvedTheme, THEME_MODES } from './theme.js';

const VIEWS = {
  home:     () => import('./components/home.js'),
  chat:     () => import('./components/chat.js'),
  image:    () => import('./components/image.js'),
  tts:      () => import('./components/tts.js'),
  stt:      () => import('./components/stt.js'),
  vision:   () => import('./components/vision.js'),
  embed:    () => import('./components/embed.js'),
  search:   () => import('./components/search.js'),
  fetch:    () => import('./components/fetch.js'),
  models:   () => import('./components/models.js'),
  history:  () => import('./components/history.js'),
  help:     () => import('./components/help.js'),
  settings: () => import('./components/settings.js'),
};

const loaded = new Set();

async function showView(name) {
  if (!VIEWS[name]) name = 'home';
  // show/hide
  for (const v of $$('.view')) v.hidden = (v.dataset.view !== name);
  // active nav
  for (const n of $$('.nav-item')) n.classList.toggle('active', n.dataset.view === name);
  // lazy-load once
  if (!loaded.has(name)) {
    try {
      const mod = await VIEWS[name]();
      const container = document.getElementById('view-' + name);
      await mod.mount(container);
      loaded.add(name);
    } catch (e) {
      const container = document.getElementById('view-' + name);
      container.innerHTML = `<div class="error-box"><strong>Failed to load view</strong><pre>${e.message}</pre></div>`;
      console.error(e);
    }
  } else {
    // notify remounted components that want to refresh
    const container = document.getElementById('view-' + name);
    container.dispatchEvent(new CustomEvent('view:show'));
  }
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  // route = everything up to the first '/' or '#' (the latter lets in-page
  // anchors like #/help#overview still work).
  const route = h.split(/[/#]/)[0] || 'home';
  return route;
}

window.addEventListener('hashchange', () => showView(parseRoute()));

// ---- sidebar status ---------------------------------------------------------
function renderStatus() {
  const s = getState();

  // upstream
  const dot = document.getElementById('statusDot');
  const up = s.upstream?.reachable;
  dot.classList.toggle('good', !!up);
  dot.classList.toggle('bad', up === false);
  dot.querySelector('.label').textContent = up ? 'upstream ready'
                                               : (up === false ? 'upstream offline' : 'checking…');

  // idn-tts
  const idnDot = document.getElementById('idnTtsDot');
  if (idnDot) {
    const idn = s.idnTts || {};
    const reachable = !!idn.reachable;
    const enabled = idn.enabled !== false;
    idnDot.classList.toggle('good', reachable);
    idnDot.classList.toggle('bad', enabled && !reachable);
    idnDot.classList.toggle('warn', !enabled);
    const label = idnDot.querySelector('.label');
    if (!enabled) label.textContent = 'idn-tts disabled';
    else if (reachable) label.textContent = `idn-tts · ${idn.n_speakers || 0} voices`;
    else label.textContent = 'idn-tts offline';
  }

  const urlEl = document.getElementById('upstreamUrl');
  urlEl.textContent = s.settings?.nineroute_url || '—';
}

onChange(renderStatus);

// ---- theme toggle (sidebar footer) -----------------------------------------
const THEME_ICON = { dark: '☾', light: '☀', system: '◐' };
function renderThemeToggle() {
  const btn = document.getElementById('themeToggle');
  if (!btn) return;
  const mode = currentMode();
  const resolved = resolvedTheme(mode);
  const icon = btn.querySelector('.theme-toggle-icon');
  const label = btn.querySelector('.theme-toggle-label');
  if (icon) icon.textContent = THEME_ICON[mode];
  if (label) label.textContent = mode === 'system' ? 'system (' + resolved + ')' : mode;
  btn.title = 'theme: ' + mode + ' → ' + resolved + ' (click to cycle)';
}
const _themeBtn = document.getElementById('themeToggle');
if (_themeBtn) {
  _themeBtn.addEventListener('click', () => {
    const order = THEME_MODES;  // ['dark','light','system']
    const next = order[(order.indexOf(currentMode()) + 1) % order.length];
    setMode(next);
  });
}
onThemeChange(renderThemeToggle);

// Recheck every 30s unobtrusively.
setInterval(refreshUpstream, 30_000);

// ---- keyboard shortcuts ----------------------------------------------------
const NAV_MAP = { h: 'home', c: 'chat', i: 'image', t: 'tts', r: 'stt',
                  v: 'vision', e: 'embed', s: 'search', f: 'fetch',
                  m: 'models', y: 'history', '?': 'help', ',': 'settings' };

function isTypingTarget(target) {
  const tag = (target?.tagName || '').toLowerCase();
  return ['input', 'textarea', 'select'].includes(tag) || target?.isContentEditable;
}

document.addEventListener('keydown', (e) => {
  if (isTypingTarget(e.target)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  if (e.key === 'g') {
    const handler = (ev) => {
      window.removeEventListener('keydown', handler, true);
      // re-check guards on the follow-up key too
      if (isTypingTarget(ev.target)) return;
      if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
      const route = NAV_MAP[ev.key];
      if (route) {
        ev.preventDefault();
        location.hash = '#/' + route;
      }
    };
    // single-use, expires after 1.2 s so a lone 'g' press doesn't linger forever
    window.addEventListener('keydown', handler, { once: true, capture: true });
    setTimeout(() => window.removeEventListener('keydown', handler, true), 1200);
  }
});

// ---- go ---------------------------------------------------------------------
(async () => {
  initTheme();
  renderThemeToggle();
  await bootstrap();
  renderStatus();

  const s = getState();
  if (!s.upstream?.reachable) {
    toast({
      title: '9Router is unreachable',
      body: 'Start it or check NINEROUTER_URL in .env.',
      kind: 'bad',
      timeout: 6000,
    });
  }

  await showView(parseRoute());
})();

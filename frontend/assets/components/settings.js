// Settings view — show effective config (read-only) + quick health probe.
import { apiGet } from '../api.js';
import { getState, refreshUpstream, refreshModels } from '../store.js';
import { copyToClipboard, el, loading, toastError, toastGood } from '../ui.js';
import { currentMode, setMode, resolvedTheme, THEME_MODES, onThemeChange } from '../theme.js';

const SHORTCUTS = [
  ['g h',   'Home'],
  ['g c',   'Chat'],
  ['g i',   'Image'],
  ['g t',   'Speak (TTS)'],
  ['g r',   'Transcribe (STT)'],
  ['g e',   'Embeddings'],
  ['g s',   'Search'],
  ['g f',   'Read URL'],
  ['g m',   'Models'],
  ['g y',   'History'],
  ['g ,',   'Settings'],
  ['Enter',       'Send chat'],
  ['Shift+Enter', 'New line in chat'],
  ['Esc',         'Close modal'],
];

export async function mount(root) {
  await render(root);
  root.addEventListener('view:show', () => render(root));
}

async function render(root) {
  root.innerHTML = '';
  const s = getState();

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Settings'),
      el('p', { class: 'sub' }, 'Effective configuration. To change, edit `.env` and restart `run.sh`.'),
    ),
  ));

  // Upstream card
  root.append(el('div', { class: 'card' },
    el('h3', {}, '9Router upstream'),
    row('NINEROUTER_URL', s.settings?.nineroute_url || '—', true),
    row('API key', s.settings?.has_key ? 'set (hidden)' : 'not set', false),
    row('Status', s.upstream?.reachable ? 'reachable' : 'unreachable', false),
    el('div', { class: 'btn-row mt-sm' },
      el('button', { class: 'btn btn-small', onclick: async () => {
        await refreshUpstream();
        const s2 = getState();
        s2.upstream?.reachable ? toastGood('Upstream is OK') : toastError(new Error('not reachable'), 'Upstream');
        render(root);
      } }, 'test connection'),
      el('button', { class: 'btn btn-small', onclick: async () => {
        await refreshModels(); toastGood('Models refreshed'); render(root);
      } }, 'refresh models'),
    ),
  ));

  // Indonesian TTS service card
  const idn = s.idnTts || {};
  root.append(el('div', { class: 'card mt-md' },
    el('h3', {}, 'Indonesian TTS service (optional)'),
    row('IDN_TTS_URL', s.settings?.idn_tts_url || '—', true),
    row('Enabled',  String(s.settings?.idn_tts_enabled ?? true)),
    row('Reachable', idn.reachable ? 'yes' : 'no'),
    idn.reachable ? row('Device', idn.device || '—') : null,
    idn.reachable ? row('Sample rate', (idn.sample_rate ?? '—') + ' Hz') : null,
    idn.reachable ? row('Speakers', String(idn.n_speakers || 0)) : null,
    idn.reachable ? row('Default voice', idn.default_speaker || '—') : null,
    el('p', { class: 'muted', style: { fontSize: '12px', marginTop: '8px' } },
      'Start with ', el('code', {}, './run.sh'), ' in the repo root (spawns this service alongside the dashboard).',
      ' Adds 83 Bahasa Indonesia voices (wibowo, ardi, gadis + 80 regional) to the Speak panel.',
    ),
    el('div', { class: 'btn-row mt-sm' },
      el('button', { class: 'btn btn-small', onclick: async () => {
        await refreshUpstream();
        render(root);
        const s2 = getState();
        s2.idnTts?.reachable ? toastGood('idn-tts reachable') : toastError(new Error('not reachable'), 'idn-tts');
      } }, 'recheck idn-tts'),
    ),
  ));

  // Defaults card
  const defaults = s.settings?.defaults || {};
  root.append(el('div', { class: 'card mt-md' },
    el('h3', {}, 'Default models'),
    el('p', { class: 'muted', style: { fontSize: '0.88rem' } },
      'Used when a panel has none picked. Override by setting `DEFAULT_*_MODEL` in `.env`.'),
    ...Object.entries(defaults).map(([k, v]) => row(k, v || '— auto (first available) —')),
  ));

  // Shortcuts card
  root.append(el('div', { class: 'card mt-md' },
    el('h3', {}, 'Keyboard shortcuts'),
    ...SHORTCUTS.map(([k, v]) => el('div', { class: 'inline', style: { justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--hairline-soft)' } },
      el('span', {}, ...k.split(' ').map((key, i, arr) => el('span', {}, el('kbd', {}, key), i < arr.length - 1 ? ' then ' : '')),
      ),
      el('span', { class: 'muted' }, v),
    )),
  ));

  // Appearance card (theme switcher)
  root.append(renderThemeCard());

  // About card
  root.append(el('div', { class: 'card mt-md' },
    el('h3', {}, 'About'),
    el('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 8px' } },
      'WY NineXore AI is a local developer console built on top of ',
      el('a', { href: 'https://github.com/decolua/9router', target: '_blank', rel: 'noopener' }, '9Router'),
      ' — an open-source OpenAI-compatible gateway. All external provider credentials (Codex / OpenAI Plus, NVIDIA NIM, DeepSeek, Anthropic, Tavily, Firecrawl, etc.) live inside your 9Router instance, not in this repository.'),
    el('p', { class: 'muted', style: { fontSize: '13px', margin: '0 0 8px' } },
      'An optional local CUDA service adds Bahasa Indonesia voices (Coqui VITS) and offline Whisper transcription — audio stays on your machine.'),
    el('div', { class: 'inline', style: { gap: '10px', flexWrap: 'wrap' } },
      el('a', { class: 'btn btn-small', href: 'https://github.com/Wayan123/WY-NineXore-AI', target: '_blank', rel: 'noopener' }, 'Source repo ↗'),
      el('a', { class: 'btn btn-small', href: 'https://github.com/decolua/9router', target: '_blank', rel: 'noopener' }, '9Router ↗'),
      el('a', { class: 'btn btn-ghost btn-small', href: '#/help' }, 'User manual'),
    ),
  ));

  // Live health (raw JSON) card
  const probeHost = el('div', { class: 'card mt-md' },
    el('h3', {}, 'Live probe'),
    el('p', { class: 'muted', style: { fontSize: '0.88rem' } }, 'Raw JSON from `/api/upstream`.'),
  );
  probeHost.append(loading('Probing…'));
  root.append(probeHost);
  try {
    const live = await apiGet('/api/upstream');
    probeHost.lastChild.remove();
    probeHost.append(el('pre', {}, JSON.stringify(live, null, 2)));
  } catch (e) {
    probeHost.lastChild.remove();
    probeHost.append(el('div', { class: 'error-box' }, e.message));
  }
}

function row(k, v, copy = false) {
  return el('div', { class: 'inline', style: { justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--hairline-soft)', flexWrap: 'nowrap' } },
    el('span', { class: 'muted', style: { minWidth: '140px' } }, k),
    el('span', { class: 'mono', style: { textAlign: 'right', wordBreak: 'break-all', flex: 1 } }, v),
    copy ? el('button', { class: 'btn btn-ghost btn-small', onclick: () => copyToClipboard(v) }, '⧉') : null,
  );
}

function renderThemeCard() {
  const mode = currentMode();
  const resolved = resolvedTheme(mode);

  const MODE_META = {
    dark:   { label: 'Dark',   hint: 'Canvas gelap (default).', icon: '\u263E' },
    light:  { label: 'Light',  hint: 'Canvas terang untuk siang hari.', icon: '\u2600' },
    system: { label: 'System', hint: 'Ikut preferensi OS (prefers-color-scheme).', icon: '\u25D0' },
  };

  const segHost = el('div', {
    class: 'inline',
    role: 'radiogroup',
    'aria-label': 'Theme mode',
    style: { gap: '6px', padding: '4px', background: 'var(--surface-2)',
             border: '1px solid var(--hairline)', borderRadius: 'var(--r-md)',
             width: 'fit-content' },
  });

  const buttons = {};
  for (const m of THEME_MODES) {
    const meta = MODE_META[m];
    const btn = el('button', {
      role: 'radio',
      'aria-checked': m === mode ? 'true' : 'false',
      class: 'btn btn-small' + (m === mode ? ' btn-primary' : ' btn-ghost'),
      style: { minWidth: '82px' },
      onclick: () => {
        setMode(m);
        // update aria + classes
        for (const other of THEME_MODES) {
          const b = buttons[other];
          b.setAttribute('aria-checked', other === m ? 'true' : 'false');
          b.className = 'btn btn-small' + (other === m ? ' btn-primary' : ' btn-ghost');
        }
        resolvedSpan.textContent = 'resolved: ' + resolvedTheme(m);
        hintSpan.textContent = MODE_META[m].hint;
      },
    }, meta.icon + ' ' + meta.label);
    buttons[m] = btn;
    segHost.appendChild(btn);
  }

  const resolvedSpan = el('span', { class: 'muted mono', style: { fontSize: '12px' } },
    'resolved: ' + resolved);
  const hintSpan = el('span', { class: 'muted', style: { fontSize: '12px' } },
    MODE_META[mode].hint);

  return el('div', { class: 'card mt-md' },
    el('h3', {}, 'Appearance'),
    el('p', { class: 'muted', style: { fontSize: '0.88rem', margin: '0 0 12px' } },
      'Pilih tema. Setting ini disimpan di browser (localStorage), tidak dikirim ke server.'),
    segHost,
    el('div', { class: 'inline mt-sm', style: { gap: '14px', flexWrap: 'wrap' } },
      resolvedSpan, hintSpan,
    ),
  );
}

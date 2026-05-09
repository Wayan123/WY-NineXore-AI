// Read a URL — web fetch view.
import { apiJSON } from '../api.js';
import { defaultModel, modelList } from '../store.js';
import { clear, copyToClipboard, el, loading, toastError, toastGood, toastWarn } from '../ui.js';
import { renderMarkdown } from '../md.js';

const LS = 'nine.fetch.prefs';
const state = { model: '', url: '', format: 'markdown', max_characters: 20000 };
function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() { localStorage.setItem(LS, JSON.stringify(state)); }

function firstFetchModel() {
  return modelList('web').filter(m => m.kind === 'webFetch')[0]?.id || '';
}

export async function mount(root) {
  loadPrefs();
  if (!state.model) state.model = defaultModel('fetch') || firstFetchModel();
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Read a URL'),
      el('p', { class: 'sub' }, 'Give it a link. Get clean markdown (or plain text / HTML) back.'),
    ),
  ));

  const fetchModels = modelList('web').filter(m => m.kind === 'webFetch');
  const modelSel = el('select', { onchange: (e) => { state.model = e.target.value; savePrefs(); } },
    ...(fetchModels.length ? fetchModels.map(m => el('option', { value: m.id, selected: m.id === state.model }, m.id))
                           : [el('option', { value: '' }, '— no fetch providers configured —')]),
  );

  const urlIn = el('input', {
    type: 'url', placeholder: 'https://…', value: state.url,
    oninput: (e) => { state.url = e.target.value; savePrefs(); },
    onkeydown: (e) => { if (e.key === 'Enter') run(); },
  });
  const fmtSel = el('select', { onchange: (e) => { state.format = e.target.value; savePrefs(); } },
    ...['markdown', 'text', 'html'].map(f => el('option', { value: f, selected: f === state.format }, f)),
  );
  const maxIn = el('input', { type: 'number', min: 0, step: 500, value: state.max_characters || 0,
    onchange: (e) => { state.max_characters = parseInt(e.target.value) || 0; savePrefs(); },
    style: { width: '120px' }, title: 'Max characters (0 = no cap)' });

  const goBtn = el('button', { class: 'btn btn-primary', onclick: run }, 'Read');
  const status = el('div', { class: 'muted' });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Provider ', el('span', { class: 'req' }, '*')), modelSel),
      el('div', { class: 'field' }, el('label', {}, 'Options'),
        el('div', { class: 'inline' }, fmtSel, maxIn)),
    ),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'URL ', el('span', { class: 'req' }, '*')),
      urlIn,
    ),
    el('div', { class: 'btn-row mt-sm' }, goBtn, status),
  ));

  const resultBox = el('div', { class: 'mt-md' });
  root.append(resultBox);

  async function run() {
    if (!state.model) { toastWarn('Pick a provider first'); return; }
    if (!state.url) { toastWarn('Enter a URL'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Reading…'));
    try {
      const body = { model: state.model, url: state.url, format: state.format };
      if (state.max_characters) body.max_characters = state.max_characters;
      const r = await apiJSON('/api/fetch/run', body);
      clear(status);
      show(r);
      toastGood('Fetched');
    } catch (e) {
      toastError(e, 'Fetch failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Fetch failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally { goBtn.disabled = false; }
  }

  function show(r) {
    clear(resultBox);
    const c = r.content || {};
    const text = c.text || '';
    const fmt = c.format || state.format;
    const isMd = fmt === 'markdown';

    resultBox.append(el('div', { class: 'card solid' },
      el('div', { class: 'card-head' },
        el('h3', {}, r.title || '(no title)'),
        el('div', { class: 'inline' },
          el('span', { class: 'pill' }, r.provider || '—'),
          el('span', { class: 'pill' }, `${c.length ?? text.length} chars`),
          el('span', { class: 'pill' }, fmt),
          el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(text) }, 'copy'),
          el('a', { class: 'btn btn-small', href: r.url, target: '_blank', rel: 'noopener' }, 'open source ↗'),
        ),
      ),
      el('div', { class: 'muted', style: { fontSize: '0.82rem', wordBreak: 'break-all' } }, r.url),
    ));

    const body = el('div', { class: 'card mt-md', style: { maxHeight: '70vh', overflow: 'auto' } });
    if (isMd) {
      const md = el('div', { class: 'md' });
      md.innerHTML = renderMarkdown(text);
      body.append(md);
    } else if (fmt === 'html') {
      // render HTML in a sandboxed iframe so scripts can't run in our origin
      const iframe = el('iframe', {
        sandbox: '',
        style: { width: '100%', minHeight: '60vh', border: '1px solid var(--hairline-strong)', borderRadius: 'var(--r-md)', background: '#fff' },
        srcdoc: text,
      });
      body.append(iframe);
    } else {
      body.append(el('pre', { style: { whiteSpace: 'pre-wrap' } }, text));
    }
    resultBox.append(body);
  }
}

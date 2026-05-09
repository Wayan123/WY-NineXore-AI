// Models explorer — browse every kind the upstream exposes. Filter + modal info.
import { apiGet } from '../api.js';
import { getState, refreshModels } from '../store.js';
import { clear, copyToClipboard, debounce, el, empty, loading, openModal, toastError, toastGood } from '../ui.js';

const KINDS = [
  { key: 'chat',        label: 'Chat / LLM',      ico: '✎' },
  { key: 'image',       label: 'Image',           ico: '◆' },
  { key: 'tts',         label: 'TTS',             ico: '♪' },
  { key: 'stt',         label: 'STT',             ico: '⇢' },
  { key: 'embedding',   label: 'Embeddings',      ico: '∞' },
  { key: 'web',         label: 'Web search/fetch',ico: '⌕' },
  { key: 'image-to-text', label: 'Vision',        ico: '◉' },
];

let query = '';

export async function mount(root) {
  await render(root);
  root.addEventListener('view:show', () => render(root));
}

async function render(root) {
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Models'),
      el('p', { class: 'sub' }, 'What this instance of 9Router exposes. Pulled live from `/v1/models/*`.'),
    ),
    el('div', { class: 'inline' },
      el('input', {
        placeholder: 'filter by id (e.g. deepseek, gemini)…',
        value: query,
        oninput: debounce((e) => { query = e.target.value.toLowerCase(); paint(); }, 120),
        style: { width: '320px' },
      }),
      el('button', {
        class: 'btn btn-ghost btn-small',
        onclick: async () => { await refreshModels(); paint(); toastGood('Refreshed'); },
      }, '↻ refresh'),
    ),
  ));

  const host = el('div', { class: 'col mt-sm' });
  root.append(host);

  function paint() {
    clear(host);
    const s = getState();
    const models = s.models || {};
    let found = 0;
    for (const k of KINDS) {
      const arr = (models[k.key]?.data || []).filter(m => (m.id || '').toLowerCase().includes(query));
      if (!arr.length && query) continue;
      found += arr.length;
      const card = el('section', { class: 'card' },
        el('div', { class: 'card-head' },
          el('h3', {}, el('span', { style: { color: 'var(--accent)', marginRight: '6px' } }, k.ico), k.label),
          el('span', { class: 'hint' }, `${(models[k.key]?.data || []).length} available`),
        ),
      );
      if (!arr.length) {
        card.append(el('div', { class: 'muted' },
          query ? 'No matches.' : 'None exposed — add a provider in the 9Router dashboard.'));
      } else {
        for (const m of arr) {
          card.append(el('div', { class: 'model-row' },
            el('div', {},
              el('code', {}, m.id),
              m.kind ? el('span', { class: 'pill', style: { marginLeft: '6px' } }, m.kind) : null,
            ),
            el('div', { class: 'owned' }, m.owned_by || ''),
            el('div', { class: 'inline' },
              el('button', { class: 'btn btn-small', onclick: () => showInfo(m.id) }, 'info'),
              el('button', { class: 'btn btn-small btn-ghost', onclick: () => copyToClipboard(m.id) }, 'copy id'),
            ),
          ));
        }
      }
      host.append(card);
    }
    if (query && !found) host.append(empty('No matches.', 'Try a shorter word.'));
  }
  paint();
}

async function showInfo(id) {
  const body = el('div', { class: 'col' }, el('h3', {}, id), loading());
  openModal(body);
  try {
    const info = await apiGet('/api/models/info?id=' + encodeURIComponent(id));
    clear(body);
    body.append(
      el('h3', {}, id),
      el('div', { class: 'inline mt-sm' },
        info.kind ? el('span', { class: 'pill accent' }, info.kind) : null,
        info.owned_by ? el('span', { class: 'pill' }, info.owned_by) : null,
        info.endpoint ? el('span', { class: 'pill' }, info.endpoint) : null,
      ),
      el('pre', { class: 'mt-md' }, JSON.stringify(info, null, 2)),
      el('div', { class: 'btn-row mt-sm' },
        el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(JSON.stringify(info, null, 2)) }, 'copy JSON'),
        el('button', { class: 'btn btn-small', 'data-close': '' }, 'close'),
      ),
    );
  } catch (e) {
    toastError(e, 'Model info');
    clear(body);
    body.append(el('h3', {}, id), el('div', { class: 'error-box' }, e.message));
  }
}

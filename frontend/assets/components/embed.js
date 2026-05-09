// Embeddings playground — vectorise text and eyeball similarities.
import { apiJSON } from '../api.js';
import { defaultModel, modelList } from '../store.js';
import { clear, copyToClipboard, el, empty, loading, toastError, toastGood, toastWarn } from '../ui.js';

const LS = 'nine.embed.prefs';
const state = { model: '', inputs: '' };
function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() { localStorage.setItem(LS, JSON.stringify(state)); }

const EXAMPLE = [
  'The weather turned cold overnight.',
  'It suddenly got freezing.',
  'I bought a new bicycle yesterday.',
  'A red panda climbed up the tree.',
].join('\n');

export async function mount(root) {
  loadPrefs();
  if (!state.model) state.model = defaultModel('embedding');
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Embeddings'),
      el('p', { class: 'sub' }, 'Turn sentences into vectors, then compare them with cosine similarity.'),
    ),
  ));

  const models = modelList('embedding');
  const modelSel = el('select', { onchange: (e) => { state.model = e.target.value; savePrefs(); } },
    ...(models.length ? models.map(m => el('option', { value: m.id, selected: m.id === state.model }, m.id))
                      : [el('option', { value: '' }, '— no embedding models configured —')]),
  );

  const ta = el('textarea', {
    rows: 8,
    placeholder: 'One sentence per line.',
    oninput: (e) => { state.inputs = e.target.value; savePrefs(); },
  });
  ta.value = state.inputs || '';

  const loadExample = el('button', { class: 'btn btn-ghost btn-small', onclick: () => {
    ta.value = EXAMPLE; state.inputs = EXAMPLE; savePrefs();
  } }, 'example');

  const goBtn = el('button', { class: 'btn btn-primary', onclick: run }, 'Embed');
  const status = el('div', { class: 'muted' });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Model ', el('span', { class: 'req' }, '*')), modelSel),
      el('div', { class: 'field' },
        el('label', {}, 'Try it'),
        el('div', { class: 'inline' }, loadExample),
      ),
    ),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Inputs ', el('span', { class: 'req' }, '*'), el('span', { class: 'muted' }, ' — one per line')),
      ta,
    ),
    el('div', { class: 'btn-row mt-sm' }, goBtn, status),
  ));

  const resultWrap = el('div', { class: 'mt-md' });
  root.append(resultWrap);

  async function run() {
    const lines = (ta.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) { toastWarn('Add at least one line'); return; }
    if (!state.model) { toastWarn('Pick a model first'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Embedding…'));
    try {
      const r = await apiJSON('/api/embeddings/embed', {
        model: state.model,
        input: lines.length === 1 ? lines[0] : lines,
      });
      clear(status);
      showResult(r, lines);
      toastGood(`${r.count} vector(s) · dim ${r.dimensions}`);
    } catch (e) {
      toastError(e, 'Embeddings failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Embedding failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally { goBtn.disabled = false; }
  }

  function showResult(r, lines) {
    clear(resultWrap);

    const summary = el('div', { class: 'card solid' },
      el('div', { class: 'inline' },
        el('span', { class: 'pill accent' }, r.model || '—'),
        el('span', { class: 'pill' }, `dim ${r.dimensions}`),
        el('span', { class: 'pill' }, `n ${r.count}`),
        r.usage?.total_tokens ? el('span', { class: 'pill' }, `tokens ${r.usage.total_tokens}`) : null,
        el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(JSON.stringify(r.vectors)) }, 'copy vectors'),
      ),
    );
    resultWrap.append(summary);

    // similarity matrix
    if (r.similarity?.length > 1) {
      const table = el('table', { class: 'matrix mt-md' });
      const head = el('tr', {}, el('th', {}, '#'));
      for (let j = 0; j < r.similarity.length; j++) head.append(el('th', {}, String(j + 1)));
      table.append(el('thead', {}, head));
      const tbody = el('tbody');
      for (let i = 0; i < r.similarity.length; i++) {
        const tr = el('tr', {},
          el('th', { title: lines[i] }, (lines[i] || `#${i+1}`).slice(0, 28)));
        for (let j = 0; j < r.similarity[i].length; j++) {
          const v = r.similarity[i][j];
          const bg = heatColor(v);
          const fg = v > 0.6 ? 'var(--accent-ink)' : 'var(--ink-muted)';
          tr.append(el('td', { style: { background: bg, color: fg } }, v.toFixed(3)));
        }
        tbody.append(tr);
      }
      table.append(tbody);
      resultWrap.append(el('div', { class: 'card mt-md' },
        el('div', { class: 'card-head' },
          el('h3', {}, 'Cosine similarity'),
          el('span', { class: 'hint' }, '1 = identical · 0 = unrelated · brighter = closer'),
        ),
        el('div', { style: { overflowX: 'auto' } }, table),
      ));
    }

    // vectors preview
    const preview = el('div', { class: 'card mt-md' },
      el('div', { class: 'card-head' },
        el('h3', {}, 'Vectors (preview)'),
        el('span', { class: 'hint' }, 'first 8 dims per input'),
      ),
    );
    const tbl = el('table', { class: 'table' });
    tbl.append(el('thead', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Text'), el('th', {}, 'Preview'))));
    const tb = el('tbody');
    for (let i = 0; i < r.vectors.length; i++) {
      const snip = (r.vectors[i] || []).slice(0, 8).map(x => x.toFixed(4)).join(', ');
      tb.append(el('tr', {},
        el('td', {}, String(i + 1)),
        el('td', {}, lines[i] || ''),
        el('td', { class: 'mono' }, '[' + snip + ', …]'),
      ));
    }
    tbl.append(tb);
    preview.append(tbl);
    resultWrap.append(preview);
  }
}

function heatColor(v) {
  // v in [0, 1] for cosine similarity on semantically-similar text.
  // Interpolate from surface-1 (#0f1113) to accent (#8b90f0).
  const x = Math.max(0, Math.min(1, v));
  const r = Math.round(0x0f + (0x8b - 0x0f) * x);
  const g = Math.round(0x11 + (0x90 - 0x11) * x);
  const b = Math.round(0x13 + (0xf0 - 0x13) * x);
  return `rgb(${r}, ${g}, ${b})`;
}

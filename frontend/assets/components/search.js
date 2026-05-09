// Web search view.
import { apiJSON } from '../api.js';
import { defaultModel, modelList } from '../store.js';
import { clear, el, empty, loading, toastError, toastGood, toastWarn } from '../ui.js';

const LS = 'nine.search.prefs';
const state = { model: '', query: '', max_results: 8, search_type: 'web', country: '', language: '' };
function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() { localStorage.setItem(LS, JSON.stringify(state)); }

export async function mount(root) {
  loadPrefs();
  if (!state.model) state.model = defaultModel('search') || firstSearchModel();
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Search the web'),
      el('p', { class: 'sub' }, 'Pick a provider, ask a question, skim the results.'),
    ),
  ));

  const searchModels = modelList('web').filter(m => m.kind === 'webSearch');
  const modelSel = el('select', { onchange: (e) => { state.model = e.target.value; savePrefs(); } },
    ...(searchModels.length ? searchModels.map(m => el('option', { value: m.id, selected: m.id === state.model }, m.id))
                            : [el('option', { value: '' }, '— no search providers configured —')]),
  );

  const queryIn = el('input', { placeholder: 'What are you looking for?', value: state.query,
    oninput: (e) => { state.query = e.target.value; savePrefs(); },
    onkeydown: (e) => { if (e.key === 'Enter') run(); } });

  const maxIn = el('input', { type: 'number', min: 1, max: 30, value: state.max_results,
    onchange: (e) => { state.max_results = Math.max(1, Math.min(30, parseInt(e.target.value) || 5)); savePrefs(); },
    style: { width: '90px' } });
  const typeSel = el('select', { onchange: (e) => { state.search_type = e.target.value; savePrefs(); } },
    el('option', { value: 'web', selected: state.search_type === 'web' }, 'web'),
    el('option', { value: 'news', selected: state.search_type === 'news' }, 'news'),
  );
  const countryIn = el('input', { placeholder: 'country (e.g. us, id)', value: state.country,
    oninput: (e) => { state.country = e.target.value; savePrefs(); } });
  const langIn = el('input', { placeholder: 'language (e.g. en)', value: state.language,
    oninput: (e) => { state.language = e.target.value; savePrefs(); } });

  const goBtn = el('button', { class: 'btn btn-primary', onclick: run }, 'Search');
  const status = el('div', { class: 'muted' });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Provider ', el('span', { class: 'req' }, '*')), modelSel),
      el('div', { class: 'field' }, el('label', {}, 'Type'),
        el('div', { class: 'inline' }, typeSel, maxIn, countryIn, langIn)),
    ),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Query ', el('span', { class: 'req' }, '*')),
      queryIn,
    ),
    el('div', { class: 'btn-row mt-sm' }, goBtn, status),
  ));

  const resultsBox = el('div', { class: 'mt-md' });
  root.append(resultsBox);

  async function run() {
    if (!state.model) { toastWarn('Pick a provider first'); return; }
    if (!state.query.trim()) { toastWarn('Empty query'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Searching…'));
    try {
      const body = {
        model: state.model,
        query: state.query.trim(),
        max_results: state.max_results,
        search_type: state.search_type,
      };
      if (state.country) body.country = state.country;
      if (state.language) body.language = state.language;
      const r = await apiJSON('/api/search/run', body);
      clear(status);
      showResults(r);
      toastGood(`${r.results?.length ?? 0} result(s)`);
    } catch (e) {
      toastError(e, 'Search failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Search failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally { goBtn.disabled = false; }
  }

  function showResults(r) {
    clear(resultsBox);
    const header = el('div', { class: 'inline' },
      el('span', { class: 'pill' }, r.provider || '—'),
      r.usage?.queries_used ? el('span', { class: 'pill' }, `queries ${r.usage.queries_used}`) : null,
      r.metrics?.response_time_ms ? el('span', { class: 'pill' }, `${r.metrics.response_time_ms} ms`) : null,
    );
    resultsBox.append(el('div', { class: 'card solid' },
      el('div', { class: 'card-head' },
        el('h3', {}, r.query || state.query),
        header,
      ),
      r.answer ? el('p', { style: { color: 'var(--ink-muted)', borderLeft: '2px solid var(--accent)', paddingLeft: '10px', margin: '8px 0 0' } }, r.answer) : null,
    ));

    const list = el('div', { class: 'result-list mt-md' });
    for (const item of (r.results || [])) {
      list.append(el('div', { class: 'result-item' },
        el('h4', {}, el('a', { href: item.url, target: '_blank', rel: 'noopener' }, item.title || item.url)),
        el('div', { class: 'url' }, item.display_url || item.url),
        el('div', { class: 'snippet' }, item.snippet || item.content || ''),
        item.published_at ? el('div', { class: 'muted', style: { fontSize: '0.78rem', marginTop: '4px' } },
          new Date(item.published_at).toLocaleString()) : null,
      ));
    }
    if (!list.children.length) list.append(empty('No results.', ''));
    resultsBox.append(list);
  }
}

function firstSearchModel() {
  const arr = modelList('web').filter(m => m.kind === 'webSearch');
  return arr[0]?.id || '';
}

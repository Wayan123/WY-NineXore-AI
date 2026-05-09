// History view — every output ever made, filterable, with delete/favorite.
import { apiGet, apiDelete, apiPatch } from '../api.js';
import { clear, el, empty, fmtDate, loading, toastError, toastGood } from '../ui.js';

const KINDS = ['all', 'image', 'tts', 'stt', 'embedding', 'search', 'fetch', 'vision'];
let filter = 'all';
let favsOnly = false;

export async function mount(root) {
  await render(root);
  root.addEventListener('view:show', () => render(root));
}

async function render(root) {
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'History'),
      el('p', { class: 'sub' }, 'Saved outputs, newest first.'),
    ),
  ));

  // filter bar
  const bar = el('div', { class: 'inline mb-md' });
  for (const k of KINDS) {
    bar.append(el('button', {
      class: 'btn btn-small' + (filter === k ? ' btn-primary' : ''),
      dataset: { kind: k },
      onclick: () => { filter = k; paint(); },
    }, k));
  }
  bar.append(
    el('span', { style: { flex: 1 } }),
    el('label', { class: 'inline' },
      el('input', { type: 'checkbox', checked: favsOnly, onchange: (e) => { favsOnly = e.target.checked; paint(); } }),
      'favourites only',
    ),
  );
  root.append(bar);

  // stats
  const statsHost = el('div', { class: 'grid cols-3 mb-md' });
  root.append(statsHost);
  try {
    const s = await apiGet('/api/history/stats');
    statsHost.append(
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Chat sessions'), el('div', { class: 'v' }, s.sessions || 0)),
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Chat messages'), el('div', { class: 'v' }, s.messages || 0)),
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Saved outputs'),
        el('div', { class: 'v' }, Object.values(s.outputs_by_kind || {}).reduce((a,b) => a+b, 0)),
        el('div', { class: 'd' }, Object.entries(s.outputs_by_kind || {}).map(([k, v]) => `${k} ${v}`).join(' · ') || '—'),
      ),
    );
  } catch (e) { /* ignore */ }

  const list = el('div', { class: 'result-list' });
  root.append(list);

  async function paint() {
    clear(list).append(loading('Loading…'));
    try {
      const q = new URLSearchParams();
      if (filter !== 'all') q.set('kind', filter);
      if (favsOnly) q.set('favorite', 'true');
      q.set('limit', '200');
      const items = await apiGet('/api/history/outputs?' + q.toString());
      // update bar highlights
      for (const btn of bar.querySelectorAll('button[data-kind]')) {
        btn.classList.toggle('btn-primary', btn.dataset.kind === filter);
      }
      clear(list);
      if (!items.length) { list.append(empty('No entries.', 'Generate something first.')); return; }
      for (const it of items) list.append(row(it));
    } catch (e) {
      clear(list);
      list.append(el('div', { class: 'error-box' }, e.message));
      toastError(e, 'History');
    }
  }

  function row(it) {
    const url = it.file_path ? '/files/' + it.file_path : '';
    const kindColor = { image: 'accent', tts: 'accent', vision: 'accent',
                        stt: 'moss', embedding: 'moss', search: 'moss', fetch: 'moss' }[it.kind] || '';
    const node = el('div', { class: 'result-item' },
      el('div', { class: 'inline' },
        el('span', { class: 'pill ' + kindColor }, it.kind),
        el('code', { class: 'mono' }, it.model || '—'),
        el('span', { class: 'muted', style: { fontSize: '0.78rem' } }, fmtDate(it.created_at)),
        it.favorite ? el('span', { class: 'pill accent', title: 'favorite' }, '★') : null,
      ),
      el('div', { style: { marginTop: '4px' } }, (it.prompt || '').slice(0, 200) || '—'),
    );

    if (it.kind === 'image' && url) {
      node.append(el('div', { style: { marginTop: '6px' } },
        el('img', { src: url, style: { maxHeight: '120px', borderRadius: '6px' } })));
    } else if (it.kind === 'tts' && url) {
      node.append(el('div', { style: { marginTop: '6px' } }, el('audio', { controls: true, src: url })));
    } else if (it.kind === 'embedding') {
      node.append(el('div', { class: 'muted', style: { fontSize: '0.82rem', marginTop: '4px' } },
        `dim ${it.result?.dimensions || '—'} · ${it.result?.count || '—'} vector(s)`));
    } else if (it.kind === 'vision') {
      const text = (it.result?.text || '').slice(0, 280);
      node.append(el('pre', {
        style: { whiteSpace: 'pre-wrap', marginTop: '6px', fontSize: '0.85rem', maxHeight: '140px' },
      }, text || '—'));
    }

    node.append(el('div', { class: 'btn-row mt-sm' },
      it.file_path ? el('a', { class: 'btn btn-small', href: url, target: '_blank', rel: 'noopener' }, 'open') : null,
      el('button', {
        class: 'btn btn-small' + (it.favorite ? ' btn-primary' : ''),
        onclick: async () => {
          try { await apiPatch('/api/history/outputs/' + it.id, { favorite: !it.favorite }); it.favorite = !it.favorite; paint(); }
          catch (e) { toastError(e); }
        },
      }, it.favorite ? '★ favourited' : '☆ favourite'),
      el('button', {
        class: 'btn btn-small btn-danger',
        onclick: async () => {
          if (!confirm('Delete this entry?')) return;
          try { await apiDelete('/api/history/outputs/' + it.id); toastGood('Deleted'); paint(); }
          catch (e) { toastError(e); }
        },
      }, '✕ delete'),
    ));

    return node;
  }

  await paint();
}

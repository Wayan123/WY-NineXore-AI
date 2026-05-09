// Image generation view.
import { apiGet, apiJSON, apiDelete, apiPatch } from '../api.js';
import { defaultModel, modelList } from '../store.js';
import { clear, download, el, empty, fmtDate, loading, openModal, toastError, toastGood, toastWarn } from '../ui.js';

const LS = 'nine.image.prefs';

const state = { model: '', prompt: '', size: '1024x1024', quality: '', n: 1, history: [] };

function loadPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(LS) || '{}');
    Object.assign(state, s);
  } catch {}
}
function savePrefs() {
  const { model, prompt, size, quality, n } = state;
  localStorage.setItem(LS, JSON.stringify({ model, prompt, size, quality, n }));
}

export async function mount(root) {
  loadPrefs();
  if (!state.model) state.model = defaultModel('image');
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Images'),
      el('p', { class: 'sub' }, 'Describe what you want. Everything you generate is saved into the data folder.'),
    ),
  ));

  // -------- form card -----------------------------------------------------
  const opts = modelList('image');
  const modelSel = el('select', {
    onchange: (e) => { state.model = e.target.value; savePrefs(); },
  },
    ...opts.map(m => el('option', { value: m.id, selected: m.id === state.model }, m.id)),
  );
  if (!opts.length) modelSel.append(el('option', { value: '' }, '— no image models configured —'));

  const promptTA = el('textarea', {
    placeholder: 'e.g. “a quiet tea-house at dusk, watercolour, soft grain”',
    oninput: (e) => { state.prompt = e.target.value; savePrefs(); },
    rows: 4,
  });
  promptTA.value = state.prompt || '';

  const sizes = ['512x512', '768x768', '1024x1024', '1024x1792', '1792x1024'];
  const sizeSel = el('select', { onchange: (e) => { state.size = e.target.value; savePrefs(); } },
    ...sizes.map(s => el('option', { value: s, selected: s === state.size }, s)),
  );
  const qualSel = el('select', { onchange: (e) => { state.quality = e.target.value; savePrefs(); } },
    el('option', { value: '' }, 'quality: default'),
    el('option', { value: 'standard', selected: state.quality === 'standard' }, 'standard'),
    el('option', { value: 'hd', selected: state.quality === 'hd' }, 'hd'),
  );
  const nIn = el('input', { type: 'number', min: 1, max: 4, value: state.n,
    onchange: (e) => { state.n = Math.max(1, Math.min(4, parseInt(e.target.value) || 1)); savePrefs(); },
    style: { width: '90px' } });

  const goBtn = el('button', { class: 'btn btn-primary', onclick: generate }, 'Generate');
  const status = el('div', { class: 'muted' }, '');

  const card = el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Model ', el('span', { class: 'req' }, '*')), modelSel),
      el('div', { class: 'field' },
        el('label', {}, 'Options'),
        el('div', { class: 'inline' }, sizeSel, qualSel, nIn),
      ),
    ),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Prompt ', el('span', { class: 'req' }, '*')),
      promptTA,
    ),
    el('div', { class: 'btn-row mt-sm' }, goBtn, status),
  );
  root.append(card);

  // -------- gallery -------------------------------------------------------
  root.append(el('div', { class: 'page-head mt-lg' },
    el('div', {}, el('h3', {}, 'Your images'), el('p', { class: 'sub' }, 'Saved to `data/outputs`. Click to zoom.')),
    el('div', { class: 'inline' },
      el('button', { class: 'btn btn-ghost btn-small', onclick: reloadGallery }, '↻ refresh'),
    ),
  ));
  const gallery = el('div', { class: 'image-grid' });
  root.append(gallery);
  await reloadGallery();

  root.addEventListener('view:show', reloadGallery);

  async function generate() {
    if (!state.model) { toastWarn('Pick a model first'); return; }
    if (!state.prompt.trim()) { toastWarn('Prompt is empty'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Generating…'));
    try {
      const body = {
        model: state.model,
        prompt: state.prompt.trim(),
        n: state.n || 1,
        size: state.size || undefined,
        quality: state.quality || undefined,
      };
      const r = await apiJSON('/api/image/generate', body);
      toastGood('Saved ' + (r.images?.length || 0) + ' image(s)');
      status.innerHTML = '';
      await reloadGallery();
    } catch (e) {
      toastError(e, 'Generate failed');
      status.innerHTML = '';
      status.append(el('div', { class: 'error-box' },
        el('strong', {}, 'Generation failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally {
      goBtn.disabled = false;
    }
  }

  async function reloadGallery() {
    clear(gallery);
    gallery.append(loading('Loading gallery…'));
    try {
      const items = await apiGet('/api/history/outputs?kind=image&limit=60');
      clear(gallery);
      if (!items.length) { gallery.append(empty('No images yet.', 'Type a prompt above and press Generate.', '◆')); return; }
      for (const it of items) render(it);
    } catch (e) {
      clear(gallery);
      gallery.append(el('div', { class: 'error-box' }, 'Could not load gallery: ' + e.message));
    }
  }

  function render(item) {
    const saved = (item.result?.saved || []).filter(s => s?.url || s?.file);
    if (!saved.length && !item.file_path) return;
    // If the stored 'saved' list is empty (older runs), fall back to file_path
    const urls = saved.length
      ? saved.map(s => s.url || ('/files/' + s.file))
      : (item.file_path ? ['/files/' + item.file_path] : []);

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const label = urls.length > 1 ? ` (${i + 1}/${urls.length})` : '';
      const card = el('div', { class: 'image-card' },
        el('div', { class: 'thumb' },
          el('img', {
            src: url, alt: item.prompt,
            loading: 'lazy',
            onclick: () => zoom(url, item),
          }),
        ),
        el('div', { class: 'meta' },
          el('div', { class: 'prompt' }, ((item.prompt || '—').slice(0, 140)) + label),
          el('div', { class: 'muted', style: { fontSize: '0.78rem', marginTop: '4px' } },
            fmtDate(item.created_at), ' · ', el('code', { class: 'mono' }, item.model || '—'),
          ),
          el('div', { class: 'row mt-sm' },
            el('a', { class: 'btn btn-small', href: url, target: '_blank', rel: 'noopener' }, 'open'),
            el('button', { class: 'btn btn-small', onclick: () => download(url, filenameFromUrl(url, item.model)) }, 'save'),
            // Favourite/delete act on the whole history row; only show on the first image
            i === 0 ? el('button', {
              class: 'btn btn-small' + (item.favorite ? ' btn-primary' : ''),
              title: item.favorite ? 'unfavourite' : 'favourite',
              onclick: async (ev) => {
                try {
                  const next = !item.favorite;
                  await apiPatch('/api/history/outputs/' + item.id, { favorite: next });
                  item.favorite = next;
                  ev.currentTarget.classList.toggle('btn-primary', next);
                  ev.currentTarget.title = next ? 'unfavourite' : 'favourite';
                  toastGood(next ? 'Favourited' : 'Removed from favourites');
                } catch (e) { toastError(e); }
              },
            }, item.favorite ? '★' : '☆') : null,
            i === 0 ? el('button', {
              class: 'btn btn-small btn-danger',
              onclick: async () => {
                if (!confirm('Delete this entry (removes all of its images)?')) return;
                try { await apiDelete('/api/history/outputs/' + item.id); await reloadGallery(); }
                catch (e) { toastError(e); }
              },
            }, '✕') : null,
          ),
        ),
      );
      gallery.append(card);
    }
  }

  function filenameFromUrl(url, model) {
    const name = (url.split('/').pop() || 'image.png').split('?')[0];
    return name || ((model || 'image') + '.png');
  }

  function zoom(url, item) {
    openModal(el('div', {},
      el('img', { src: url, style: { maxWidth: '100%', borderRadius: '8px' } }),
      el('p', { class: 'muted', style: { marginTop: '10px' } }, item.prompt || ''),
      el('p', { class: 'muted mono', style: { fontSize: '0.78rem' } }, item.model || ''),
    ));
  }
}

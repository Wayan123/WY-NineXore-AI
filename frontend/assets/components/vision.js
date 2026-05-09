// Vision / OCR view — upload an image, pick a vision-capable chat model,
// get text back. Routes through /api/vision/extract which wraps the image
// into a multimodal /v1/chat/completions call.
import { apiGet, apiForm, apiDelete } from '../api.js';
import { modelList, refreshKind } from '../store.js';
import { clear, copyToClipboard, el, empty, fmtBytes, fmtDate, loading, toastError, toastGood, toastWarn } from '../ui.js';
import { renderMarkdown } from '../md.js';

const LS = 'nine.vision.prefs';
const state = {
  model: 'cx/gpt-5.4',
  prompt: '',
  file: null,
  fileUrl: null,
  max_tokens: 1024,
  temperature: 0,
};

function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() {
  const { model, prompt, max_tokens, temperature } = state;
  localStorage.setItem(LS, JSON.stringify({ model, prompt, max_tokens, temperature }));
}

// Known vision-capable chat models on typical 9Router deploys.
// Empty = fall back to filtered chat list.
const KNOWN_VISION = [
  'cx/gpt-5.4',
  'cx/gpt-5.5',
  'cx/gpt-5.2',
  'cx/gpt-5.1',
  'kr/claude-sonnet-4.5',
  'kr/claude-opus-4.7',
];

function pickVisionModels(allChat) {
  const ids = new Set(allChat.map(m => m.id));
  const order = KNOWN_VISION.filter(id => ids.has(id));
  const rest = allChat
    .filter(m => !order.includes(m.id))
    .filter(m => /cx\/|claude|gemini|gpt-4|gpt-5|glm/i.test(m.id));
  return [
    ...order.map(id => allChat.find(m => m.id === id)),
    ...rest,
  ];
}

export async function mount(root) {
  loadPrefs();
  await buildView(root);
  root.addEventListener('view:show', () => buildView(root));
}

async function buildView(root) {
  await refreshKind('chat').catch(() => {});

  const allChat = modelList('chat');
  const visionChoices = pickVisionModels(allChat);
  const availableIds = new Set(allChat.map(m => m.id));
  if (!state.model || !availableIds.has(state.model)) {
    state.model = visionChoices[0]?.id || allChat[0]?.id || '';
    savePrefs();
  }

  // fetch prompt catalog once; falls back to Bahasa inline if endpoint fails.
  let prompts = {};
  try {
    const r = await apiGet('/api/vision/prompts');
    prompts = r.prompts || {};
  } catch {}

  if (!state.prompt) {
    state.prompt = prompts.ocr
      || 'Baca semua teks pada gambar ini dan tulis ulang persis apa adanya. Pertahankan baris dan tanda baca. Jangan tambahkan komentar.';
  }

  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Vision · OCR'),
      el('p', { class: 'sub' }, 'Drop an image, pick a prompt, get text. Runs through a multimodal chat model.'),
    ),
  ));

  // Status callout — keep it short, just a model hint
  root.append(el('div', { class: 'callout' },
    el('strong', {}, 'Tip'),
    ' — ', el('code', {}, 'cx/gpt-5.4'), ' reads Indonesian text cleanly. Use the ',
    el('code', {}, 'translate-id'), ' prompt to translate foreign text into Bahasa.',
  ));

  // --- form ------------------------------------------------------------
  const modelSel = el('select', {
    onchange: (e) => { state.model = e.target.value; savePrefs(); },
  });
  for (const m of visionChoices) {
    const o = el('option', { value: m.id }, m.id);
    if (m.id === state.model) o.selected = true;
    modelSel.append(o);
  }
  if (!visionChoices.length) {
    modelSel.append(el('option', { value: '' }, '— no chat models —'));
  }

  const promptTA = el('textarea', {
    rows: 3,
    oninput: (e) => { state.prompt = e.target.value; savePrefs(); },
  });
  promptTA.value = state.prompt;

  const promptChips = el('div', { class: 'inline', style: { gap: '6px', flexWrap: 'wrap', marginTop: '6px' } });
  const CHIP_LABELS = {
    ocr: 'OCR (id)',
    'ocr-en': 'OCR (en)',
    describe: 'describe',
    table: 'extract table',
    'translate-id': 'translate → id',
  };
  for (const [key, label] of Object.entries(CHIP_LABELS)) {
    if (!prompts[key]) continue;
    promptChips.append(el('button', {
      class: 'btn btn-ghost btn-small',
      onclick: () => {
        state.prompt = prompts[key];
        promptTA.value = prompts[key];
        savePrefs();
      },
    }, label));
  }

  // dropzone
  const dropzone = el('div', { class: 'dropzone', tabIndex: 0,
    onclick: (e) => { if (e.target === e.currentTarget) pickFile(); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } },
  },
    el('div', { style: { fontSize: '1.4rem', marginBottom: '6px' } }, '◉'),
    el('div', {}, 'Drop an image or '),
    el('button', { class: 'btn btn-small', onclick: (e) => { e.stopPropagation(); pickFile(); } }, 'Choose image'),
    el('div', { class: 'muted mt-sm', style: { fontSize: '12px' } },
      'PNG, JPG, WebP, BMP, GIF · up to 12 MB'),
  );
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
  });

  const preview = el('div', { class: 'mt-sm' });

  const goBtn = el('button', { class: 'btn btn-primary', onclick: submit }, 'Extract');
  const status = el('div', { class: 'muted' });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' },
        el('label', {}, 'Vision model ',
          el('span', { class: 'muted' }, '(multimodal chat)')),
        modelSel,
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Image ', el('span', { class: 'req' }, '*')),
        dropzone,
      ),
    ),
    preview,
    el('div', { class: 'field mt-md' },
      el('label', {}, 'Prompt'),
      promptTA,
      promptChips,
    ),
    el('div', { class: 'btn-row mt-md' }, goBtn, status),
  ));

  const resultBox = el('div', { class: 'mt-md' });
  root.append(resultBox);

  root.append(el('h3', { class: 'mt-lg' }, 'Recent extractions'));
  const listHost = el('div', { class: 'result-list mt-sm' });
  root.append(listHost);

  await reloadList();

  // ------- helpers inside the closure --------------------------------
  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = () => inp.files?.[0] && setFile(inp.files[0]);
    inp.click();
  }

  function setFile(f) {
    state.file = f;
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = URL.createObjectURL(f);
    clear(preview);
    preview.append(
      el('div', { class: 'inline' },
        el('span', { class: 'pill' }, f.name),
        el('span', { class: 'muted', style: { fontSize: '12px' } }, fmtBytes(f.size)),
        el('button', {
          class: 'btn btn-ghost btn-small',
          onclick: () => { state.file = null; URL.revokeObjectURL(state.fileUrl); state.fileUrl = null; clear(preview); },
        }, 'remove'),
      ),
      el('img', {
        src: state.fileUrl,
        class: 'mt-sm',
        style: { maxHeight: '260px', maxWidth: '100%', borderRadius: 'var(--r-md)', border: '1px solid var(--hairline)' },
      }),
    );
  }

  async function submit() {
    if (!state.file) { toastWarn('Add an image first'); return; }
    if (!state.model) { toastWarn('Pick a model first'); return; }
    if (!state.prompt.trim()) { toastWarn('Prompt is empty'); return; }

    goBtn.disabled = true;
    clear(status).append(loading('Reading…'));
    clear(resultBox);
    try {
      const fd = new FormData();
      fd.append('file', state.file, state.file.name);
      fd.append('model', state.model);
      fd.append('prompt', state.prompt);
      fd.append('max_tokens', String(state.max_tokens || 1024));
      fd.append('temperature', String(state.temperature ?? 0));
      const r = await apiForm('/api/vision/extract', fd);
      clear(status);
      showResult(r);
      toastGood('Extracted');
      await reloadList();
    } catch (e) {
      toastError(e, 'Vision failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Vision failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally {
      goBtn.disabled = false;
    }
  }

  function showResult(r) {
    const text = r.text || '(empty response)';
    const mdHtml = renderMarkdown(text);
    resultBox.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', {}, 'Result'),
        el('div', { class: 'inline' },
          el('span', { class: 'pill' }, r.model || ''),
          r.usage?.total_tokens ? el('span', { class: 'pill' }, `tokens ${r.usage.total_tokens}`) : null,
          el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(text) }, 'copy'),
        ),
      ),
      el('div', { class: 'md', html: mdHtml }),
    ));
  }

  async function reloadList() {
    clear(listHost).append(loading('Loading…'));
    try {
      const items = await apiGet('/api/history/outputs?kind=vision&limit=30');
      clear(listHost);
      if (!items.length) { listHost.append(empty('No extractions yet.', 'Drop an image above and press Extract.', '◉')); return; }
      for (const it of items) listHost.append(renderItem(it));
    } catch (e) {
      clear(listHost);
      listHost.append(el('div', { class: 'error-box' }, 'Could not load: ' + e.message));
    }
  }

  function renderItem(it) {
    const text = it.result?.text || '';
    const meta = it.result || {};
    return el('div', { class: 'result-item' },
      el('div', { class: 'inline', style: { gap: '8px' } },
        el('code', {}, it.model || '—'),
        el('span', { class: 'muted', style: { fontSize: '11px' } },
          fmtDate(it.created_at),
          meta.bytes ? ' · ' + fmtBytes(meta.bytes) : '',
          meta.mime ? ' · ' + meta.mime : '',
        ),
      ),
      el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
        (it.prompt || '').slice(0, 160)),
      el('pre', { style: { whiteSpace: 'pre-wrap', marginTop: '6px', maxHeight: '220px' } }, (text || '').slice(0, 1200)),
      el('div', { class: 'inline mt-sm' },
        el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(text || '') }, 'copy'),
        el('button', {
          class: 'btn btn-small btn-danger',
          onclick: async () => {
            if (!confirm('Delete this extraction?')) return;
            try { await apiDelete('/api/history/outputs/' + it.id); await reloadList(); }
            catch (e) { toastError(e); }
          },
        }, '✕ delete'),
      ),
    );
  }
}

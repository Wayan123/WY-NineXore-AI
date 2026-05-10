// Speech-to-text view — upload or record, get transcript.
// Refetches the STT model list on mount so services that came online after
// dashboard boot (e.g. local Whisper on idn-tts) show up.
import { apiGet, apiForm, apiDelete } from '../api.js';
import { defaultModel, getState, modelList, refreshKind, refreshUpstream } from '../store.js';
import { clear, copyToClipboard, el, empty, fmtBytes, fmtDate, loading, toastBad, toastError, toastGood, toastWarn } from '../ui.js';

const LS = 'nine.stt.prefs';
const state = {
  model: '', language: '', prompt: '', response_format: 'json', temperature: '',
  file: null, fileUrl: null, recorder: null, chunks: [],
};
function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() {
  const { model, language, prompt, response_format, temperature } = state;
  localStorage.setItem(LS, JSON.stringify({ model, language, prompt, response_format, temperature }));
}

function sortForDropdown(models) {
  const rank = (m) => {
    const id = m.id || '';
    if (id.startsWith('local/')) return 0;
    return 1;
  };
  return [...models].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    return (a.id || '').localeCompare(b.id || '');
  });
}

export async function mount(root) {
  loadPrefs();
  await buildView(root);
  root.addEventListener('view:show', () => buildView(root));
}

async function buildView(root) {
  await refreshKind('stt').catch(() => {});
  await refreshUpstream().catch(() => {});

  const allModels = modelList('stt');
  const availableIds = new Set(allModels.map(m => m.id));
  if (!state.model || !availableIds.has(state.model)) {
    state.model = defaultModel('stt');
    if (!availableIds.has(state.model)) state.model = allModels[0]?.id || '';
    savePrefs();
  }

  // If using local/whisper and language hasn't been explicitly set, prefer 'id'
  // — Whisper autodetects but a hint produces much cleaner output for Bahasa.
  if (!state.language && state.model?.startsWith('local/whisper')) {
    state.language = 'id';
    savePrefs();
  }

  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Transcribe'),
      el('p', { class: 'sub' }, 'Drop an audio file or record from your mic. Local Whisper runs on GPU when available.'),
    ),
    el('div', { class: 'inline' },
      el('button', {
        class: 'btn btn-ghost btn-small',
        onclick: async () => {
          await refreshKind('stt');
          await refreshUpstream();
          await buildView(root);
          toastGood('Refreshed');
        },
      }, '↻ refresh models'),
    ),
  ));

  // Whisper status card — per-variant status with a "load" button
  const s = getState();
  const idn = s.idnTts || {};
  const cardHost = el('div');
  async function refreshWhisperCard() {
    await refreshUpstream();
    cardHost.innerHTML = '';
    const idn2 = getState().idnTts || {};
    const card = renderWhisperCard(idn2, onRequestLoad);
    if (card) cardHost.appendChild(card);
    // Also refresh the select so labels reflect loaded/loading.
    await refreshKind('stt');
    const allModels2 = modelList('stt');
    modelSel.innerHTML = '';
    modelSel.append(buildGroupedOptions(sortForDropdown(allModels2), state.model));
  }
  async function onRequestLoad(variant) {
    try {
      await fetch('/api/idn-tts/whisper/load?variant=' + encodeURIComponent(variant), { method: 'POST' });
      toastGood('Loading ' + variant, 'Will be ready in a moment.');
    } catch (e) {
      toastError(e, 'Whisper load');
      return;
    }
    // Poll every 2 s until the variant changes state.
    const started = Date.now();
    const poll = async () => {
      await refreshWhisperCard();
      const v = (getState().idnTts?.whisper?.variants || {})[variant];
      if (!v) return;
      if (v.loaded || v.error) {
        if (v.loaded) toastGood(variant + ' ready');
        else toastWarn(variant + ' load failed', String(v.error).slice(0, 140));
        return;
      }
      if (Date.now() - started > 300_000) return;  // 5 min cap
      setTimeout(poll, 2000);
    };
    setTimeout(poll, 1500);
  }
  const card = renderWhisperCard(idn, onRequestLoad);
  if (card) cardHost.appendChild(card);
  root.append(cardHost);

  const sorted = sortForDropdown(allModels);
  const modelSel = el('select', { onchange: (e) => { state.model = e.target.value; savePrefs(); } });
  modelSel.append(buildGroupedOptions(sorted, state.model));

  const langIn = el('input', { placeholder: 'ISO code (en, id, vi, …) — optional', value: state.language,
    oninput: (e) => { state.language = e.target.value; savePrefs(); } });
  const promptIn = el('input', { placeholder: 'optional prompt / glossary', value: state.prompt,
    oninput: (e) => { state.prompt = e.target.value; savePrefs(); } });
  const fmtSel = el('select', { onchange: (e) => { state.response_format = e.target.value; savePrefs(); } },
    ...['json', 'text', 'verbose_json', 'srt', 'vtt'].map(f =>
      el('option', { value: f, selected: f === state.response_format }, f)),
  );
  const tempIn = el('input', { type: 'number', min: 0, max: 1, step: 0.1,
    placeholder: 'temperature 0–1', value: state.temperature,
    oninput: (e) => { state.temperature = e.target.value; savePrefs(); } });

  // dropzone — click only opens the picker when the click lands on the zone
  // itself, not on a child button.
  const dropzone = el('div', { class: 'dropzone', tabIndex: 0,
    onclick: (e) => { if (e.target === e.currentTarget) pickFile(); },
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickFile(); } },
  },
    el('div', { style: { fontSize: '1.4rem', marginBottom: '6px' } }, '⇢'),
    el('div', {}, 'Drop an audio file here, or '),
    el('button', { class: 'btn btn-small', onclick: (e) => { e.stopPropagation(); pickFile(); } }, 'Choose file'),
    el('div', { class: 'muted mt-sm', style: { fontSize: '0.82rem' } },
      'MP3, WAV, M4A, WEBM, OGG, FLAC · up to 200 MB'),
  );
  dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.classList.add('dragover'); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));
  dropzone.addEventListener('drop', e => {
    e.preventDefault(); dropzone.classList.remove('dragover');
    if (e.dataTransfer?.files?.[0]) setFile(e.dataTransfer.files[0]);
  });

  const filePreview = el('div', { class: 'mt-sm' });

  // recorder
  const recordBtn = el('button', { class: 'btn', onclick: toggleRecord }, '● record');
  const recordHint = el('span', { class: 'muted', style: { fontSize: '0.82rem' } },
    'Uses your browser mic. Stop to upload.');

  const goBtn = el('button', { class: 'btn btn-primary', onclick: submit }, 'Transcribe');
  const status = el('div', { class: 'muted' });

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' }, el('label', {}, 'Model ', el('span', { class: 'req' }, '*')), modelSel),
      el('div', { class: 'field' },
        el('label', {}, 'Options'),
        el('div', { class: 'inline' }, langIn, fmtSel, tempIn),
      ),
    ),
    el('div', { class: 'field mt-sm' }, el('label', {}, 'Prompt (hint)'), promptIn),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Audio ', el('span', { class: 'req' }, '*')),
      dropzone,
      filePreview,
      el('div', { class: 'inline mt-sm' }, recordBtn, recordHint),
    ),
    el('div', { class: 'btn-row mt-sm' }, goBtn, status),
  ));

  const resultBox = el('div', { class: 'mt-md' });
  root.append(resultBox);

  root.append(el('h3', { class: 'mt-lg' }, 'Transcripts'));
  const list = el('div', { class: 'result-list mt-sm' });
  root.append(list);

  await reload();
  root.addEventListener('view:show', reload);

  function pickFile() {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'audio/*';
    inp.onchange = () => inp.files?.[0] && setFile(inp.files[0]);
    inp.click();
  }

  function setFile(f) {
    state.file = f;
    if (state.fileUrl) URL.revokeObjectURL(state.fileUrl);
    state.fileUrl = URL.createObjectURL(f);
    clear(filePreview);
    filePreview.append(
      el('div', { class: 'inline' },
        el('span', { class: 'pill' }, f.name),
        el('span', { class: 'muted', style: { fontSize: '0.82rem' } }, fmtBytes(f.size)),
        el('button', {
          class: 'btn btn-ghost btn-small',
          onclick: () => { state.file = null; URL.revokeObjectURL(state.fileUrl); state.fileUrl = null; clear(filePreview); },
        }, 'remove'),
      ),
      el('audio', { controls: true, src: state.fileUrl, class: 'mt-sm', style: { width: '100%' } }),
    );
  }

  async function toggleRecord() {
    if (state.recorder && state.recorder.state === 'recording') {
      state.recorder.stop();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const chunks = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
        const ext = (rec.mimeType || '').includes('mp4') ? 'm4a' : 'webm';
        const file = new File([blob], `recording-${Date.now()}.${ext}`, { type: blob.type });
        setFile(file);
        recordBtn.textContent = '● record';
        recordBtn.classList.remove('btn-danger');
        state.recorder = null;
      };
      rec.start();
      state.recorder = rec;
      recordBtn.textContent = '■ stop';
      recordBtn.classList.add('btn-danger');
    } catch (e) {
      toastBad('Mic not available', e.message);
    }
  }

  async function submit() {
    if (!state.file) { toastWarn('Add a file first'); return; }
    if (!state.model) { toastWarn('Pick a model first'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Transcribing…'));
    clear(resultBox);
    try {
      const fd = new FormData();
      fd.append('file', state.file, state.file.name);
      fd.append('model', state.model);
      if (state.language) fd.append('language', state.language);
      if (state.prompt) fd.append('prompt', state.prompt);
      if (state.response_format) fd.append('response_format', state.response_format);
      if (state.temperature) fd.append('temperature', state.temperature);
      const r = await apiForm('/api/stt/transcribe', fd);
      clear(status);
      showResult(r);
      toastGood('Transcribed');
      await reload();
    } catch (e) {
      toastError(e, 'STT failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Transcription failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally { goBtn.disabled = false; }
  }

  function showResult(r) {
    const body = typeof r.result === 'string' ? r.result : (r.result?.text || JSON.stringify(r.result, null, 2));
    resultBox.append(el('div', { class: 'card' },
      el('div', { class: 'card-head' },
        el('h3', {}, 'Transcript'),
        el('div', { class: 'inline' },
          el('span', { class: 'pill' }, r.filename || ''),
          el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(body) }, 'copy'),
        ),
      ),
      el('pre', { style: { whiteSpace: 'pre-wrap' } }, body),
    ));
  }

  async function reload() {
    clear(list).append(loading('Loading…'));
    try {
      const items = await apiGet('/api/history/outputs?kind=stt&limit=40');
      clear(list);
      if (!items.length) { list.append(empty('No transcripts yet.', '', '⇢')); return; }
      for (const it of items) list.append(renderItem(it));
    } catch (e) {
      clear(list);
      list.append(el('div', { class: 'error-box' }, 'Could not load: ' + e.message));
    }
  }

  function renderItem(it) {
    const r = it.result?.result;
    const text = typeof r === 'string' ? r : (r?.text || JSON.stringify(r, null, 2) || '');
    return el('div', { class: 'result-item' },
      el('div', { class: 'muted', style: { fontSize: '0.78rem' } },
        fmtDate(it.created_at), ' · ', el('code', { class: 'mono' }, it.model || '—'),
      ),
      el('div', { class: 'mono', style: { fontSize: '0.78rem', color: 'var(--ink-tertiary)' } },
        (it.prompt || '').slice(0, 80)),
      el('pre', { style: { whiteSpace: 'pre-wrap', marginTop: '4px' } }, (text || '').slice(0, 1200)),
      el('div', { class: 'inline mt-sm' },
        el('button', { class: 'btn btn-small', onclick: () => copyToClipboard(text || '') }, 'copy'),
        el('button', {
          class: 'btn btn-small btn-danger',
          onclick: async () => {
            if (!confirm('Delete this transcript?')) return;
            try { await apiDelete('/api/history/outputs/' + it.id); await reload(); }
            catch (e) { toastError(e); }
          },
        }, '✕ delete'),
      ),
    );
  }
}

// ---- helpers outside of the component closure -------------------------

function buildGroupedOptions(models, selected) {
  const frag = document.createDocumentFragment();
  const local = models.filter(m => (m.id || '').startsWith('local/'));
  const upstream = models.filter(m => !(m.id || '').startsWith('local/'));

  function addGroup(label, items) {
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const m of items) {
      const o = document.createElement('option');
      o.value = m.id;
      let tag = '';
      if (m.id?.startsWith('local/whisper')) {
        // Rich labels for whisper variants: size + status
        const size = m.size_gb ? `${m.size_gb} GB` : '';
        if (m.error)         tag = ` — failed`;
        else if (m.loading)  tag = ` — loading…`;
        else if (m.loaded)   tag = ` — ready (${m.device || 'cpu'})`;
        else                 tag = size ? ` — ${size}, downloads on first use` : ' — not loaded';
      } else if (m.loaded === false && m.loading)      tag = ' (loading…)';
      else if (m.loaded === false)                      tag = ' (loads on first use)';
      o.textContent = m.id + tag;
      if (m.id === selected) o.selected = true;
      grp.appendChild(o);
    }
    frag.appendChild(grp);
  }

  addGroup('Local (on this machine)', local);
  addGroup('Upstream (9Router)', upstream);

  if (!models.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— no STT models configured —';
    frag.appendChild(o);
  }
  return frag;
}



function renderWhisperCard(idn, onRequestLoad) {
  if (!idn) return null;
  const w = idn.whisper || {};
  if (!idn.enabled || !w.enabled) return null;
  if (!idn.reachable) return null;

  const variants = w.variants || {};
  const names = Object.keys(variants);
  if (!names.length) return null;

  const card = el('div', { class: 'audio-waveform-card' },
    el('div', { class: 'inline', style: { alignItems: 'center', gap: '14px', marginBottom: '10px' } },
      el('div', { class: 'voice-icon', title: 'whisper' }, 'WH'),
      el('div', { style: { flex: 1 } },
        el('div', { class: 'inline', style: { gap: '8px' } },
          el('strong', { style: { color: 'var(--ink)' } }, 'Local Whisper'),
          el('span', { class: 'badge-uppercase accent' }, 'offline'),
        ),
        el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
          'Audio stays on this machine. Pick a model that fits your hardware:'),
      ),
    ),
  );

  // rows per variant
  const rows = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px' } });
  for (const name of names) {
    const v = variants[name];
    let status, dotClass;
    if (v.error) {
      status = 'failed'; dotClass = 'bad';
    } else if (v.loading) {
      status = 'downloading / loading…'; dotClass = 'warn';
    } else if (v.loaded) {
      status = `ready · ${v.device || 'cpu'}`; dotClass = 'good';
    } else {
      status = 'not cached'; dotClass = '';
    }

    const loadBtn = (!v.loaded && !v.loading && !v.error)
      ? el('button', {
          class: 'btn btn-small',
          onclick: () => onRequestLoad && onRequestLoad(name),
        }, 'load')
      : null;

    rows.append(el('div', {
      class: 'inline',
      style: { gap: '10px', fontSize: '12px', padding: '4px 0',
               borderBottom: '1px solid var(--hairline-soft)' },
    },
      el('span', { class: 'indicator-dot ' + dotClass }),
      el('code', { style: { minWidth: '100px' } }, `local/whisper-${name}`),
      el('span', { class: 'muted', style: { minWidth: '90px' } },
        v.size_gb ? `${v.size_gb} GB` : ''),
      el('span', { class: 'muted', style: { flex: 1 } }, status),
      v.error ? el('span', { class: 'mono', style: { fontSize: '11px', color: 'var(--bad)' } },
        String(v.error).slice(0, 80)) : null,
      loadBtn,
    ));
  }
  card.append(rows);

  card.append(el('div', { class: 'muted mt-sm', style: { fontSize: '11px' } },
    'First load downloads the model from HuggingFace (tiny ≈ 150 MB, medium ≈ 1.5 GB, large-v3 ≈ 2.9 GB). ',
    'After that it stays resident and transcribes in <1 s.',
  ));
  return card;
}

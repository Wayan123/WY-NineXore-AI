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

  // Whisper status card
  const s = getState();
  const idn = s.idnTts || {};
  const whisperCard = renderWhisperCard(idn);
  if (whisperCard) root.append(whisperCard);

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
      const tag = m.loaded === false && m.loading ? ' (loading…)' :
                  m.loaded === false ? ' (loads on first use)' : '';
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



function renderWhisperCard(idn) {
  if (!idn) return null;
  const w = idn.whisper || {};
  if (!idn.enabled || !w.enabled) return null;
  if (!idn.reachable) return null;

  const name = (w.model || '').split('/').pop() || 'whisper';
  const initials = name.slice(0, 2).toUpperCase();

  // Surface load failures prominently — otherwise users see
  // "will load on first request" while every attempt 503s.
  if (w.error) {
    return el('div', { class: 'callout bad' },
      el('strong', {}, 'Local Whisper failed to load'),
      ' \u2014 ', el('code', {}, w.model),
      el('div', { class: 'mono mt-xs', style: { fontSize: '11px' } }, String(w.error).slice(0, 240)),
    );
  }

  if (w.loaded) {
    return el('div', { class: 'audio-waveform-card' },
      el('div', { class: 'inline', style: { alignItems: 'center', gap: '14px' } },
        el('div', { class: 'voice-icon', title: name }, initials),
        el('div', { style: { flex: 1 } },
          el('div', { class: 'inline', style: { gap: '8px' } },
            el('span', { class: 'indicator-dot good' }),
            el('strong', { style: { color: 'var(--ink)' } }, 'Local Whisper ready'),
            el('span', { class: 'badge-uppercase accent' }, 'whisper'),
          ),
          el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
            w.model, ' · ', w.device || 'cuda', ' · transcripts stay on this machine',
          ),
        ),
      ),
    );
  }

  if (w.loading) {
    return el('div', { class: 'callout warn' },
      el('strong', {}, 'Local Whisper loading…'),
      ' \u2014 ', el('code', {}, w.model), ' is warming up on GPU. This can take 10–30 s the first time.',
    );
  }

  return el('div', { class: 'callout' },
    el('strong', {}, 'Local Whisper available'),
    ' \u2014 ', el('code', {}, w.model),
    ' loads on your first transcribe request (~10–15 s, then ~0.5 s per clip).',
  );
}

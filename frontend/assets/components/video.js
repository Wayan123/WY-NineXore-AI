// Video Studio — short-video pipeline orchestrated end-to-end.
//
// Flow:
//   topic + style → POST /api/video/generate → job_id
//   poll /api/video/status/{id} every 2 s → progress + scene-by-scene
//   on done: render <video> + history, refresh recent-jobs strip
//
// Mirrors the Pixelle-Video flow (script → image → TTS → ffmpeg compose)
// but driven entirely by the dashboard's existing primitives.
import { apiGet, apiJSON } from '../api.js';
import { defaultModel, getState, modelList, refreshKind, refreshUpstream } from '../store.js';
import { clear, download, el, empty, fmtBytes, fmtDate, loading, toastError, toastGood, toastWarn } from '../ui.js';
import { t, getLocale, onLocaleChange } from '../i18n.js';

const LS = 'nine.video.prefs';

const ASPECT_OPTS = [
  { value: '1:1',  key: 'video.aspect.1to1'  },
  { value: '9:16', key: 'video.aspect.9to16' },
  { value: '16:9', key: 'video.aspect.16to9' },
  { value: '4:5',  key: 'video.aspect.4to5'  },
  { value: '5:4',  key: 'video.aspect.5to4'  },
];

const LANG_OPTS = [
  { value: 'id', label: { id: 'Bahasa Indonesia', en: 'Indonesian' } },
  { value: 'en', label: { id: 'Bahasa Inggris',   en: 'English'    } },
  { value: 'ja', label: { id: 'Bahasa Jepang',    en: 'Japanese'   } },
  { value: 'ko', label: { id: 'Bahasa Korea',     en: 'Korean'     } },
  { value: 'fr', label: { id: 'Bahasa Prancis',   en: 'French'     } },
  { value: 'de', label: { id: 'Bahasa Jerman',    en: 'German'     } },
  { value: 'es', label: { id: 'Bahasa Spanyol',   en: 'Spanish'    } },
  { value: 'vi', label: { id: 'Bahasa Vietnam',   en: 'Vietnamese' } },
];

const state = {
  topic: '',
  scene_count: 4,
  aspect: '9:16',
  chat_model: '',
  image_model: '',
  tts_model: '',
  language: 'id',
  style_prefix: '',
};

let _activePollTimer = null;
let _activeJobId = null;
let _stopPolling = false;

function loadPrefs() {
  try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {}
}

function savePrefs() {
  localStorage.setItem(LS, JSON.stringify(state));
}

function pickLabel(opt, locale = getLocale()) {
  if (opt && opt.label && typeof opt.label === 'object') {
    return opt.label[locale] || opt.label.en || opt.label.id || opt.value;
  }
  return opt && opt.value;
}

export async function mount(root) {
  loadPrefs();
  await refreshUpstream();
  await Promise.all([
    refreshKind('chat'),
    refreshKind('image'),
    refreshKind('tts'),
  ]);

  root.innerHTML = '';

  // ---------- pre-flight: capabilities -------------------------------------
  let caps = null;
  try { caps = await apiGet('/api/video/capabilities'); } catch (_) {}
  const ffmpegOk = !!(caps && caps.ffmpeg);

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, t('video.title')),
      el('p', { class: 'sub' }, t('video.subtitle')),
    ),
  ));

  if (!ffmpegOk) {
    root.append(el('div', { class: 'callout bad' },
      el('strong', {}, t('video.error.title') + ': '),
      t('video.error.ffmpegMissing')));
    return;
  }

  // ---------- defaults pull from settings + model list ---------------------
  const settings = await apiGet('/api/settings').catch(() => ({}));
  const defaults = settings.defaults || {};

  if (!state.chat_model) state.chat_model = defaults.chat || defaultModel('chat') || '';
  if (!state.image_model) state.image_model = defaults.image || defaultModel('image') || '';
  if (!state.tts_model) state.tts_model = defaults.tts || defaultModel('tts') || '';

  // ---------- model dropdown helper ---------------------------------------
  function modelSelect(kind, current, onchange) {
    const items = modelList(kind) || [];
    const sel = el('select', { onchange });
    sel.append(el('option', { value: '' }, '\u2014'));
    for (const m of items) {
      const id = m.id || m.model || '';
      if (!id) continue;
      const o = el('option', { value: id }, id);
      if (id === current) o.selected = true;
      sel.append(o);
    }
    return sel;
  }

  // ---------- form ---------------------------------------------------------
  const topicTA = el('textarea', {
    rows: 2,
    placeholder: t('video.field.topic.placeholder'),
    oninput: (e) => { state.topic = e.target.value; savePrefs(); },
  });
  topicTA.value = state.topic;

  const scenesIn = el('input', {
    type: 'range', min: '2', max: '10', step: '1',
    value: String(state.scene_count),
    style: { flex: 1 },
    oninput: (e) => { state.scene_count = parseInt(e.target.value, 10); scenesVal.textContent = state.scene_count; savePrefs(); },
  });
  const scenesVal = el('span', { class: 'mono', style: { minWidth: '2.4em', textAlign: 'right' } }, state.scene_count);

  const aspectSel = el('select', { onchange: (e) => { state.aspect = e.target.value; savePrefs(); } });
  for (const opt of ASPECT_OPTS) {
    const o = el('option', { value: opt.value, 'data-i18n': opt.key }, t(opt.key));
    if (opt.value === state.aspect) o.selected = true;
    aspectSel.append(o);
  }

  const chatSel = modelSelect('chat',  state.chat_model,  (e) => { state.chat_model = e.target.value; savePrefs(); });
  const imageSel = modelSelect('image', state.image_model, (e) => { state.image_model = e.target.value; savePrefs(); });
  const ttsSel = modelSelect('tts',   state.tts_model,   (e) => { state.tts_model = e.target.value; savePrefs(); });

  const langSel = el('select', { onchange: (e) => { state.language = e.target.value; savePrefs(); } });
  for (const opt of LANG_OPTS) {
    const o = el('option', { value: opt.value }, pickLabel(opt));
    if (opt.value === state.language) o.selected = true;
    langSel.append(o);
  }

  const styleIn = el('input', {
    placeholder: t('video.field.stylePrefix.placeholder'),
    value: state.style_prefix,
    oninput: (e) => { state.style_prefix = e.target.value; savePrefs(); },
  });

  const startBtn = el('button', { class: 'btn btn-primary' }, t('video.start'));
  const cancelBtn = el('button', {
    class: 'btn btn-ghost',
    style: { display: 'none' },
    onclick: () => { _stopPolling = true; },
  }, t('video.cancel'));

  // ---------- progress + result host --------------------------------------
  const progressHost = el('div', { class: 'card mt-md', style: { display: 'none' } });
  const sceneTable = el('div');
  const resultHost = el('div', { class: 'card mt-md', style: { display: 'none' } });
  const recentHost = el('div', { class: 'card mt-md' });

  // ---------- assemble form ----------------------------------------------
  root.append(el('div', { class: 'card' },
    el('div', { class: 'field' },
      el('label', {}, t('video.field.topic')),
      topicTA,
    ),
    el('div', { class: 'grid cols-3', style: { marginTop: '12px' } },
      el('div', { class: 'field' },
        el('label', {}, t('video.field.scenes')),
        el('div', { class: 'inline', style: { gap: '10px', alignItems: 'center' } }, scenesIn, scenesVal),
      ),
      el('div', { class: 'field' },
        el('label', {}, t('video.field.aspect')),
        aspectSel,
      ),
      el('div', { class: 'field' },
        el('label', {}, t('video.field.language')),
        langSel,
      ),
    ),
    el('div', { class: 'grid cols-3', style: { marginTop: '12px' } },
      el('div', { class: 'field' },
        el('label', {}, t('video.field.chatModel')),
        chatSel,
      ),
      el('div', { class: 'field' },
        el('label', {}, t('video.field.imageModel')),
        imageSel,
      ),
      el('div', { class: 'field' },
        el('label', {}, t('video.field.ttsModel')),
        ttsSel,
      ),
    ),
    el('div', { class: 'field', style: { marginTop: '12px' } },
      el('label', {}, t('video.field.stylePrefix')),
      styleIn,
    ),
    el('div', { class: 'inline mt-md', style: { gap: '8px' } }, startBtn, cancelBtn),
    el('div', { class: 'hint mt-xs' }, t('video.note.timing')),
  ));

  root.append(progressHost);
  root.append(resultHost);
  root.append(recentHost);

  startBtn.addEventListener('click', () => onSubmit());
  await renderRecent();

  // re-translate option labels on locale change
  onLocaleChange(() => {
    [...aspectSel.options].forEach((o) => {
      const k = o.getAttribute('data-i18n');
      if (k) o.textContent = t(k);
    });
    [...langSel.options].forEach((o) => {
      const opt = LANG_OPTS.find(x => x.value === o.value);
      if (opt) o.textContent = pickLabel(opt);
    });
  });

  // ---------- handlers ---------------------------------------------------
  async function onSubmit() {
    const topic = (state.topic || '').trim();
    if (topic.length < 2) { toastWarn(t('video.field.topic')); topicTA.focus(); return; }
    if (!state.chat_model) { toastWarn(t('video.field.chatModel'));  return; }
    if (!state.image_model) { toastWarn(t('video.field.imageModel')); return; }
    if (!state.tts_model) { toastWarn(t('video.field.ttsModel'));   return; }

    startBtn.disabled = true;
    cancelBtn.style.display = '';
    progressHost.style.display = '';
    resultHost.style.display = 'none';
    _stopPolling = false;
    progressHost.innerHTML = '';
    progressHost.append(loading(t('video.state.pending')));

    try {
      const res = await apiJSON('/api/video/generate', {
        topic, scene_count: state.scene_count, aspect: state.aspect,
        chat_model: state.chat_model, image_model: state.image_model,
        tts_model: state.tts_model,
        language: state.language, style_prefix: state.style_prefix,
      });
      _activeJobId = res.job_id;
      pollJob(res.job_id);
    } catch (e) {
      progressHost.style.display = 'none';
      startBtn.disabled = false;
      cancelBtn.style.display = 'none';
      toastError(e, t('video.error.title'));
    }
  }

  function pollJob(jobId) {
    if (_activePollTimer) clearTimeout(_activePollTimer);
    const tick = async () => {
      if (_stopPolling) {
        _stopPolling = false;
        startBtn.disabled = false;
        cancelBtn.style.display = 'none';
        return;
      }
      let job = null;
      try { job = await apiGet(`/api/video/status/${jobId}`); }
      catch (e) { toastError(e, 'video.status'); }
      if (job) renderProgress(job);
      if (job && (job.state === 'done' || job.state === 'failed')) {
        startBtn.disabled = false;
        cancelBtn.style.display = 'none';
        if (job.state === 'done') {
          toastGood(t('video.state.done'), job.output_file || '');
          renderResult(job);
          await renderRecent();
        } else {
          toastError({ message: job.error || 'unknown' }, t('video.error.title'));
        }
        return;
      }
      _activePollTimer = setTimeout(tick, 2000);
    };
    tick();
  }

  function renderProgress(job) {
    progressHost.innerHTML = '';
    const stateKey = 'video.state.' + (job.state || 'pending');
    const pct = Math.round((job.progress || 0) * 100);

    progressHost.append(
      el('div', { class: 'inline', style: { gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        el('strong', { style: { color: 'var(--ink)' } }, t(stateKey)),
        el('span', { class: 'mono muted' }, `${pct}%`),
        el('span', { class: 'muted', style: { fontSize: '12px' } }, job.message || ''),
      ),
      el('div', { style: {
        height: '6px', background: 'var(--surface-2)',
        borderRadius: '999px', overflow: 'hidden', marginTop: '8px',
      } },
        el('div', { style: {
          width: pct + '%', height: '100%',
          background: 'linear-gradient(90deg,var(--accent),var(--accent-strong,var(--accent)))',
          transition: 'width 0.4s ease',
        } }),
      ),
    );

    // Per-scene status table
    const scenes = job.scenes || [];
    if (scenes.length) {
      const tbl = el('div', { style: { marginTop: '14px' } });
      tbl.append(el('div', { class: 'badge-uppercase accent', style: { marginBottom: '6px' } },
        t('video.scenes.title')));
      for (const sc of scenes) {
        const dots =
          (sc.image_done ? '🖼️' : '·') + ' ' +
          (sc.audio_done ? '🔊' : '·') + ' ' +
          (sc.clip_done  ? '🎬' : '·');
        tbl.append(el('div', {
          style: {
            display: 'grid',
            gridTemplateColumns: '32px 60px 1fr',
            gap: '8px',
            padding: '6px 0',
            borderTop: '1px dashed var(--hairline)',
            fontSize: '12px',
          },
        },
          el('div', { class: 'mono muted' }, '#' + sc.index),
          el('div', { style: { fontSize: '14px' } }, dots),
          el('div', {}, sc.narration || ''),
        ));
      }
      progressHost.append(tbl);
    }

    if (job.state === 'failed') {
      progressHost.append(el('div', { class: 'callout bad mt-xs' },
        el('strong', {}, t('video.error.title') + ': '),
        job.error || 'unknown'));
    }
  }

  function renderResult(job) {
    resultHost.innerHTML = '';
    resultHost.style.display = '';
    const url = job.output_file ? '/files/' + job.output_file : '';
    resultHost.append(
      el('div', { class: 'inline', style: { gap: '10px', alignItems: 'baseline' } },
        el('strong', {}, t('video.result.title')),
        el('span', { class: 'muted', style: { fontSize: '12px' } }, job.output_file || ''),
      ),
    );
    if (url) {
      const video = el('video', {
        src: url, controls: 'controls', preload: 'metadata',
        style: { width: '100%', maxWidth: '480px', borderRadius: 'var(--r-md)', marginTop: '10px', background: 'black' },
      });
      resultHost.append(video);
      resultHost.append(el('div', { class: 'inline mt-xs', style: { gap: '6px' } },
        el('a', { class: 'btn btn-ghost btn-small', href: url, download: '' }, t('btn.download')),
        el('a', { class: 'btn btn-ghost btn-small', href: url, target: '_blank', rel: 'noopener' }, '↗'),
      ));
    }
  }

  async function renderRecent() {
    recentHost.innerHTML = '';
    recentHost.append(el('div', { class: 'badge-uppercase accent', style: { marginBottom: '6px' } },
      t('video.recent')));
    let items = [];
    try {
      const r = await apiGet('/api/history/outputs?kind=video&limit=10');
      items = Array.isArray(r) ? r : (r?.data || []);
    } catch (_) {}
    if (!items.length) {
      recentHost.append(el('div', { class: 'muted', style: { fontSize: '12px' } }, t('video.recent.empty')));
      return;
    }
    for (const it of items) {
      const url = it.file_path ? '/files/' + it.file_path : '';
      const sz = it?.result?.bytes ? fmtBytes(it.result.bytes) : '';
      recentHost.append(el('div', {
        style: {
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: '8px',
          padding: '8px 0',
          borderTop: '1px dashed var(--hairline)',
          fontSize: '13px',
        },
      },
        el('div', {},
          el('div', {}, it.prompt || '(no topic)'),
          el('div', { class: 'muted', style: { fontSize: '11px' } },
            (it.created_at ? fmtDate(it.created_at) : '') + (sz ? ' · ' + sz : '')),
        ),
        el('div', { class: 'inline', style: { gap: '4px' } },
          url ? el('a', { class: 'btn btn-ghost btn-small', href: url, target: '_blank' }, '▶') : null,
          url ? el('a', { class: 'btn btn-ghost btn-small', href: url, download: '' }, '↓') : null,
        ),
      ));
    }
  }
}

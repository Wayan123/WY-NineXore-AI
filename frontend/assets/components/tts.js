// Text-to-speech view.
// Always refetches the TTS model list on mount so voices from services that
// came online after dashboard boot (e.g. idn-tts) show up without a reload.
import { apiGet, apiJSON, apiDelete } from '../api.js';
import { defaultModel, getState, modelList, refreshKind, refreshUpstream } from '../store.js';
import { clear, download, el, empty, fmtBytes, fmtDate, loading, toastError, toastGood, toastWarn } from '../ui.js';

const LS = 'nine.tts.prefs';
const state = { model: '', text: '', voice: '', langFilter: '', speed: 1.2 };

function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() {
  const { model, text, voice, langFilter, speed } = state;
  localStorage.setItem(LS, JSON.stringify({ model, text, voice, langFilter, speed }));
}

/**
 * Sort TTS models so the most-likely useful voices are at the top:
 *   1. named Coqui (wibowo, ardi, gadis) — Indonesian named voices
 *   2. all upstream 9Router voices (nvidia, openai, el, edge-tts, ...)
 *   3. regional Coqui (coqui/JV-*, coqui/SU-*) at the bottom
 */
function sortForDropdown(models) {
  const NAMED_COQUI = new Set(['coqui/wibowo', 'coqui/ardi', 'coqui/gadis']);
  const rank = (m) => {
    const id = m.id || '';
    if (NAMED_COQUI.has(id)) return 0;
    if (!id.startsWith('coqui/')) return 1;
    return 2;
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
  // --- refresh TTS list every time the panel opens ---------------------
  await refreshKind('tts').catch(() => {});
  // also probe the idn-tts service so the status card is up to date
  await refreshUpstream().catch(() => {});

  const allModels = modelList('tts');
  const availableIds = new Set(allModels.map(m => m.id));

  // If the persisted model isn't in the current list (e.g. idn-tts started
  // after dashboard boot and then stopped again), snap to the best default.
  if (!state.model || !availableIds.has(state.model)) {
    state.model = defaultModel('tts');
    if (!availableIds.has(state.model)) {
      state.model = allModels[0]?.id || '';
    }
    savePrefs();
  }

  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Speak'),
      el('p', { class: 'sub' }, 'Pick a voice, type what to say. Output is saved.'),
    ),
    el('div', { class: 'inline' },
      el('button', {
        class: 'btn btn-ghost btn-small',
        title: 'Re-fetch the model list',
        onclick: async () => {
          await refreshKind('tts');
          await refreshUpstream();
          await buildView(root);
          toastGood('Refreshed');
        },
      }, '↻ refresh voices'),
    ),
  ));

  // --- Indonesian TTS status card (always visible) ---------------------
  const s = getState();
  const idn = s.idnTts || {};
  const idnCard = renderIdnCard(idn);
  if (idnCard) root.append(idnCard);

  // --- form ------------------------------------------------------------
  const sorted = sortForDropdown(allModels);

  const modelSel = el('select', {
    onchange: (e) => {
      state.model = e.target.value;
      savePrefs();
      renderCoquiHint();
      refreshVoices();
      updatePlaceholder();
      updateSpeedVisibility();
    },
  });
  modelSel.append(buildGroupedOptions(sorted, state.model));

  function updatePlaceholder() {
    if (!textTA) return;
    textTA.placeholder = (state.model || '').startsWith('coqui/')
      ? 'Tulis kalimat dalam Bahasa Indonesia…'
      : 'Type what you want spoken…';
  }

  const coquiHint = el('div', { class: 'hint-card mt-xs', style: { display: 'none' } });
  function renderCoquiHint() {
    if ((state.model || '').startsWith('coqui/')) {
      const speaker = state.model.split('/')[1];
      coquiHint.style.display = '';
      coquiHint.innerHTML = '';
      coquiHint.append(
        el('span', { class: 'badge-uppercase accent' }, 'coqui · indonesian'),
        el('div', { style: { marginTop: '6px' } },
          'Voice ', el('code', {}, speaker),
          ' routed to the local ', el('code', {}, 'idn-tts'), ' service. Best for Bahasa Indonesia.',
        ),
      );
    } else {
      coquiHint.style.display = 'none';
    }
  }

  const langIn = el('input', {
    placeholder: 'filter voices by language (e.g. en, id, vi)',
    value: state.langFilter || '',
    oninput: (e) => { state.langFilter = e.target.value; savePrefs(); refreshVoices(); },
  });
  const voiceSel = el('select');
  const voicesHint = el('div', { class: 'hint' }, 'Voices come from /v1/audio/voices per provider.');

  const textTA = el('textarea', {
    rows: 5,
    placeholder: (state.model || '').startsWith('coqui/')
      ? 'Tulis kalimat dalam Bahasa Indonesia…'
      : 'Type what you want spoken…',
    oninput: (e) => { state.text = e.target.value; savePrefs(); },
  });
  textTA.value = state.text || '';

  // Sample helpers — load a phrase in the right language
  const samples = [
    { label: 'sample · id', text: 'Selamat pagi, apa kabar hari ini? Semoga harimu menyenangkan.' },
    { label: 'sample · en', text: 'Hello there. This is a quick test of the speech system.' },
  ];
  const sampleRow = el('div', { class: 'inline', style: { marginTop: '6px', gap: '6px' } },
    ...samples.map(s => el('button', {
      class: 'btn btn-ghost btn-small',
      onclick: () => { textTA.value = s.text; state.text = s.text; savePrefs(); },
    }, s.label)),
  );

  const goBtn = el('button', { class: 'btn btn-primary', onclick: speak }, 'Speak');
  const status = el('div', { class: 'muted' });

  // ---- speed control (only meaningful for coqui/*) --------------------
  const speedVal = el('span', { class: 'mono', 'aria-live': 'polite', style: { minWidth: '48px', textAlign: 'right' } },
    `${(state.speed || 1.2).toFixed(2)}×`);
  const speedSlider = el('input', {
    id: 'tts-speed',
    type: 'range', min: '0.5', max: '2.5', step: '0.05',
    value: String(state.speed || 1.2),
    'aria-label': 'Speaking pace',
    'aria-valuetext': `${(state.speed || 1.2).toFixed(2)} times normal`,
    oninput: (e) => {
      state.speed = parseFloat(e.target.value);
      speedVal.textContent = `${state.speed.toFixed(2)}×`;
      e.target.setAttribute('aria-valuetext', `${state.speed.toFixed(2)} times normal`);
      savePrefs();   // persist during drag, not only on release
    },
    onchange: () => savePrefs(),
    style: { flex: 1 },
  });
  const speedResetBtn = el('button', {
    class: 'btn btn-ghost btn-small',
    title: 'Reset to 1.20 (natural pace)',
    onclick: () => {
      state.speed = 1.2;
      speedSlider.value = '1.2';
      speedVal.textContent = '1.20×';
      savePrefs();
    },
  }, 'reset');
  const speedHint = el('div', { class: 'hint', id: 'tts-speed-hint' },
    '0.5× very fast — 1.00× native (rushes) — ',
    el('strong', {}, '1.20× natural'),
    ' — 2.5× very slow. Higher = slower.',
  );
  const speedField = el('div', { class: 'field mt-md' },
    el('label', { for: 'tts-speed' }, 'Speaking pace ',
      el('span', { class: 'muted' }, '(Coqui local; many upstream TTS providers honor it too)')),
    el('div', { class: 'inline', style: { gap: '10px' } }, speedSlider, speedVal, speedResetBtn),
    speedHint,
  );
  // show/hide based on current model: coqui local honors speed always; for
  // upstream TTS we still show the control because many providers honor it too.
  function updateSpeedVisibility() {
    speedField.style.display = '';
  }
  updateSpeedVisibility();

  root.append(el('div', { class: 'card' },
    el('div', { class: 'grid cols-2' },
      el('div', { class: 'field' },
        el('label', {}, 'Voice model ',
          el('span', { class: 'muted' }, `(${allModels.length} available)`)),
        modelSel,
        coquiHint,
      ),
      el('div', { class: 'field' },
        el('label', {}, 'Voice override (optional)'),
        el('div', { class: 'inline', style: { gap: '6px' } }, langIn, voiceSel),
        voicesHint,
      ),
    ),
    el('div', { class: 'field mt-md' },
      el('label', {}, 'Text ', el('span', { class: 'req' }, '*')),
      textTA,
      sampleRow,
    ),
    speedField,
    el('div', { class: 'btn-row mt-md' }, goBtn, status),
  ));

  root.append(el('h3', { class: 'mt-lg' }, 'Recent speech'));
  const list = el('div', { class: 'result-list mt-sm' });
  root.append(list);

  renderCoquiHint();
  await refreshVoices();
  await reloadList();

  async function refreshVoices() {
    voiceSel.innerHTML = '';
    voiceSel.append(el('option', { value: '' }, '— default voice —'));
    try {
      const providerHint = (state.model || '').split('/')[0] || '';
      const q = new URLSearchParams();
      if (providerHint) q.set('provider', providerHint);
      if (state.langFilter) q.set('lang', state.langFilter);
      const res = await apiGet('/api/tts/voices?' + q.toString());
      const items = res?.data || [];
      for (const v of items) {
        const label = v.model || v.id || v.name || '';
        if (!label) continue;
        const o = el('option', { value: label }, label + (v.language ? ` · ${v.language}` : ''));
        if (label === state.voice) o.selected = true;
        voiceSel.append(o);
      }
      voiceSel.onchange = (e) => { state.voice = e.target.value; savePrefs(); };
      voicesHint.textContent = items.length ? `${items.length} voice(s) found` : 'No voices listed for this provider.';
    } catch (e) {
      voicesHint.textContent = 'Voices list not available.';
    }
  }

  async function speak() {
    if (!state.model) { toastWarn('Pick a voice first'); return; }
    if (!state.text.trim()) { toastWarn('Enter some text first'); return; }
    goBtn.disabled = true;
    clear(status).append(loading('Synthesising…'));
    try {
      const payload = { model: state.model, input: state.text.trim() };
      if (state.voice) payload.voice = state.voice;
      // Speed: forward to both coqui (local) and upstream TTS — upstream
      // providers that don't honor the field ignore it.
      if (state.speed && state.speed !== 1.0) payload.speed = state.speed;
      const r = await apiJSON('/api/tts/speak', payload);
      toastGood('Saved', r.file);
      clear(status);
      await reloadList();
    } catch (e) {
      toastError(e, 'TTS failed');
      clear(status).append(el('div', { class: 'error-box' },
        el('strong', {}, 'Synthesis failed' + (e.status ? ` (${e.status})` : '')),
        el('pre', {}, e.upstreamMessage || e.message),
      ));
    } finally { goBtn.disabled = false; }
  }

  async function reloadList() {
    clear(list).append(loading('Loading…'));
    try {
      const items = await apiGet('/api/history/outputs?kind=tts&limit=40');
      clear(list);
      if (!items.length) { list.append(empty('Nothing spoken yet.', 'Type some text above and press Speak.', '♪')); return; }
      for (const it of items) list.append(renderItem(it));
    } catch (e) {
      clear(list);
      list.append(el('div', { class: 'error-box' }, 'Could not load: ' + e.message));
    }
  }

  function renderItem(it) {
    const url = it.file_path ? '/files/' + it.file_path : null;
    const isCoqui = it.model?.startsWith('coqui/') || it.result?.provider === 'coqui';
    const speaker = isCoqui ? it.model.split('/').pop() : (it.model || '?').slice(0, 2);
    const initials = (speaker || '??').slice(0, 2);

    const wrapper = isCoqui ? 'audio-waveform-card' : 'result-item';

    return el('div', { class: wrapper },
      el('div', { class: 'inline', style: { alignItems: 'center', gap: '10px' } },
        isCoqui ? el('div', { class: 'voice-icon', title: speaker }, initials) : null,
        el('div', { style: { flex: 1, minWidth: 0 } },
          el('div', { class: 'inline', style: { gap: '8px', flexWrap: 'wrap' } },
            el('code', { style: { fontSize: '12px' } }, it.model || '—'),
            isCoqui ? el('span', { class: 'badge-uppercase accent' }, 'coqui · id') : null,
            el('span', { class: 'muted', style: { fontSize: '11px' } },
              fmtDate(it.created_at),
              it.result?.bytes ? ' · ' + fmtBytes(it.result.bytes) : '',
            ),
          ),
          el('div', { style: { margin: '6px 0 4px', color: 'var(--ink-muted)', fontSize: '13px' } },
            (it.prompt || '').slice(0, 220) || '—'),
        ),
      ),
      el('div', { class: 'audio-row mt-sm' },
        url ? el('audio', { controls: true, src: url }) : null,
        url ? el('button', {
          class: 'btn btn-small',
          onclick: () => download(url, 'speech.' + (url.endsWith('.wav') ? 'wav' : 'mp3')),
        }, 'download') : null,
        el('button', {
          class: 'btn btn-small btn-danger',
          onclick: async () => {
            if (!confirm('Delete?')) return;
            try { await apiDelete('/api/history/outputs/' + it.id); await reloadList(); }
            catch (e) { toastError(e); }
          },
        }, '✕'),
      ),
    );
  }
}

function buildGroupedOptions(models, selected) {
  const frag = document.createDocumentFragment();

  const named = models.filter(m => ['coqui/wibowo', 'coqui/ardi', 'coqui/gadis'].includes(m.id));
  const upstream = models.filter(m => !m.id?.startsWith('coqui/'));
  const regional = models.filter(m => m.id?.startsWith('coqui/') && !named.includes(m));

  function addGroup(label, items) {
    if (!items.length) return;
    const grp = document.createElement('optgroup');
    grp.label = label;
    for (const m of items) {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.id;
      if (m.id === selected) o.selected = true;
      grp.appendChild(o);
    }
    frag.appendChild(grp);
  }

  addGroup('Coqui · Indonesian (recommended)', named);
  addGroup('Upstream (9Router)', upstream);
  addGroup('Coqui · regional (Javanese / Sundanese)', regional);

  if (!models.length) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = '— no TTS models configured —';
    frag.appendChild(o);
  }
  return frag;
}

function renderIdnCard(idn) {
  if (!idn) return null;
  if (!idn.enabled) {
    return el('div', { class: 'callout' },
      el('strong', {}, 'Indonesian TTS disabled'),
      ' — set ', el('code', {}, 'IDN_TTS_ENABLED=true'), ' in .env to use Coqui voices.',
    );
  }
  if (!idn.reachable) {
    return el('div', { class: 'callout warn' },
      el('strong', {}, 'Indonesian TTS unreachable'),
      ' at ', el('code', {}, idn.url), '. Check log ',
      el('code', {}, '/tmp/wy-nine-idn-tts.log'),
      ' and restart ', el('code', {}, './run.sh'),
      '. Press ↻ refresh voices once it\'s back.',
    );
  }
  const voice = idn.default_speaker || 'wibowo';
  const initials = voice.slice(0, 2).toUpperCase();
  return el('div', { class: 'audio-waveform-card' },
    el('div', { class: 'inline', style: { alignItems: 'center', gap: '14px' } },
      el('div', { class: 'voice-icon', title: voice }, initials),
      el('div', { style: { flex: 1 } },
        el('div', { class: 'inline', style: { gap: '8px' } },
          el('span', { class: 'indicator-dot good' }),
          el('strong', { style: { color: 'var(--ink)' } }, 'Indonesian TTS online'),
          el('span', { class: 'badge-uppercase accent' }, 'coqui'),
        ),
        el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
          `${idn.n_speakers || 0} voices`, ' · default ',
          el('code', {}, voice),
          idn.device ? ' · ' + idn.device : '',
        ),
      ),
    ),
  );
}

// Text-to-speech view.
// Always refetches the TTS model list on mount so voices from services that
// came online after dashboard boot (e.g. idn-tts) show up without a reload.
import { apiGet, apiJSON, apiDelete } from '../api.js';
import { defaultModel, getState, modelList, refreshKind, refreshUpstream } from '../store.js';
import { clear, download, el, empty, fmtBytes, fmtDate, loading, toastError, toastGood, toastWarn } from '../ui.js';
import { t, getLocale, pickLocale } from '../i18n.js';

// Cache the Supertonic voice catalogue once we have it so we can render
// inline descriptions next to the selected voice without re-fetching.
let _supertonicVoiceMeta = null;
async function ensureSupertonicVoiceMeta() {
  if (_supertonicVoiceMeta) return _supertonicVoiceMeta;
  try {
    const info = await apiGet('/api/idn-tts/supertonic/voices');
    if (info && Array.isArray(info.voices)) {
      _supertonicVoiceMeta = {};
      for (const v of info.voices) {
        if (v && v.name) _supertonicVoiceMeta[v.name] = v;
      }
    }
  } catch (_) {}
  return _supertonicVoiceMeta || {};
}

const LS = 'nine.tts.prefs';
const state = { model: '', text: '', voice: '', langFilter: '', speed: 1.2 };

function loadPrefs() { try { Object.assign(state, JSON.parse(localStorage.getItem(LS) || '{}')); } catch {} }
function savePrefs() {
  const { model, text, voice, langFilter, speed } = state;
  localStorage.setItem(LS, JSON.stringify({ model, text, voice, langFilter, speed }));
}

/**
 * Sort TTS models so the most-likely useful voices are at the top:
 *   1. Supertonic on-device voices (M1…M5, F1…F5)
 *   2. named Coqui (wibowo, ardi, gadis) — Indonesian named voices
 *   3. all upstream 9Router voices (nvidia, openai, el, edge-tts, ...)
 *   4. regional Coqui (coqui/JV-*, coqui/SU-*) at the bottom
 */
function sortForDropdown(models) {
  const NAMED_COQUI = new Set(['coqui/wibowo', 'coqui/ardi', 'coqui/gadis']);
  const rank = (m) => {
    const id = m.id || '';
    if (id.startsWith('supertonic/')) return 0;
    if (NAMED_COQUI.has(id)) return 1;
    if (!id.startsWith('coqui/')) return 2;
    return 3;
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
      el('h2', {}, t('tts.title')),
      el('p', { class: 'sub' }, t('tts.subtitle')),
    ),
    el('div', { class: 'inline' },
      el('button', {
        class: 'btn btn-ghost btn-small',
        title: 'Re-fetch the model list',
        onclick: async () => {
          await refreshKind('tts');
          await refreshUpstream();
          await buildView(root);
          toastGood(t('btn.refresh'));
        },
      }, t('btn.refreshVoices')),
    ),
  ));

  // --- Indonesian TTS status card (always visible) ---------------------
  const s = getState();
  const idn = s.idnTts || {};
  const idnCard = renderIdnCard(idn);
  if (idnCard) root.append(idnCard);

  // Supertonic status card (only when SDK enabled)
  const supertonicCardHost = el('div');
  async function refreshSupertonicCard() {
    supertonicCardHost.innerHTML = '';
    let info = null;
    try {
      info = await apiGet('/api/idn-tts/supertonic/voices');
    } catch (_) {}
    const card = renderSupertonicCard(info, async () => {
      try {
        await apiJSON('/api/idn-tts/supertonic/load', {});
        toastGood('Loading Supertonic', '~30–90 s on first download (260 MB).');
      } catch (e) { toastError(e, 'Supertonic load'); return; }
      const t0 = Date.now();
      const poll = async () => {
        await refreshSupertonicCard();
        let info2 = null;
        try { info2 = await apiGet('/api/idn-tts/supertonic/voices'); } catch (_) {}
        if (!info2) return;
        if (info2.loaded || info2.error) {
          if (info2.loaded) toastGood('Supertonic ready', `${info2.voices?.length || 0} voices · ${info2.device || 'cpu'}`);
          else toastWarn('Supertonic load failed', String(info2.error).slice(0, 140));
          // refresh model dropdown so loaded flag flows into option labels
          await refreshKind('tts');
          await buildView(root);
          return;
        }
        if (Date.now() - t0 > 300_000) return;
        setTimeout(poll, 2000);
      };
      setTimeout(poll, 1500);
    });
    if (card) supertonicCardHost.appendChild(card);
  }
  refreshSupertonicCard();
  root.append(supertonicCardHost);

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
      updateLangVisibility();
      updateSupertonicCaption();
    },
  });
  modelSel.append(buildGroupedOptions(sorted, state.model));

  function updatePlaceholder() {
    if (!textTA) return;
    const m = state.model || '';
    if (m.startsWith('coqui/')) {
      textTA.placeholder = 'Tulis kalimat dalam Bahasa Indonesia…';
    } else if (m.startsWith('supertonic/')) {
      textTA.placeholder = 'Type any of 31 supported languages — EN, ID, JA, KO, FR, DE, ES, AR…';
    } else {
      textTA.placeholder = 'Type what you want spoken…';
    }
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
  const voicesHint = el('div', { class: 'hint' }, t('tts.voice.hint'));
  // Supertonic voice description caption: surfaces the official voice
  // metadata (gender + bilingual description + use-cases) for the
  // currently selected supertonic/<voice> model.
  const supertonicCaption = el('div', { class: 'hint mt-xs', style: { display: 'none', borderLeft: '2px solid var(--accent)', padding: '6px 10px', background: 'var(--surface-2)', borderRadius: 'var(--r-sm)' } });
  async function updateSupertonicCaption() {
    const m = state.model || '';
    if (!m.startsWith('supertonic/')) {
      supertonicCaption.style.display = 'none';
      supertonicCaption.innerHTML = '';
      return;
    }
    const voiceName = m.split('/')[1] || '';
    const meta = (await ensureSupertonicVoiceMeta())[voiceName];
    if (!meta) {
      supertonicCaption.style.display = 'none';
      return;
    }
    const desc = pickLocale(meta.description);
    const useCases = pickLocale(meta.use_cases);
    const genderKey = 'tts.voice.gender.' + (meta.gender || 'custom');
    supertonicCaption.innerHTML = '';
    supertonicCaption.append(
      el('div', { class: 'inline', style: { gap: '6px', alignItems: 'center', marginBottom: '4px' } },
        el('strong', { style: { color: 'var(--ink)' } }, voiceName),
        el('span', { class: 'badge-uppercase accent' }, t(genderKey)),
      ),
      el('div', { style: { color: 'var(--ink-muted)', fontSize: '12px' } }, desc),
      useCases ? el('div', { class: 'muted', style: { fontSize: '11px', marginTop: '4px' } },
        el('strong', {}, t('tts.voice.useCases') + ': '), useCases) : null,
    );
    supertonicCaption.style.display = '';
  }

  const textTA = el('textarea', {
    rows: 5,
    placeholder: (state.model || '').startsWith('coqui/')
      ? 'Tulis kalimat dalam Bahasa Indonesia…'
      : 'Type what you want spoken…',
    oninput: (e) => { state.text = e.target.value; savePrefs(); },
  });
  textTA.value = state.text || '';

  // Sample helpers — load a phrase in the right language. When a Supertonic
  // voice is selected, the sample's lang code is also pushed into the language
  // dropdown so the user doesn't have to switch it manually.
  const samples = [
    { label: 'id',  lang: 'id', text: 'Selamat pagi, apa kabar hari ini? Semoga harimu menyenangkan.' },
    { label: 'en',  lang: 'en', text: 'Hello there. This is a quick test of the speech system.' },
    { label: 'ja',  lang: 'ja', text: 'こんにちは、これは音声合成のテストです。' },
    { label: 'ko',  lang: 'ko', text: '안녕하세요, 이것은 음성 합성 테스트입니다.' },
    { label: 'fr',  lang: 'fr', text: 'Bonjour, ceci est un test rapide du système de synthèse vocale.' },
    { label: 'vi',  lang: 'vi', text: 'Xin chào, đây là một bài kiểm tra giọng nói tiếng Việt.' },
  ];
  const sampleRow = el('div', { class: 'inline', style: { marginTop: '6px', gap: '6px', flexWrap: 'wrap' } },
    el('span', { class: 'muted', style: { fontSize: '11px', alignSelf: 'center' } }, 'samples:'),
    ...samples.map(s => el('button', {
      class: 'btn btn-ghost btn-small',
      onclick: () => {
        textTA.value = s.text;
        state.text = s.text;
        // If a Supertonic voice is active, also flip the language picker.
        if ((state.model || '').startsWith('supertonic/') && langSel) {
          if ([...langSel.options].some(o => o.value === s.lang)) {
            langSel.value = s.lang;
            state.supertonicLang = s.lang;
          }
        }
        savePrefs();
      },
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
      el('span', { class: 'muted' }, '(local Coqui + Supertonic honor it; many upstream TTS providers do too)')),
    el('div', { class: 'inline', style: { gap: '10px' } }, speedSlider, speedVal, speedResetBtn),
    speedHint,
  );
  // show/hide based on current model: coqui local honors speed always; for
  // upstream TTS we still show the control because many providers honor it too.
  function updateSpeedVisibility() {
    speedField.style.display = '';
  }
  updateSpeedVisibility();

  // ---- Supertonic language picker (only visible for supertonic/* models) -
  const langSel = el('select', {
    id: 'tts-supertonic-lang',
    onchange: (e) => { state.supertonicLang = e.target.value; savePrefs(); },
  });
  const langField = el('div', { class: 'field mt-md', style: { display: 'none' } },
    el('label', { for: 'tts-supertonic-lang' }, 'Language ',
      el('span', { class: 'muted' }, '(Supertonic — 31 supported)')),
    langSel,
    el('div', { class: 'hint' },
      'Same voice can speak any of the 31 supported languages. ',
      'Default follows your browser locale.',
    ),
  );

  let _supertonicLangsLoaded = false;
  // The Supertonic language list is small (31 entries) and never changes per
  // session. Fetch once on panel mount so the dropdown is ready before the
  // first click on Speak. updateLangVisibility just shows/hides.
  async function ensureSupertonicLanguages() {
    if (_supertonicLangsLoaded) return;
    try {
      const r = await apiGet('/api/idn-tts/supertonic/languages');
      const langs = (r.languages || []);
      langSel.innerHTML = '';
      // Pick a sensible default: persisted pref → browser locale prefix → 'en'
      const browserLang = (navigator.language || 'en').slice(0, 2).toLowerCase();
      const stickyDefault = state.supertonicLang
        || (langs.some(l => l.code === browserLang) ? browserLang : 'en');
      for (const l of langs) {
        const o = document.createElement('option');
        o.value = l.code;
        o.textContent = `${l.code} — ${l.label}`;
        if (l.code === stickyDefault) o.selected = true;
        langSel.appendChild(o);
      }
      state.supertonicLang = stickyDefault;
      savePrefs();
      _supertonicLangsLoaded = true;
    } catch (e) {
      // service down or SDK missing — show one fallback option
      langSel.innerHTML = '<option value="en">en — English</option>';
      state.supertonicLang = 'en';
      _supertonicLangsLoaded = true;  // don't keep retrying on every change
    }
  }
  // Eager prefetch — prevents the "empty <select>, click Speak fast" race.
  ensureSupertonicLanguages();

  function updateLangVisibility() {
    const isSuper = (state.model || '').startsWith('supertonic/');
    langField.style.display = isSuper ? '' : 'none';
    if (isSuper) ensureSupertonicLanguages();
  }
  // Refresh visibility when the model dropdown changes
  modelSel.addEventListener('change', updateLangVisibility);
  modelSel.addEventListener('change', updateSupertonicCaption);

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
        supertonicCaption,
      ),
    ),
    el('div', { class: 'field mt-md' },
      el('label', {}, 'Text ', el('span', { class: 'req' }, '*')),
      textTA,
      sampleRow,
    ),
    speedField,
    langField,
    el('div', { class: 'btn-row mt-md' }, goBtn, status),
  ));

  root.append(el('h3', { class: 'mt-lg' }, 'Recent speech'));
  const list = el('div', { class: 'result-list mt-sm' });
  root.append(list);

  renderCoquiHint();
  updateLangVisibility();
  updateSupertonicCaption();
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
      // Supertonic also wants a language (31 supported); default 'en'.
      // Wait for the language dropdown to populate so we don't accidentally
      // ship 'en' when the user actually picked another locale via select.
      if ((state.model || '').startsWith('supertonic/')) {
        await ensureSupertonicLanguages();
        payload.language = state.supertonicLang || 'en';
      }
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

function renderSupertonicCard(info, onRequestLoad) {
  if (!info) return null;
  if (!info.enabled) {
    // SDK not installed in idn-tts env. Surface only if it could be helpful.
    return null;  // hide silently — not all users want this
  }
  const voices = info.voices || [];
  const loaded = !!info.loaded;
  const loading = !!info.loading;
  const error = info.error;

  const card = el('div', { class: 'audio-waveform-card mt-sm' },
    el('div', { class: 'inline', style: { alignItems: 'center', gap: '14px' } },
      el('div', { class: 'voice-icon', title: 'supertonic' }, 'ST'),
      el('div', { style: { flex: 1 } },
        el('div', { class: 'inline', style: { gap: '8px' } },
          el('span', { class: 'indicator-dot ' + (error ? 'bad' : (loaded ? 'good' : (loading ? 'warn' : ''))) }),
          el('strong', { style: { color: 'var(--ink)' } },
            error ? 'Supertonic failed to load'
                  : (loaded ? 'Supertonic ready'
                            : (loading ? 'Supertonic loading…'
                                       : 'Supertonic available'))),
          el('span', { class: 'badge-uppercase accent' }, 'on-device · 31 langs'),
        ),
        el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
          loaded
            ? `${voices.length} voices · ${info.device || 'cpu'} · 24 kHz · audio stays on this machine`
            : '260 MB on first use · downloads from HuggingFace · audio stays on this machine',
        ),
        error ? el('div', { class: 'mono mt-xs', style: { fontSize: '11px', color: 'var(--bad)' } },
          String(error).slice(0, 240)) : null,
      ),
      (!loaded && !loading && !error) ? el('button', {
        class: 'btn btn-small',
        onclick: () => onRequestLoad && onRequestLoad(),
      }, 'load now') : null,
    ),
  );
  return card;
}

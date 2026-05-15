// i18n.js — bilingual locale store for the WY NineXore dashboard.
//
// Design (mirrors theme.js):
//  • Two locales: 'id' (Bahasa Indonesia, default) and 'en' (English).
//  • Preference persists in localStorage key 'wy-nine-locale'.
//  • URL ?lang=id|en wins once, then persists (handy for screenshots).
//  • Listeners get called on every change — components subscribe to
//    re-render their own visible strings.
//
// Translation table is kept inline so this module ships with no extra
// fetch. Keys follow a flat dotted convention:
//   nav.chat, nav.image, ttsPanel.title, ttsPanel.refresh, etc.
//
// New strings: add ID + EN side-by-side. Missing keys fall back to the
// other locale, and finally to the literal key, so a typo never blanks
// the UI.

const KEY = 'wy-nine-locale';
const LOCALES = ['id', 'en'];
const listeners = new Set();

const TRANSLATIONS = {
  // ---- App chrome -------------------------------------------------
  'app.title':            { id: 'WY NineXore',                       en: 'WY NineXore' },
  'app.skipToContent':    { id: 'Lompat ke konten',                  en: 'Skip to content' },
  'app.locale.tooltip':   { id: 'Ubah bahasa antarmuka (ID / EN)',   en: 'Switch interface language (ID / EN)' },
  'app.theme.tooltip':    { id: 'Ubah tema (gelap / terang / sistem)', en: 'Cycle theme (dark / light / system)' },

  // ---- Sidebar / nav ----------------------------------------------
  'nav.section.home':     { id: 'Beranda',     en: 'Home' },
  'nav.section.make':     { id: 'Buat',        en: 'Make' },
  'nav.section.know':     { id: 'Pengetahuan', en: 'Know' },
  'nav.section.tools':    { id: 'Alat',        en: 'Tools' },
  'nav.home':             { id: 'Beranda',     en: 'Home' },
  'nav.chat':             { id: 'Chat',        en: 'Chat' },
  'nav.image':            { id: 'Gambar',      en: 'Image' },
  'nav.tts':              { id: 'Bicara',      en: 'Speak' },
  'nav.stt':              { id: 'Transkripsi', en: 'Transcribe' },
  'nav.vision':           { id: 'Visi',        en: 'Vision' },
  'nav.embed':            { id: 'Embedding',   en: 'Embeddings' },
  'nav.search':           { id: 'Cari',        en: 'Search' },
  'nav.fetch':            { id: 'Baca URL',    en: 'Read' },
  'nav.video':            { id: 'Video',       en: 'Video' },
  'nav.models':           { id: 'Model',       en: 'Models' },
  'nav.history':          { id: 'Riwayat',     en: 'History' },
  'nav.settings':         { id: 'Pengaturan',  en: 'Settings' },
  'nav.help':             { id: 'Panduan',     en: 'Help' },

  // ---- Common buttons ---------------------------------------------
  'btn.refresh':          { id: 'Muat ulang',  en: 'Refresh' },
  'btn.refreshVoices':    { id: '↻ muat ulang voices', en: '↻ refresh voices' },
  'btn.send':             { id: 'Kirim',       en: 'Send' },
  'btn.cancel':           { id: 'Batal',       en: 'Cancel' },
  'btn.close':            { id: 'Tutup',       en: 'Close' },
  'btn.save':             { id: 'Simpan',      en: 'Save' },
  'btn.copy':             { id: 'Salin',       en: 'Copy' },
  'btn.download':         { id: 'Unduh',       en: 'Download' },

  // ---- TTS panel --------------------------------------------------
  'tts.title':            { id: 'Bicara — teks → suara',                 en: 'Speak — text → speech' },
  'tts.subtitle':         { id: 'Pilih voice, ketik kalimat. Output disimpan otomatis.',
                            en: 'Pick a voice, type what to say. Output is saved.' },
  'tts.voice.label':      { id: 'Voice',          en: 'Voice' },
  'tts.voice.filter':     { id: 'filter voice berdasarkan bahasa (mis. en, id, vi)',
                            en: 'filter voices by language (e.g. en, id, vi)' },
  'tts.voice.hint':       { id: 'Voice diambil dari /v1/audio/voices per provider.',
                            en: 'Voices come from /v1/audio/voices per provider.' },
  'tts.text.placeholder': { id: 'Tulis teks yang ingin dibacakan…',
                            en: 'Write the text to speak…' },
  'tts.speed.label':      { id: 'Kecepatan',      en: 'Speed' },
  'tts.speak':            { id: 'Bicara',         en: 'Speak' },
  'tts.lang.label':       { id: 'Bahasa Supertonic', en: 'Supertonic language' },
  'tts.supertonic.title':       { id: 'Supertonic — TTS on-device',  en: 'Supertonic — on-device TTS' },
  'tts.supertonic.notInstalled':{ id: 'Tidak terpasang',             en: 'Not installed' },
  'tts.supertonic.notLoaded':   { id: 'Belum dimuat',                en: 'Not loaded' },
  'tts.supertonic.loading':     { id: 'Memuat…',                     en: 'Loading…' },
  'tts.supertonic.ready':       { id: 'Siap',                        en: 'Ready' },
  'tts.supertonic.load':        { id: 'Muat sekarang',               en: 'Load now' },
  'tts.voice.gender.male':      { id: 'pria',                        en: 'male' },
  'tts.voice.gender.female':    { id: 'wanita',                      en: 'female' },
  'tts.voice.gender.custom':    { id: 'kustom',                      en: 'custom' },
  'tts.voice.useCases':         { id: 'Cocok untuk',                 en: 'Best for' },

  // ---- Help panel -------------------------------------------------
  'help.title':           { id: 'Panduan & manual pengguna',
                            en: 'Help & user manual' },
  'help.subtitle':        { id: 'Panduan pemakaian setiap panel. Scroll, atau klik salah satu item di daftar isi.',
                            en: 'Usage guide for every panel. Scroll, or click an item in the table of contents.' },
  'help.toc':             { id: 'Di halaman ini',  en: 'On this page' },
  'help.readmeLink':      { id: 'README lengkap di GitHub ↗',
                            en: 'Full README on GitHub ↗' },
  'help.toc.overview':         { id: 'Tinjauan — apa itu NineXore AI?',     en: 'Overview — what is NineXore AI?' },
  'help.toc.architecture':     { id: 'Arsitektur — 2 proses lokal + 9Router', en: 'Architecture — 2 local processes + 9Router' },
  'help.toc.chat':             { id: 'Panel Chat',                              en: 'Chat panel' },
  'help.toc.image':            { id: 'Panel Gambar',                            en: 'Image panel' },
  'help.toc.tts':              { id: 'Panel Bicara / TTS',                      en: 'Speak / TTS panel' },
  'help.toc.supertonicVoices': { id: 'Panduan voice Supertonic (M1…F5)',     en: 'Supertonic voice guide (M1…F5)' },
  'help.toc.stt':              { id: 'Panel Transkripsi / STT',                 en: 'Transcribe / STT panel' },
  'help.toc.vision':           { id: 'Panel Visi / OCR',                        en: 'Vision / OCR panel' },
  'help.toc.embed':            { id: 'Panel Embedding',                         en: 'Embeddings panel' },
  'help.toc.search':           { id: 'Panel Cari',                              en: 'Search panel' },
  'help.toc.fetch':            { id: 'Panel Baca URL',                          en: 'Read URL panel' },
  'help.toc.models':           { id: 'Penjelajah Model',                        en: 'Models explorer' },
  'help.toc.history':          { id: 'Panel Riwayat',                           en: 'History panel' },
  'help.toc.settings':         { id: 'Panel Pengaturan',                        en: 'Settings panel' },
  'help.toc.shortcuts':        { id: 'Pintasan keyboard',                       en: 'Keyboard shortcuts' },
  'help.toc.faq':              { id: 'FAQ & troubleshooting',                   en: 'FAQ & troubleshooting' },
  'help.toc.links':            { id: 'Referensi eksternal',                     en: 'External references' },

  // ---- Video Studio panel ----------------------------------------
  'video.title':              { id: 'Video Studio — dari ide ke video pendek',
                                en: 'Video Studio — idea to short video' },
  'video.subtitle':           { id: 'Masukkan topik. AI menulis naskah, membuat ilustrasi, narasi, dan menggabungkannya jadi video pendek.',
                                en: 'Type a topic. AI writes the script, generates illustrations, narrates each scene, and stitches them into a short video.' },
  'video.field.topic':        { id: 'Topik',                                  en: 'Topic' },
  'video.field.topic.placeholder': { id: 'mis. Tutorial singkat memulai NineXore AI', en: 'e.g. A quick tour of NineXore AI' },
  'video.field.scenes':       { id: 'Jumlah scene',                           en: 'Scene count' },
  'video.field.aspect':       { id: 'Rasio aspek',                            en: 'Aspect ratio' },
  'video.field.chatModel':    { id: 'Model penulis naskah (LLM)',             en: 'Script writer (LLM)' },
  'video.field.imageModel':   { id: 'Model pembuat gambar',                   en: 'Image model' },
  'video.field.ttsModel':     { id: 'Model TTS',                              en: 'TTS model' },
  'video.field.language':     { id: 'Bahasa narasi',                          en: 'Narration language' },
  'video.field.stylePrefix':  { id: 'Prefix gaya gambar (opsional, EN)',      en: 'Image style prefix (optional, EN)' },
  'video.field.stylePrefix.placeholder': {
                                id: 'mis. cinematic lighting, photorealistic, 8k',
                                en: 'e.g. cinematic lighting, photorealistic, 8k' },
  'video.start':              { id: 'Buat video',                             en: 'Generate video' },
  'video.cancel':             { id: 'Berhenti polling',                      en: 'Stop polling' },
  'video.aspect.1to1':        { id: '1:1 (kotak)',                            en: '1:1 (square)' },
  'video.aspect.9to16':       { id: '9:16 (vertikal)',                        en: '9:16 (vertical)' },
  'video.aspect.16to9':       { id: '16:9 (horizontal)',                      en: '16:9 (horizontal)' },
  'video.aspect.4to5':        { id: '4:5 (portrait)',                         en: '4:5 (portrait)' },
  'video.aspect.5to4':        { id: '5:4 (landscape)',                        en: '5:4 (landscape)' },
  'video.state.pending':           { id: 'Menunggu antrian…',          en: 'Queued…' },
  'video.state.writing_script':    { id: 'Menulis naskah…',            en: 'Writing script…' },
  'video.state.generating_images': { id: 'Membuat gambar…',            en: 'Generating images…' },
  'video.state.synthesizing_voices': { id: 'Membuat narasi suara…',    en: 'Synthesizing voice…' },
  'video.state.composing_video':   { id: 'Menyusun video akhir…',      en: 'Composing video…' },
  'video.state.done':              { id: 'Selesai',                       en: 'Done' },
  'video.state.failed':            { id: 'Gagal',                         en: 'Failed' },
  'video.state.cancelled':         { id: 'Dibatalkan',                    en: 'Cancelled' },
  'video.error.ffmpegMissing': { id: 'ffmpeg tidak terpasang. Install dulu: sudo apt install ffmpeg.',
                                en: 'ffmpeg is not installed. Install with: sudo apt install ffmpeg.' },
  'video.error.title':         { id: 'Pembuatan video gagal',                  en: 'Video generation failed' },
  'video.scenes.title':        { id: 'Scene & status',                          en: 'Scenes & status' },
  'video.result.title':        { id: 'Hasil',                                  en: 'Result' },
  'video.recent':              { id: 'Job terbaru',                            en: 'Recent jobs' },
  'video.recent.empty':        { id: 'Belum ada video yang dibuat.',           en: 'No videos yet.' },
  'video.note.timing':         { id: 'Estimasi: 1–3 menit per scene tergantung model gambar.',
                                en: 'Heads-up: 1–3 minutes per scene depending on the image model.' },
};

function urlLocale() {
  try {
    const p = new URLSearchParams(window.location.search);
    const q = p.get('lang');
    if (q && LOCALES.includes(q)) {
      try { localStorage.setItem(KEY, q); } catch (_) {}
      return q;
    }
  } catch (_) {}
  return null;
}

function storedLocale() {
  try {
    const v = localStorage.getItem(KEY);
    if (LOCALES.includes(v)) return v;
  } catch (_) {}
  return null;
}

function browserDefault() {
  // Prefer Indonesian when the browser is set to Indonesian, otherwise
  // default to id (the dashboard's primary audience).
  try {
    const langs = (navigator.languages || [navigator.language || 'id']).map(s => String(s).toLowerCase());
    if (langs.some(l => l.startsWith('id'))) return 'id';
    if (langs.some(l => l.startsWith('en'))) return 'en';
  } catch (_) {}
  return 'id';
}

let _locale = urlLocale() || storedLocale() || browserDefault();
document.documentElement.setAttribute('lang', _locale);

export function getLocale() {
  return _locale;
}

export function setLocale(loc) {
  if (!LOCALES.includes(loc)) loc = 'id';
  _locale = loc;
  try { localStorage.setItem(KEY, loc); } catch (_) {}
  document.documentElement.setAttribute('lang', loc);
  for (const fn of listeners) {
    try { fn(loc); } catch (_) {}
  }
}

export function toggleLocale() {
  setLocale(_locale === 'id' ? 'en' : 'id');
  return _locale;
}

export function onLocaleChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Translate a key. Falls back to the other locale, then the literal key,
 * so a typo never blanks the UI.
 *
 * Optional ``vars`` object substitutes ``{name}`` placeholders.
 */
export function t(key, vars) {
  const row = TRANSLATIONS[key];
  let s;
  if (row) {
    s = row[_locale] ?? row[_locale === 'id' ? 'en' : 'id'] ?? key;
  } else {
    s = key;
  }
  if (vars && typeof s === 'string') {
    s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
  }
  return s;
}

/**
 * Pick the locale-specific value out of an object that has both ``en`` and
 * ``id`` keys (the shape backend returns for voice descriptions /
 * language labels). Falls back gracefully.
 */
export function pickLocale(obj, fallback = '') {
  if (!obj || typeof obj !== 'object') return obj || fallback;
  if (obj[_locale] != null) return obj[_locale];
  if (obj.en != null) return obj.en;
  if (obj.id != null) return obj.id;
  return fallback;
}

export const LOCALES_LIST = LOCALES.slice();

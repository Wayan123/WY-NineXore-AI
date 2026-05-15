// Help panel — in-app user manual. Bilingual via the i18n module: page
// head, TOC, and section headings translate when the user toggles ID/EN
// in the sidebar. The Supertonic voice guide pulls bilingual descriptions
// straight from /api/idn-tts/supertonic/voices and renders them in the
// active locale.
import { el } from '../ui.js';
import { apiGet } from '../api.js';
import { t, getLocale, pickLocale } from '../i18n.js';

// Toc + section titles are derived from i18n keys so they stay in sync
// with the locale toggle. Body text inside each section deliberately
// stays mixed (Bahasa labels next to English explanations) since most
// of it is technical reference — a full sentence-level translation
// would balloon this file beyond its weight class. The sections that
// matter most for new users (overview, tts, supertonic-voices) are
// fully bilingual.
const TOC = [
  { id: 'overview',         key: 'help.toc.overview' },
  { id: 'architecture',     key: 'help.toc.architecture' },
  { id: 'chat',             key: 'help.toc.chat' },
  { id: 'image',            key: 'help.toc.image' },
  { id: 'tts',              key: 'help.toc.tts' },
  { id: 'supertonic-voices', key: 'help.toc.supertonicVoices' },
  { id: 'stt',              key: 'help.toc.stt' },
  { id: 'vision',           key: 'help.toc.vision' },
  { id: 'embed',            key: 'help.toc.embed' },
  { id: 'search',           key: 'help.toc.search' },
  { id: 'fetch',            key: 'help.toc.fetch' },
  { id: 'models',           key: 'help.toc.models' },
  { id: 'history',          key: 'help.toc.history' },
  { id: 'settings',         key: 'help.toc.settings' },
  { id: 'shortcuts',        key: 'help.toc.shortcuts' },
  { id: 'faq',              key: 'help.toc.faq' },
  { id: 'links',            key: 'help.toc.links' },
];

export async function mount(root) {
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, t('help.title')),
      el('p', { class: 'sub' }, t('help.subtitle')),
    ),
    el('div', { class: 'inline' },
      el('a', {
        class: 'btn btn-ghost btn-small',
        href: 'https://github.com/Wayan123/WY-NineXore-AI#readme',
        target: '_blank', rel: 'noopener',
      }, t('help.readmeLink')),
    ),
  ));

  // two-column layout: sticky TOC + content
  const layout = el('div', { style: { display: 'grid', gridTemplateColumns: '220px 1fr', gap: '24px', alignItems: 'start' } });
  root.append(layout);

  // TOC
  const toc = el('aside', {
    style: {
      position: 'sticky', top: '20px',
      background: 'var(--surface-1)',
      border: '1px solid var(--hairline)',
      borderRadius: 'var(--r-lg)',
      padding: '12px 14px',
      fontSize: '13px',
    },
  });
  toc.append(el('div', {
    style: {
      fontSize: '11px', fontWeight: 600, letterSpacing: '1.1px',
      textTransform: 'uppercase', color: 'var(--ink-tertiary)', marginBottom: '8px',
    },
  }, t('help.toc')));
  for (const item of TOC) {
    toc.append(el('a', {
      href: '#/help#' + item.id,
      style: {
        display: 'block', padding: '4px 0',
        color: 'var(--ink-subtle)',
        borderBottom: 'none',
        textDecoration: 'none',
      },
      onmouseover: (e) => e.target.style.color = 'var(--ink)',
      onmouseout:  (e) => e.target.style.color = 'var(--ink-subtle)',
      onclick: (e) => {
        e.preventDefault();
        const target = document.getElementById('help-' + item.id);
        if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, t(item.key)));
  }
  layout.append(toc);

  // content
  const content = el('div', { class: 'col', style: { gap: '24px', minWidth: 0 } });
  layout.append(content);

  for (const fn of [
    overview, architecture, chatHelp, imageHelp, ttsHelp, supertonicVoicesHelp, sttHelp, visionHelp,
    embedHelp, searchHelp, fetchHelp, modelsHelp, historyHelp, settingsHelp,
    shortcutsHelp, faqHelp, linksHelp,
  ]) {
    content.append(fn());
  }
}

// Hydrate the supertonic voices section after mount so we can fetch the
// bilingual catalogue without blocking the initial render. Called lazily.
async function hydrateSupertonicVoices() {
  const host = document.getElementById('help-supertonic-voices-body');
  if (!host) return;
  let info = null;
  try {
    info = await apiGet('/api/idn-tts/supertonic/voices');
  } catch (_) {}
  const voices = (info && Array.isArray(info.voices) && info.voices.length)
    ? info.voices
    : null;
  // Empty / unreachable — keep the fallback message that's already in the DOM.
  if (!voices) return;
  host.innerHTML = '';

  // Group: male first, then female, then anything else.
  const ordered = voices.slice().sort((a, b) => {
    const order = { male: 0, female: 1, custom: 2 };
    const ga = order[a.gender] ?? 3;
    const gb = order[b.gender] ?? 3;
    if (ga !== gb) return ga - gb;
    return String(a.name).localeCompare(String(b.name));
  });

  for (const v of ordered) {
    const desc = pickLocale(v.description);
    const useCases = pickLocale(v.use_cases);
    const genderKey = 'tts.voice.gender.' + (v.gender || 'custom');
    host.append(el('div', {
      style: {
        display: 'grid',
        gridTemplateColumns: '60px 1fr',
        gap: '12px',
        padding: '10px 0',
        borderTop: '1px dashed var(--hairline)',
      },
    },
      el('div', { style: { display: 'flex', alignItems: 'flex-start' } },
        el('div', { class: 'voice-icon', style: { fontSize: '15px' } }, v.name),
      ),
      el('div', {},
        el('div', { class: 'inline', style: { gap: '6px', alignItems: 'center', marginBottom: '4px' } },
          el('strong', {}, v.name),
          el('span', { class: 'badge-uppercase accent' }, t(genderKey)),
        ),
        el('div', { style: { color: 'var(--ink-muted)', fontSize: '13px' } }, desc),
        useCases ? el('div', { class: 'muted', style: { fontSize: '12px', marginTop: '4px' } },
          el('strong', {}, t('tts.voice.useCases') + ': '), useCases) : null,
      ),
    ));
  }
}

// Schedule the hydration after the synchronous mount completes.
if (typeof window !== 'undefined') {
  Promise.resolve().then(() => {
    setTimeout(hydrateSupertonicVoices, 0);
  });
}

// ---------- section builders ------------------------------------------

function section(id, title, ...children) {
  return el('section', { id: 'help-' + id, class: 'card', style: { scrollMarginTop: '20px' } },
    el('h3', { style: { marginBottom: '10px' } }, title),
    ...children,
  );
}

function p(...c) { return el('p', {}, ...c); }
function code(t) { return el('code', {}, t); }
function b(t) { return el('strong', {}, t); }
function ul(...items) {
  return el('ul', { style: { paddingLeft: '1.4em', margin: '6px 0' } },
    ...items.map(it => el('li', {}, it)));
}
function callout(kind, strong, ...rest) {
  return el('div', { class: 'callout ' + (kind || '') },
    el('strong', {}, strong), ' ', ...rest);
}

// ---------- content --------------------------------------------------

function overview() {
  return section('overview', 'Overview',
    p(b('WY NineXore AI'), ' adalah konsol pengembang lokal untuk gateway ',
      el('a', { href: 'https://github.com/decolua/9router', target: '_blank', rel: 'noopener' }, '9Router'),
      '. Semua panel di sini \u2014 chat, image, speak, transcribe, vision, embeddings, search, fetch \u2014 memanggil provider melalui satu instance 9Router yang Anda jalankan sendiri.'),
    p('Repository ini tidak pernah menyimpan API key provider. Satu-satunya rahasia yang dipakai adalah ',
      code('NINEROUTER_KEY'), ' yang tersimpan di file ', code('.env'), ' lokal (di-ignore oleh git).'),
    p('Satu service CUDA opsional di folder ', code('idn-tts/'), ' menambah suara Bahasa Indonesia (Coqui VITS, 83 suara) dan transkripsi offline (Whisper large-v3). Normalnya dijalankan otomatis oleh ', code('./run.sh'), ' di dalam conda env ', code('torch-gpu'), ' yang sama dengan dashboard — tidak perlu perintah terpisah. Audio di jalur ini tidak pernah meninggalkan mesin Anda.'),
  );
}

function architecture() {
  return section('architecture', 'Architecture',
    p('Dua proses lokal + 9Router eksternal. Kedua proses lokal jalan di ', b('satu conda env yang sama'), ' (', code('torch-gpu'), ') dan dinyalakan oleh ', b('satu ./run.sh'), ':'),
    ul(
      el('span', {}, b('Dashboard backend'), ' (port 8765) \u2014 FastAPI tipis yang proxy ke 9Router dan menyimpan history di SQLite.'),
      el('span', {}, b('Local ML service'), ' (port 21128) \u2014 Coqui VITS (boot-load) + Whisper (lazy-load saat request pertama).'),
      el('span', {}, b('9Router gateway'), ' (port 20128, Anda jalankan terpisah) \u2014 menyimpan kredensial provider (OpenAI Plus via Codex, NVIDIA NIM, DeepSeek, Anthropic, Tavily, Firecrawl, dll).'),
    ),
    p('Dashboard memutuskan route hanya berdasarkan prefix ID model:'),
    ul(
      el('span', {}, code('coqui/*'), ' \u2192 local ML service (TTS Bahasa)'),
      el('span', {}, code('local/whisper-*'), ' \u2192 local ML service (STT offline)'),
      el('span', {}, 'prefix lain \u2192 9Router'),
    ),
    p(b('Ctrl-C'), ' di jendela ', code('./run.sh'), ' mematikan kedua layanan lewat EXIT trap.'),
  );
}

function chatHelp() {
  return section('chat', 'Chat',
    p('Chat multi-session dengan streaming. Setiap session disimpan di ',
      code('data/history.db'), '.'),
    ul(
      el('span', {}, 'Tombol ', code('+ New chat'), ' di rail kiri \u2014 buat session baru.'),
      el('span', {}, 'Dropdown model di header \u2014 ganti model kapan saja (default ', code('ds/deepseek-chat'), ').'),
      el('span', {}, 'Tombol ', code('system'), ' \u2014 set instruksi sistem per-session (modal dengan textarea).'),
      el('span', {}, 'Tombol ', code('T=0.7'), ' \u2014 atur temperature + max tokens.'),
      el('span', {}, 'Toggle ', code('stream'), ' \u2014 aktifkan SSE streaming (default on).'),
      el('span', {}, el('kbd', {}, 'Enter'), ' kirim, ', el('kbd', {}, 'Shift+Enter'), ' baris baru, ', el('kbd', {}, 'Esc'), ' tutup modal.'),
    ),
    p(b('Model rekomendasi'), ': ', code('kr/claude-haiku-4.5'), ' untuk jawaban cepat, ',
      code('cx/gpt-5.4'), ' untuk reasoning + vision, ', code('ds/deepseek-chat'), ' untuk long context.'),
  );
}

function imageHelp() {
  return section('image', 'Image — text → image',
    p('Generate gambar lewat model ', code('cx/*-image'), ' (Codex / ChatGPT Plus). Panel ini memerlukan langganan Plus/Pro aktif di 9Router.'),
    ul(
      el('span', {}, 'Pilih model (default ', code('cx/gpt-5.4-image'), ').'),
      el('span', {}, 'Tulis prompt dalam bahasa apa saja. Panjang prompt mempengaruhi kualitas.'),
      el('span', {}, 'Size default ', code('1024x1024'), '. Quality ', code('hd'), ' untuk hasil tajam.'),
      el('span', {}, 'Hasil disimpan ke ', code('data/outputs/*.png'), ' dan muncul di gallery di bawah.'),
    ),
    callout('warn', 'Error "Codex did not return an image. Plus/Pro required"',
      'Session Codex Anda di 9Router tidak aktif. Masuk ulang via wizard Codex di 9Router, atau tambahkan provider image lain (FLUX, Gemini, Stability).'),
  );
}

function ttsHelp() {
  return section('tts', 'Speak — text → speech',
    p('Tiga kelompok suara:'),
    ul(
      el('span', {}, b('Supertonic (on-device, 31 bahasa)'), ' \u2014 ',
        code('supertonic/M1'), '\u2026', code('M5'), ' (suara pria), ',
        code('supertonic/F1'), '\u2026', code('F5'), ' (suara wanita). ',
        'Mendukung 31 bahasa termasuk ', code('id'), ', ', code('en'), ', ',
        code('ja'), ', ', code('ko'), ', ', code('vi'), ', ', code('fr'),
        ', ', code('de'), ', ', code('es'), ', ', code('ar'),
        '. Saat varian ini dipilih, picker bahasa muncul di bawah slider kecepatan. ',
        'Bundle 260 MB di-download otomatis dari HuggingFace pada synthesis pertama; ',
        'audio tidak pernah meninggalkan mesin.'),
      el('span', {}, b('Coqui Indonesian'), ' \u2014 ', code('coqui/wibowo'),
        ', ', code('coqui/ardi'), ', ', code('coqui/gadis'), ' + 80 suara regional (Jawa, Sunda). Berjalan lokal di service ',
        code('idn-tts'), '. Hanya Bahasa Indonesia.'),
      el('span', {}, b('Upstream'), ' \u2014 NVIDIA NIM (', code('nvidia/fastpitch'), '), atau yang lain (Edge-TTS, ElevenLabs, OpenAI, dsb) bila sudah diset di 9Router.'),
    ),
    p(b('Slider kecepatan bicara'), ' (Coqui + Supertonic): ',
      code('0.5\u00d7'), ' sangat cepat, ',
      code('1.00\u00d7'), ' native (sedikit terburu-buru), ',
      code('1.20\u00d7'), ' natural (default), ',
      code('2.5\u00d7'), ' sangat lambat. ',
      'Slider juga di-forward ke upstream TTS \u2014 provider yang mendukung (OpenAI, Edge) akan menghormatinya, lainnya mengabaikan.'),
    p('Contoh phrase tersedia via tombol ',
      code('id'), ' / ', code('en'), ' / ', code('ja'), ' / ', code('ko'),
      ' / ', code('fr'), ' / ', code('vi'), ' di bawah textarea. ',
      'Kalau Supertonic dipilih, klik tombol sample juga otomatis menyetel picker bahasa.'),
    callout('', 'Pertama kali pakai Supertonic',
      'Synthesis pertama akan men-download bundle 260 MB dari HuggingFace dan blok permintaan ~30\u201390 detik. ',
      'Klik tombol ', code('load now'), ' di kartu Supertonic untuk pre-warm di background sebelum submit.'),
    callout('', 'Ingin suara Coqui tidak muncul?',
      'Normalnya ', code('./run.sh'), ' sudah menyalakan service ini otomatis. Kalau belum, cek log ', code('/tmp/wy-nine-idn-tts.log'), ' dan jalankan ulang ', code('./run.sh'), '. Setelah itu tekan ', code('\u21bb refresh voices'), ' di panel ini.'),
    p(b('Bingung dengan M1…M5 / F1…F5?'), ' Penjelasan lengkap setiap voice (gender, karakter, dan use-case) ada di section berikutnya: ',
      el('a', { href: '#/help#supertonic-voices', onclick: (e) => { e.preventDefault(); const node = document.getElementById('help-supertonic-voices'); if (node) node.scrollIntoView({ behavior: 'smooth' }); } }, 'Supertonic voice guide →')),
  );
}

function supertonicVoicesHelp() {
  return section('supertonic-voices', 'Supertonic voice guide — M1…M5, F1…F5',
    p(b('Konvensi penamaan'), ' — nama voice Supertonic mengikuti pola ',
      code('<gender><nomor>'), ': ', b('M'), ' = male / pria, ', b('F'), ' = female / wanita, ',
      'angka ', code('1'), '–', code('5'), ' adalah varian preset dengan karakter, nada, dan timbre yang berbeda. ',
      'Total ada 10 voice resmi yang dirilis bersama setiap rilis Supertonic 3.'),
    p(b('Naming convention'), ' — Supertonic voice names follow ',
      code('<gender><index>'), ': ', b('M'), ' for male, ', b('F'), ' for female, ',
      'and ', code('1'), '–', code('5'), ' selects one of five preset variants per gender, ',
      'each with a distinct timbre, energy, and use-case profile. Ten voices ship in every Supertonic 3 release.'),
    callout('',
      getLocale() === 'id' ? 'Sumber resmi' : 'Authoritative source',
      getLocale() === 'id'
        ? 'Deskripsi di bawah disalin (dan diterjemahkan) dari katalog voice resmi Supertonic: '
        : 'The descriptions below are taken (and translated) from the official Supertonic voice catalogue: ',
      el('a', { href: 'https://supertone-inc.github.io/supertonic-py/voices/', target: '_blank', rel: 'noopener' },
        'supertonic-py/voices'), '.',
    ),
    p(b(getLocale() === 'id' ? 'Tips memilih voice' : 'How to pick'), ' — ',
      getLocale() === 'id'
        ? 'mulai dari M1 / F1 untuk narasi serbaguna, lalu coba varian lain sesuai kebutuhan: M2/F1 untuk konten formal, M5/F5 untuk audiobook & relaksasi, F2 untuk konten ceria, F3 untuk berita & iklan.'
        : 'start with M1 / F1 for general-purpose narration, then move to other variants as needed: M2/F1 for formal content, M5/F5 for audiobooks & relaxation, F2 for upbeat content, F3 for broadcast / commercials.'),
    el('div', { id: 'help-supertonic-voices-body', style: { marginTop: '12px' } },
      el('div', { class: 'muted', style: { fontSize: '12px' } },
        getLocale() === 'id'
          ? 'Memuat katalog voice dari /api/idn-tts/supertonic/voices… (service idn-tts harus berjalan; cek di sidebar).'
          : 'Loading voice catalogue from /api/idn-tts/supertonic/voices… (idn-tts service must be running; check sidebar).'),
    ),
  );
}

function sttHelp() {
  return section('stt', 'Transcribe — audio → text',
    p('Tiga varian Whisper lokal tersedia. Pilih sesuai spek mesin:'),
    ul(
      el('span', {}, code('local/whisper-tiny'), ' \u2014 ~150 MB, jalan di CPU, akurasi paling rendah.'),
      el('span', {}, code('local/whisper-medium'), ' \u2014 ~1.5 GB, balance CPU/GPU, akurasi baik.'),
      el('span', {}, code('local/whisper-large-v3'), ' \u2014 ~2.9 GB, butuh GPU ~4 GB VRAM, akurasi terbaik (default).'),
    ),
    p('Kalau varian belum ter-cache, tekan tombol ', code('load'), ' di samping baris varian \u2014 ',
      'download di background, progress dipoll setiap 2 s. Anda juga bisa langsung submit audio: service auto-download + load pada request pertama.'),
    ul(
      el('span', {}, 'Drag audio file ke dropzone, atau klik ', code('record'), ' untuk rekam langsung dari browser.'),
      el('span', {}, 'Format yang didukung: MP3, WAV, M4A, WEBM, OGG, FLAC \u2014 cap 200 MB.'),
      el('span', {}, 'Isi ', code('language=id'), ' untuk Bahasa Indonesia (Whisper bisa auto-detect tapi hint meningkatkan akurasi).'),
      el('span', {}, 'Response format: ', code('json'), ' default, atau ', code('verbose_json'), ' / ', code('srt'), ' / ', code('vtt'), ' untuk subtitle.'),
    ),
    callout('warn', 'Request / load pertama per varian (~10\u201330 s)',
      'Model di-download dari HuggingFace + dimuat ke GPU/CPU. Berikutnya <1 s pada GPU mid-range. Ukuran disk: tiny ~150 MB, medium ~1.5 GB, large-v3 ~2.9 GB.'),
  );
}

function visionHelp() {
  return section('vision', 'Vision / OCR — image → text',
    p('Upload gambar, pilih model multimodal, ambil teks atau deskripsi. Semua model vision-capable dipilih dari allowlist yang sudah diverifikasi.'),
    ul(
      el('span', {}, b('Prompt chips'), ': ',
        code('OCR (id)'), ' untuk ekstraksi persis, ',
        code('OCR (en)'), ' untuk bahasa Inggris, ',
        code('describe'), ' untuk deskripsi, ',
        code('extract table'), ' untuk tabel (→ Markdown pipe), ',
        code('translate \u2192 id'), ' untuk menerjemahkan ke Bahasa.'),
      el('span', {}, 'Cap file: 12 MB (raw) \u2014 setelah base64 menjadi ~16 MB agar tetap di bawah limit JSON body upstream.'),
      el('span', {}, 'Model direkomendasikan: ', code('cx/gpt-5.4'), ' atau ', code('cx/gpt-5.5'),
        ' (terbukti baca Bahasa Indonesia dengan sempurna).'),
    ),
    callout('', 'Model Claude via kr/* tidak muncul di dropdown',
      'Proxy kr/ di instance ini membuang payload gambar diam-diam. Hanya model yang benar-benar multimodal via providernya langsung (cx/, anthropic/, gemini/, dsb) yang dimasukkan allowlist.'),
  );
}

function embedHelp() {
  return section('embed', 'Embeddings',
    p('Ubah kalimat menjadi vektor, lalu bandingkan dengan cosine similarity.'),
    ul(
      el('span', {}, 'Satu kalimat per baris di textarea. Tombol ', code('example'), ' mengisi contoh.'),
      el('span', {}, 'Default model: ', code('nvidia/nv-embedqa-e5-v5'), ' (1024 dimensi).'),
      el('span', {}, 'Output: ringkasan usage, matrix similarity berwarna (lavender = dekat), preview 8 dimensi per input.'),
      el('span', {}, 'Tombol ', code('copy vectors'), ' menyalin full JSON ke clipboard.'),
    ),
  );
}

function searchHelp() {
  return section('search', 'Search — cari di web',
    p('Pilih provider (Tavily, Exa, Brave, Serper, Perplexity, SearXNG, YouCom, \u2026 tergantung yang dikonfigurasi di 9Router).'),
    ul(
      el('span', {}, 'Tipe: ', code('web'), ' atau ', code('news'), '.'),
      el('span', {}, 'Filter opsional: country, language, jumlah hasil, time range, domain filter.'),
      el('span', {}, 'Beberapa provider mengembalikan ', code('answer'), ' (AI-synthesised) \u2014 ditampilkan di atas list hasil.'),
    ),
  );
}

function fetchHelp() {
  return section('fetch', 'Read URL — URL → markdown',
    p('Konversi halaman web jadi markdown/teks/HTML yang bersih via Firecrawl / Jina Reader / Tavily Extract / Exa Contents.'),
    ul(
      el('span', {}, 'Format: ', code('markdown'), ' (default), ', code('text'), ', atau ', code('html'), '.'),
      el('span', {}, 'Output HTML dirender di iframe sandbox supaya script remote tidak bisa menyentuh origin dashboard.'),
      el('span', {}, 'Cap karakter opsional untuk meminimalkan token upstream.'),
    ),
  );
}

function modelsHelp() {
  return section('models', 'Models explorer',
    p('Jelajahi semua model yang 9Router Anda ekspos, dikelompokkan per kind. Filter dengan nama partial (', code('deepseek'), ', ', code('coqui'), ', dll) atau tekan ', el('kbd', {}, 'g'), ' lalu ', el('kbd', {}, 'm'), '.'),
    p('Klik tombol ', code('info'), ' pada model untuk melihat metadata lengkap (context window, parameter, dsb).'),
  );
}

function historyHelp() {
  return section('history', 'History',
    p('Semua output yang pernah Anda generate, filter per kind. Klik bintang (', code('\u2606'),
      ') untuk favorite, atau hapus individual.'),
    p('Database di ', code('data/history.db'), ', file output di ', code('data/outputs/'), '. Keduanya di-gitignore.'),
  );
}

function settingsHelp() {
  return section('settings', 'Settings',
    p('View read-only dari config efektif + probe koneksi upstream + status local Whisper service.'),
    p('Ubah konfigurasi lewat file ', code('.env'), ' di root proyek, lalu restart ', code('./run.sh'), '.'),
  );
}

function shortcutsHelp() {
  const rows = [
    ['g h', 'Home'],
    ['g c', 'Chat'],
    ['g i', 'Image'],
    ['g t', 'Speak (TTS)'],
    ['g r', 'Transcribe (STT)'],
    ['g v', 'Vision / OCR'],
    ['g e', 'Embeddings'],
    ['g s', 'Search'],
    ['g f', 'Read URL'],
    ['g m', 'Models'],
    ['g y', 'History'],
    ['g ,', 'Settings'],
    ['Enter', 'Kirim (di chat)'],
    ['Shift+Enter', 'Baris baru (di chat)'],
    ['Esc', 'Tutup modal'],
  ];
  return section('shortcuts', 'Keyboard shortcuts',
    p('Aktif di mana saja selain ketika fokus di textarea/input.'),
    el('table', { class: 'table' },
      el('thead', {}, el('tr', {},
        el('th', {}, 'Keys'),
        el('th', {}, 'Action'),
      )),
      el('tbody', {},
        ...rows.map(([k, v]) => el('tr', {},
          el('td', {}, ...k.split(' ').map((key, i, arr) =>
            el('span', {}, el('kbd', {}, key), i < arr.length - 1 ? ' then ' : ''))),
          el('td', { class: 'muted' }, v),
        )),
      ),
    ),
  );
}

function faqHelp() {
  return section('faq', 'FAQ & troubleshooting',
    el('h4', { style: { marginTop: '8px' } }, 'Kenapa Coqui voices tidak muncul?'),
    p('Service ', code('idn-tts'), ' belum siap. Normalnya ', code('./run.sh'), ' sudah menyalakannya otomatis. Cek: (1) ',
      code('curl http://127.0.0.1:21128/health'), ' balas JSON. (2) ',
      code('IDN_TTS_ENABLED=true'), ' di ', code('.env'), '. (3) Kalau crash, lihat log ', code('/tmp/wy-nine-idn-tts.log'), '. (4) Tekan ',
      code('\u21bb refresh voices'), ' di panel Speak.'),

    el('h4', { style: { marginTop: '16px' } }, 'Request pertama Whisper sangat lambat'),
    p('Ini ekspektasi. Model 2.9 GB di-load lazy ke GPU saat request pertama (~10\u201315 s). Request berikutnya <1 s.'),

    el('h4', { style: { marginTop: '16px' } }, 'Image generation 500 / "Plus/Pro required"'),
    p('Codex provider di 9Router butuh session ChatGPT Plus/Pro aktif. Masuk ulang via wizard di 9Router. Atau pakai provider image lain (FLUX, Stability, Gemini).'),

    el('h4', { style: { marginTop: '16px' } }, 'Upstream offline di sidebar'),
    p('9Router Anda tidak tercapai. ',
      code('curl http://localhost:20128/api/health'), ' harus balas ',
      code('{"ok":true}'), '. Jika tidak, start 9Router-nya, atau ubah ',
      code('NINEROUTER_URL'), ' di ', code('.env'), '.'),

    el('h4', { style: { marginTop: '16px' } }, 'Request 401 di semua endpoint'),
    p('9Router di-set ', code('requireApiKey=true'), '. Copy key dari ',
      code('9Router Dashboard \u2192 Keys'), ' dan paste ke ',
      code('NINEROUTER_KEY='), ' di ', code('.env'), '. Restart ',
      code('./run.sh'), '.'),

    el('h4', { style: { marginTop: '16px' } }, 'Hard-reload browser setelah update'),
    p(el('kbd', {}, 'Ctrl+Shift+R'), ' (atau ', el('kbd', {}, 'Cmd+Shift+R'),
      ') \u2014 beberapa file di-cache browser sampai HTML/CSS berubah.'),
  );
}

function linksHelp() {
  const links = [
    ['Source repository', 'https://github.com/Wayan123/WY-NineXore-AI'],
    ['Full README', 'https://github.com/Wayan123/WY-NineXore-AI#readme'],
    ['Architecture docs', 'https://github.com/Wayan123/WY-NineXore-AI/blob/main/docs/ARCHITECTURE.md'],
    ['Setup guide', 'https://github.com/Wayan123/WY-NineXore-AI/blob/main/docs/SETUP.md'],
    ['Security posture', 'https://github.com/Wayan123/WY-NineXore-AI/blob/main/docs/SECURITY.md'],
    ['Design system', 'https://github.com/Wayan123/WY-NineXore-AI/blob/main/DESIGN.md'],
    ['9Router (upstream gateway)', 'https://github.com/decolua/9router'],
    ['Wikidepia/indonesian-tts (Coqui model)', 'https://github.com/Wikidepia/indonesian-tts'],
    ['openai/whisper-large-v3 (HuggingFace)', 'https://huggingface.co/openai/whisper-large-v3'],
  ];
  return section('links', 'External references',
    el('ul', { style: { paddingLeft: '1.4em', margin: '6px 0', lineHeight: 1.8 } },
      ...links.map(([text, href]) => el('li', {},
        el('a', { href, target: '_blank', rel: 'noopener' }, text))),
    ),
  );
}

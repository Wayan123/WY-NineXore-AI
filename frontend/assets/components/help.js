// Help panel — in-app user manual. Bilingual-friendly where it makes sense
// (Bahasa Indonesia labels next to English explanations) because the
// primary audience runs Coqui Indonesian TTS and local Whisper on this.
import { el } from '../ui.js';

const TOC = [
  { id: 'overview',     title: 'Overview — apa itu NineXore AI?' },
  { id: 'architecture', title: 'Architecture — 3 layanan lokal' },
  { id: 'chat',         title: 'Chat panel' },
  { id: 'image',        title: 'Image panel' },
  { id: 'tts',          title: 'Speak / TTS panel' },
  { id: 'stt',          title: 'Transcribe / STT panel' },
  { id: 'vision',       title: 'Vision / OCR panel' },
  { id: 'embed',        title: 'Embeddings panel' },
  { id: 'search',       title: 'Search panel' },
  { id: 'fetch',        title: 'Read URL panel' },
  { id: 'models',       title: 'Models explorer' },
  { id: 'history',      title: 'History panel' },
  { id: 'settings',     title: 'Settings panel' },
  { id: 'shortcuts',    title: 'Keyboard shortcuts' },
  { id: 'faq',          title: 'FAQ & troubleshooting' },
  { id: 'links',        title: 'External references' },
];

export async function mount(root) {
  root.innerHTML = '';

  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Help & user manual'),
      el('p', { class: 'sub' },
        'Panduan pemakaian setiap panel. Scroll, atau klik salah satu item di daftar isi.'),
    ),
    el('div', { class: 'inline' },
      el('a', {
        class: 'btn btn-ghost btn-small',
        href: 'https://github.com/Wayan123/WY-NineXore-AI#readme',
        target: '_blank', rel: 'noopener',
      }, 'Full README on GitHub ↗'),
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
  }, 'On this page'));
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
        const t = document.getElementById('help-' + item.id);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      },
    }, item.title));
  }
  layout.append(toc);

  // content
  const content = el('div', { class: 'col', style: { gap: '24px', minWidth: 0 } });
  layout.append(content);

  for (const fn of [
    overview, architecture, chatHelp, imageHelp, ttsHelp, sttHelp, visionHelp,
    embedHelp, searchHelp, fetchHelp, modelsHelp, historyHelp, settingsHelp,
    shortcutsHelp, faqHelp, linksHelp,
  ]) {
    content.append(fn());
  }
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
    p('Dua layanan CUDA opsional di folder ', code('idn-tts/'), ' menambah suara Bahasa Indonesia (Coqui VITS, 83 suara) dan transkripsi offline (Whisper large-v3). Audio di jalur ini tidak pernah meninggalkan mesin Anda.'),
  );
}

function architecture() {
  return section('architecture', 'Architecture',
    p('Tiga proses bekerja sama:'),
    ul(
      el('span', {}, b('Dashboard backend'), ' (conda ', code('info-ai'), ', port 8765) \u2014 FastAPI tipis yang proxy ke 9Router dan menyimpan history di SQLite.'),
      el('span', {}, b('Local ML service'), ' (conda ', code('torch-gpu'), ', port 21128) \u2014 Coqui VITS + Whisper yang lazy-load di CUDA.'),
      el('span', {}, b('9Router gateway'), ' (port 20128, Anda jalankan terpisah) \u2014 menyimpan kredensial provider (OpenAI Plus via Codex, NVIDIA NIM, DeepSeek, Anthropic, Tavily, Firecrawl, dll).'),
    ),
    p('Dashboard memutuskan route hanya berdasarkan prefix ID model:'),
    ul(
      el('span', {}, code('coqui/*'), ' \u2192 local ML service (TTS Bahasa)'),
      el('span', {}, code('local/whisper-*'), ' \u2192 local ML service (STT offline)'),
      el('span', {}, 'prefix lain \u2192 9Router'),
    ),
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
    p('Dua kelompok suara:'),
    ul(
      el('span', {}, b('Coqui Indonesian (recommended)'), ' \u2014 ', code('coqui/wibowo'),
        ', ', code('coqui/ardi'), ', ', code('coqui/gadis'), ' + 80 suara regional (Jawa, Sunda). Berjalan lokal di service ',
        code('idn-tts'), '.'),
      el('span', {}, b('Upstream'), ' \u2014 NVIDIA NIM (', code('nvidia/fastpitch'), '), atau yang lain (Edge-TTS, ElevenLabs, OpenAI, dsb) bila sudah diset di 9Router.'),
    ),
    p(b('Slider kecepatan bicara'), ' (Coqui): ',
      code('0.5\u00d7'), ' sangat cepat, ',
      code('1.00\u00d7'), ' native (sedikit terburu-buru), ',
      code('1.20\u00d7'), ' natural (default), ',
      code('2.5\u00d7'), ' sangat lambat. ',
      'Slider juga di-forward ke upstream TTS \u2014 provider yang mendukung (OpenAI, Edge) akan menghormatinya, lainnya mengabaikan.'),
    p('Contoh phrase tersedia via tombol ', code('sample \u00b7 id'), ' dan ', code('sample \u00b7 en'), ' di bawah textarea.'),
    callout('', 'Ingin suara Coqui tidak muncul?',
      'Pastikan service ', code('idn-tts'), ' berjalan (', code('cd idn-tts && ./run.sh'),
      '), lalu tekan ', code('\u21bb refresh voices'), ' di panel ini.'),
  );
}

function sttHelp() {
  return section('stt', 'Transcribe — audio → text',
    p('Default: ', code('local/whisper-large-v3'), ' (offline, GPU-accelerated, akurat untuk Bahasa Indonesia).'),
    ul(
      el('span', {}, 'Drag audio file ke dropzone, atau klik ', code('record'), ' untuk rekam langsung dari browser.'),
      el('span', {}, 'Format yang didukung: MP3, WAV, M4A, WEBM, OGG, FLAC \u2014 cap 200 MB.'),
      el('span', {}, 'Isi ', code('language=id'), ' untuk Bahasa Indonesia (Whisper bisa auto-detect tapi hint meningkatkan akurasi).'),
      el('span', {}, 'Response format: ', code('json'), ' default, atau ', code('verbose_json'), ' / ', code('srt'), ' / ', code('vtt'), ' untuk subtitle.'),
    ),
    callout('warn', 'Request pertama Whisper lambat (~10\u201315 s)',
      'Model 2.9 GB di-load saat request pertama \u2014 ini disengaja agar startup service tidak menunggu. Request berikutnya <1 s pada GPU mid-range.'),
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
    p('Service ', code('idn-tts'), ' belum jalan. Cek: (1) ',
      code('curl http://127.0.0.1:21128/health'), ' balas JSON. (2) ',
      code('IDN_TTS_ENABLED=true'), ' di ', code('.env'), '. (3) Tekan ',
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

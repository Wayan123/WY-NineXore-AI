// Home view — landing with status, quick actions, recent activity.
import { apiGet } from '../api.js';
import { getState } from '../store.js';
import { el, fmtDate, toastError } from '../ui.js';

const QUICK = [
  { to: 'chat',   t: 'Chat',         d: 'Ask, draft, debug code.',              svg: 'chat' },
  { to: 'image',  t: 'Image',        d: 'Text → image.',                         svg: 'image' },
  { to: 'tts',    t: 'Speak',        d: 'Text → speech (Bahasa + more).',        svg: 'wave' },
  { to: 'stt',    t: 'Transcribe',   d: 'Audio → text (local Whisper).',          svg: 'mic' },
  { to: 'vision', t: 'Vision / OCR', d: 'Image → text (multimodal chat).',       svg: 'eye' },
  { to: 'embed',  t: 'Embeddings',   d: 'Text → vectors, cosine similarity.',    svg: 'infinity' },
  { to: 'search', t: 'Search web',   d: 'One API, many search providers.',       svg: 'search' },
  { to: 'fetch',  t: 'Read URL',     d: 'URL → markdown.',                       svg: 'fetch' },
  { to: 'models', t: 'Models',       d: 'Browse everything this instance has.',  svg: 'list' },
];

function ico(name) {
  const svg = {
    chat:    '<path d="M2 3h10v6H5l-3 3z"/>',
    image:   '<rect x="1.5" y="2.5" width="11" height="9" rx="1"/><circle cx="5" cy="6" r="1.2"/><path d="M2 10l3-3 3 3 2-2 3 3"/>',
    wave:    '<line x1="2.5" y1="7" x2="2.5" y2="7"/><line x1="5" y1="5" x2="5" y2="9"/><line x1="7.5" y1="3" x2="7.5" y2="11"/><line x1="10" y1="5" x2="10" y2="9"/><line x1="12.5" y1="6" x2="12.5" y2="8"/>',
    mic:     '<rect x="5.5" y="2" width="3" height="6" rx="1.5"/><path d="M3 7a4 4 0 0 0 8 0"/><line x1="7" y1="11" x2="7" y2="12.5"/>',
    eye:     '<path d="M1 7c2.5-3.5 5-5 6-5s3.5 1.5 6 5c-2.5 3.5-5 5-6 5s-3.5-1.5-6-5z"/><circle cx="7" cy="7" r="2.2"/>',
    infinity:'<circle cx="4" cy="7" r="2.2"/><circle cx="10" cy="7" r="2.2"/><path d="M6 7h2"/>',
    search:  '<circle cx="6" cy="6" r="3.5"/><line x1="8.5" y1="8.5" x2="12" y2="12"/>',
    fetch:   '<path d="M7 2v8m-3-3l3 3 3-3M2 12h10"/>',
    list:    '<line x1="2" y1="4" x2="12" y2="4"/><line x1="2" y1="7" x2="12" y2="7"/><line x1="2" y1="10" x2="12" y2="10"/>',
  }[name] || '';
  const d = document.createElement('div');
  d.innerHTML = `<svg width="18" height="18" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">${svg}</svg>`;
  return d.firstChild;
}

export async function mount(root) {
  const render = async () => {
    root.innerHTML = '';

    const s = getState();
    const up = s.upstream?.reachable;
    const idn = s.idnTts || {};

    const counts = {
      chat:  (s.models?.chat?.data     || []).length,
      image: (s.models?.image?.data    || []).length,
      tts:   (s.models?.tts?.data      || []).length,
      stt:   (s.models?.stt?.data      || []).length,
      embed: (s.models?.embedding?.data|| []).length,
      web:   (s.models?.web?.data      || []).length,
    };
    const totalModels = counts.chat + counts.image + counts.tts + counts.stt + counts.embed + counts.web;

    // hero
    root.append(el('section', { class: 'hero' },
      el('span', { class: 'badge-uppercase accent' }, 'WY NineXore AI'),
      el('h2', { style: { marginTop: '10px' } },
        'Developer console for ',
        el('span', { class: 'ink-soft' }, 'the 9Router gateway.')),
      el('p', {},
        'A local workbench that collects every 9Router capability in one window — chat, images, speech, transcription, embeddings, web search, and multimodal OCR. ',
        'Bahasa Indonesia TTS and offline Whisper run alongside as a separate CUDA service.',
      ),
      el('div', { class: 'btn-row' },
        el('a', { class: 'btn btn-primary', href: '#/tts' }, 'Try Bahasa TTS'),
        el('a', { class: 'btn', href: '#/chat' }, 'Open chat'),
        el('a', { class: 'btn btn-ghost', href: '#/help' }, 'Help & manual →'),
      ),
    ));

    // status row
    root.append(el('div', { class: 'grid cols-3 mt-md' },
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Upstream'),
        el('div', { class: 'v inline gap-sm' },
          el('span', { class: 'indicator-dot ' + (up ? 'good' : (up === false ? 'bad' : '')) }),
          up ? 'Online' : (up === false ? 'Offline' : '—'),
        ),
        el('div', { class: 'd' }, s.settings?.nineroute_url || '—'),
      ),
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Indonesian TTS'),
        el('div', { class: 'v inline gap-sm' },
          el('span', { class: 'indicator-dot ' + (idn.reachable ? 'good' : (idn.enabled === false ? 'warn' : 'bad')) }),
          idn.reachable ? `${idn.n_speakers || 0} voices` : (idn.enabled === false ? 'Disabled' : 'Offline'),
        ),
        el('div', { class: 'd' }, idn.reachable ? (idn.device || 'cpu') : (idn.url || '—')),
      ),
      el('div', { class: 'card stat' },
        el('div', { class: 'k' }, 'Models exposed'),
        el('div', { class: 'v' }, String(totalModels)),
        el('div', { class: 'd' },
          `chat ${counts.chat}`, ' · ',
          `image ${counts.image}`, ' · ',
          `tts ${counts.tts}`, ' · ',
          `stt ${counts.stt}`, ' · ',
          `embed ${counts.embed}`, ' · ',
          `web ${counts.web}`,
        ),
      ),
    ));

    // quick actions
    root.append(el('div', { class: 'page-head mt-lg' },
      el('div', {},
        el('h2', {}, 'Capabilities'),
        el('p', { class: 'sub' }, 'Pick a surface.'),
      ),
    ));
    root.append(el('div', { class: 'grid cols-4' },
      ...QUICK.map(q => el('a', {
        href: '#/' + q.to, class: 'card',
        style: { textDecoration: 'none', color: 'inherit', display: 'flex', flexDirection: 'column', gap: '6px' },
      },
        el('div', { style: { color: 'var(--accent)', width: '24px', height: '24px', display: 'grid', placeItems: 'center' } }, ico(q.svg)),
        el('h3', { style: { margin: '4px 0 2px', fontSize: '15px' } }, q.t),
        el('div', { class: 'muted', style: { fontSize: '12px' } }, q.d),
      )),
    ));

    // recent outputs
    root.append(el('div', { class: 'page-head mt-lg' },
      el('div', {},
        el('h2', {}, 'Recent'),
        el('p', { class: 'sub' }, 'Saved outputs from local history.'),
      ),
    ));

    const recentWrap = el('div', { class: 'card' }, 'Loading…');
    root.append(recentWrap);

    try {
      const outputs = await apiGet('/api/history/outputs?limit=10');
      recentWrap.innerHTML = '';
      if (!outputs.length) {
        recentWrap.append(
          el('div', { class: 'muted', style: { padding: '8px 0' } },
            'No history yet — generate something and it will appear here.'),
        );
      } else {
        const tbl = el('table', { class: 'table' });
        tbl.append(el('thead', {}, el('tr', {},
          el('th', {}, 'When'),
          el('th', {}, 'Kind'),
          el('th', {}, 'Model'),
          el('th', {}, 'Prompt / input'),
        )));
        const tbody = el('tbody', {});
        for (const o of outputs) {
          tbody.append(el('tr', {},
            el('td', { class: 'nowrap muted' }, fmtDate(o.created_at)),
            el('td', {}, el('span', { class: 'pill' }, o.kind)),
            el('td', { class: 'mono' }, o.model || '—'),
            el('td', { style: { maxWidth: '480px' } }, (o.prompt || '').slice(0, 180) || '—'),
          ));
        }
        tbl.append(tbody);
        recentWrap.append(tbl);
      }
    } catch (e) {
      recentWrap.innerHTML = '';
      recentWrap.append(el('div', { class: 'muted' }, 'Could not load history.'));
      toastError(e, 'History');
    }

    // --- About -------------------------------------------------------
    root.append(el('div', { class: 'page-head mt-lg' },
      el('div', {},
        el('h2', {}, 'About'),
        el('p', { class: 'sub' }, 'Where this workbench comes from.'),
      ),
    ));
    root.append(el('div', { class: 'card' },
      el('p', {},
        el('strong', {}, 'WY NineXore AI'),
        ' is a local developer console I built on top of ',
        el('a', { href: 'https://github.com/decolua/9router', target: '_blank', rel: 'noopener' }, '9Router'),
        ' — an open-source OpenAI-compatible gateway that unifies access to many AI providers. ',
        'This repository does not ship any provider keys; every external call goes through your own 9Router instance, which holds the Codex (OpenAI Plus), NVIDIA NIM, DeepSeek, Anthropic, Tavily, Firecrawl, and other credentials you configure there.',
      ),
      el('p', {}, 'In addition to the gateway, a small optional CUDA service runs in this repo to provide offline Bahasa Indonesia voices (Coqui VITS, 83 speakers) and offline English/Indonesian transcription (Whisper large-v3). Audio in those paths stays on your machine.'),
      el('p', { class: 'muted', style: { fontSize: '13px' } },
        'Source: ',
        el('a', { href: 'https://github.com/Wayan123/WY-NineXore-AI', target: '_blank', rel: 'noopener' }, 'github.com/Wayan123/WY-NineXore-AI'),
        ' · License: MIT (this repo); the Coqui Indonesian TTS model weights are non-commercial per upstream terms.',
      ),
      el('div', { class: 'btn-row mt-sm' },
        el('a', { class: 'btn btn-small', href: '#/help' }, 'Read the manual'),
        el('a', { class: 'btn btn-ghost btn-small', href: 'https://github.com/decolua/9router', target: '_blank', rel: 'noopener' }, '9Router on GitHub ↗'),
      ),
    ));
  };

  await render();
  root.addEventListener('view:show', render);
}

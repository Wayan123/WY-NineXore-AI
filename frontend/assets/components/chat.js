// Chat view — sessions + streaming + markdown.
import { apiGet, apiJSON, apiDelete, apiPatch, streamChat } from '../api.js';
import { defaultModel, modelList } from '../store.js';
import { renderMarkdown } from '../md.js';
import { $, clear, closeModal, copyToClipboard, el, fmtDate, loading, openModal, toastBad, toastError, toastGood } from '../ui.js';

const LS_SESSION = 'nine.chat.session';
const LS_SETTINGS = 'nine.chat.settings';

const state = {
  sessions: [],
  currentId: null,
  current: null,        // full session with messages
  model: '',
  streaming: true,
  system: '',
  temperature: 0.7,
  max_tokens: null,
  abort: null,
};

function loadPrefs() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}');
    state.streaming = s.streaming ?? true;
    state.system = s.system || '';
    state.temperature = s.temperature ?? 0.7;
    state.max_tokens = s.max_tokens ?? null;
    state.model = s.model || '';
  } catch {}
}

function savePrefs() {
  localStorage.setItem(LS_SETTINGS, JSON.stringify({
    streaming: state.streaming, system: state.system,
    temperature: state.temperature, max_tokens: state.max_tokens,
    model: state.model,
  }));
}

// ---------- main mount -------------------------------------------------------
export async function mount(root) {
  loadPrefs();
  if (!state.model) state.model = defaultModel('chat');

  root.innerHTML = '';
  root.append(el('div', { class: 'page-head' },
    el('div', {},
      el('h2', {}, 'Chat'),
      el('p', { class: 'sub' }, 'Markdown, streaming, sessions saved locally.'),
    ),
    el('div', { class: 'inline' },
      el('kbd', {}, 'Enter'), el('span', { class: 'muted' }, ' send · '),
      el('kbd', {}, 'Shift+Enter'), el('span', { class: 'muted' }, ' newline'),
    ),
  ));

  const wrap = el('div', { class: 'chat-wrap mt-sm' });
  root.append(wrap);

  // --- left column --------------------------------------------------------
  const side = el('div', { class: 'chat-side' });
  wrap.append(side);

  const newBtn = el('button', { class: 'btn btn-primary', onclick: newSession }, '+ New chat');
  side.append(newBtn);

  const sessionsList = el('div', { class: 'chat-sessions' });
  side.append(sessionsList);

  // --- right column -------------------------------------------------------
  const main = el('div', { class: 'chat-main' });
  wrap.append(main);

  const header = el('div', { class: 'chat-header' });
  main.append(header);

  const log = el('div', { class: 'chat-log' });
  main.append(log);

  const compose = buildCompose();
  main.append(compose.node);

  // refs for re-renders
  root._refs = { sessionsList, header, log, compose };

  await reloadSessions();
  const saved = localStorage.getItem(LS_SESSION);
  if (saved && state.sessions.find(s => s.id === saved)) {
    await selectSession(saved);
  } else if (state.sessions.length) {
    await selectSession(state.sessions[0].id);
  } else {
    showEmpty();
  }

  // Refresh model list when view reopens
  root.addEventListener('view:show', async () => {
    if (!state.model) state.model = defaultModel('chat');
    renderHeader();
  });
}

// ---------- sessions CRUD ----------------------------------------------------
async function reloadSessions() {
  try {
    state.sessions = await apiGet('/api/chat/sessions');
  } catch (e) { toastError(e, 'Load sessions'); state.sessions = []; }
  renderSessionsList();
}

async function newSession() {
  try {
    const s = await apiJSON('/api/chat/sessions', { title: 'New chat', model: state.model, system: state.system });
    await reloadSessions();
    await selectSession(s.id);
  } catch (e) { toastError(e, 'Create session'); }
}

async function selectSession(id) {
  state.currentId = id;
  localStorage.setItem(LS_SESSION, id);
  try {
    state.current = await apiGet('/api/chat/sessions/' + id);
  } catch (e) { toastError(e, 'Open session'); return; }
  if (state.current.model) state.model = state.current.model;
  if (state.current.system) state.system = state.current.system;
  renderSessionsList();
  renderHeader();
  renderLog();
}

async function renameSession(id) {
  const cur = state.sessions.find(s => s.id === id);
  const title = prompt('New title', cur?.title || '');
  if (title == null) return;
  try {
    await apiPatch('/api/chat/sessions/' + id, { title });
    await reloadSessions();
    if (state.currentId === id) renderHeader();
  } catch (e) { toastError(e, 'Rename'); }
}

async function pinSession(id, pinned) {
  try {
    await apiPatch('/api/chat/sessions/' + id, { pinned });
    await reloadSessions();
  } catch (e) { toastError(e, 'Pin'); }
}

async function deleteSession(id) {
  if (!confirm('Delete this chat? This can’t be undone.')) return;
  try {
    await apiDelete('/api/chat/sessions/' + id);
    if (state.currentId === id) { state.currentId = null; state.current = null; }
    await reloadSessions();
    if (!state.currentId && state.sessions.length) await selectSession(state.sessions[0].id);
    else if (!state.sessions.length) showEmpty();
  } catch (e) { toastError(e, 'Delete'); }
}

// ---------- rendering --------------------------------------------------------
function renderSessionsList() {
  const host = $('.chat-sessions');
  if (!host) return;
  clear(host);
  if (!state.sessions.length) {
    host.append(el('div', { class: 'muted', style: { padding: '8px' } }, 'No chats yet.'));
    return;
  }
  for (const s of state.sessions) {
    const node = el('div', {
      class: 'chat-session' + (s.id === state.currentId ? ' active' : ''),
      onclick: (e) => { if (e.target.tagName !== 'BUTTON') selectSession(s.id); },
    },
      s.pinned ? el('span', { class: 'pin', title: 'pinned' }, '★') : null,
      el('span', { class: 'title', title: s.title }, s.title || 'Untitled'),
      el('button', {
        class: 'btn btn-ghost btn-small',
        title: s.pinned ? 'Unpin' : 'Pin',
        onclick: (e) => { e.stopPropagation(); pinSession(s.id, !s.pinned); },
      }, s.pinned ? '☆' : '★'),
      el('button', {
        class: 'btn btn-ghost btn-small',
        title: 'Rename',
        onclick: (e) => { e.stopPropagation(); renameSession(s.id); },
      }, '✎'),
      el('button', {
        class: 'btn btn-ghost btn-small',
        title: 'Delete',
        onclick: (e) => { e.stopPropagation(); deleteSession(s.id); },
      }, '✕'),
    );
    host.append(node);
  }
}

function renderHeader() {
  const host = $('.chat-header');
  if (!host) return;
  clear(host);
  if (!state.current) return;

  const title = el('span', { class: 'title' }, state.current.title || 'Untitled');
  const modelSel = el('select', {
    onchange: (e) => { state.model = e.target.value; savePrefs(); },
    title: 'Model',
  });
  const opts = modelList('chat');
  for (const m of opts) {
    const o = el('option', { value: m.id }, m.id);
    if (m.id === state.model) o.selected = true;
    modelSel.append(o);
  }
  if (!opts.find(m => m.id === state.model) && state.model) {
    const o = el('option', { value: state.model }, state.model + ' (custom)');
    o.selected = true;
    modelSel.append(o);
  }

  const sysToggle = el('button', {
    class: 'btn btn-ghost btn-small',
    title: 'System prompt',
    onclick: editSystem,
  }, state.system ? '◉ system' : '○ system');

  const tempBtn = el('button', {
    class: 'btn btn-ghost btn-small',
    title: 'Generation knobs',
    onclick: editKnobs,
  }, `T=${state.temperature}`);

  const streamBtn = el('label', { class: 'inline', style: { margin: 0, fontSize: '0.85rem' } },
    el('input', {
      type: 'checkbox', checked: state.streaming,
      onchange: (e) => { state.streaming = e.target.checked; savePrefs(); },
    }),
    el('span', { class: 'muted' }, 'stream'),
  );

  host.append(title, modelSel, sysToggle, tempBtn, streamBtn);
}

function renderLog() {
  const host = $('.chat-log');
  if (!host) return;
  clear(host);
  if (!state.current) return;
  const msgs = state.current.messages || [];
  if (!msgs.length) {
    host.append(el('div', { class: 'empty' },
      el('div', { class: 'em-ico' }, '✎'),
      el('div', { class: 'em-title' }, 'Empty chat.'),
      el('div', {}, 'Type below to say hello.'),
    ));
    return;
  }
  for (const m of msgs) host.append(renderMessage(m));
  host.scrollTop = host.scrollHeight;
}

function renderMessage(m) {
  const avatar = el('div', { class: 'msg-avatar', title: m.role }, m.role === 'user' ? 'you' : 'ai');
  const mdBox = el('div', { class: 'md' });
  mdBox.innerHTML = renderMarkdown(m.content || '');
  const body = el('div', { class: 'msg-body', style: { position: 'relative' } }, mdBox);
  if (m.role === 'assistant') {
    const copyBtn = el('button', {
      class: 'btn btn-ghost btn-small',
      onclick: () => copyToClipboard(mdBox.innerText || ''),
      title: 'Copy',
      style: { position: 'absolute', top: '4px', right: '4px', fontSize: '0.78rem', padding: '2px 6px' },
    }, '⧉');
    body.append(copyBtn);
  }
  const wrap = el('div', { class: 'msg ' + (m.role === 'user' ? 'user' : 'assistant') });
  wrap.append(avatar, body);
  return wrap;
}

function showEmpty() {
  const host = $('.chat-log');
  if (!host) return;
  clear(host);
  host.append(el('div', { class: 'empty' },
    el('div', { class: 'em-ico' }, '✎'),
    el('div', { class: 'em-title' }, 'No chats yet.'),
    el('div', {}, 'Start one with the button on the left.'),
  ));
  const h = $('.chat-header'); if (h) clear(h);
}

// ---------- compose ----------------------------------------------------------
function buildCompose() {
  const ta = el('textarea', {
    placeholder: 'Type your message — Enter to send, Shift+Enter for newline.',
    oninput: (e) => { autosize(e.target); },
    onkeydown: (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        submit();
      }
    },
  });

  const sendBtn = el('button', { class: 'btn btn-primary', onclick: submit }, 'Send');
  const stopBtn = el('button', { class: 'btn btn-danger', onclick: stop, style: { display: 'none' } }, 'Stop');

  const node = el('div', { class: 'chat-compose' },
    ta,
    el('div', { class: 'chat-compose-row' },
      el('div', { class: 'muted', style: { fontSize: '0.78rem' } }, 'Your chats are stored locally.'),
      el('div', { class: 'spacer' }),
      stopBtn, sendBtn,
    ),
  );
  return { node, ta, sendBtn, stopBtn };

  async function submit() {
    const text = ta.value.trim();
    if (!text) return;
    if (!state.currentId) {
      await newSession();
      if (!state.currentId) return;
    }
    if (!state.model) { toastBad('Pick a model first'); return; }

    ta.value = ''; autosize(ta);
    // optimistic local render
    state.current.messages = state.current.messages || [];
    state.current.messages.push({ role: 'user', content: text });
    const userNode = renderMessage({ role: 'user', content: text });
    $('.chat-log').append(userNode);
    const assistantNode = renderMessage({ role: 'assistant', content: '' });
    const mdEl = assistantNode.querySelector('.md');
    mdEl.innerHTML = '<span class="spinner"></span> <span class="muted">thinking…</span>';
    $('.chat-log').append(assistantNode);
    scrollBottom();

    stopBtn.style.display = ''; sendBtn.style.display = 'none';
    state.abort = new AbortController();

    const messages = state.current.messages.map(m => ({ role: m.role, content: m.content }));
    const payload = {
      model: state.model,
      messages,
      system: state.system || undefined,
      session_id: state.currentId,
      temperature: state.temperature,
      max_tokens: state.max_tokens || undefined,
    };

    let final = '';
    try {
      if (state.streaming) {
        mdEl.innerHTML = '';
        let buf = '';
        const setHtml = () => { mdEl.innerHTML = renderMarkdown(buf); scrollBottom(); };
        final = await streamChat(payload, {
          signal: state.abort.signal,
          onChunk: (c) => { buf += c; setHtml(); },
          onError: (err) => {
            buf += '\n\n⚠ upstream error: ' + (err?.body?.error?.message ?? JSON.stringify(err));
            setHtml();
          },
        });
      } else {
        const resp = await apiJSON('/api/chat/complete', { ...payload, stream: false });
        final = resp?.choices?.[0]?.message?.content ?? '';
        mdEl.innerHTML = renderMarkdown(final);
        scrollBottom();
      }
    } catch (e) {
      if (e.name === 'AbortError') {
        mdEl.innerHTML = renderMarkdown((final || '') + '\n\n_stopped._');
      } else {
        mdEl.innerHTML = '';
        mdEl.append(el('div', { class: 'error-box' },
          el('strong', {}, 'Request failed' + (e.status ? ` (${e.status})` : '')),
          el('pre', {}, e.upstreamMessage || e.message),
        ));
        toastError(e, 'Chat failed');
      }
    } finally {
      stopBtn.style.display = 'none'; sendBtn.style.display = '';
      state.abort = null;
    }

    if (final) {
      state.current.messages.push({ role: 'assistant', content: final });
      // If the title is still default, suggest one from the first user message
      if (state.current.title === 'New chat') {
        const t = text.slice(0, 40).replace(/\s+/g, ' ').trim();
        try {
          await apiPatch('/api/chat/sessions/' + state.currentId, { title: t });
          state.current.title = t;
          renderHeader();
          await reloadSessions();
        } catch {}
      }
    }
  }

  function stop() { state.abort?.abort(); }

  function autosize(node) {
    node.style.height = 'auto';
    node.style.height = Math.min(node.scrollHeight + 2, Math.floor(window.innerHeight * 0.3)) + 'px';
  }
  function scrollBottom() { const log = $('.chat-log'); if (log) log.scrollTop = log.scrollHeight; }
}

// ---------- knob editors -----------------------------------------------------
function editSystem() {
  const ta = el('textarea', {
    rows: 6,
    placeholder: 'e.g. “You are a careful code reviewer. Reply in short paragraphs.”',
    style: { width: '100%', fontFamily: 'var(--sans)' },
  });
  ta.value = state.system || '';

  const save = () => {
    state.system = ta.value.trim();
    savePrefs();
    if (state.currentId) {
      apiPatch('/api/chat/sessions/' + state.currentId, { system: state.system }).catch(() => {});
      if (state.current) state.current.system = state.system;
    }
    renderHeader();
    toastGood('System prompt ' + (state.system ? 'updated' : 'cleared'));
    closeModal();
  };

  const clear_ = () => { ta.value = ''; };

  openModal(el('div', {},
    el('h3', {}, 'System prompt'),
    el('p', { class: 'muted', style: { fontSize: '0.88rem' } },
      'Instructions the model sees before every reply. Applies to this chat only.'),
    ta,
    el('div', { class: 'btn-row mt-md', style: { justifyContent: 'flex-end' } },
      el('button', { class: 'btn btn-ghost', onclick: clear_ }, 'clear'),
      el('button', { class: 'btn', 'data-close': '' }, 'cancel'),
      el('button', { class: 'btn btn-primary', onclick: save }, 'save'),
    ),
  ));
  setTimeout(() => ta.focus(), 0);
}

function editKnobs() {
  const tIn = el('input', { type: 'number', min: 0, max: 2, step: 0.1, value: state.temperature ?? 0.7 });
  const mIn = el('input', { type: 'number', min: 1, step: 1, value: state.max_tokens ?? '',
    placeholder: 'blank = unlimited' });

  const save = () => {
    const t = parseFloat(tIn.value);
    if (!Number.isNaN(t)) state.temperature = Math.max(0, Math.min(2, t));
    const m = parseInt(mIn.value, 10);
    state.max_tokens = Number.isFinite(m) && m > 0 ? m : null;
    savePrefs();
    renderHeader();
    toastGood('Updated');
    closeModal();
  };

  openModal(el('div', {},
    el('h3', {}, 'Generation knobs'),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Temperature ', el('span', { class: 'muted' }, '(0 precise → 2 wild)')),
      tIn),
    el('div', { class: 'field mt-sm' },
      el('label', {}, 'Max tokens ', el('span', { class: 'muted' }, '(blank = unlimited)')),
      mIn),
    el('div', { class: 'btn-row mt-md', style: { justifyContent: 'flex-end' } },
      el('button', { class: 'btn', 'data-close': '' }, 'cancel'),
      el('button', { class: 'btn btn-primary', onclick: save }, 'save'),
    ),
  ));
}

// Tiny DOM + UI helpers. No framework, just conveniences.

// el('div', {class:'x', onclick: fn}, 'text', el('span'))
export function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class' || k === 'className') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k === 'dataset' && typeof v === 'object') Object.assign(n.dataset, v);
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in n && k !== 'value') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  // value needs to be set after others for <input>/<select>
  if (props && 'value' in props && props.value != null) n.value = props.value;
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    n.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return n;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }

// ---- toasts -----------------------------------------------------------------
let _toasts;
export function toast({ title = '', body = '', kind = '', timeout = 3800 } = {}) {
  _toasts ??= document.getElementById('toasts');
  const t = el('div', { class: `toast ${kind}` },
    title && el('div', { class: 'tt-head' }, title),
    body && el('div', { class: 'tt-body' }, body),
  );
  _toasts.appendChild(t);
  const close = () => {
    if (!t.isConnected) return;
    t.style.transition = 'opacity 200ms, transform 200ms';
    t.style.opacity = 0; t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 220);
  };
  if (timeout > 0) setTimeout(close, timeout);
  t.addEventListener('click', close);
  return close;
}
export const toastGood = (title, body) => toast({ title, body, kind: 'good' });
export const toastBad  = (title, body) => toast({ title, body, kind: 'bad', timeout: 6000 });
export const toastWarn = (title, body) => toast({ title, body, kind: 'warn' });

// Friendly error display from ApiError / generic Error.
export function toastError(err, context = 'Request failed') {
  const status = err?.status ?? '';
  const msg = err?.upstreamMessage || err?.message || String(err);
  toastBad(context + (status ? ` (${status})` : ''), msg);
  console.error(context, err);
}

// ---- modal ------------------------------------------------------------------
const modalRoot = () => document.getElementById('modal');
const modalBody = () => document.getElementById('modalBody');
let _modalOpen = false;
let _modalPrevFocus = null;

function focusables(root) {
  return [...root.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )];
}

function trapFocus(e) {
  if (!_modalOpen || e.key !== 'Tab') return;
  const card = modalRoot().querySelector('.modal-card');
  if (!card) return;
  const list = focusables(card);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  }
}

export function openModal(contentNode) {
  const root = modalRoot();
  const body = modalBody();
  _modalPrevFocus = document.activeElement;
  clear(body).appendChild(contentNode);
  root.hidden = false;
  _modalOpen = true;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', trapFocus, true);
  // move focus to the first focusable element inside the modal (or the card itself)
  requestAnimationFrame(() => {
    const card = root.querySelector('.modal-card');
    const f = focusables(card || root);
    if (f.length) f[0].focus();
    else card?.focus();
  });
}

export function closeModal() {
  if (!_modalOpen) return;
  modalRoot().hidden = true;
  _modalOpen = false;
  document.body.style.overflow = '';
  document.removeEventListener('keydown', trapFocus, true);
  if (_modalPrevFocus && _modalPrevFocus.focus) {
    try { _modalPrevFocus.focus(); } catch {}
  }
  _modalPrevFocus = null;
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-close]') && _modalOpen) closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && _modalOpen) closeModal();
});

// ---- small utilities --------------------------------------------------------
export function debounce(fn, ms = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function fmtBytes(n) {
  if (!n && n !== 0) return '';
  const u = ['B','KB','MB','GB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n < 10 ? 1 : 0)} ${u[i]}`;
}

export function fmtDate(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const opts = sameDay ? { hour: '2-digit', minute: '2-digit' }
                       : { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
  return d.toLocaleString(undefined, opts);
}

export function copyToClipboard(text) {
  return navigator.clipboard?.writeText(text).then(
    () => toastGood('Copied', undefined),
    () => toastWarn('Copy failed'),
  );
}

export function download(url, filename) {
  const a = el('a', { href: url, download: filename || '' });
  document.body.appendChild(a); a.click(); a.remove();
}

export function loading(label = 'Working…') {
  return el('div', { class: 'inline muted' },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('span', { class: 'sr-only' }, label),
    ' ', label,
  );
}

export function errorBox(err, context = 'Error') {
  const msg = err?.upstreamMessage || err?.message || String(err);
  const status = err?.status ? ` · ${err.status}` : '';
  return el('div', { class: 'error-box' },
    el('strong', {}, context + status),
    el('pre', {}, msg),
  );
}

export function empty(title = 'Nothing here yet.', sub = '', iconChar = '◌') {
  return el('div', { class: 'empty' },
    el('div', { class: 'em-ico' }, iconChar),
    el('div', { class: 'em-title' }, title),
    sub && el('div', {}, sub),
  );
}

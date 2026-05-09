// Small shared state: settings + model catalogs cached once at boot.
import { apiGet } from './api.js';

const state = {
  settings: null,       // { nineroute_url, has_key, defaults: {...} }
  upstream: null,       // { reachable, ... }
  idnTts: null,         // { reachable, ...health... }
  models: null,         // { chat, image, tts, stt, embedding, web, 'image-to-text' }
  listeners: new Set(),
};

export function getState() { return state; }

export function onChange(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); }
function notify() { for (const fn of state.listeners) fn(state); }

export async function bootstrap() {
  try {
    state.settings = await apiGet('/api/settings');
  } catch (e) {
    state.settings = { nineroute_url: '', has_key: false, defaults: {} };
  }
  try {
    state.upstream = await apiGet('/api/upstream');
  } catch {
    state.upstream = { reachable: false };
  }
  try {
    state.idnTts = await apiGet('/api/idn-tts/status');
  } catch {
    state.idnTts = { reachable: false };
  }
  try {
    state.models = await apiGet('/api/models/all');
  } catch {
    state.models = {};
  }
  notify();
  return state;
}

export async function refreshUpstream() {
  try { state.upstream = await apiGet('/api/upstream'); }
  catch { state.upstream = { reachable: false }; }
  try { state.idnTts = await apiGet('/api/idn-tts/status'); }
  catch { state.idnTts = { reachable: false }; }
  notify();
}

export async function refreshModels() {
  try { state.models = await apiGet('/api/models/all'); }
  catch { state.models = {}; }
  notify();
}

/**
 * Refresh a single kind and merge the result back into the cache.
 * Use this from individual panels so the dropdown reflects services that
 * came online after the dashboard started.
 */
export async function refreshKind(kind) {
  const path = kind === 'chat' ? '/api/models?kind=chat' : `/api/models?kind=${kind}`;
  try {
    const resp = await apiGet(path);
    state.models = state.models || {};
    state.models[kind] = resp;
    notify();
    return resp;
  } catch (e) {
    return null;
  }
}

// Get a default model for a capability: user-configured default, else first available.
export function defaultModel(kind) {
  const def = state.settings?.defaults?.[kind] || '';
  if (def) return def;

  const list = state.models?.[kind]?.data || [];

  // For TTS, prefer named Indonesian Coqui voices over generic first-entry.
  if (kind === 'tts') {
    for (const name of ['coqui/wibowo', 'coqui/ardi', 'coqui/gadis']) {
      if (list.some(m => m.id === name)) return name;
    }
  }
  return list[0]?.id || '';
}

// Return array of model IDs for a kind.
export function modelList(kind) {
  return state.models?.[kind]?.data || [];
}

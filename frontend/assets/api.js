// API helpers — thin fetch wrappers. Every call returns JSON or throws an ApiError.

export class ApiError extends Error {
  constructor(status, body, url) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body).slice(0, 300);
    super(`${status} ${url}: ${detail}`);
    this.status = status; this.body = body; this.url = url;
    this.name = 'ApiError';
  }
  get upstreamStatus() {
    return this.body?.error?.status ?? this.status;
  }
  get upstreamMessage() {
    // 1. Canonical upstream-error shape: {error:{status, body, url}}
    const nested = this.body?.error?.body;
    if (nested != null) {
      if (typeof nested === 'string') return nested;
      return nested?.error?.message ?? nested?.message ?? JSON.stringify(nested).slice(0, 280);
    }
    // 2. FastAPI HTTPException with string detail (our validation errors)
    if (typeof this.body?.detail === 'string') return this.body.detail;
    // 3. Pydantic validation errors: detail is an array of {msg, loc}
    if (Array.isArray(this.body?.detail)) {
      return this.body.detail.map(e => e.msg || JSON.stringify(e)).join('; ');
    }
    // 4. Generic {message}
    if (this.body?.message) return this.body.message;
    if (typeof this.body === 'string') return this.body;
    return this.message;
  }
}

async function parse(resp, url) {
  const ctype = resp.headers.get('content-type') || '';
  const body = ctype.includes('application/json') ? await resp.json().catch(() => null)
                                                  : await resp.text();
  if (!resp.ok) throw new ApiError(resp.status, body, url);
  return body;
}

export async function apiGet(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' } });
  return parse(r, url);
}

export async function apiJSON(url, body, method = 'POST') {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return parse(r, url);
}

export async function apiForm(url, formData) {
  const r = await fetch(url, { method: 'POST', body: formData });
  return parse(r, url);
}

export async function apiDelete(url) {
  const r = await fetch(url, { method: 'DELETE' });
  return parse(r, url);
}

export async function apiPatch(url, body) {
  return apiJSON(url, body, 'PATCH');
}

// SSE stream handler for /api/chat/stream.
// Calls onChunk(text) for each incremental content piece,
// onMeta({finish_reason, usage}) at end, and returns the full text.
export async function streamChat(payload, { onChunk, onError, signal } = {}) {
  const r = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(payload),
    signal,
  });
  if (!r.ok) {
    let body = null;
    try { body = await r.json(); } catch { body = await r.text(); }
    throw new ApiError(r.status, body, '/api/chat/stream');
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of frame.split('\n')) {
        const L = line.trim();
        if (!L.startsWith('data:')) continue;
        const payloadStr = L.slice(5).trim();
        if (!payloadStr || payloadStr === '[DONE]') continue;
        try {
          const obj = JSON.parse(payloadStr);
          if (obj?.error) { onError?.(obj.error); continue; }
          const delta = obj?.choices?.[0]?.delta?.content ?? '';
          if (delta) { full += delta; onChunk?.(delta, obj); }
        } catch (e) {
          // ignore non-JSON keep-alive frames
        }
      }
    }
  }
  return full;
}

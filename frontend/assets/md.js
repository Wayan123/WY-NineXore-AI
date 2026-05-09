// Minimal markdown → HTML for chat output.
// Not a full CommonMark parser; covers what LLMs actually emit:
// headings, paragraphs, **bold**, *italic*, `inline code`, ```fenced```,
// [links](url), > quotes, -/1. lists, horizontal rules.
// All input is escaped first, so this never lets HTML through.

const HTML_ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => HTML_ENTITIES[c]);
}

const SAFE_SCHEMES = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i;

function safeUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '#';
  // allow relative paths and explicit safe schemes only
  if (SAFE_SCHEMES.test(s)) return s;
  return '#';
}

function renderInline(s) {
  // s is already HTML-escaped.
  // code spans first, so other rules don't touch their contents
  s = s.replace(/`([^`\n]+)`/g, (_, c) => `<code>${c}</code>`);
  // [text](url) — guard the URL scheme
  s = s.replace(/\[([^\]]+)\]\(([^\s)]+)\)/g,
    (_, text, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noopener noreferrer">${text}</a>`);
  // autolinks: bare https?:// ... until whitespace/punct at end
  s = s.replace(/(?<!["'>=])\bhttps?:\/\/[^\s<>()]+/g,
    (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`);
  // bold + italic
  s = s.replace(/\*\*([^\*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^\*])\*([^\*\n]+)\*/g, '$1<em>$2</em>');
  // line breaks: two trailing spaces → <br>
  s = s.replace(/  $/gm, '<br>');
  return s;
}

export function renderMarkdown(src) {
  const text = escapeHtml(src || '');
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let inPara = [];

  const flushPara = () => {
    if (inPara.length) {
      out.push(`<p>${renderInline(inPara.join(' '))}</p>`);
      inPara = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```(\w+)?\s*$/);
    if (fence) {
      flushPara();
      const lang = fence[1] || '';
      const buf = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++; // skip closing fence
      const cls = lang ? ` class="lang-${lang}"` : '';
      out.push(`<pre><code${cls}>${buf.join('\n')}</code></pre>`);
      continue;
    }

    // headings
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      const lvl = Math.min(h[1].length + 1, 4); // start at h3 inside messages
      out.push(`<h${lvl}>${renderInline(h[2].trim())}</h${lvl}>`);
      i++; continue;
    }

    // hr
    if (/^\s*(\-\-\-|\*\*\*|___)\s*$/.test(line)) {
      flushPara();
      out.push('<hr>');
      i++; continue;
    }

    // blockquote run
    if (/^\s*>\s?/.test(line)) {
      flushPara();
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
        i++;
      }
      out.push(`<ul>${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
        i++;
      }
      out.push(`<ol>${items.map(it => `<li>${renderInline(it)}</li>`).join('')}</ol>`);
      continue;
    }

    // blank line → flush paragraph
    if (/^\s*$/.test(line)) {
      flushPara();
      i++; continue;
    }

    // accumulate paragraph
    inPara.push(line.trim());
    i++;
  }
  flushPara();
  return out.join('\n');
}

// Shared, safe Markdown rendering for live and historical chat messages.
((global) => {
  const SAFE_TAGS = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'mark',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'code', 'span', 'a',
    'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub',
    'small', 'details', 'summary', 'input'
  ]);
  const SAFE_ATTRS = {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'class', 'width', 'height'],
    code: ['class'],
    span: ['class'],
    pre: ['class'],
    ul: ['class'],
    ol: ['class', 'start'],
    li: ['class'],
    td: ['align'],
    th: ['align'],
    input: ['type', 'checked', 'disabled']
  };
  const URL_ATTRS = new Set(['href', 'src']);

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function decodeCodePoint(value, radix) {
    const codePoint = Number.parseInt(value, radix);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : '';
  }

  function decodeProtocolEntities(value) {
    return String(value || '')
      .replace(/&#x([0-9a-f]+);?/gi, (_match, hex) => decodeCodePoint(hex, 16))
      .replace(/&#([0-9]+);?/g, (_match, decimal) => decodeCodePoint(decimal, 10))
      .replace(/&colon;?/gi, ':')
      .replace(/&tab;?/gi, '\t')
      .replace(/&newline;?/gi, '\n');
  }

  function isSafeUrl(value) {
    const compact = decodeProtocolEntities(value)
      .replace(/[\u0000-\u0020\u007f]+/g, '');
    const scheme = compact.match(/^([a-z][a-z0-9+.-]*):/i)?.[1]?.toLowerCase();
    return !scheme || ['http', 'https', 'mailto', 'tel'].includes(scheme);
  }

  function sanitizeHtml(html) {
    return String(html || '').replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*\/?>/g, (match, tag) => {
      const lower = tag.toLowerCase();
      if (!SAFE_TAGS.has(lower)) return '';
      if (match.charAt(1) === '/') return `</${lower}>`;

      const allowed = SAFE_ATTRS[lower];
      if (!allowed) return match.endsWith('/>') ? `<${lower} />` : `<${lower}>`;

      let attrs = '';
      const attrPattern = /\s([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/g;
      let attribute;
      while ((attribute = attrPattern.exec(match)) !== null) {
        const name = attribute[1].toLowerCase();
        const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
        if (!allowed.includes(name)) continue;
        if (URL_ATTRS.has(name) && !isSafeUrl(value)) continue;
        if (lower === 'input' && name === 'type' && value.toLowerCase() !== 'checkbox') continue;
        attrs += ` ${name}="${value.replace(/"/g, '&quot;')}"`;
      }
      return match.endsWith('/>') ? `<${lower}${attrs} />` : `<${lower}${attrs}>`;
    });
  }

  function fallbackMarkdown(text) {
    return text
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\n/g, '<br>');
  }

  function renderMarkdown(text) {
    if (!text) return '';
    const parser = global.marked;
    const parsed = parser && typeof parser.parse === 'function'
      ? parser.parse(String(text), { breaks: true, gfm: true })
      : fallbackMarkdown(escapeHtml(text));
    let html = sanitizeHtml(parsed);
    html = html.replace(/<img ([^>]*)>/g, '<img $1 class="chat-image-thumb chat-image-clickable">');
    html = html
      .replace(/<table>/g, '<div class="chat-table-scroll" role="region" aria-label="Scrollable table" tabindex="0"><table>')
      .replace(/<\/table>/g, '</table></div>');
    return html;
  }

  global.VirtualWorldChatMarkdown = Object.freeze({
    escapeHtml,
    renderMarkdown,
    sanitizeHtml
  });
})(globalThis);

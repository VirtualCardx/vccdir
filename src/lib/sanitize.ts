// Text utilities: HTML escaping, article sanitizing, slugs, and search budgets.

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export function sanitizeContentHtml(html: string): string {
  const allowedTags = new Set(['p', 'br', 'strong', 'b', 'em', 'i', 'u', 'h2', 'h3', 'ul', 'ol', 'li', 'blockquote', 'a', 'hr']);
  const safeHref = (href: string) => /^(https?:\/\/|mailto:|\/|#)/i.test(href) && !/^javascript:/i.test(href);
  const withoutUnsafeBlocks = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '');

  return withoutUnsafeBlocks.replace(/<\/?([a-z0-9]+)([^>]*)>/gi, (tag, rawName: string, attrs: string) => {
    const name = rawName.toLowerCase();
    if (!allowedTags.has(name)) return '';
    if (tag.startsWith('</')) return `</${name}>`;
    if (name === 'br' || name === 'hr') return `<${name}>`;
    if (name === 'a') {
      const hrefMatch = attrs.match(/(?:^|\s)href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim() : '';
      if (!href || !safeHref(href)) return '<a>';
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${name}>`;
  });
}

export function contentBodyHtml(body: string): string {
  if (!/<\/?[a-z][\s\S]*>/i.test(body)) return plainTextToHtml(body);
  const sanitized = sanitizeContentHtml(body);
  // Wrap leading bare text so the intro paragraph gets spacing before block-level content;
  // the "* + *" spacing rule only applies between element siblings.
  const leading = sanitized.match(/^[^<]*/);
  if (leading && leading[0].trim()) {
    const rest = sanitized.slice(leading[0].length);
    if (/^<(?:p|h2|h3|ul|ol|blockquote|hr)/i.test(rest)) {
      return `<p>${leading[0].trim()}</p>${rest}`;
    }
  }
  return sanitized;
}

export function generateSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// D1 rejects LIKE patterns longer than 50 bytes, so cap the escaped search term at 48 bytes.
export function truncateSearchTerm(text: string): string {
  const encoder = new TextEncoder();
  const escapedLength = (value: string) => encoder.encode(value.replace(/[\\%_]/g, (char) => `\\${char}`)).length;
  let truncated = text.slice(0, 100);
  while (truncated && escapedLength(truncated) > 48) truncated = Array.from(truncated).slice(0, -1).join('');
  return truncated;
}

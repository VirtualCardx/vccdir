import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { bodyLimit } from 'hono/body-limit';
import type { Context } from 'hono';
import { Layout } from './layout';
import { t, getLang } from './i18n';
import type { Provider, Card, Tag, ProviderWithTags, CardWithProvider, ContentPost, Lang } from './types';

type Env = { Bindings: CloudflareBindings };
const app = new Hono<Env>();

// Keep every public indexing signal on the configured www origin. Cloudflare may
// route both hostnames to this Worker, so normalize the bare domain here as a
// safety net even when an edge redirect rule has not been configured yet.
app.use('*', async (c, next) => {
  c.header('Content-Security-Policy', "default-src 'self'; script-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'");
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  const configured = c.env.SITE_URL?.replace(/\/+$/, '');
  if (configured) {
    const canonical = new URL(configured);
    const requested = new URL(c.req.url);
    const bareCanonicalHost = canonical.hostname.replace(/^www\./, '');

    if (canonical.hostname.startsWith('www.') && requested.hostname === bareCanonicalHost) {
      requested.protocol = canonical.protocol;
      requested.host = canonical.host;
      return c.redirect(requested.toString(), 301);
    }
  }

  await next();
});

// ==========================================
// Helpers
// ==========================================
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

function providerName(p: Provider | { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? p.name_zh : p.name_en;
}

function providerDesc(p: Provider, lang: Lang): string {
  const description = (lang === 'zh' ? p.desc_zh : p.desc_en)?.trim();
  const name = providerName(p, lang);
  const fallback = lang === 'zh'
    ? `查看${name}虚拟信用卡平台的开卡方式、费率、KYC要求、支持地区和可用卡段，并与其他虚拟卡平台进行对比。`
    : `Review ${name} virtual card issuance, fees, KYC requirements, supported regions, and available cards, then compare it with other VCC platforms.`;
  if (!description) return fallback;
  return description.length < 70 ? `${description}${/[。.!?]$/.test(description) ? '' : '。'}${fallback}` : description;
}

function cardMetaDescription(card: CardWithProvider, lang: Lang): string {
  const description = card.description?.trim();
  const name = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;
  const fallback = lang === 'zh'
    ? `了解${name} ${card.card_type} 虚拟卡（BIN ${card.bin}）的开卡费、充值费率、月费、支持币种、额度和适用场景，并与其他虚拟信用卡进行比较。`
    : `Explore the ${name} ${card.card_type} virtual card (BIN ${card.bin}), including issuance fees, funding rates, monthly costs, currency, limits, and supported use cases.`;
  if (!description) return fallback;
  return description.length < 70 ? `${description}${/[。.!?]$/.test(description) ? '' : '。'}${fallback}` : description;
}

function contentTitle(post: ContentPost, lang: Lang): string {
  return lang === 'zh' ? post.title_zh : post.title_en;
}

function contentExcerpt(post: ContentPost, lang: Lang): string {
  const excerpt = (lang === 'zh' ? post.excerpt_zh : post.excerpt_en)?.trim();
  const title = contentTitle(post, lang);
  const fallback = lang === 'zh'
    ? `深入了解${title}的费率、申请或使用方式、适用场景和注意事项，帮助你比较并选择合适的虚拟信用卡服务。`
    : `Learn about ${title}, including fees, setup or usage, suitable use cases, and important considerations when comparing virtual card services.`;
  if (!excerpt) return fallback;
  return excerpt.length < 70 ? `${excerpt}${/[。.!?]$/.test(excerpt) ? '' : '。'}${fallback}` : excerpt;
}

function contentBody(post: ContentPost, lang: Lang): string {
  return lang === 'zh' ? post.body_zh : post.body_en;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function plainTextToHtml(text: string): string {
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
      const hrefMatch = attrs.match(/\s href=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const href = hrefMatch ? (hrefMatch[1] || hrefMatch[2] || hrefMatch[3] || '').trim() : '';
      if (!href || !safeHref(href)) return '<a>';
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">`;
    }
    return `<${name}>`;
  });
}

function contentBodyHtml(body: string): string {
  return /<\/?[a-z][\s\S]*>/i.test(body) ? sanitizeContentHtml(body) : plainTextToHtml(body);
}

function tagName(tag: Tag, lang: Lang): string {
  return lang === 'zh' ? tag.name_zh : tag.name_en;
}

export function generateSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

class ApiError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 415, message: string) {
    super(message);
  }
}

function parseLimit(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

function assertSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
    throw new ApiError(400, 'slug must be lowercase ASCII words separated by hyphens');
  }
  return slug;
}

function assertSafeWebsite(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, 'website must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new ApiError(400, 'website must use HTTPS');
  return url.toString();
}

async function parseJsonBody(c: Context<Env>): Promise<Record<string, unknown>> {
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Content-Type must be application/json');
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > 256 * 1024) throw new ApiError(413, 'JSON body exceeds 256 KiB');
  try {
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 256 * 1024) throw new ApiError(413, 'JSON body exceeds 256 KiB');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Request body must be a JSON object');
  }
}

function requireHermesAuth(c: Context<Env>): Response | null {
  const expected = c.env.HERMES_API_TOKEN;
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!expected || expected === 'change-me-in-production') {
    return c.json({ error: 'HERMES_API_TOKEN is not configured' }, 503);
  }

  if (!token || !constantTimeEqual(token, expected)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return null;
}

function stringField(body: Record<string, unknown>, key: string, fallback = ''): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

function requiredStringField(body: Record<string, unknown>, key: string, maximum: number): string {
  const value = stringField(body, key);
  if (!value) throw new ApiError(400, `${key} is required`);
  if (value.length > maximum) throw new ApiError(400, `${key} exceeds ${maximum} characters`);
  return value;
}

function nullableStringField(body: Record<string, unknown>, key: string): string | null {
  const value = stringField(body, key);
  return value || null;
}

function patchedNullableString(body: Record<string, unknown>, key: string, current: string | null): string | null {
  if (!(key in body)) return current;
  if (body[key] === null) return null;
  if (typeof body[key] !== 'string') throw new ApiError(400, `${key} must be a string or null`);
  return String(body[key]).trim() || null;
}

function normalizeContentStatus(value: string): string {
  if (value && value !== 'draft' && value !== 'published') throw new ApiError(400, 'status must be draft or published');
  return value === 'published' ? 'published' : 'draft';
}

function normalizeActiveStatus(value: string): string {
  if (value && value !== 'active' && value !== 'inactive') throw new ApiError(400, 'status must be active or inactive');
  return value === 'inactive' ? 'inactive' : 'active';
}

function assertLogoKey(value: string | null): string | null {
  if (!value) return null;
  if (!/^logos\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(value)) throw new ApiError(400, 'logo_url must be a managed image key');
  return value;
}

function assertContentImageKey(value: string | null): string | null {
  if (!value) return null;
  if (!/^content\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(value)) {
    throw new ApiError(400, 'featured_image_url must be a managed content image key');
  }
  return value;
}

function optionalIsoDate(value: string | null, key: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ApiError(400, `${key} must be a valid ISO date`);
  return new Date(timestamp).toISOString();
}

function numberField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const value = body[key];
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new ApiError(400, `${key} must be a finite number`);
  return numberValue;
}

function nonNegativeNumberField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const value = numberField(body, key, fallback);
  if (value < 0) throw new ApiError(400, `${key} must be zero or greater`);
  return value;
}

function optionalNumberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new ApiError(400, `${key} must be a finite number`);
  return numberValue;
}

function binaryFlagField(body: Record<string, unknown>, key: string, fallback: number): number {
  const value = numberField(body, key, fallback);
  if (value !== 0 && value !== 1) throw new ApiError(400, `${key} must be 0 or 1`);
  return value;
}

function detectImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { mime: 'image/gif', extension: 'gif' };
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

function numberArrayField(body: Record<string, unknown>, key: string): number[] | null {
  const value = body[key];
  if (!Array.isArray(value)) return null;
  const numbers = [...new Set(value.map((item) => Number(item)))];
  if (numbers.some((item) => !Number.isInteger(item) || item < 1)) throw new ApiError(400, `${key} must contain positive integer IDs`);
  return numbers;
}

async function apiProvidersWithTags(db: D1Database, providers: Provider[], activeCardsOnly = false): Promise<ProviderWithTags[]> {
  if (!providers.length) return [];
  const placeholders = providers.map(() => '?').join(',');
  const ids = providers.map((provider) => provider.id);
  const [tagRows, countRows] = await Promise.all([
    db.prepare(
      `SELECT pt.provider_id, t.* FROM vcc_provider_tags pt INNER JOIN vcc_tags t ON t.id = pt.tag_id WHERE pt.provider_id IN (${placeholders}) ORDER BY t.category, t.id`
    ).bind(...ids).all<Tag & { provider_id: number }>(),
    db.prepare(
      `SELECT provider_id, COUNT(*) AS card_count FROM vcc_cards WHERE provider_id IN (${placeholders})${activeCardsOnly ? ' AND status = ?' : ''} GROUP BY provider_id`
    ).bind(...ids, ...(activeCardsOnly ? ['active'] : [])).all<{ provider_id: number; card_count: number }>(),
  ]);
  const tagsByProvider = new Map<number, Tag[]>();
  for (const row of tagRows.results) {
    const tags = tagsByProvider.get(row.provider_id) || [];
    const { provider_id: _providerId, ...tag } = row;
    tags.push(tag);
    tagsByProvider.set(row.provider_id, tags);
  }
  const counts = new Map(countRows.results.map((row) => [row.provider_id, row.card_count]));
  return providers.map((provider) => ({
    ...provider,
    tags: tagsByProvider.get(provider.id) || [],
    card_count: counts.get(provider.id) || 0,
  }));
}

async function validateTagIds(db: D1Database, tagIds: number[] | null): Promise<void> {
  if (!tagIds?.length) return;
  if (tagIds.length) {
    const placeholders = tagIds.map(() => '?').join(',');
    const existing = await db.prepare(`SELECT id FROM vcc_tags WHERE id IN (${placeholders})`).bind(...tagIds).all<{ id: number }>();
    if (existing.results.length !== tagIds.length) throw new ApiError(400, 'tag_ids contains an unknown tag');
  }
}

async function updateProviderTags(db: D1Database, providerId: number, tagIds: number[] | null): Promise<void> {
  if (!tagIds) return;
  await validateTagIds(db, tagIds);
  await db.batch([
    db.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(providerId),
    ...tagIds.map((tagId) => db.prepare('INSERT INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(providerId, tagId)),
  ]);
}

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) return c.json({ error: 'A record with the same unique value already exists' }, 409);
  if (/FOREIGN KEY constraint failed/i.test(message)) return c.json({ error: 'A referenced record does not exist' }, 400);
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

function siteOrigin(c: Context<Env>): string {
  const configured = c.env.SITE_URL?.replace(/\/+$/, '');
  if (configured && configured !== 'https://example.com') return configured;
  return new URL(c.req.url).origin;
}

function absoluteUrl(c: Context<Env>, path: string): string {
  return `${siteOrigin(c)}${path.startsWith('/') ? path : `/${path}`}`;
}

function baseJsonLd(c: Context<Env>, lang: Lang) {
  const origin = siteOrigin(c);
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': `${origin}/#organization`,
      name: t('site.title', lang),
      url: origin,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': `${origin}/#website`,
      name: t('site.title', lang),
      url: origin,
      publisher: { '@id': `${origin}/#organization` },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${origin}/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

function breadcrumbJsonLd(c: Context<Env>, items: { name: string; path: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(c, item.path),
    })),
  };
}

export function publicPageNumber(value: string | undefined): number | null {
  if (!value) return 1;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : null;
}

export function pageUrl(path: string, page: number, query: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, value);
  if (page > 1) params.set('page', String(page));
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function Pagination({ path, page, totalPages, query, lang }: {
  path: string;
  page: number;
  totalPages: number;
  query?: Record<string, string>;
  lang: Lang;
}) {
  if (totalPages <= 1) return null;
  const first = Math.max(1, page - 2);
  const last = Math.min(totalPages, page + 2);
  const pages = Array.from({ length: last - first + 1 }, (_, index) => first + index);
  return (
    <nav class="mt-12 flex flex-wrap items-center justify-center gap-2" aria-label={lang === 'zh' ? '分页导航' : 'Pagination'}>
      {page > 1 && (
        <a rel="prev" href={pageUrl(path, page - 1, query)} class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-brand-200 hover:text-brand-600">
          &larr; {t('common.previous', lang)}
        </a>
      )}
      {first > 1 && <span class="px-2 text-slate-400">…</span>}
      {pages.map((number) => (
        <a
          href={pageUrl(path, number, query)}
          aria-current={number === page ? 'page' : undefined}
          class={`flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors ${number === page ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-600'}`}
        >
          {number}
        </a>
      ))}
      {last < totalPages && <span class="px-2 text-slate-400">…</span>}
      {page < totalPages && (
        <a rel="next" href={pageUrl(path, page + 1, query)} class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-brand-200 hover:text-brand-600">
          {t('common.next', lang)} &rarr;
        </a>
      )}
    </nav>
  );
}

function CardTile({ card, lang }: { card: CardWithProvider; lang: Lang }) {
  const name = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;
  return (
    <a href={`/card/${card.slug}`} class="card-hover group relative block overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-6 shadow-soft">
      <span class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-500 via-brand-400 to-accent-400 opacity-0 transition-opacity group-hover:opacity-100"></span>
      <div class="mb-5 flex items-center justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          {card.provider_logo_url ? (
            <img src={`/images/${card.provider_logo_url}`} alt="" width="44" height="44" loading="lazy" class="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-accent-50 font-bold text-brand-700 ring-1 ring-brand-100">{name.charAt(0)}</div>
          )}
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-slate-500">{name}</div>
            <h3 class="font-mono text-lg font-bold tracking-tight text-slate-950">{card.bin}</h3>
          </div>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5">
          {card.is_featured === 1 && <span class="status-featured">{t('home.pinned', lang)}</span>}
          <span class={`rounded-lg px-2.5 py-1 text-xs font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>{card.card_type}</span>
        </div>
      </div>
      <div class="grid grid-cols-3 gap-2 rounded-2xl bg-slate-50/90 p-3 text-center ring-1 ring-slate-100">
        <div><div class="text-[11px] text-slate-400">{t('card.issuance_fee', lang)}</div><div class="mt-1 font-bold text-slate-900">{card.issuance_fee === 0 ? t('common.free', lang) : `$${card.issuance_fee}`}</div></div>
        <div class="border-x border-slate-200"><div class="text-[11px] text-slate-400">{t('card.fee_rate', lang)}</div><div class="mt-1 font-bold text-slate-900">{card.fee_rate}%</div></div>
        <div><div class="text-[11px] text-slate-400">{t('card.currency', lang)}</div><div class="mt-1 font-bold text-slate-900">{card.currency}</div></div>
      </div>
      <div class="mt-4 flex items-center justify-between gap-3 text-sm">
        <span class="truncate text-slate-500">{card.usage || t('common.na', lang)}</span>
        <span class="shrink-0 font-medium text-brand-600 group-hover:translate-x-0.5">{t('provider.view_detail', lang)} &rarr;</span>
      </div>
    </a>
  );
}

function ArticleTile({ post, lang, prominent = false }: { post: ContentPost; lang: Lang; prominent?: boolean }) {
  return (
    <article class="card-hover group overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-soft">
      <a href={`/content/${post.slug}`} class="block">
        {post.featured_image_url ? (
          <img src={`/images/${post.featured_image_url}`} alt={contentTitle(post, lang)} width="720" height="405" loading="lazy" class={`w-full object-cover ${prominent ? 'aspect-[16/9]' : 'aspect-[16/8]'}`} />
        ) : (
          <div class={`relative flex w-full items-end overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-accent-500 p-5 ${prominent ? 'aspect-[16/9]' : 'aspect-[16/8]'}`}><span class="absolute -right-8 -top-8 h-32 w-32 rounded-full border-[24px] border-white/10"></span><span class="relative text-xs font-bold uppercase tracking-[.18em] text-white/90">VCC INSIGHTS</span></div>
        )}
        <div class="p-5">
          <div class="flex items-center justify-between gap-3">
            {post.published_at && <time datetime={post.published_at} class="text-xs font-medium text-slate-400">{post.published_at.slice(0, 10)}</time>}
            {post.is_featured === 1 && <span class="status-featured">{t('home.pinned', lang)}</span>}
          </div>
          <h3 class={`${prominent ? 'mt-2 text-xl' : 'mt-2 text-lg'} font-bold leading-snug tracking-tight text-slate-950 transition-colors group-hover:text-brand-600`}>{contentTitle(post, lang)}</h3>
          <p class="mt-3 line-clamp-2 text-sm leading-6 text-slate-500">{contentExcerpt(post, lang)}</p>
          <span class="mt-4 inline-block text-sm font-medium text-brand-600">{t('content.read_more', lang)} &rarr;</span>
        </div>
      </a>
    </article>
  );
}

// ==========================================
// Language Switch
// ==========================================
app.get('/lang/:lang', (c) => {
  const lang = c.req.param('lang');
  if (lang !== 'zh' && lang !== 'en') return c.redirect('/');
  setCookie(c, 'lang', lang, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
  });
  const current = new URL(c.req.url);
  const referer = new URL(c.req.header('Referer') || '/', current);
  return c.redirect(referer.origin === current.origin ? `${referer.pathname}${referer.search}${referer.hash}` : '/');
});

// ==========================================
// R2 Image Proxy
// ==========================================
app.get('/images/*', async (c) => {
  const key = c.req.path.replace('/images/', '');
  const object = await c.env.R2.get(key);
  if (!object) return c.notFound();
  const contentType = object.httpMetadata?.contentType || '';
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(contentType)) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.httpEtag);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(object.body, { headers });
});

app.get('/robots.txt', (c) => {
  const body = `User-agent: *
Allow: /
Disallow: /api/admin

Sitemap: ${absoluteUrl(c, '/sitemap.xml')}
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
});

// ==========================================
// Hermes Agent API
// ==========================================
app.use('/api/admin/*', bodyLimit({
  maxSize: 2 * 1024 * 1024,
  onError: (c) => c.json({ error: 'Request body exceeds 2 MiB' }, 413),
}));

app.use('/api/admin/*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const unauthorized = requireHermesAuth(c);
  if (unauthorized) return unauthorized;
  await next();
});

app.get('/api/admin/content', async (c) => {
  const status = c.req.query('status');
  const featured = c.req.query('featured');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const params: unknown[] = [];
  let query = 'SELECT * FROM content_posts';
  const where: string[] = [];

  if (status === 'draft' || status === 'published') {
    where.push('status = ?');
    params.push(status);
  }

  if (featured === '0' || featured === '1') {
    where.push('is_featured = ?');
    params.push(Number(featured));
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')}`;

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all<ContentPost>();
  return c.json({ results: posts.results });
});

app.get('/api/admin/content/:id', async (c) => {
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(c.req.param('id')).first<ContentPost>();
  if (!post) return c.json({ error: 'Content not found' }, 404);
  return c.json(post);
});

app.post('/api/admin/content', async (c) => {
  const body = await parseJsonBody(c);
  const titleZh = requiredStringField(body, 'title_zh', 200);
  const titleEn = requiredStringField(body, 'title_en', 200);
  const bodyZh = requiredStringField(body, 'body_zh', 100000);
  const bodyEn = requiredStringField(body, 'body_en', 100000);
  const slug = assertSlug(stringField(body, 'slug') || generateSlug(titleEn));
  const status = normalizeContentStatus(stringField(body, 'status'));
  const isFeatured = binaryFlagField(body, 'is_featured', 0);
  const featuredImageUrl = assertContentImageKey(nullableStringField(body, 'featured_image_url'));
  const publishedAt = status === 'published'
    ? (optionalIsoDate(nullableStringField(body, 'published_at'), 'published_at') || new Date().toISOString())
    : null;
  const result = await c.env.DB.prepare(
    'INSERT INTO content_posts (title_zh, title_en, slug, excerpt_zh, excerpt_en, body_zh, body_en, status, is_featured, featured_image_url, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    titleZh, titleEn, slug, nullableStringField(body, 'excerpt_zh'), nullableStringField(body, 'excerpt_en'),
    bodyZh, bodyEn, status, isFeatured, featuredImageUrl, publishedAt
  ).run();

  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(result.meta.last_row_id).first<ContentPost>();
  return c.json(post, 201);
});

app.put('/api/admin/content/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  if (!existing) return c.json({ error: 'Content not found' }, 404);

  const body = await parseJsonBody(c);
  const status = normalizeContentStatus(stringField(body, 'status', existing.status));
  const publishedAt = status === 'published'
    ? (optionalIsoDate(patchedNullableString(body, 'published_at', existing.published_at), 'published_at') || new Date().toISOString())
    : null;
  const titleZh = stringField(body, 'title_zh', existing.title_zh);
  const titleEn = stringField(body, 'title_en', existing.title_en);
  const bodyZh = stringField(body, 'body_zh', existing.body_zh);
  const bodyEn = stringField(body, 'body_en', existing.body_en);
  if (!titleZh || !titleEn || !bodyZh || !bodyEn) throw new ApiError(400, 'Bilingual titles and bodies cannot be empty');

  await c.env.DB.prepare(
    `UPDATE content_posts SET title_zh = ?, title_en = ?, slug = ?, excerpt_zh = ?, excerpt_en = ?, body_zh = ?, body_en = ?, status = ?, is_featured = ?, featured_image_url = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    titleZh,
    titleEn,
    assertSlug(stringField(body, 'slug', existing.slug)),
    patchedNullableString(body, 'excerpt_zh', existing.excerpt_zh),
    patchedNullableString(body, 'excerpt_en', existing.excerpt_en),
    bodyZh,
    bodyEn,
    status,
    binaryFlagField(body, 'is_featured', existing.is_featured),
    assertContentImageKey(patchedNullableString(body, 'featured_image_url', existing.featured_image_url)),
    publishedAt,
    id
  ).run();

  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  return c.json(post);
});

app.delete('/api/admin/content/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM content_posts WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.post('/api/admin/images', async (c) => {
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > 2 * 1024 * 1024) throw new ApiError(413, 'Image exceeds 2 MiB');
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw new ApiError(415, 'Content-Type must be multipart/form-data');
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'file is required');
  if (file.size > 2 * 1024 * 1024) throw new ApiError(413, 'Image exceeds 2 MiB');
  const buffer = await file.arrayBuffer();
  const detected = detectImageType(new Uint8Array(buffer));
  if (!detected || detected.mime !== file.type) throw new ApiError(415, 'File content must be a valid PNG, JPEG, WebP, or GIF image');
  const kindParam = c.req.query('kind');
  if (kindParam && kindParam !== 'content' && kindParam !== 'logo' && kindParam !== 'logos') throw new ApiError(400, 'kind must be content or logo');
  const kind = kindParam === 'content' ? 'content' : 'logos';
  const key = `${kind}/${crypto.randomUUID()}.${detected.extension}`;
  await c.env.R2.put(key, buffer, { httpMetadata: { contentType: detected.mime } });
  return c.json({ key, url: absoluteUrl(c, `/images/${key}`) }, 201);
});

app.delete('/api/admin/images/*', async (c) => {
  const key = c.req.path.replace('/api/admin/images/', '');
  if (!/^(?:logos|content)\/[a-f0-9-]+\.(?:png|jpg|webp|gif)$/i.test(key)) throw new ApiError(400, 'Invalid managed image key');
  await c.env.R2.delete(key);
  return c.json({ ok: true });
});

app.get('/api/admin/providers', async (c) => {
  const status = c.req.query('status');
  const limit = parseLimit(c.req.query('limit'), 100, 200);
  const params: unknown[] = [];
  let query = 'SELECT * FROM vcc_providers';

  if (status === 'active' || status === 'inactive') {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const providers = await c.env.DB.prepare(query).bind(...params).all<Provider>();
  const results = await apiProvidersWithTags(c.env.DB, providers.results);
  return c.json({ results });
});

app.get('/api/admin/providers/:id', async (c) => {
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(c.req.param('id')).first<Provider>();
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json((await apiProvidersWithTags(c.env.DB, [provider]))[0]);
});

app.post('/api/admin/providers', async (c) => {
  const body = await parseJsonBody(c);
  const nameZh = requiredStringField(body, 'name_zh', 120);
  const nameEn = requiredStringField(body, 'name_en', 120);
  const slug = assertSlug(stringField(body, 'slug') || generateSlug(nameEn));
  const tagIds = numberArrayField(body, 'tag_ids');
  await validateTagIds(c.env.DB, tagIds);

  const result = await c.env.DB.prepare(
    'INSERT INTO vcc_providers (name_zh, name_en, website, founded_date, apply_method, desc_zh, desc_en, need_kyc, region, status, logo_url, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    nameZh,
    nameEn,
    assertSafeWebsite(nullableStringField(body, 'website')),
    nullableStringField(body, 'founded_date'),
    nullableStringField(body, 'apply_method'),
    nullableStringField(body, 'desc_zh'),
    nullableStringField(body, 'desc_en'),
    binaryFlagField(body, 'need_kyc', 0),
    nullableStringField(body, 'region'),
    normalizeActiveStatus(stringField(body, 'status')),
    assertLogoKey(nullableStringField(body, 'logo_url')),
    slug
  ).run();

  const providerId = Number(result.meta.last_row_id);
  await updateProviderTags(c.env.DB, providerId, tagIds);
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(providerId).first<Provider>();
  return c.json(provider ? (await apiProvidersWithTags(c.env.DB, [provider]))[0] : null, 201);
});

app.put('/api/admin/providers/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>();
  if (!existing) return c.json({ error: 'Provider not found' }, 404);

  const body = await parseJsonBody(c);
  const nameZh = stringField(body, 'name_zh', existing.name_zh);
  const nameEn = stringField(body, 'name_en', existing.name_en);
  const tagIds = numberArrayField(body, 'tag_ids');
  await validateTagIds(c.env.DB, tagIds);
  if (!nameZh || !nameEn) throw new ApiError(400, 'Bilingual provider names cannot be empty');
  const update = c.env.DB.prepare(
    `UPDATE vcc_providers SET name_zh = ?, name_en = ?, website = ?, founded_date = ?, apply_method = ?, desc_zh = ?, desc_en = ?, need_kyc = ?, region = ?, status = ?, logo_url = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    nameZh,
    nameEn,
    assertSafeWebsite(patchedNullableString(body, 'website', existing.website)),
    patchedNullableString(body, 'founded_date', existing.founded_date),
    patchedNullableString(body, 'apply_method', existing.apply_method),
    patchedNullableString(body, 'desc_zh', existing.desc_zh),
    patchedNullableString(body, 'desc_en', existing.desc_en),
    binaryFlagField(body, 'need_kyc', existing.need_kyc),
    patchedNullableString(body, 'region', existing.region),
    normalizeActiveStatus(stringField(body, 'status', existing.status)),
    assertLogoKey(patchedNullableString(body, 'logo_url', existing.logo_url)),
    assertSlug(stringField(body, 'slug', existing.slug)),
    id
  );

  if (tagIds) {
    await c.env.DB.batch([
      update,
      c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(id),
      ...tagIds.map((tagId) => c.env.DB.prepare('INSERT INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(id, tagId)),
    ]);
  } else {
    await update.run();
  }
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>();
  return c.json(provider ? (await apiProvidersWithTags(c.env.DB, [provider]))[0] : null);
});

app.delete('/api/admin/providers/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_cards WHERE provider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_providers WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

app.get('/api/admin/cards', async (c) => {
  const status = c.req.query('status');
  const featured = c.req.query('featured');
  const providerId = c.req.query('provider_id');
  const limit = parseLimit(c.req.query('limit'), 100, 200);
  const params: unknown[] = [];
  let query = 'SELECT * FROM vcc_cards';
  const where: string[] = [];

  if (status === 'active' || status === 'inactive') {
    where.push('status = ?');
    params.push(status);
  }
  if (providerId) {
    if (!/^\d+$/.test(providerId)) throw new ApiError(400, 'provider_id must be a positive integer');
    where.push('provider_id = ?');
    params.push(providerId);
  }
  if (featured === '0' || featured === '1') {
    where.push('is_featured = ?');
    params.push(Number(featured));
  }
  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const cards = await c.env.DB.prepare(query).bind(...params).all<Card>();
  return c.json({ results: cards.results });
});

app.get('/api/admin/cards/:id', async (c) => {
  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(c.req.param('id')).first<Card>();
  if (!card) return c.json({ error: 'Card not found' }, 404);
  return c.json(card);
});

app.post('/api/admin/cards', async (c) => {
  const body = await parseJsonBody(c);
  const providerId = optionalNumberField(body, 'provider_id');
  const bin = requiredStringField(body, 'bin', 19);
  const cardType = requiredStringField(body, 'card_type', 40);
  if (!providerId || !Number.isInteger(providerId) || providerId < 1) throw new ApiError(400, 'provider_id must be a positive integer');
  if (!/^\d{6,19}$/.test(bin)) throw new ApiError(400, 'bin must contain 6 to 19 digits');
  const provider = await c.env.DB.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(providerId).first<{ slug: string }>();
  if (!provider) throw new ApiError(400, 'provider_id does not exist');

  let slug = stringField(body, 'slug');
  if (!slug) slug = `${provider.slug}-${bin}`;
  assertSlug(slug);
  const currency = stringField(body, 'currency', 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a three-letter code');

  const result = await c.env.DB.prepare(
    'INSERT INTO vcc_cards (provider_id, bin, card_type, currency, issuance_fee, fee_rate, monthly_fee, initial_load, quota, usage, description, status, is_featured, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    providerId,
    bin,
    cardType,
    currency,
    nonNegativeNumberField(body, 'issuance_fee', 0),
    nonNegativeNumberField(body, 'fee_rate', 0),
    nonNegativeNumberField(body, 'monthly_fee', 0),
    nonNegativeNumberField(body, 'initial_load', 0),
    nullableStringField(body, 'quota'),
    nullableStringField(body, 'usage'),
    nullableStringField(body, 'description'),
    normalizeActiveStatus(stringField(body, 'status')),
    binaryFlagField(body, 'is_featured', 0),
    slug
  ).run();

  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(result.meta.last_row_id).first<Card>();
  return c.json(card, 201);
});

app.put('/api/admin/cards/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>();
  if (!existing) return c.json({ error: 'Card not found' }, 404);

  const body = await parseJsonBody(c);
  const providerId = optionalNumberField(body, 'provider_id') ?? existing.provider_id;
  if (!Number.isInteger(providerId) || providerId < 1) throw new ApiError(400, 'provider_id must be a positive integer');
  const provider = await c.env.DB.prepare('SELECT id FROM vcc_providers WHERE id = ?').bind(providerId).first<{ id: number }>();
  if (!provider) throw new ApiError(400, 'provider_id does not exist');
  const bin = stringField(body, 'bin', existing.bin);
  if (!/^\d{6,19}$/.test(bin)) throw new ApiError(400, 'bin must contain 6 to 19 digits');
  const currency = stringField(body, 'currency', existing.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a three-letter code');
  await c.env.DB.prepare(
    'UPDATE vcc_cards SET provider_id = ?, bin = ?, card_type = ?, currency = ?, issuance_fee = ?, fee_rate = ?, monthly_fee = ?, initial_load = ?, quota = ?, usage = ?, description = ?, status = ?, is_featured = ?, slug = ? WHERE id = ?'
  ).bind(
    providerId,
    bin,
    stringField(body, 'card_type', existing.card_type),
    currency,
    nonNegativeNumberField(body, 'issuance_fee', existing.issuance_fee),
    nonNegativeNumberField(body, 'fee_rate', existing.fee_rate),
    nonNegativeNumberField(body, 'monthly_fee', existing.monthly_fee),
    nonNegativeNumberField(body, 'initial_load', existing.initial_load),
    patchedNullableString(body, 'quota', existing.quota),
    patchedNullableString(body, 'usage', existing.usage),
    patchedNullableString(body, 'description', existing.description),
    normalizeActiveStatus(stringField(body, 'status', existing.status)),
    binaryFlagField(body, 'is_featured', existing.is_featured),
    assertSlug(stringField(body, 'slug', existing.slug)),
    id
  ).run();

  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>();
  return c.json(card);
});

app.delete('/api/admin/cards/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM vcc_cards WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

app.get('/api/admin/tags', async (c) => {
  const tags = await c.env.DB.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>();
  return c.json({ results: tags.results });
});

app.get('/api/admin/tags/:id', async (c) => {
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(c.req.param('id')).first<Tag>();
  if (!tag) return c.json({ error: 'Tag not found' }, 404);
  return c.json(tag);
});

app.post('/api/admin/tags', async (c) => {
  const body = await parseJsonBody(c);
  const nameZh = requiredStringField(body, 'name_zh', 80);
  const nameEn = requiredStringField(body, 'name_en', 80);

  const result = await c.env.DB.prepare('INSERT INTO vcc_tags (name_zh, name_en, category) VALUES (?, ?, ?)').bind(
    nameZh,
    nameEn,
    nullableStringField(body, 'category')
  ).run();
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(result.meta.last_row_id).first<Tag>();
  return c.json(tag, 201);
});

app.put('/api/admin/tags/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(id).first<Tag>();
  if (!existing) return c.json({ error: 'Tag not found' }, 404);

  const body = await parseJsonBody(c);
  await c.env.DB.prepare('UPDATE vcc_tags SET name_zh = ?, name_en = ?, category = ? WHERE id = ?').bind(
    stringField(body, 'name_zh', existing.name_zh),
    stringField(body, 'name_en', existing.name_en),
    patchedNullableString(body, 'category', existing.category),
    id
  ).run();
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(id).first<Tag>();
  return c.json(tag);
});

app.delete('/api/admin/tags/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE tag_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_tags WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// ==========================================
// Homepage
// ==========================================
app.get('/', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const cardSelect = `SELECT c.*, p.name_zh AS provider_name_zh, p.name_en AS provider_name_en, p.slug AS provider_slug, p.logo_url AS provider_logo_url
    FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id
    WHERE c.status = ? AND p.status = ?`;

  const [providerCount, cardCount, tagCount, homepageCards, homepagePosts] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS c FROM vcc_providers WHERE status = ?').bind('active').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM vcc_cards WHERE status = ?').bind('active').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) AS c FROM vcc_tags').first<{ c: number }>(),
    db.prepare(`${cardSelect} ORDER BY c.is_featured DESC, c.created_at DESC LIMIT 6`).bind('active', 'active').all<CardWithProvider>(),
    db.prepare('SELECT * FROM content_posts WHERE status = ? ORDER BY is_featured DESC, published_at DESC LIMIT 6').bind('published').all<ContentPost>(),
  ]);

  const jsonLd = [
    ...baseJsonLd(c, lang),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('home.cards', lang),
      numberOfItems: homepageCards.results.length,
      itemListElement: homepageCards.results.map((card, index) => ({
        '@type': 'ListItem', position: index + 1, url: absoluteUrl(c, `/card/${card.slug}`), name: `${card.provider_name_en} ${card.bin}`,
      })),
    },
  ];

  return c.html(
    <Layout title={t('home.hero.title', lang)} description={t('site.description', lang)} lang={lang} canonicalUrl={absoluteUrl(c, '/')} jsonLd={jsonLd}>
      <section class="relative overflow-hidden bg-slate-950 text-white">
        <div class="absolute inset-0" style="background-image: radial-gradient(circle at 12% 10%, rgba(99,102,241,.52), transparent 30rem), radial-gradient(circle at 88% 65%, rgba(6,182,212,.3), transparent 30rem);"></div>
        <div class="absolute inset-0 opacity-[.08]" style="background-image: linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px); background-size: 44px 44px;"></div>
        <div class="relative page-shell grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:py-28">
          <div>
            <span class="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold tracking-wide text-brand-100 backdrop-blur"><span class="h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_0_4px_rgba(34,211,238,.12)]"></span>VCC Directory · Independent Comparison</span>
            <h1 class="max-w-3xl text-4xl font-bold tracking-[-.04em] sm:text-5xl md:text-6xl lg:text-7xl">{t('home.hero.title', lang)}</h1>
            <p class="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">{t('home.hero.desc', lang)}</p>
            <div class="mt-9 flex flex-wrap gap-3">
            <a href="/cards" class="rounded-2xl bg-white px-6 py-3.5 font-bold text-brand-700 shadow-xl shadow-black/20 transition-transform hover:-translate-y-0.5 hover:bg-brand-50">{t('home.view_all_cards', lang)} &rarr;</a>
            <a href="/content" class="rounded-2xl border border-white/20 bg-white/10 px-6 py-3.5 font-bold text-white backdrop-blur transition-colors hover:bg-white/15">{t('nav.content', lang)}</a>
            </div>
          </div>
          <div class="relative mx-auto hidden w-full max-w-md lg:block" aria-hidden="true">
            <div class="absolute -inset-10 rounded-full bg-brand-500/20 blur-3xl"></div>
            <div class="relative rotate-2 rounded-[2rem] border border-white/15 bg-white/10 p-3 shadow-2xl shadow-black/30 backdrop-blur-xl">
              <div class="rounded-[1.4rem] border border-white/10 bg-gradient-to-br from-brand-600/90 via-brand-700/90 to-slate-900 p-7">
                <div class="flex items-center justify-between"><span class="text-sm font-bold tracking-wide text-white">VCC DIRECTORY</span><span class="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-[10px] font-bold tracking-widest text-accent-100">VIRTUAL</span></div>
                <div class="mt-14 font-mono text-2xl font-semibold tracking-[.12em] text-white">{homepageCards.results[0]?.bin || '•••• ••••'}</div>
                <div class="mt-8 flex items-end justify-between"><div><div class="text-[10px] uppercase tracking-widest text-brand-200">{lang === 'zh' ? '服务商' : 'Provider'}</div><div class="mt-1 text-sm font-semibold text-white">{homepageCards.results[0] ? (lang === 'zh' ? homepageCards.results[0].provider_name_zh : homepageCards.results[0].provider_name_en) : 'VCC Directory'}</div></div><div class="flex h-10 w-14 items-center justify-center rounded-xl bg-white/10 text-xs font-black text-white">{homepageCards.results[0]?.card_type || 'VCC'}</div></div>
              </div>
            </div>
            <div class="absolute -bottom-8 -left-8 -rotate-3 rounded-2xl border border-white/15 bg-slate-900/80 px-5 py-4 shadow-xl backdrop-blur"><div class="text-xs text-slate-400">{t('home.stats.cards', lang)}</div><div class="mt-1 text-2xl font-black text-white">{cardCount?.c || 0}<span class="ml-2 text-xs font-semibold text-accent-300">Verified</span></div></div>
          </div>
        </div>
      </section>

      <section class="relative z-10 mx-auto -mt-8 max-w-4xl px-4">
        <div class="grid grid-cols-3 overflow-hidden rounded-3xl border border-white bg-white/95 shadow-lift backdrop-blur">
          {[
            { label: t('home.stats.platforms', lang), value: providerCount?.c || 0 },
            { label: t('home.stats.cards', lang), value: cardCount?.c || 0 },
            { label: t('home.stats.tags', lang), value: tagCount?.c || 0 },
          ].map((stat, index) => (
            <div class={`px-3 py-5 text-center sm:p-6 ${index > 0 ? 'border-l border-slate-100' : ''}`}><div class="text-2xl font-black tracking-tight text-brand-600 sm:text-3xl">{stat.value}</div><div class="mt-1 text-[11px] font-medium text-slate-500 sm:text-sm">{stat.label}</div></div>
          ))}
        </div>
      </section>

      <section class="page-shell py-16 sm:py-20">
        <div class="mb-8 flex items-end justify-between gap-4"><div><p class="eyebrow mb-2">VIRTUAL CARDS</p><h2 class="section-title">{t('home.cards', lang)}</h2></div><a href="/cards" class="hidden rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 sm:block">{t('home.view_all_cards', lang)} &rarr;</a></div>
        <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{homepageCards.results.map((card) => <CardTile card={card} lang={lang} />)}</div>
      </section>

      <section class="border-y border-slate-200/70 bg-white/50">
        <div class="page-shell py-16 sm:py-20">
          <div class="mb-8 flex items-end justify-between gap-4"><div><p class="eyebrow mb-2">INDUSTRY NEWS</p><h2 class="section-title">{t('home.posts', lang)}</h2></div><a href="/content" class="hidden rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 sm:block">{t('home.view_all_posts', lang)} &rarr;</a></div>
          {homepagePosts.results.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{homepagePosts.results.map((post) => <ArticleTile post={post} lang={lang} />)}</div> : <div class="empty-state">{t('content.no_results', lang)}</div>}
        </div>
      </section>
    </Layout>
  );
});

// ==========================================
// Virtual Card Directory
// ==========================================
app.get('/cards', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const page = publicPageNumber(c.req.query('page'));
  const search = (c.req.query('q') || '').trim().slice(0, 100);
  if (!page) return c.redirect(pageUrl('/cards', 1, { q: search }), 301);

  const pageSize = 12;
  const where = ['c.status = ?', 'p.status = ?'];
  const params: unknown[] = ['active', 'active'];
  if (search) {
    where.push('(c.bin LIKE ? OR c.card_type LIKE ? OR c.currency LIKE ? OR c.usage LIKE ? OR c.description LIKE ? OR p.name_zh LIKE ? OR p.name_en LIKE ?)');
    const pattern = `%${search}%`;
    params.push(pattern, pattern, pattern, pattern, pattern, pattern, pattern);
  }
  const whereSql = where.join(' AND ');
  const [countRow, cardRows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS c FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id WHERE ${whereSql}`).bind(...params).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT c.*, p.name_zh AS provider_name_zh, p.name_en AS provider_name_en, p.slug AS provider_slug, p.logo_url AS provider_logo_url
      FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id
      WHERE ${whereSql} ORDER BY c.is_featured DESC, c.created_at DESC LIMIT ? OFFSET ?`
    ).bind(...params, pageSize, (page - 1) * pageSize).all<CardWithProvider>(),
  ]);
  const total = countRow?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    return c.html(<Layout title={t('cards.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, '/cards')} noIndex><div class="page-shell py-20"><div class="empty-state">{t('cards.no_results', lang)}</div></div></Layout>, 404);
  }

  const canonicalPath = search ? '/cards' : pageUrl('/cards', page);
  const title = page > 1 ? `${t('cards.title', lang)} - ${lang === 'zh' ? `第 ${page} 页` : `Page ${page}`}` : t('cards.title', lang);
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [{ name: t('nav.home', lang), path: '/' }, { name: t('cards.title', lang), path: '/cards' }]),
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: cardRows.results.length,
      itemListElement: cardRows.results.map((card, index) => ({ '@type': 'ListItem', position: (page - 1) * pageSize + index + 1, url: absoluteUrl(c, `/card/${card.slug}`), name: `${card.provider_name_en} ${card.bin}` })),
    },
  ];

  return c.html(
    <Layout
      title={title}
      description={t('cards.desc', lang)}
      lang={lang}
      canonicalUrl={absoluteUrl(c, canonicalPath)}
      noIndex={Boolean(search)}
      followWhenNoIndex={Boolean(search)}
      prevUrl={page > 1 ? absoluteUrl(c, pageUrl('/cards', page - 1, { q: search })) : undefined}
      nextUrl={page < totalPages ? absoluteUrl(c, pageUrl('/cards', page + 1, { q: search })) : undefined}
      jsonLd={jsonLd}
    >
      <section class="page-hero">
        <div class="page-shell py-14 sm:py-16">
          <nav class="mb-6 text-sm font-medium text-slate-400"><a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a><span class="mx-2 text-slate-300">/</span><span>{t('cards.title', lang)}</span></nav>
          <div class="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div><p class="eyebrow mb-2">VCC CATALOG</p><h1 class="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{t('cards.title', lang)}</h1><p class="mt-4 max-w-2xl leading-7 text-slate-500">{t('cards.desc', lang)}</p></div>
            <form method="get" action="/cards" class="flex w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70">
              <label for="card-search" class="sr-only">{t('cards.search', lang)}</label>
              <input id="card-search" type="search" name="q" value={search} placeholder={t('cards.search', lang)} class="min-w-0 flex-1 bg-transparent px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
              <button type="submit" class="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">{lang === 'zh' ? '搜索' : 'Search'}</button>
            </form>
          </div>
        </div>
      </section>
      <section class="page-shell py-12 sm:py-14">
        <div class="mb-7 flex items-center justify-between gap-3"><p class="text-sm text-slate-500"><span class="font-bold text-slate-950">{total}</span> {t('cards.results', lang)}</p>{search && <a href="/cards" class="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 hover:bg-brand-100">{lang === 'zh' ? '清除搜索' : 'Clear search'}</a>}</div>
        {cardRows.results.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{cardRows.results.map((card) => <CardTile card={card} lang={lang} />)}</div> : <div class="empty-state">{t('cards.no_results', lang)}</div>}
        <Pagination path="/cards" page={page} totalPages={totalPages} query={{ q: search }} lang={lang} />
      </section>
    </Layout>
  );
});

// ==========================================
// Provider Detail
// ==========================================
app.get('/provider/:slug', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const slug = c.req.param('slug');

  const provider = await db.prepare('SELECT * FROM vcc_providers WHERE slug = ? AND status = ?').bind(slug, 'active').first<Provider>();
  if (!provider) {
    return c.html(
      <Layout title={t('provider.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/provider/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('provider.not_found', lang)}</h1>
          <a href="/" class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const [cards, providerTags] = await Promise.all([
    db.prepare('SELECT * FROM vcc_cards WHERE provider_id = ? AND status = ? ORDER BY issuance_fee ASC').bind(provider.id, 'active').all<Card>(),
    db.prepare('SELECT t.* FROM vcc_tags t INNER JOIN vcc_provider_tags pt ON t.id = pt.tag_id WHERE pt.provider_id = ?').bind(provider.id).all<Tag>(),
  ]);

  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: '/' },
      { name: providerName(provider, lang), path: `/provider/${provider.slug}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: providerName(provider, lang),
      description: providerDesc(provider, lang),
      url: absoluteUrl(c, `/provider/${provider.slug}`),
      provider: {
        '@type': 'Organization',
        name: provider.name_en,
        url: provider.website,
        foundingDate: provider.founded_date,
      },
      offers: cards.results.map((card) => ({
        '@type': 'Offer',
        url: absoluteUrl(c, `/card/${card.slug}`),
        name: `${card.card_type} ${card.bin}`,
        priceCurrency: card.currency,
        price: card.issuance_fee,
      })),
    },
  ];

  return c.html(
    <Layout title={providerName(provider, lang)} description={providerDesc(provider, lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/provider/${provider.slug}`)} jsonLd={jsonLd}>
      <div class="page-shell py-10 sm:py-14">
        {/* Breadcrumb */}
        <nav class="breadcrumb mb-6">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <span class="text-slate-900">{providerName(provider, lang)}</span>
        </nav>

        {/* Provider Header */}
        <div class="surface-card relative mb-10 overflow-hidden p-6 sm:p-8">
          <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-500 to-accent-400"></div>
          <div class="flex flex-col items-start gap-5 sm:flex-row">
            {provider.logo_url ? (
              <img src={`/images/${provider.logo_url}`} alt={providerName(provider, lang)} class="h-16 w-16 rounded-2xl object-cover shadow-md ring-1 ring-slate-100" />
            ) : (
              <div class="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-accent-50 text-2xl font-bold text-brand-700 ring-1 ring-brand-100">
                {providerName(provider, lang).charAt(0)}
              </div>
            )}
            <div class="flex-1">
              <h1 class="mb-2 text-3xl font-bold tracking-tight text-slate-950">{providerName(provider, lang)}</h1>
              <p class="mb-5 max-w-3xl leading-7 text-slate-500">{providerDesc(provider, lang)}</p>
              <div class="flex flex-wrap gap-2 mb-4">
                {providerTags.results.map((tag) => (
                  <span class="px-2.5 py-1 bg-brand-50 text-brand-600 rounded-full text-xs font-medium">{tagName(tag, lang)}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div class="mt-7 grid grid-cols-2 gap-3 border-t border-slate-100 pt-7 md:grid-cols-4">
            {provider.website && (
              <div class="metric-tile">
                <div class="mb-1 text-xs text-slate-400">{t('provider.website', lang)}</div>
                <a href={provider.website} target="_blank" rel="noopener noreferrer" class="text-sm font-semibold text-brand-600 hover:underline">{t('common.visit', lang)} ↗</a>
              </div>
            )}
            {provider.founded_date && (
              <div class="metric-tile">
                <div class="mb-1 text-xs text-slate-400">{t('provider.founded', lang)}</div>
                <div class="text-sm font-semibold text-slate-900">{provider.founded_date}</div>
              </div>
            )}
            {provider.apply_method && (
              <div class="metric-tile">
                <div class="mb-1 text-xs text-slate-400">{t('provider.apply_method', lang)}</div>
                <div class="text-sm font-semibold text-slate-900">{provider.apply_method}</div>
              </div>
            )}
            <div class="metric-tile">
              <div class="mb-1 text-xs text-slate-400">{t('provider.kyc', lang)}</div>
              <div class="text-sm font-semibold text-slate-900">
                {provider.need_kyc ? (
                  <span class="text-amber-600">{t('provider.kyc_yes', lang)}</span>
                ) : (
                  <span class="text-green-600">{t('provider.kyc_no', lang)}</span>
                )}
              </div>
            </div>
            {provider.region && (
              <div class="metric-tile">
                <div class="mb-1 text-xs text-slate-400">{t('provider.region', lang)}</div>
                <div class="text-sm font-semibold text-slate-900">{provider.region}</div>
              </div>
            )}
          </div>
        </div>

        {/* Card BINs */}
        <div class="mb-6 flex items-end justify-between"><div><p class="eyebrow mb-2">AVAILABLE PRODUCTS</p><h2 class="section-title">{t('provider.cards', lang)}</h2></div><span class="rounded-full bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700">{cards.results.length}</span></div>
        {cards.results.length === 0 ? (
          <div class="empty-state">{t('home.no_results', lang)}</div>
        ) : (
          <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
            {cards.results.map((card) => (
              <a href={`/card/${card.slug}`} class="card-hover group block rounded-3xl border border-slate-200/70 bg-white p-6 shadow-soft">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center space-x-2">
                    <span class={`px-2 py-0.5 rounded text-xs font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {card.card_type}
                    </span>
                    <span class="font-mono font-bold text-slate-900 group-hover:text-brand-600">{card.bin}</span>
                  </div>
                  <span class="rounded-lg bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500">{card.currency}</span>
                </div>
                <div class="grid grid-cols-2 gap-3 rounded-2xl bg-slate-50/80 p-4 ring-1 ring-slate-100">
                  <div>
                    <div class="text-xs text-slate-400">{t('card.issuance_fee', lang)}</div>
                    <div class="text-sm font-semibold text-slate-900">
                      {card.issuance_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.issuance_fee}`}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-slate-400">{t('card.fee_rate', lang)}</div>
                    <div class="text-sm font-semibold text-slate-900">{card.fee_rate}%</div>
                  </div>
                  <div>
                    <div class="text-xs text-slate-400">{t('card.monthly_fee', lang)}</div>
                    <div class="text-sm font-semibold text-slate-900">
                      {card.monthly_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.monthly_fee}`}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-slate-400">{t('card.initial_load', lang)}</div>
                    <div class="text-sm font-semibold text-slate-900">${card.initial_load}</div>
                  </div>
                </div>
                {card.description && (
                  <div class="mt-4 line-clamp-2 text-sm leading-6 text-slate-500">{card.description}</div>
                )}
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
});

// ==========================================
// Card Detail
// ==========================================
app.get('/card/:slug', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const slug = c.req.param('slug');

  const card = await db.prepare(
    'SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en, p.slug as provider_slug, p.logo_url as provider_logo_url FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id WHERE c.slug = ? AND c.status = ? AND p.status = ?'
  ).bind(slug, 'active', 'active').first<CardWithProvider>();

  if (!card) {
    return c.html(
      <Layout title={t('card.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/card/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('card.not_found', lang)}</h1>
          <a href="/" class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const pName = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;

  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: '/' },
      { name: t('cards.title', lang), path: '/cards' },
      { name: `${card.card_type} ${card.bin}`, path: `/card/${card.slug}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: `${card.card_type} ${card.bin}`,
      description: cardMetaDescription(card, lang),
      url: absoluteUrl(c, `/card/${card.slug}`),
      provider: { '@type': 'Organization', name: card.provider_name_en },
      offers: {
        '@type': 'Offer',
        priceCurrency: card.currency,
        price: card.issuance_fee,
      },
    },
  ];

  return c.html(
    <Layout title={`${card.card_type} ${card.bin}`} description={cardMetaDescription(card, lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/card/${card.slug}`)} jsonLd={jsonLd}>
      <div class="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <nav class="breadcrumb mb-7">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href="/cards" class="hover:text-brand-600">{t('cards.title', lang)}</a>
          <span class="mx-2">/</span>
          <span class="text-slate-900">{card.bin}</span>
        </nav>

        <div class="surface-card relative overflow-hidden p-6 sm:p-9">
          <div class="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-brand-500 to-accent-400"></div>
          <div class="mb-8 flex items-center space-x-3">
            <span class={`px-3 py-1 rounded-lg text-sm font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
              {card.card_type}
            </span>
            <h1 class="font-mono text-3xl font-bold tracking-tight text-slate-950">{card.bin}</h1>
          </div>

          <div class="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div class="metric-tile">
              <div class="mb-1 text-xs text-slate-400">{t('card.issuance_fee', lang)}</div>
              <div class="text-xl font-bold text-slate-900">
                {card.issuance_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.issuance_fee}`}
              </div>
            </div>
            <div class="metric-tile">
              <div class="mb-1 text-xs text-slate-400">{t('card.fee_rate', lang)}</div>
              <div class="text-xl font-bold text-slate-900">{card.fee_rate}%</div>
            </div>
            <div class="metric-tile">
              <div class="mb-1 text-xs text-slate-400">{t('card.monthly_fee', lang)}</div>
              <div class="text-xl font-bold text-slate-900">
                {card.monthly_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.monthly_fee}`}
              </div>
            </div>
            <div class="metric-tile">
              <div class="mb-1 text-xs text-slate-400">{t('card.initial_load', lang)}</div>
              <div class="text-xl font-bold text-slate-900">${card.initial_load}</div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-5 border-t border-slate-100 pt-7 md:grid-cols-2">
            <div>
              <div class="mb-1 text-xs text-slate-400">{t('card.provider', lang)}</div>
              <a href={`/provider/${card.provider_slug}`} class="font-semibold text-brand-600 hover:underline">{pName}</a>
            </div>
            <div>
              <div class="mb-1 text-xs text-slate-400">{t('card.currency', lang)}</div>
              <div class="font-semibold text-slate-900">{card.currency}</div>
            </div>
            {card.quota && (
              <div>
                <div class="mb-1 text-xs text-slate-400">{t('card.quota', lang)}</div>
                <div class="font-semibold text-slate-900">{card.quota}</div>
              </div>
            )}
            {card.usage && (
              <div>
                <div class="mb-1 text-xs text-slate-400">{t('card.usage', lang)}</div>
                <div class="font-semibold text-slate-900">{card.usage}</div>
              </div>
            )}
          </div>
          {card.description && (
            <div class="mt-6 border-t border-slate-100 pt-6">
              <div class="mb-2 text-xs text-slate-400">{t('provider.description', lang)}</div>
              <p class="leading-7 text-slate-600">{card.description}</p>
            </div>
          )}
        </div>

        <div class="mt-7">
          <a href={`/provider/${card.provider_slug}`} class="button-secondary text-sm">&larr; {t('card.back_provider', lang)}</a>
        </div>
      </div>
    </Layout>
  );
});

// ==========================================
// Content
// ==========================================
app.get('/content', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const page = publicPageNumber(c.req.query('page'));
  if (!page) return c.redirect('/content', 301);
  const pageSize = 9;
  const [countRow, posts] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM content_posts WHERE status = ?').bind('published').first<{ c: number }>(),
    c.env.DB.prepare('SELECT * FROM content_posts WHERE status = ? ORDER BY published_at DESC, updated_at DESC LIMIT ? OFFSET ?').bind('published', pageSize, (page - 1) * pageSize).all<ContentPost>(),
  ]);
  const total = countRow?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    return c.html(<Layout title={t('content.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, '/content')} noIndex><div class="page-shell py-20"><div class="empty-state">{t('content.no_results', lang)}</div></div></Layout>, 404);
  }
  const canonicalPath = pageUrl('/content', page);
  const title = page > 1 ? `${t('content.title', lang)} - ${lang === 'zh' ? `第 ${page} 页` : `Page ${page}`}` : t('content.title', lang);
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [{ name: t('nav.home', lang), path: '/' }, { name: t('content.title', lang), path: '/content' }]),
    {
      '@context': 'https://schema.org', '@type': 'Blog', name: title, description: t('content.desc', lang), url: absoluteUrl(c, canonicalPath),
      blogPost: posts.results.map((post) => ({
        '@type': 'BlogPosting', headline: contentTitle(post, lang), url: absoluteUrl(c, `/content/${post.slug}`), datePublished: post.published_at, dateModified: post.updated_at,
        ...(post.featured_image_url ? { image: absoluteUrl(c, `/images/${post.featured_image_url}`) } : {}),
      })),
    },
  ];
  return c.html(
    <Layout
      title={title}
      description={t('content.desc', lang)}
      lang={lang}
      canonicalUrl={absoluteUrl(c, canonicalPath)}
      prevUrl={page > 1 ? absoluteUrl(c, pageUrl('/content', page - 1)) : undefined}
      nextUrl={page < totalPages ? absoluteUrl(c, pageUrl('/content', page + 1)) : undefined}
      jsonLd={jsonLd}
    >
      <section class="page-hero">
        <div class="page-shell py-14 sm:py-16">
          <nav class="mb-6 text-sm font-medium text-slate-400"><a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a><span class="mx-2 text-slate-300">/</span><span>{t('content.title', lang)}</span></nav>
          <p class="eyebrow mb-3">VCC INDUSTRY INSIGHTS</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{t('content.title', lang)}</h1>
          <p class="mt-4 max-w-2xl leading-7 text-slate-500">{t('content.desc', lang)}</p>
        </div>
      </section>
      <section class="page-shell py-12 sm:py-14">
        {posts.results.length ? <div class="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">{posts.results.map((post) => <ArticleTile post={post} lang={lang} prominent />)}</div> : <div class="empty-state">{t('content.no_results', lang)}</div>}
        <Pagination path="/content" page={page} totalPages={totalPages} lang={lang} />
      </section>
    </Layout>
  );
});

app.get('/content/:slug', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE slug = ? AND status = ?').bind(slug, 'published').first<ContentPost>();

  if (!post) {
    return c.html(
      <Layout title={t('content.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/content/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('content.not_found', lang)}</h1>
          <a href="/content" class="text-brand-600 hover:underline">{t('content.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const bodyHtml = contentBodyHtml(contentBody(post, lang));
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: '/' },
      { name: t('content.title', lang), path: '/content' },
      { name: contentTitle(post, lang), path: `/content/${post.slug}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: contentTitle(post, lang),
      description: contentExcerpt(post, lang),
      url: absoluteUrl(c, `/content/${post.slug}`),
      mainEntityOfPage: absoluteUrl(c, `/content/${post.slug}`),
      datePublished: post.published_at,
      dateModified: post.updated_at,
      publisher: { '@id': `${siteOrigin(c)}/#organization` },
      ...(post.featured_image_url ? { image: absoluteUrl(c, `/images/${post.featured_image_url}`) } : {}),
    },
  ];

  return c.html(
    <Layout title={contentTitle(post, lang)} description={contentExcerpt(post, lang)} lang={lang} canonicalUrl={absoluteUrl(c, `/content/${post.slug}`)} ogType="article" ogImage={post.featured_image_url ? absoluteUrl(c, `/images/${post.featured_image_url}`) : undefined} jsonLd={jsonLd}>
      <article class="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <nav class="breadcrumb mb-8">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href="/content" class="hover:text-brand-600">{t('content.title', lang)}</a>
        </nav>
        <header class="mb-10 text-center">
          <p class="eyebrow mb-4">{t('content.title', lang)}</p>
          <h1 class="text-3xl font-bold leading-[1.12] tracking-[-.035em] text-slate-950 md:text-5xl">{contentTitle(post, lang)}</h1>
          {post.published_at && <time datetime={post.published_at} class="mt-4 block text-sm font-medium text-slate-400">{post.published_at.slice(0, 10)}</time>}
          {contentExcerpt(post, lang) && <p class="mx-auto mt-6 max-w-2xl text-lg leading-8 text-slate-500">{contentExcerpt(post, lang)}</p>}
        </header>
        {post.featured_image_url && <img src={`/images/${post.featured_image_url}`} alt={contentTitle(post, lang)} width="960" height="540" class="mb-8 aspect-[16/9] w-full rounded-3xl object-cover shadow-lift" />}
        <div class="surface-card p-6 md:p-12">
          <div class="content-prose text-[1.02rem] leading-8 text-slate-700" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
        </div>
      </article>
    </Layout>
  );
});

// ==========================================
// Sitemap.xml
// ==========================================
app.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const origin = siteOrigin(c);

  const [providers, cards, posts] = await Promise.all([
    db.prepare('SELECT slug, updated_at FROM vcc_providers WHERE status = ? ORDER BY updated_at DESC').bind('active').all<{ slug: string; updated_at: string }>(),
    db.prepare('SELECT c.slug, c.created_at FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id WHERE c.status = ? AND p.status = ? ORDER BY c.created_at DESC').bind('active', 'active').all<{ slug: string; created_at: string }>(),
    db.prepare('SELECT slug, updated_at FROM content_posts WHERE status = ? ORDER BY published_at DESC').bind('published').all<{ slug: string; updated_at: string }>(),
  ]);

  const urls: string[] = [];

  // Homepage
  urls.push(`  <url>
    <loc>${origin}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`);

  urls.push(`  <url>
    <loc>${origin}/cards</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`);

  // Provider pages
  for (const p of providers.results) {
    const lastmod = p.updated_at ? `\n    <lastmod>${p.updated_at.split(' ')[0]}</lastmod>` : '';
    urls.push(`  <url>
    <loc>${origin}/provider/${p.slug}</loc>${lastmod}
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);
  }

  // Card pages
  for (const card of cards.results) {
    const lastmod = card.created_at ? `\n    <lastmod>${card.created_at.split(' ')[0]}</lastmod>` : '';
    urls.push(`  <url>
    <loc>${origin}/card/${card.slug}</loc>${lastmod}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`);
  }

  // Content pages
  urls.push(`  <url>
    <loc>${origin}/content</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`);

  for (const post of posts.results) {
    const lastmod = post.updated_at ? `\n    <lastmod>${post.updated_at.split(' ')[0]}</lastmod>` : '';
    urls.push(`  <url>
    <loc>${origin}/content/${post.slug}</loc>${lastmod}
    <changefreq>monthly</changefreq>
    <priority>0.6</priority>
  </url>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
  });
});
// ==========================================
// Export
// ==========================================
export { app };
export default app;

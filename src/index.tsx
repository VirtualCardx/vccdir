import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import { Layout } from './layout';
import { t, getLang } from './i18n';
import type { Provider, Card, Tag, ProviderWithTags, CardWithProvider, ContentPost, Lang } from './types';

type Env = { Bindings: CloudflareBindings };
const app = new Hono<Env>();

// ==========================================
// Helpers
// ==========================================
async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(bytes = 32): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  return base64Url(values);
}

function sessionSecret(c: Context<Env>): string {
  return c.env.SESSION_SECRET || c.env.ADMIN_PASSWORD;
}

function isSecureRequest(c: Context<Env>): boolean {
  return new URL(c.req.url).protocol === 'https:';
}

async function hmac(text: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text));
  return base64Url(new Uint8Array(signature));
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256
  );
  return bytesToHex(new Uint8Array(bits));
}

async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const iterations = 210000;
  return `pbkdf2$${iterations}$${bytesToHex(salt)}$${await pbkdf2(password, salt, iterations)}`;
}

async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (storedHash.startsWith('pbkdf2$')) {
    const [, iterationsText, saltHex, hash] = storedHash.split('$');
    const iterations = Number(iterationsText);
    if (!Number.isFinite(iterations) || !saltHex || !hash) return false;
    const candidate = await pbkdf2(password, hexToBytes(saltHex), iterations);
    return constantTimeEqual(candidate, hash);
  }

  return constantTimeEqual(await sha256(password), storedHash);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function createSessionCookie(c: Context<Env>, userId: number): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
  const payload = `${userId}.${expires}.${randomToken(16)}`;
  return `${payload}.${await hmac(payload, sessionSecret(c))}`;
}

async function isLoggedIn(c: Context<Env>): Promise<boolean> {
  const session = getCookie(c, 'admin_session');
  if (!session) return false;

  const parts = session.split('.');
  if (parts.length !== 4) return false;

  const payload = parts.slice(0, 3).join('.');
  const signature = parts[3];
  const expected = await hmac(payload, sessionSecret(c));
  if (!constantTimeEqual(signature, expected)) return false;

  const expires = Number(parts[1]);
  return Number.isFinite(expires) && expires > Math.floor(Date.now() / 1000);
}

function getCsrfToken(c: Context<Env>): string {
  const existing = getCookie(c, 'csrf_token');
  if (existing && existing.length >= 32) return existing;

  const token = randomToken();
  setCookie(c, 'csrf_token', token, {
    path: '/admin',
    httpOnly: false,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24,
  });
  return token;
}

async function verifyCsrf(c: Context<Env>): Promise<boolean> {
  const cookieToken = getCookie(c, 'csrf_token');
  if (!cookieToken) return false;

  const body = await c.req.parseBody();
  const formToken = body['csrf_token'];
  return typeof formToken === 'string' && constantTimeEqual(formToken, cookieToken);
}

function providerName(p: Provider | { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? p.name_zh : p.name_en;
}

function providerDesc(p: Provider, lang: Lang): string {
  return (lang === 'zh' ? p.desc_zh : p.desc_en) || '';
}

function contentTitle(post: ContentPost, lang: Lang): string {
  return lang === 'zh' ? post.title_zh : post.title_en;
}

function contentExcerpt(post: ContentPost, lang: Lang): string {
  return (lang === 'zh' ? post.excerpt_zh : post.excerpt_en) || '';
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

function sanitizeContentHtml(html: string): string {
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

function generateSlug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
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

function nullableStringField(body: Record<string, unknown>, key: string): string | null {
  const value = stringField(body, key);
  return value || null;
}

function normalizeContentStatus(value: string): string {
  return value === 'published' ? 'published' : 'draft';
}

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

// ==========================================
// Language Switch
// ==========================================
app.get('/lang/:lang', (c) => {
  const lang = c.req.param('lang');
  if (lang !== 'zh' && lang !== 'en') return c.redirect('/');
  setCookie(c, 'lang', lang, { path: '/', maxAge: 60 * 60 * 24 * 365, httpOnly: false, sameSite: 'Lax' });
  const referer = c.req.header('Referer') || '/';
  return c.redirect(referer);
});

// ==========================================
// R2 Image Proxy
// ==========================================
app.get('/images/*', async (c) => {
  const key = c.req.path.replace('/images/', '');
  const object = await c.env.R2.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(object.body, { headers });
});

app.get('/robots.txt', (c) => {
  const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /api/admin
Disallow: /login

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
app.use('/api/admin/*', async (c, next) => {
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const unauthorized = requireHermesAuth(c);
  if (unauthorized) return unauthorized;
  await next();
});

app.get('/api/admin/content', async (c) => {
  const status = c.req.query('status');
  const limit = Math.min(Number(c.req.query('limit') || 50), 100);
  const params: unknown[] = [];
  let query = 'SELECT * FROM content_posts';

  if (status === 'draft' || status === 'published') {
    query += ' WHERE status = ?';
    params.push(status);
  }

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
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const titleZh = stringField(body, 'title_zh');
  const titleEn = stringField(body, 'title_en', titleZh);
  const bodyZh = stringField(body, 'body_zh');
  const bodyEn = stringField(body, 'body_en', bodyZh);
  const slug = stringField(body, 'slug') || generateSlug(titleEn || titleZh);
  const status = normalizeContentStatus(stringField(body, 'status'));

  if (!titleZh || !titleEn || !bodyZh || !bodyEn || !slug) {
    return c.json({ error: 'title_zh, title_en, body_zh, body_en, and slug are required' }, 400);
  }

  const publishedAt = status === 'published' ? (stringField(body, 'published_at') || new Date().toISOString()) : null;
  const result = await c.env.DB.prepare(
    'INSERT INTO content_posts (title_zh, title_en, slug, excerpt_zh, excerpt_en, body_zh, body_en, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    titleZh, titleEn, slug, nullableStringField(body, 'excerpt_zh'), nullableStringField(body, 'excerpt_en'),
    bodyZh, bodyEn, status, publishedAt
  ).run();

  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(result.meta.last_row_id).first<ContentPost>();
  return c.json(post, 201);
});

app.put('/api/admin/content/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  if (!existing) return c.json({ error: 'Content not found' }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  const status = normalizeContentStatus(stringField(body, 'status', existing.status));
  const publishedAt = status === 'published'
    ? (stringField(body, 'published_at') || existing.published_at || new Date().toISOString())
    : null;

  await c.env.DB.prepare(
    `UPDATE content_posts SET title_zh = ?, title_en = ?, slug = ?, excerpt_zh = ?, excerpt_en = ?, body_zh = ?, body_en = ?, status = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    stringField(body, 'title_zh', existing.title_zh),
    stringField(body, 'title_en', existing.title_en),
    stringField(body, 'slug', existing.slug),
    nullableStringField(body, 'excerpt_zh') ?? existing.excerpt_zh,
    nullableStringField(body, 'excerpt_en') ?? existing.excerpt_en,
    stringField(body, 'body_zh', existing.body_zh),
    stringField(body, 'body_en', existing.body_en),
    status,
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

// ==========================================
// Homepage - Provider Grid
// ==========================================
app.get('/', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const admin = await isLoggedIn(c);
  const search = c.req.query('q') || '';
  const tagFilter = c.req.query('tag') || '';

  // Stats
  const [providerCount, cardCount, tagCount] = await Promise.all([
    db.prepare('SELECT COUNT(*) as c FROM vcc_providers WHERE status = ?').bind('active').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM vcc_cards WHERE status = ?').bind('active').first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM vcc_tags').first<{ c: number }>(),
  ]);

  // Get all tags
  const tags = await db.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>();

  // Build provider query
  let providerQuery = 'SELECT DISTINCT p.* FROM vcc_providers p';
  const params: string[] = [];

  if (tagFilter) {
    providerQuery += ' INNER JOIN vcc_provider_tags pt ON p.id = pt.provider_id';
  }

  providerQuery += ' WHERE p.status = ?';
  params.push('active');

  if (tagFilter) {
    providerQuery += ' AND pt.tag_id = ?';
    params.push(tagFilter);
  }

  if (search) {
    providerQuery += ' AND (p.name_zh LIKE ? OR p.name_en LIKE ? OR p.desc_zh LIKE ? OR p.desc_en LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  providerQuery += ' ORDER BY p.updated_at DESC';

  const stmt = db.prepare(providerQuery);
  const providers = await stmt.bind(...params).all<Provider>();

  // Get tags and card counts for each provider
  const providersWithTags: ProviderWithTags[] = await Promise.all(
    providers.results.map(async (p) => {
      const [pTags, cardCountResult] = await Promise.all([
        db.prepare(
          'SELECT t.* FROM vcc_tags t INNER JOIN vcc_provider_tags pt ON t.id = pt.tag_id WHERE pt.provider_id = ?'
        ).bind(p.id).all<Tag>(),
        db.prepare('SELECT COUNT(*) as c FROM vcc_cards WHERE provider_id = ? AND status = ?').bind(p.id, 'active').first<{ c: number }>(),
      ]);
      return { ...p, tags: pTags.results, card_count: cardCountResult?.c || 0 };
    })
  );

  const jsonLd = [
    ...baseJsonLd(c, lang),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('site.title', lang),
      description: t('site.description', lang),
      numberOfItems: providers.results.length,
      itemListElement: providersWithTags.map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: absoluteUrl(c, `/provider/${p.slug}`),
        name: providerName(p, lang),
      })),
    },
  ];

  return c.html(
    <Layout title={t('home.hero.title', lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, '/')} jsonLd={jsonLd}>
      {/* Hero Section */}
      <section class="bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 text-white py-16">
        <div class="max-w-7xl mx-auto px-4 text-center">
          <h1 class="text-4xl md:text-5xl font-bold mb-4">{t('home.hero.title', lang)}</h1>
          <p class="text-brand-100 text-lg mb-8 max-w-2xl mx-auto">{t('home.hero.desc', lang)}</p>
          {/* Search */}
          <form method="get" action="/" class="max-w-xl mx-auto">
            <div class="flex">
              <input
                type="text"
                name="q"
                value={search}
                placeholder={t('home.search', lang)}
                class="flex-1 px-4 py-3 rounded-l-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-brand-300"
              />
              <button type="submit" class="px-6 py-3 bg-brand-500 hover:bg-brand-400 rounded-r-lg font-medium transition-colors">
                {lang === 'zh' ? '搜索' : 'Search'}
              </button>
            </div>
            {tagFilter && <input type="hidden" name="tag" value={tagFilter} />}
          </form>
        </div>
      </section>

      {/* Stats */}
      <section class="max-w-7xl mx-auto px-4 -mt-8">
        <div class="grid grid-cols-3 gap-4">
          {[
            { label: t('home.stats.platforms', lang), value: providerCount?.c || 0 },
            { label: t('home.stats.cards', lang), value: cardCount?.c || 0 },
            { label: t('home.stats.tags', lang), value: tagCount?.c || 0 },
          ].map((stat) => (
            <div class="bg-white rounded-xl shadow-sm p-4 text-center">
              <div class="text-2xl font-bold text-brand-600">{stat.value}</div>
              <div class="text-gray-500 text-sm">{stat.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Tags Filter */}
      <section class="max-w-7xl mx-auto px-4 mt-8">
        <div class="flex flex-wrap gap-2">
          <a
            href="/"
            class={`tag-pill px-3 py-1.5 rounded-full text-sm font-medium ${!tagFilter ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-brand-50 border border-gray-200'}`}
          >
            {t('home.all', lang)}
          </a>
          {tags.results.map((tag) => (
            <a
              href={`/?tag=${tag.id}${search ? `&q=${encodeURIComponent(search)}` : ''}`}
              class={`tag-pill px-3 py-1.5 rounded-full text-sm font-medium ${String(tag.id) === tagFilter ? 'bg-brand-600 text-white' : 'bg-white text-gray-600 hover:bg-brand-50 border border-gray-200'}`}
            >
              {tagName(tag, lang)}
            </a>
          ))}
        </div>
      </section>

      {/* Provider Grid */}
      <section class="max-w-7xl mx-auto px-4 mt-8 pb-8">
        {providersWithTags.length === 0 ? (
          <div class="text-center py-16 text-gray-400">
            <p class="text-lg">{t('home.no_results', lang)}</p>
          </div>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {providersWithTags.map((p) => (
              <a href={`/provider/${p.slug}`} class="card-hover block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="p-6">
                  <div class="flex items-center space-x-3 mb-3">
                    {p.logo_url ? (
                      <img src={`/images/${p.logo_url}`} alt={providerName(p, lang)} class="w-10 h-10 rounded-lg object-cover" />
                    ) : (
                      <div class="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-lg">
                        {providerName(p, lang).charAt(0)}
                      </div>
                    )}
                    <div>
                      <h3 class="font-semibold text-gray-900">{providerName(p, lang)}</h3>
                      {p.region && <span class="text-xs text-gray-400">{p.region}</span>}
                    </div>
                  </div>
                  <p class="text-gray-500 text-sm mb-4 line-clamp-2" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                    {providerDesc(p, lang)}
                  </p>
                  <div class="flex flex-wrap gap-1.5 mb-3">
                    {p.tags.slice(0, 4).map((tag) => (
                      <span class="px-2 py-0.5 bg-brand-50 text-brand-600 rounded text-xs">{tagName(tag, lang)}</span>
                    ))}
                  </div>
                  <div class="flex items-center justify-between text-sm">
                    <span class="text-gray-400">{p.card_count} {t('provider.cards_count', lang)}</span>
                    <span class="text-brand-600 font-medium">{t('provider.view_detail', lang)} &rarr;</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
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
  const admin = await isLoggedIn(c);
  const slug = c.req.param('slug');

  const provider = await db.prepare('SELECT * FROM vcc_providers WHERE slug = ?').bind(slug).first<Provider>();
  if (!provider) {
    return c.html(
      <Layout title={t('provider.not_found', lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/provider/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold text-gray-900 mb-4">{t('provider.not_found', lang)}</h1>
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
    <Layout title={providerName(provider, lang)} description={providerDesc(provider, lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/provider/${provider.slug}`)} jsonLd={jsonLd}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        {/* Breadcrumb */}
        <nav class="mb-6 text-sm text-gray-500">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <span class="text-gray-900">{providerName(provider, lang)}</span>
        </nav>

        {/* Provider Header */}
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-8">
          <div class="flex items-start space-x-4">
            {provider.logo_url ? (
              <img src={`/images/${provider.logo_url}`} alt={providerName(provider, lang)} class="w-16 h-16 rounded-xl object-cover" />
            ) : (
              <div class="w-16 h-16 rounded-xl bg-brand-100 flex items-center justify-center text-brand-600 font-bold text-2xl">
                {providerName(provider, lang).charAt(0)}
              </div>
            )}
            <div class="flex-1">
              <h1 class="text-2xl font-bold text-gray-900 mb-1">{providerName(provider, lang)}</h1>
              <p class="text-gray-500 mb-4">{providerDesc(provider, lang)}</p>
              <div class="flex flex-wrap gap-2 mb-4">
                {providerTags.results.map((tag) => (
                  <span class="px-2.5 py-1 bg-brand-50 text-brand-600 rounded-full text-xs font-medium">{tagName(tag, lang)}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Info Grid */}
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
            {provider.website && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('provider.website', lang)}</div>
                <a href={provider.website} target="_blank" rel="noopener noreferrer" class="text-brand-600 hover:underline text-sm">{t('common.visit', lang)}</a>
              </div>
            )}
            {provider.founded_date && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('provider.founded', lang)}</div>
                <div class="text-sm font-medium text-gray-900">{provider.founded_date}</div>
              </div>
            )}
            {provider.apply_method && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('provider.apply_method', lang)}</div>
                <div class="text-sm font-medium text-gray-900">{provider.apply_method}</div>
              </div>
            )}
            <div>
              <div class="text-xs text-gray-400 mb-1">{t('provider.kyc', lang)}</div>
              <div class="text-sm font-medium text-gray-900">
                {provider.need_kyc ? (
                  <span class="text-amber-600">{t('provider.kyc_yes', lang)}</span>
                ) : (
                  <span class="text-green-600">{t('provider.kyc_no', lang)}</span>
                )}
              </div>
            </div>
            {provider.region && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('provider.region', lang)}</div>
                <div class="text-sm font-medium text-gray-900">{provider.region}</div>
              </div>
            )}
          </div>
        </div>

        {/* Card BINs */}
        <h2 class="text-xl font-bold text-gray-900 mb-4">{t('provider.cards', lang)} ({cards.results.length})</h2>
        {cards.results.length === 0 ? (
          <div class="text-center py-8 text-gray-400">{t('home.no_results', lang)}</div>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {cards.results.map((card) => (
              <a href={`/card/${card.slug}`} class="card-hover block bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div class="flex items-center justify-between mb-3">
                  <div class="flex items-center space-x-2">
                    <span class={`px-2 py-0.5 rounded text-xs font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                      {card.card_type}
                    </span>
                    <span class="font-mono font-semibold text-gray-900">{card.bin}</span>
                  </div>
                  <span class="text-xs text-gray-400">{card.currency}</span>
                </div>
                <div class="grid grid-cols-2 gap-3">
                  <div>
                    <div class="text-xs text-gray-400">{t('card.issuance_fee', lang)}</div>
                    <div class="text-sm font-semibold text-gray-900">
                      {card.issuance_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.issuance_fee}`}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-gray-400">{t('card.fee_rate', lang)}</div>
                    <div class="text-sm font-semibold text-gray-900">{card.fee_rate}%</div>
                  </div>
                  <div>
                    <div class="text-xs text-gray-400">{t('card.monthly_fee', lang)}</div>
                    <div class="text-sm font-semibold text-gray-900">
                      {card.monthly_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.monthly_fee}`}
                    </div>
                  </div>
                  <div>
                    <div class="text-xs text-gray-400">{t('card.initial_load', lang)}</div>
                    <div class="text-sm font-semibold text-gray-900">${card.initial_load}</div>
                  </div>
                </div>
                {card.description && (
                  <div class="mt-3 text-xs text-gray-400">{card.description}</div>
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
  const admin = await isLoggedIn(c);
  const slug = c.req.param('slug');

  const card = await db.prepare(
    'SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en, p.slug as provider_slug FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id WHERE c.slug = ?'
  ).bind(slug).first<CardWithProvider>();

  if (!card) {
    return c.html(
      <Layout title={t('card.not_found', lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/card/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold text-gray-900 mb-4">{t('card.not_found', lang)}</h1>
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
      { name: pName, path: `/provider/${card.provider_slug}` },
      { name: `${card.card_type} ${card.bin}`, path: `/card/${card.slug}` },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: `${card.card_type} ${card.bin}`,
      description: card.description || `${pName} ${card.card_type} ${card.bin}`,
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
    <Layout title={`${card.card_type} ${card.bin}`} description={card.description || `${pName} ${card.card_type} ${card.bin}`} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/card/${card.slug}`)} jsonLd={jsonLd}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <nav class="mb-6 text-sm text-gray-500">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href={`/provider/${card.provider_slug}`} class="hover:text-brand-600">{pName}</a>
          <span class="mx-2">/</span>
          <span class="text-gray-900">{card.bin}</span>
        </nav>

        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div class="flex items-center space-x-3 mb-6">
            <span class={`px-3 py-1 rounded-lg text-sm font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
              {card.card_type}
            </span>
            <h1 class="text-2xl font-bold text-gray-900 font-mono">{card.bin}</h1>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 gap-6 mb-6">
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="text-xs text-gray-400 mb-1">{t('card.issuance_fee', lang)}</div>
              <div class="text-xl font-bold text-gray-900">
                {card.issuance_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.issuance_fee}`}
              </div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="text-xs text-gray-400 mb-1">{t('card.fee_rate', lang)}</div>
              <div class="text-xl font-bold text-gray-900">{card.fee_rate}%</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="text-xs text-gray-400 mb-1">{t('card.monthly_fee', lang)}</div>
              <div class="text-xl font-bold text-gray-900">
                {card.monthly_fee === 0 ? <span class="text-green-600">{t('common.free', lang)}</span> : `$${card.monthly_fee}`}
              </div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4">
              <div class="text-xs text-gray-400 mb-1">{t('card.initial_load', lang)}</div>
              <div class="text-xl font-bold text-gray-900">${card.initial_load}</div>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-gray-100 pt-6">
            <div>
              <div class="text-xs text-gray-400 mb-1">{t('card.provider', lang)}</div>
              <a href={`/provider/${card.provider_slug}`} class="text-brand-600 hover:underline font-medium">{pName}</a>
            </div>
            <div>
              <div class="text-xs text-gray-400 mb-1">{t('card.currency', lang)}</div>
              <div class="font-medium text-gray-900">{card.currency}</div>
            </div>
            {card.quota && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('card.quota', lang)}</div>
                <div class="font-medium text-gray-900">{card.quota}</div>
              </div>
            )}
            {card.usage && (
              <div>
                <div class="text-xs text-gray-400 mb-1">{t('card.usage', lang)}</div>
                <div class="font-medium text-gray-900">{card.usage}</div>
              </div>
            )}
          </div>
          {card.description && (
            <div class="mt-6 pt-6 border-t border-gray-100">
              <div class="text-xs text-gray-400 mb-2">{t('provider.description', lang)}</div>
              <p class="text-gray-700">{card.description}</p>
            </div>
          )}
        </div>

        <div class="mt-6">
          <a href={`/provider/${card.provider_slug}`} class="text-brand-600 hover:underline text-sm">&larr; {t('card.back_provider', lang)}</a>
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
  const admin = await isLoggedIn(c);
  const csrfToken = admin ? getCsrfToken(c) : '';
  const posts = admin
    ? await c.env.DB.prepare('SELECT * FROM content_posts ORDER BY updated_at DESC').all<ContentPost>()
    : await c.env.DB.prepare(
      'SELECT * FROM content_posts WHERE status = ? ORDER BY published_at DESC, updated_at DESC'
    ).bind('published').all<ContentPost>();
  const publishedPosts = posts.results.filter((post) => post.status === 'published');

  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: '/' },
      { name: t('content.title', lang), path: '/content' },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'Blog',
      name: t('content.title', lang),
      description: t('content.desc', lang),
      url: absoluteUrl(c, '/content'),
      blogPost: publishedPosts.map((post) => ({
        '@type': 'BlogPosting',
        headline: contentTitle(post, lang),
        url: absoluteUrl(c, `/content/${post.slug}`),
        datePublished: post.published_at,
        dateModified: post.updated_at,
      })),
    },
  ];

  return c.html(
    <Layout title={t('content.title', lang)} description={t('content.desc', lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, '/content')} jsonLd={jsonLd}>
      <section class="bg-white border-b border-gray-200">
        <div class="max-w-7xl mx-auto px-4 py-12">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 class="text-3xl font-bold text-gray-900 mb-3">{t('content.title', lang)}</h1>
              <p class="text-gray-500 max-w-2xl">{t('content.desc', lang)}</p>
            </div>
            {admin && (
              <a href="/admin/content/new" class="shrink-0 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
                + {t('admin.add_content', lang)}
              </a>
            )}
          </div>
        </div>
      </section>

      <section class="max-w-7xl mx-auto px-4 py-8">
        <h2 class="text-xl font-bold text-gray-900 mb-4">{t('content.latest', lang)}</h2>
        {posts.results.length === 0 ? (
          <div class="text-center py-16 text-gray-400">{t('content.no_results', lang)}</div>
        ) : (
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            {posts.results.map((post) => (
              <div class="card-hover bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div class="p-6">
                  <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
                  <h3 class="text-lg font-semibold text-gray-900 leading-snug">
                    {post.status === 'published' ? (
                      <a href={`/content/${post.slug}`} class="hover:text-brand-600">{contentTitle(post, lang)}</a>
                    ) : (
                      contentTitle(post, lang)
                    )}
                  </h3>
                  <div class="flex shrink-0 items-center gap-2">
                    {admin && (
                      <span class={`px-2 py-0.5 rounded text-xs font-medium ${post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                        {post.status === 'published' ? (lang === 'zh' ? '已发布' : 'Published') : (lang === 'zh' ? '草稿' : 'Draft')}
                      </span>
                    )}
                    {post.published_at && <span class="text-xs text-gray-400">{post.published_at.slice(0, 10)}</span>}
                  </div>
                  </div>
                  {contentExcerpt(post, lang) && <p class="text-gray-500 text-sm mb-4">{contentExcerpt(post, lang)}</p>}
                  {post.status === 'published' ? (
                    <a href={`/content/${post.slug}`} class="text-brand-600 font-medium text-sm">{t('content.read_more', lang)} &rarr;</a>
                  ) : (
                    <span class="text-gray-400 text-sm">{lang === 'zh' ? '草稿未公开' : 'Draft is not public'}</span>
                  )}
                </div>
                {admin && (
                  <div class="flex items-center justify-between gap-3 border-t border-gray-100 bg-gray-50 px-6 py-3">
                    <span class="text-xs text-gray-400">{lang === 'zh' ? '管理操作' : 'Admin actions'}</span>
                    <div class="flex items-start gap-3">
                      <a href={`/admin/content/${post.id}/edit`} class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium leading-none text-brand-600 hover:bg-brand-50">{t('admin.edit', lang)}</a>
                      <form method="post" action={`/admin/content/${post.id}/delete`} class="m-0 flex items-start" onsubmit="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>
                        <input type="hidden" name="csrf_token" value={csrfToken} />
                        <button type="submit" class="inline-flex h-7 items-center rounded-md border-0 bg-transparent px-2 py-0 text-xs font-medium leading-none text-red-500 hover:bg-red-50">{t('admin.delete', lang)}</button>
                      </form>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </Layout>
  );
});

app.get('/content/:slug', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const admin = await isLoggedIn(c);
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE slug = ? AND status = ?').bind(slug, 'published').first<ContentPost>();

  if (!post) {
    return c.html(
      <Layout title={t('content.not_found', lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/content/${slug}`)} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold text-gray-900 mb-4">{t('content.not_found', lang)}</h1>
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
    },
  ];

  return c.html(
    <Layout title={contentTitle(post, lang)} description={contentExcerpt(post, lang)} lang={lang} isAdmin={admin} canonicalUrl={absoluteUrl(c, `/content/${post.slug}`)} ogType="article" jsonLd={jsonLd}>
      <article class="max-w-3xl mx-auto px-4 py-8">
        <nav class="mb-6 text-sm text-gray-500">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href="/content" class="hover:text-brand-600">{t('content.title', lang)}</a>
        </nav>
        <header class="mb-8">
          <h1 class="text-3xl font-bold text-gray-900 mb-3">{contentTitle(post, lang)}</h1>
          {post.published_at && <div class="text-sm text-gray-400">{post.published_at.slice(0, 10)}</div>}
          {contentExcerpt(post, lang) && <p class="text-gray-500 mt-4">{contentExcerpt(post, lang)}</p>}
        </header>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div class="content-prose text-gray-700 leading-7" dangerouslySetInnerHTML={{ __html: bodyHtml }} />
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
    db.prepare('SELECT c.slug, c.created_at FROM vcc_cards c WHERE c.status = ? ORDER BY c.created_at DESC').bind('active').all<{ slug: string; created_at: string }>(),
    db.prepare('SELECT slug, updated_at FROM content_posts WHERE status = ? ORDER BY published_at DESC').bind('published').all<{ slug: string; updated_at: string }>(),
  ]);

  const urls: string[] = [];

  // Homepage
  urls.push(`  <url>
    <loc>${origin}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
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
// Login
// ==========================================
app.get('/login', (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const error = c.req.query('error');

  return c.html(
    <Layout title={t('login.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, '/login')} noIndex>
      <div class="min-h-[60vh] flex items-center justify-center py-12 px-4">
        <div class="max-w-md w-full bg-white rounded-xl shadow-sm border border-gray-100 p-8">
          <h1 class="text-2xl font-bold text-gray-900 text-center mb-8">{t('login.title', lang)}</h1>
          {error && (
            <div class="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
              {t('login.error', lang)}
            </div>
          )}
          <form method="post" action="/login">
            <div class="mb-4">
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('login.username', lang)}</label>
              <input type="text" name="username" required class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div class="mb-6">
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('login.password', lang)}</label>
              <input type="password" name="password" required class="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <button type="submit" class="w-full py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
              {t('login.submit', lang)}
            </button>
          </form>
        </div>
      </div>
    </Layout>
  );
});

app.post('/login', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();
  const username = String(body['username'] || '');
  const password = String(body['password'] || '');

  const user = await db.prepare('SELECT id, password_hash FROM admin_users WHERE username = ?').bind(username).first<{ id: number; password_hash: string }>();

  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return c.redirect('/login?error=1');
  }

  setCookie(c, 'admin_session', await createSessionCookie(c, user.id), {
    path: '/',
    httpOnly: true,
    secure: isSecureRequest(c),
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24, // 24 hours
  });
  return c.redirect('/admin');
});

app.get('/logout', (c) => {
  deleteCookie(c, 'admin_session', { path: '/' });
  deleteCookie(c, 'csrf_token', { path: '/admin' });
  return c.redirect('/');
});

// ==========================================
// Admin Middleware
// ==========================================
app.use('/admin/*', async (c, next) => {
  if (!(await isLoggedIn(c))) return c.redirect('/login');
  if (c.req.method === 'POST' && !(await verifyCsrf(c))) return c.text('Invalid CSRF token', 403);
  await next();
});

// ==========================================
// Admin Dashboard
// ==========================================
app.get('/admin', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const csrfToken = getCsrfToken(c);

  const [providers, cards, posts, tags] = await Promise.all([
    db.prepare('SELECT * FROM vcc_providers ORDER BY updated_at DESC').all<Provider>(),
    db.prepare('SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en, p.slug as provider_slug FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id ORDER BY c.created_at DESC').all<CardWithProvider>(),
    db.prepare('SELECT * FROM content_posts ORDER BY updated_at DESC').all<ContentPost>(),
    db.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>(),
  ]);

  return c.html(
    <Layout title={t('admin.title', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, '/admin')} noIndex>
      <div class="max-w-7xl mx-auto px-4 py-8">
        <div class="flex items-center justify-between mb-8">
          <h1 class="text-2xl font-bold text-gray-900">{t('admin.title', lang)}</h1>
          <a href="/admin/password" class="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors">
            {t('admin.change_password', lang)}
          </a>
        </div>

        {/* Providers Section */}
        <div class="mb-12">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-900">{t('admin.providers', lang)}</h2>
            <a href="/admin/provider/new" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
              + {t('admin.add_provider', lang)}
            </a>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">Slug</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{lang === 'zh' ? '中文名' : 'Chinese Name'}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{lang === 'zh' ? '英文名' : 'English Name'}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('provider.region', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('common.status', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.actions', lang)}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {providers.results.map((p) => (
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-3 text-gray-500">{p.id}</td>
                      <td class="px-4 py-3 font-mono text-xs text-gray-500">{p.slug}</td>
                      <td class="px-4 py-3 font-medium text-gray-900">{p.name_zh}</td>
                      <td class="px-4 py-3 text-gray-700">{p.name_en}</td>
                      <td class="px-4 py-3 text-gray-500">{p.region || '-'}</td>
                      <td class="px-4 py-3">
                        <span class={`px-2 py-0.5 rounded text-xs font-medium ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {p.status === 'active' ? t('common.active', lang) : t('common.inactive', lang)}
                        </span>
                      </td>
                      <td class="px-4 py-3">
                        <a href={`/admin/provider/${p.id}/edit`} class="text-brand-600 hover:underline text-xs">{t('admin.edit', lang)}</a>
                        <form method="post" action={`/admin/provider/${p.id}/delete`} class="inline ml-2" onsubmit="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <button type="submit" class="text-red-500 hover:underline text-xs">{t('admin.delete', lang)}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Cards Section */}
        <div class="mb-12">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-900">{t('admin.cards', lang)}</h2>
            <a href="/admin/card/new" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
              + {t('admin.add_card', lang)}
            </a>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">Slug</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.provider', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">BIN</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.type', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.issuance_fee', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.fee_rate', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.monthly_fee', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('card.initial_load', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.actions', lang)}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {cards.results.map((card) => (
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-3 text-gray-500">{card.id}</td>
                      <td class="px-4 py-3 font-mono text-xs text-gray-500">{card.slug}</td>
                      <td class="px-4 py-3 text-gray-700">{lang === 'zh' ? card.provider_name_zh : card.provider_name_en}</td>
                      <td class="px-4 py-3 font-mono font-medium text-gray-900">{card.bin}</td>
                      <td class="px-4 py-3">
                        <span class={`px-2 py-0.5 rounded text-xs font-bold ${card.card_type === 'Visa' ? 'bg-blue-100 text-blue-700' : 'bg-orange-100 text-orange-700'}`}>
                          {card.card_type}
                        </span>
                      </td>
                      <td class="px-4 py-3">${card.issuance_fee}</td>
                      <td class="px-4 py-3">{card.fee_rate}%</td>
                      <td class="px-4 py-3">${card.monthly_fee}</td>
                      <td class="px-4 py-3">${card.initial_load}</td>
                      <td class="px-4 py-3">
                        <a href={`/admin/card/${card.id}/edit`} class="text-brand-600 hover:underline text-xs">{t('admin.edit', lang)}</a>
                        <form method="post" action={`/admin/card/${card.id}/delete`} class="inline ml-2" onsubmit="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <button type="submit" class="text-red-500 hover:underline text-xs">{t('admin.delete', lang)}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Content Section */}
        <div class="mb-12">
          <div class="flex items-center justify-between mb-4">
            <div>
              <h2 class="text-xl font-bold text-gray-900">{t('admin.content', lang)}</h2>
              <p class="text-sm text-gray-500 mt-1">{lang === 'zh' ? '管理文章、草稿和公开内容' : 'Manage articles, drafts, and published content'}</p>
            </div>
            <a href="/admin/content/new" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
              + {t('admin.add_content', lang)}
            </a>
          </div>
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {posts.results.length === 0 ? (
              <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-8 text-center text-gray-400 lg:col-span-2">
                {t('content.no_results', lang)}
              </div>
            ) : posts.results.map((post) => (
              <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                <div class="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h3 class="font-semibold text-gray-900 mb-1">{contentTitle(post, lang)}</h3>
                    <div class="font-mono text-xs text-gray-400">/{post.slug}</div>
                  </div>
                  <span class={`shrink-0 px-2 py-0.5 rounded text-xs font-medium ${post.status === 'published' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                    {post.status === 'published' ? (lang === 'zh' ? '已发布' : 'Published') : (lang === 'zh' ? '草稿' : 'Draft')}
                  </span>
                </div>
                <p class="text-sm text-gray-500 line-clamp-2" style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
                  {contentExcerpt(post, lang) || (lang === 'zh' ? '暂无摘要' : 'No excerpt')}
                </p>
                <div class="flex items-center justify-between mt-4 pt-4 border-t border-gray-100">
                  <div class="text-xs text-gray-400">
                    {lang === 'zh' ? '更新' : 'Updated'} {post.updated_at ? post.updated_at.slice(0, 10) : '-'}
                    {post.published_at && <span class="ml-2">{lang === 'zh' ? '发布' : 'Published'} {post.published_at.slice(0, 10)}</span>}
                  </div>
                  <div class="flex items-start gap-2">
                    {post.status === 'published' && <a href={`/content/${post.slug}`} class="text-gray-500 hover:underline text-xs" target="_blank">View</a>}
                    <a href={`/admin/content/${post.id}/edit`} class="inline-flex h-7 items-center rounded-md px-2 text-xs font-medium leading-none text-brand-600 hover:bg-brand-50">{t('admin.edit', lang)}</a>
                    <form method="post" action={`/admin/content/${post.id}/delete`} class="m-0 flex items-start" onsubmit="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>
                      <input type="hidden" name="csrf_token" value={csrfToken} />
                      <button type="submit" class="inline-flex h-7 items-center rounded-md border-0 bg-transparent px-2 py-0 text-xs font-medium leading-none text-red-500 hover:bg-red-50">{t('admin.delete', lang)}</button>
                    </form>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Tags Section */}
        <div>
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-gray-900">{t('admin.tags', lang)}</h2>
          </div>

          {/* Add Tag Form */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6 mb-4">
            <form method="post" action="/admin/tag/new" class="flex flex-wrap items-end gap-4">
              <input type="hidden" name="csrf_token" value={csrfToken} />
              <div class="flex-1 min-w-[150px]">
                <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.tag_name_zh', lang)} *</label>
                <input type="text" name="name_zh" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none text-sm" />
              </div>
              <div class="flex-1 min-w-[150px]">
                <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.tag_name_en', lang)} *</label>
                <input type="text" name="name_en" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none text-sm" />
              </div>
              <div class="w-40">
                <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.tag_category', lang)}</label>
                <select name="category" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none text-sm">
                  <option value="payment">{t('admin.tag_category_payment', lang)}</option>
                  <option value="compliance">{t('admin.tag_category_compliance', lang)}</option>
                  <option value="feature">{t('admin.tag_category_feature', lang)}</option>
                  <option value="type">{t('admin.tag_category_type', lang)}</option>
                </select>
              </div>
              <button type="submit" class="px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 transition-colors">
                + {t('admin.add_tag', lang)}
              </button>
            </form>
          </div>

          {/* Tags Table */}
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead class="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">ID</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.tag_name_zh', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.tag_name_en', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.tag_category', lang)}</th>
                    <th class="text-left px-4 py-3 font-medium text-gray-500">{t('admin.actions', lang)}</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  {tags.results.map((tag) => (
                    <tr class="hover:bg-gray-50">
                      <td class="px-4 py-3 text-gray-500">{tag.id}</td>
                      <td class="px-4 py-3 font-medium text-gray-900">{tag.name_zh}</td>
                      <td class="px-4 py-3 text-gray-700">{tag.name_en}</td>
                      <td class="px-4 py-3">
                        <span class="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs">{tag.category || '-'}</span>
                      </td>
                      <td class="px-4 py-3">
                        <form method="post" action={`/admin/tag/${tag.id}/delete`} class="inline" onsubmit="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>
                          <input type="hidden" name="csrf_token" value={csrfToken} />
                          <button type="submit" class="text-red-500 hover:underline text-xs">{t('admin.delete', lang)}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
});

// ==========================================
// Admin: Content CRUD
// ==========================================

function ContentForm({ post, lang, action, csrfToken }: {
  post?: ContentPost;
  lang: Lang;
  action: string;
  csrfToken: string;
}) {
  const bodyZh = contentBodyHtml(post?.body_zh || '');
  const bodyEn = contentBodyHtml(post?.body_en || '');
  const editorTools = [
    { cmd: 'formatBlock', value: 'h2', label: 'H2' },
    { cmd: 'formatBlock', value: 'h3', label: 'H3' },
    { cmd: 'formatBlock', value: 'p', label: 'P' },
    { cmd: 'bold', label: 'B' },
    { cmd: 'italic', label: 'I' },
    { cmd: 'underline', label: 'U' },
    { cmd: 'insertUnorderedList', label: 'UL' },
    { cmd: 'insertOrderedList', label: 'OL' },
    { cmd: 'formatBlock', value: 'blockquote', label: '"' },
    { cmd: 'createLink', label: 'Link' },
    { cmd: 'removeFormat', label: 'Clear' },
  ];

  return (
    <form method="post" action={action} class="space-y-6" data-rich-content-form="true">
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <div class="grid grid-cols-1 xl:grid-cols-[1fr_280px] gap-6">
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '中文标题' : 'Chinese Title'} *</label>
              <input type="text" name="title_zh" required value={post?.title_zh || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '英文标题' : 'English Title'} *</label>
              <input type="text" name="title_en" required value={post?.title_en || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Slug</label>
              <input type="text" name="slug" value={post?.slug || ''} placeholder={lang === 'zh' ? '留空自动生成' : 'Leave empty to auto-generate'} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono text-sm" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('common.status', lang)}</label>
              <select name="status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
                <option value="draft" selected={(!post || post.status === 'draft')}>{lang === 'zh' ? '草稿' : 'Draft'}</option>
                <option value="published" selected={post?.status === 'published'}>{lang === 'zh' ? '已发布' : 'Published'}</option>
              </select>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '中文摘要' : 'Chinese Excerpt'}</label>
              <textarea name="excerpt_zh" rows={3} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">{post?.excerpt_zh || ''}</textarea>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '英文摘要' : 'English Excerpt'}</label>
              <textarea name="excerpt_en" rows={3} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">{post?.excerpt_en || ''}</textarea>
            </div>
          </div>

          <div class="bg-gray-50 border border-gray-200 rounded-xl overflow-hidden">
            <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200 bg-white">
              <h2 class="font-semibold text-gray-900">{lang === 'zh' ? '富文本正文' : 'Rich Text Body'}</h2>
              <div class="flex rounded-lg bg-gray-100 p-1">
                <button type="button" data-tab-target="zh" class="px-3 py-1.5 rounded-md bg-white text-brand-600 text-sm font-medium shadow-sm">{lang === 'zh' ? '中文' : 'ZH'}</button>
                <button type="button" data-tab-target="en" class="px-3 py-1.5 rounded-md text-gray-500 text-sm font-medium">{lang === 'zh' ? '英文' : 'EN'}</button>
              </div>
            </div>

            {[
              { key: 'zh', name: 'body_zh', html: bodyZh },
              { key: 'en', name: 'body_en', html: bodyEn },
            ].map((editor) => (
              <div data-editor-panel={editor.key} class={editor.key === 'en' ? 'hidden' : ''}>
                <input type="hidden" name={editor.name} value={editor.html} data-editor-input={editor.key} />
                <div class="flex flex-wrap items-center gap-1 px-3 py-2 border-b border-gray-200 bg-white">
                  {editorTools.map((tool) => (
                    <button type="button" data-editor-command={tool.cmd} data-editor-value={tool.value || ''} class="min-w-9 h-8 px-2 rounded-md border border-gray-200 bg-white text-xs font-semibold text-gray-600 hover:bg-brand-50 hover:text-brand-600">
                      {tool.label}
                    </button>
                  ))}
                </div>
                <div
                  contenteditable={true}
                  data-editor={editor.key}
                  data-placeholder={lang === 'zh' ? '在这里编写内容...' : 'Write content here...'}
                  class="rich-editor content-prose min-h-[360px] bg-white px-4 py-4 text-gray-800 leading-7"
                  dangerouslySetInnerHTML={{ __html: editor.html }}
                />
              </div>
            ))}
          </div>
        </div>

        <aside class="space-y-4">
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 class="font-semibold text-gray-900 mb-3">{lang === 'zh' ? '发布设置' : 'Publish Settings'}</h3>
            <div class="space-y-3 text-sm text-gray-500">
              <div class="flex justify-between"><span>ID</span><span class="font-mono">{post?.id || '-'}</span></div>
              <div class="flex justify-between"><span>{lang === 'zh' ? '状态' : 'Status'}</span><span>{post?.status === 'published' ? (lang === 'zh' ? '已发布' : 'Published') : (lang === 'zh' ? '草稿' : 'Draft')}</span></div>
              <div class="flex justify-between"><span>{lang === 'zh' ? '创建' : 'Created'}</span><span>{post?.created_at ? post.created_at.slice(0, 10) : '-'}</span></div>
              <div class="flex justify-between"><span>{lang === 'zh' ? '更新' : 'Updated'}</span><span>{post?.updated_at ? post.updated_at.slice(0, 10) : '-'}</span></div>
            </div>
          </div>
          <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <h3 class="font-semibold text-gray-900 mb-3">{lang === 'zh' ? '操作' : 'Actions'}</h3>
            <div class="space-y-3">
              <button type="submit" class="w-full px-4 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
                {t('admin.save', lang)}
              </button>
              {post?.status === 'published' && (
                <a href={`/content/${post.slug}`} target="_blank" class="block w-full text-center px-4 py-2.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors">
                  {lang === 'zh' ? '查看公开页' : 'View Public Page'}
                </a>
              )}
              <a href="/admin" class="block w-full text-center px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition-colors">
                {t('admin.cancel', lang)}
              </a>
            </div>
          </div>
        </aside>
      </div>

      <script dangerouslySetInnerHTML={{ __html: `
        (() => {
          const form = document.querySelector('[data-rich-content-form]');
          if (!form) return;
          const sync = () => {
            form.querySelectorAll('[data-editor]').forEach((editor) => {
              const key = editor.getAttribute('data-editor');
              const input = form.querySelector('[data-editor-input="' + key + '"]');
              if (input) input.value = editor.innerHTML.trim();
            });
          };
          const activateTab = (key) => {
            form.querySelectorAll('[data-editor-panel]').forEach((panel) => {
              panel.classList.toggle('hidden', panel.getAttribute('data-editor-panel') !== key);
            });
            form.querySelectorAll('[data-tab-target]').forEach((button) => {
              const active = button.getAttribute('data-tab-target') === key;
              button.classList.toggle('bg-white', active);
              button.classList.toggle('text-brand-600', active);
              button.classList.toggle('shadow-sm', active);
              button.classList.toggle('text-gray-500', !active);
            });
          };
          form.querySelectorAll('[data-tab-target]').forEach((button) => {
            button.addEventListener('click', () => activateTab(button.getAttribute('data-tab-target')));
          });
          form.querySelectorAll('[data-editor-command]').forEach((button) => {
            button.addEventListener('click', () => {
              const panel = button.closest('[data-editor-panel]');
              const editor = panel && panel.querySelector('[data-editor]');
              if (!editor) return;
              editor.focus();
              const command = button.getAttribute('data-editor-command');
              let value = button.getAttribute('data-editor-value') || null;
              if (command === 'createLink') {
                value = prompt('${lang === 'zh' ? '输入链接地址' : 'Enter URL'}') || '';
                if (!value) return;
              }
              document.execCommand(command, false, value);
              sync();
            });
          });
          form.querySelectorAll('[data-editor]').forEach((editor) => {
            editor.addEventListener('input', sync);
            editor.addEventListener('blur', sync);
          });
          form.addEventListener('submit', sync);
        })();
      ` }} />
    </form>
  );
}

app.get('/admin/content/new', (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const csrfToken = getCsrfToken(c);

  return c.html(
    <Layout title={t('admin.add_content', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, '/admin/content/new')} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.add_content', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ContentForm lang={lang} action="/admin/content/new" csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/content/new', async (c) => {
  const body = await c.req.parseBody();
  const titleZh = String(body['title_zh'] || '').trim();
  const titleEn = String(body['title_en'] || '').trim();
  const bodyZh = String(body['body_zh'] || '').trim();
  const bodyEn = String(body['body_en'] || '').trim();
  const slug = String(body['slug'] || '').trim() || generateSlug(titleEn || titleZh);
  const status = normalizeContentStatus(String(body['status'] || 'draft'));
  const publishedAt = status === 'published' ? new Date().toISOString() : null;

  await c.env.DB.prepare(
    'INSERT INTO content_posts (title_zh, title_en, slug, excerpt_zh, excerpt_en, body_zh, body_en, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    titleZh, titleEn, slug, body['excerpt_zh'] || null, body['excerpt_en'] || null, bodyZh, bodyEn, status, publishedAt
  ).run();

  return c.redirect('/admin');
});

app.get('/admin/content/:id/edit', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const csrfToken = getCsrfToken(c);
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(c.req.param('id')).first<ContentPost>();
  if (!post) return c.redirect('/admin');

  return c.html(
    <Layout title={t('admin.edit_content', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, `/admin/content/${post.id}/edit`)} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.edit_content', lang)}: {contentTitle(post, lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ContentForm post={post} lang={lang} action={`/admin/content/${post.id}/edit`} csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/content/:id/edit', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  if (!existing) return c.redirect('/admin');

  const body = await c.req.parseBody();
  const status = normalizeContentStatus(String(body['status'] || 'draft'));
  const publishedAt = status === 'published' ? (existing.published_at || new Date().toISOString()) : null;
  const slug = String(body['slug'] || '').trim() || generateSlug(String(body['title_en'] || body['title_zh'] || existing.slug));

  await c.env.DB.prepare(
    `UPDATE content_posts SET title_zh = ?, title_en = ?, slug = ?, excerpt_zh = ?, excerpt_en = ?, body_zh = ?, body_en = ?, status = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    body['title_zh'], body['title_en'], slug, body['excerpt_zh'] || null, body['excerpt_en'] || null,
    body['body_zh'], body['body_en'], status, publishedAt, id
  ).run();

  return c.redirect('/admin');
});

app.post('/admin/content/:id/delete', async (c) => {
  await c.env.DB.prepare('DELETE FROM content_posts WHERE id = ?').bind(c.req.param('id')).run();
  return c.redirect('/admin');
});

// ==========================================
// Admin: Tag CRUD
// ==========================================
app.post('/admin/tag/new', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();
  const nameZh = String(body['name_zh'] || '').trim();
  const nameEn = String(body['name_en'] || '').trim();
  const category = String(body['category'] || '') || null;

  if (nameZh && nameEn) {
    await db.prepare('INSERT INTO vcc_tags (name_zh, name_en, category) VALUES (?, ?, ?)').bind(nameZh, nameEn, category).run();
  }

  return c.redirect('/admin');
});

app.post('/admin/tag/:id/delete', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;

  // Delete tag associations first, then the tag itself
  await db.prepare('DELETE FROM vcc_provider_tags WHERE tag_id = ?').bind(id).run();
  await db.prepare('DELETE FROM vcc_tags WHERE id = ?').bind(id).run();

  return c.redirect('/admin');
});

// ==========================================
// Admin: Change Password
// ==========================================
app.get('/admin/password', (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const success = c.req.query('success');
  const error = c.req.query('error');
  const csrfToken = getCsrfToken(c);

  return c.html(
    <Layout title={t('admin.change_password', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, '/admin/password')} noIndex>
      <div class="max-w-lg mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.change_password', lang)}</h1>
        {success && (
          <div class="bg-green-50 border border-green-200 text-green-700 rounded-lg px-4 py-3 mb-6 text-sm">
            {t('admin.password_changed', lang)}
          </div>
        )}
        {error === 'old' && (
          <div class="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
            {t('admin.password_error_old', lang)}
          </div>
        )}
        {error === 'mismatch' && (
          <div class="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
            {t('admin.password_error_mismatch', lang)}
          </div>
        )}
        {error === 'short' && (
          <div class="bg-red-50 border border-red-200 text-red-600 rounded-lg px-4 py-3 mb-6 text-sm">
            {t('admin.password_error_short', lang)}
          </div>
        )}
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <form method="post" action="/admin/password" class="space-y-5">
            <input type="hidden" name="csrf_token" value={csrfToken} />
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.old_password', lang)} *</label>
              <input type="password" name="old_password" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.new_password', lang)} *</label>
              <input type="password" name="new_password" required minLength={6} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.confirm_password', lang)} *</label>
              <input type="password" name="confirm_password" required minLength={6} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
            </div>
            <div class="flex space-x-4">
              <button type="submit" class="px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
                {t('admin.save', lang)}
              </button>
              <a href="/admin" class="px-6 py-2.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition-colors">
                {t('admin.cancel', lang)}
              </a>
            </div>
          </form>
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/password', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();
  const oldPassword = String(body['old_password'] || '');
  const newPassword = String(body['new_password'] || '');
  const confirmPassword = String(body['confirm_password'] || '');

  if (newPassword.length < 6) {
    return c.redirect('/admin/password?error=short');
  }

  if (newPassword !== confirmPassword) {
    return c.redirect('/admin/password?error=mismatch');
  }

  // Verify old password against the first admin user (current session)
  const user = await db.prepare('SELECT id, password_hash FROM admin_users ORDER BY id LIMIT 1').first<{ id: number; password_hash: string }>();

  if (!user || !(await verifyPassword(oldPassword, user.password_hash))) {
    return c.redirect('/admin/password?error=old');
  }

  // Update password
  const newHash = await hashPassword(newPassword);
  await db.prepare('UPDATE admin_users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();

  return c.redirect('/admin/password?success=1');
});

// ==========================================
// Admin: Provider CRUD
// ==========================================

// Provider Form Component
function ProviderForm({ provider, tags, selectedTags, lang, action, csrfToken }: {
  provider?: Provider;
  tags: Tag[];
  selectedTags: number[];
  lang: Lang;
  action: string;
  csrfToken: string;
}) {
  return (
    <form method="post" action={action} enctype="multipart/form-data" class="space-y-6">
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '中文名称' : 'Chinese Name'} *</label>
          <input type="text" name="name_zh" required value={provider?.name_zh || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '英文名称' : 'English Name'} *</label>
          <input type="text" name="name_en" required value={provider?.name_en || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Slug</label>
          <input type="text" name="slug" value={provider?.slug || ''} placeholder={lang === 'zh' ? '留空自动生成' : 'Leave empty to auto-generate'} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.website', lang)}</label>
          <input type="url" name="website" value={provider?.website || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.founded', lang)}</label>
          <input type="text" name="founded_date" value={provider?.founded_date || ''} placeholder="YYYY-MM" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.apply_method', lang)}</label>
          <input type="text" name="apply_method" value={provider?.apply_method || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.region', lang)}</label>
          <input type="text" name="region" value={provider?.region || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('common.status', lang)}</label>
          <select name="status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
            <option value="active" selected={(!provider || provider.status === 'active')}>{t('common.active', lang)}</option>
            <option value="inactive" selected={provider?.status === 'inactive'}>{t('common.inactive', lang)}</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.kyc', lang)}</label>
          <select name="need_kyc" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
            <option value="0" selected={(!provider || !provider.need_kyc)}>{t('provider.kyc_no', lang)}</option>
            <option value="1" selected={!!provider?.need_kyc}>{t('provider.kyc_yes', lang)}</option>
          </select>
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '中文描述' : 'Chinese Description'}</label>
        <textarea name="desc_zh" rows={3} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">{provider?.desc_zh || ''}</textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{lang === 'zh' ? '英文描述' : 'English Description'}</label>
        <textarea name="desc_en" rows={3} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">{provider?.desc_en || ''}</textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{t('admin.upload_logo', lang)}</label>
        <input type="file" name="logo" accept="image/*" class="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        {provider?.logo_url && <p class="text-xs text-gray-400 mt-1">{lang === 'zh' ? '当前Logo' : 'Current logo'}: {provider.logo_url}</p>}
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-2">{t('admin.manage_tags', lang)}</label>
        <div class="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <label class="flex items-center space-x-1 px-3 py-1.5 bg-gray-50 rounded-lg cursor-pointer hover:bg-brand-50">
              <input type="checkbox" name="tags" value={String(tag.id)} checked={selectedTags.includes(tag.id)} class="rounded" />
              <span class="text-sm">{tagName(tag, lang)}</span>
            </label>
          ))}
        </div>
      </div>
      <div class="flex space-x-4">
        <button type="submit" class="px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
          {t('admin.save', lang)}
        </button>
        <a href="/admin" class="px-6 py-2.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition-colors">
          {t('admin.cancel', lang)}
        </a>
      </div>
    </form>
  );
}

// New Provider
app.get('/admin/provider/new', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const csrfToken = getCsrfToken(c);
  const tags = await c.env.DB.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>();

  return c.html(
    <Layout title={t('admin.add_provider', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, '/admin/provider/new')} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.add_provider', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ProviderForm tags={tags.results} selectedTags={[]} lang={lang} action="/admin/provider/new" csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/provider/new', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();

  // Handle logo upload
  let logoUrl: string | null = null;
  const logo = body['logo'];
  if (logo && typeof logo === 'object' && 'arrayBuffer' in logo) {
    const file = logo as { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };
    if (file.size > 0) {
      const ext = file.name.split('.').pop() || 'png';
      const key = `logos/${Date.now()}.${ext}`;
      await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      logoUrl = key;
    }
  }

  const slug = String(body['slug'] || '') || generateSlug(String(body['name_en'] || ''));

  const result = await db.prepare(
    'INSERT INTO vcc_providers (name_zh, name_en, website, founded_date, apply_method, desc_zh, desc_en, need_kyc, region, status, logo_url, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body['name_zh'], body['name_en'], body['website'] || null, body['founded_date'] || null,
    body['apply_method'] || null, body['desc_zh'] || null, body['desc_en'] || null,
    Number(body['need_kyc'] || 0), body['region'] || null, body['status'] || 'active', logoUrl, slug
  ).run();

  // Handle tags
  const providerId = result.meta.last_row_id;
  const tagIds = Array.isArray(body['tags']) ? body['tags'] : body['tags'] ? [body['tags']] : [];
  for (const tagId of tagIds) {
    await db.prepare('INSERT OR IGNORE INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(providerId, tagId).run();
  }

  return c.redirect('/admin');
});

// Edit Provider
app.get('/admin/provider/:id/edit', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const id = c.req.param('id');
  const csrfToken = getCsrfToken(c);

  const [provider, tags, selectedTagsResult] = await Promise.all([
    db.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>(),
    db.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>(),
    db.prepare('SELECT tag_id FROM vcc_provider_tags WHERE provider_id = ?').bind(id).all<{ tag_id: number }>(),
  ]);

  if (!provider) return c.redirect('/admin');

  const selectedTags = selectedTagsResult.results.map(r => r.tag_id);

  return c.html(
    <Layout title={t('admin.edit_provider', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, `/admin/provider/${id}/edit`)} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.edit_provider', lang)}: {providerName(provider, lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ProviderForm provider={provider} tags={tags.results} selectedTags={selectedTags} lang={lang} action={`/admin/provider/${id}/edit`} csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/provider/:id/edit', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.parseBody();

  // Handle logo upload
  let logoUpdate = '';
  const logoParams: unknown[] = [];
  const logo = body['logo'];
  if (logo && typeof logo === 'object' && 'arrayBuffer' in logo) {
    const file = logo as { name: string; size: number; type: string; arrayBuffer(): Promise<ArrayBuffer> };
    if (file.size > 0) {
      const ext = file.name.split('.').pop() || 'png';
      const key = `logos/${Date.now()}.${ext}`;
      await c.env.R2.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
      logoUpdate = ', logo_url = ?';
      logoParams.push(key);
    }
  }

  const slug = String(body['slug'] || '') || generateSlug(String(body['name_en'] || ''));

  await db.prepare(
    `UPDATE vcc_providers SET name_zh = ?, name_en = ?, website = ?, founded_date = ?, apply_method = ?, desc_zh = ?, desc_en = ?, need_kyc = ?, region = ?, status = ?, slug = ?, updated_at = datetime('now')${logoUpdate} WHERE id = ?`
  ).bind(
    body['name_zh'], body['name_en'], body['website'] || null, body['founded_date'] || null,
    body['apply_method'] || null, body['desc_zh'] || null, body['desc_en'] || null,
    Number(body['need_kyc'] || 0), body['region'] || null, body['status'] || 'active', slug,
    ...logoParams, id
  ).run();

  // Update tags
  await db.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(id).run();
  const tagIds = Array.isArray(body['tags']) ? body['tags'] : body['tags'] ? [body['tags']] : [];
  for (const tagId of tagIds) {
    await db.prepare('INSERT OR IGNORE INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(id, tagId).run();
  }

  return c.redirect('/admin');
});

// Delete Provider
app.post('/admin/provider/:id/delete', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM vcc_providers WHERE id = ?').bind(id).run();
  return c.redirect('/admin');
});

// ==========================================
// Admin: Card CRUD
// ==========================================

function CardForm({ card, providers, lang, action, csrfToken }: {
  card?: Card;
  providers: Provider[];
  lang: Lang;
  action: string;
  csrfToken: string;
}) {
  return (
    <form method="post" action={action} class="space-y-6">
      <input type="hidden" name="csrf_token" value={csrfToken} />
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.provider', lang)} *</label>
          <select name="provider_id" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
            <option value="">{t('admin.select_provider', lang)}</option>
            {providers.map((p) => (
              <option value={String(p.id)} selected={card?.provider_id === p.id}>{providerName(p, lang)}</option>
            ))}
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">BIN *</label>
          <input type="text" name="bin" required value={card?.bin || ''} placeholder="e.g. 556150" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">Slug</label>
          <input type="text" name="slug" value={card?.slug || ''} placeholder={lang === 'zh' ? '留空自动生成' : 'Leave empty to auto-generate'} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none font-mono text-sm" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.type', lang)} *</label>
          <select name="card_type" required class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
            <option value="Visa" selected={card?.card_type === 'Visa'}>Visa</option>
            <option value="Mastercard" selected={card?.card_type === 'Mastercard'}>Mastercard</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.currency', lang)}</label>
          <input type="text" name="currency" value={card?.currency || 'USD'} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.issuance_fee', lang)} ($) *</label>
          <input type="number" name="issuance_fee" required step="0.01" min="0" value={String(card?.issuance_fee ?? 0)} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.fee_rate', lang)} (%)</label>
          <input type="number" name="fee_rate" step="0.01" min="0" value={String(card?.fee_rate ?? 0)} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.monthly_fee', lang)} ($)</label>
          <input type="number" name="monthly_fee" step="0.01" min="0" value={String(card?.monthly_fee ?? 0)} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.initial_load', lang)} ($)</label>
          <input type="number" name="initial_load" step="0.01" min="0" value={String(card?.initial_load ?? 0)} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.quota', lang)}</label>
          <input type="text" name="quota" value={card?.quota || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">{t('card.usage', lang)}</label>
          <input type="text" name="usage" value={card?.usage || ''} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none" />
        </div>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{t('provider.description', lang)}</label>
        <textarea name="description" rows={3} class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">{card?.description || ''}</textarea>
      </div>
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">{t('common.status', lang)}</label>
        <select name="status" class="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-transparent outline-none">
          <option value="active" selected={(!card || card.status === 'active')}>{t('common.active', lang)}</option>
          <option value="inactive" selected={card?.status === 'inactive'}>{t('common.inactive', lang)}</option>
        </select>
      </div>
      <div class="flex space-x-4">
        <button type="submit" class="px-6 py-2.5 bg-brand-600 text-white rounded-lg font-medium hover:bg-brand-700 transition-colors">
          {t('admin.save', lang)}
        </button>
        <a href="/admin" class="px-6 py-2.5 bg-gray-100 text-gray-600 rounded-lg font-medium hover:bg-gray-200 transition-colors">
          {t('admin.cancel', lang)}
        </a>
      </div>
    </form>
  );
}

// New Card
app.get('/admin/card/new', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const csrfToken = getCsrfToken(c);
  const providers = await c.env.DB.prepare('SELECT * FROM vcc_providers ORDER BY name_en').all<Provider>();

  return c.html(
    <Layout title={t('admin.add_card', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, '/admin/card/new')} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.add_card', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <CardForm providers={providers.results} lang={lang} action="/admin/card/new" csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/card/new', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();

  // Auto-generate slug from provider slug + BIN if not provided
  let slug = String(body['slug'] || '');
  if (!slug) {
    const provider = await db.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(body['provider_id']).first<{ slug: string }>();
    slug = `${provider?.slug || 'card'}-${body['bin']}`;
  }

  await db.prepare(
    'INSERT INTO vcc_cards (provider_id, bin, card_type, currency, issuance_fee, fee_rate, monthly_fee, initial_load, quota, usage, description, status, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body['provider_id'], body['bin'], body['card_type'], body['currency'] || 'USD',
    Number(body['issuance_fee'] || 0), Number(body['fee_rate'] || 0),
    Number(body['monthly_fee'] || 0), Number(body['initial_load'] || 0),
    body['quota'] || null, body['usage'] || null, body['description'] || null,
    body['status'] || 'active', slug
  ).run();

  return c.redirect('/admin');
});

// Edit Card
app.get('/admin/card/:id/edit', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const id = c.req.param('id');
  const csrfToken = getCsrfToken(c);

  const [card, providers] = await Promise.all([
    db.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>(),
    db.prepare('SELECT * FROM vcc_providers ORDER BY name_en').all<Provider>(),
  ]);

  if (!card) return c.redirect('/admin');

  return c.html(
    <Layout title={t('admin.edit_card', lang)} lang={lang} isAdmin={true} canonicalUrl={absoluteUrl(c, `/admin/card/${id}/edit`)} noIndex>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.edit_card', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <CardForm card={card} providers={providers.results} lang={lang} action={`/admin/card/${id}/edit`} csrfToken={csrfToken} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/card/:id/edit', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.parseBody();

  // Auto-generate slug from provider slug + BIN if not provided
  let slug = String(body['slug'] || '');
  if (!slug) {
    const provider = await db.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(body['provider_id']).first<{ slug: string }>();
    slug = `${provider?.slug || 'card'}-${body['bin']}`;
  }

  await db.prepare(
    'UPDATE vcc_cards SET provider_id = ?, bin = ?, card_type = ?, currency = ?, issuance_fee = ?, fee_rate = ?, monthly_fee = ?, initial_load = ?, quota = ?, usage = ?, description = ?, status = ?, slug = ? WHERE id = ?'
  ).bind(
    body['provider_id'], body['bin'], body['card_type'], body['currency'] || 'USD',
    Number(body['issuance_fee'] || 0), Number(body['fee_rate'] || 0),
    Number(body['monthly_fee'] || 0), Number(body['initial_load'] || 0),
    body['quota'] || null, body['usage'] || null, body['description'] || null,
    body['status'] || 'active', slug, id
  ).run();

  return c.redirect('/admin');
});

// Delete Card
app.post('/admin/card/:id/delete', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM vcc_cards WHERE id = ?').bind(id).run();
  return c.redirect('/admin');
});

// ==========================================
// Export
// ==========================================
export default app;

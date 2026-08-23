// Worker entry point: middleware, language routing, image proxy, robots, sitemap, and route wiring.
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { getLang, langPath } from './i18n';
import type { Env } from './types';
import { ApiError } from './lib/api';
import { siteOrigin, absoluteUrl } from './lib/seo';
import { homePage, providersPage, providerPage, cardPage, contentListPage, contentDetailPage } from './pages';
import { adminApi } from './admin';

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

  const pageUrl = new URL(c.req.url);
  const pathname = pageUrl.pathname;
  const isExempt = /^\/(?:api|images|lang)\//.test(pathname) || ['/robots.txt', '/sitemap.xml', '/favicon.ico', '/vccdirindexnow42k7q9m3xp1w5n8z6.txt'].includes(pathname);
  // Visitors who chose English get forwarded to the /en version; crawlers without cookies see the default pages.
  if (getLang(getCookie(c, 'lang')) === 'en' && pathname !== '/en' && !pathname.startsWith('/en/') && !isExempt) {
    return c.redirect(`/en${pathname === '/' ? '' : pathname}${pageUrl.search}`, 302);
  }

  await next();

  // Public pages vary by language, so keep HTML out of browser and edge caches.
  if ((c.res.headers.get('Content-Type') || '').startsWith('text/html')) {
    c.res.headers.set('Cache-Control', 'no-cache');
  }
});

// ==========================================
// Language Switch
// ==========================================
app.get('/lang/:lang', (c) => {
  const target = c.req.param('lang');
  if (target !== 'zh' && target !== 'en') return c.redirect('/');
  setCookie(c, 'lang', target, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: false,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
  });
  const current = new URL(c.req.url);
  const referer = new URL(c.req.header('Referer') || '/', current);
  let targetPath = referer.origin === current.origin ? `${referer.pathname}${referer.search}` : '/';
  if (target === 'en') {
    if (targetPath !== '/en' && !targetPath.startsWith('/en/')) targetPath = `/en${targetPath === '/' ? '' : targetPath}`;
  } else {
    targetPath = targetPath.replace(/^\/en(?=\/|$)/, '') || '/';
  }
  return c.redirect(targetPath);
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

// IndexNow key verification: path and body are both the key, which is public by protocol design.
app.get('/vccdirindexnow42k7q9m3xp1w5n8z6.txt', (c) => c.text('vccdirindexnow42k7q9m3xp1w5n8z6'));

// ==========================================
// Route Wiring
// ==========================================
app.route('/api/admin', adminApi);

app.get('/', homePage);
app.get('/en', homePage);
app.get('/en/', homePage);
// The card BIN directory was removed; keep its link equity flowing to the platform directory.
app.get('/cards', (c) => c.redirect('/providers', 301));
app.get('/en/cards', (c) => c.redirect('/en/providers', 301));
app.get('/providers', providersPage);
app.get('/en/providers', providersPage);
app.get('/provider/:slug', providerPage);
app.get('/en/provider/:slug', providerPage);
app.get('/card/:slug', cardPage);
app.get('/en/card/:slug', cardPage);
app.get('/content', contentListPage);
app.get('/en/content', contentListPage);
app.get('/content/:slug', contentDetailPage);
app.get('/en/content/:slug', contentDetailPage);

app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: error.message }, error.status);
  const message = error instanceof Error ? error.message : String(error);
  if (/UNIQUE constraint failed/i.test(message)) return c.json({ error: 'A record with the same unique value already exists' }, 409);
  if (/FOREIGN KEY constraint failed/i.test(message)) return c.json({ error: 'A referenced record does not exist' }, 400);
  console.error(error);
  return c.json({ error: 'Internal server error' }, 500);
});

// ==========================================
// Sitemap.xml
// ==========================================
app.get('/sitemap.xml', async (c) => {
  const db = c.env.DB;
  const origin = siteOrigin(c);

  const [providers, cards, posts] = await Promise.all([
    db.prepare('SELECT slug, updated_at, status FROM vcc_providers ORDER BY updated_at DESC').all<{ slug: string; updated_at: string; status: string }>(),
    db.prepare('SELECT c.slug, c.created_at FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id WHERE c.status = ? AND p.status = ? ORDER BY c.created_at DESC').bind('active', 'active').all<{ slug: string; created_at: string }>(),
    db.prepare('SELECT slug, updated_at FROM content_posts WHERE status = ? ORDER BY published_at DESC').bind('published').all<{ slug: string; updated_at: string }>(),
  ]);

  // Each page is emitted in both languages; every entry lists its hreflang alternates.
  const alternate = (hreflang: string, href: string) => `\n    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}"/>`;
  const urlEntry = (path: string, changefreq: string, priority: string, lastmod?: string) => {
    const zhUrl = `${origin}${path}`;
    const enUrl = `${origin}${langPath('en', path)}`;
    const links = `${alternate('zh-CN', zhUrl)}${alternate('en', enUrl)}${alternate('x-default', zhUrl)}`;
    const mod = lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : '';
    return `  <url>
    <loc>${zhUrl}</loc>${links}${mod}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>
  <url>
    <loc>${enUrl}</loc>${links}${mod}
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
  };

  const urls: string[] = [
    urlEntry('/', 'daily', '1.0'),
    urlEntry('/providers', 'weekly', '0.9'),
  ];

  // Inactive providers stay listed at low priority so their stopped-operating warnings stay discoverable.
  for (const p of providers.results) {
    const active = p.status === 'active';
    urls.push(urlEntry(`/provider/${p.slug}`, active ? 'weekly' : 'yearly', active ? '0.8' : '0.3', p.updated_at ? p.updated_at.split(' ')[0] : undefined));
  }
  for (const card of cards.results) urls.push(urlEntry(`/card/${card.slug}`, 'monthly', '0.6', card.created_at ? card.created_at.split(' ')[0] : undefined));
  urls.push(urlEntry('/content', 'weekly', '0.7'));
  for (const post of posts.results) urls.push(urlEntry(`/content/${post.slug}`, 'monthly', '0.6', post.updated_at ? post.updated_at.split(' ')[0] : undefined));

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
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

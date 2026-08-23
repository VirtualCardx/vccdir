// Edge-page caching via the Workers Cache API, plus precise purging after admin mutations.
// Cache keys keep only the `page` parameter so tracking params cannot create variants.
import type { Context } from 'hono';
import type { Env } from '../types';
import { siteOrigin } from './seo';

const LIST_PATHS = new Set(['/', '/en', '/en/', '/providers', '/en/providers', '/cards', '/en/cards', '/content', '/en/content']);
const DETAIL_PREFIXES = ['/provider/', '/en/provider/', '/card/', '/en/card/', '/content/'];

export const LIST_CACHE_CONTROL = 'public, max-age=60, s-maxage=600, stale-while-revalidate=86400';
export const DETAIL_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

// Only plain GET/HEAD list or detail pages with at most a `page` parameter are cacheable;
// search variants and anything with extra query params must not enter the cache.
export function cacheablePageRequest(method: string, pathname: string, search: URLSearchParams): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  if (!LIST_PATHS.has(pathname) && !DETAIL_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  for (const key of search.keys()) if (key !== 'page') return false;
  return true;
}

function pageCacheKey(origin: string, pathname: string, page: string | null): Request {
  return new Request(page ? `${origin}${pathname}?page=${page}` : `${origin}${pathname}`, { method: 'GET' });
}

const cacheAvailable = () => typeof caches !== 'undefined';

// Serve from the edge cache when possible; must run after the language-cookie redirect
// so cookie users are never served the wrong language from cache.
export async function lookupPageCache(c: Context<Env>): Promise<Response | undefined> {
  if (!cacheAvailable()) return undefined;
  const url = new URL(c.req.url);
  if (!cacheablePageRequest(c.req.method, url.pathname, url.searchParams)) return undefined;
  if (c.req.header('Authorization')) return undefined;
  return caches.default.match(pageCacheKey(siteOrigin(c), url.pathname, url.searchParams.get('page')));
}

// Store a 200 response and apply its public Cache-Control; returns true when handled,
// so callers know not to overwrite the header with the no-cache fallback.
export async function storePageCache(c: Context<Env>): Promise<boolean> {
  const url = new URL(c.req.url);
  if (!cacheablePageRequest(c.req.method, url.pathname, url.searchParams)) return false;
  if (c.res.status !== 200 || c.res.headers.get('Set-Cookie') || c.req.header('Authorization')) return false;
  const isList = LIST_PATHS.has(url.pathname);
  c.res.headers.set('Cache-Control', isList ? LIST_CACHE_CONTROL : DETAIL_CACHE_CONTROL);
  if (!cacheAvailable()) return true;
  try {
    c.executionCtx.waitUntil(caches.default.put(
      pageCacheKey(siteOrigin(c), url.pathname, url.searchParams.get('page')),
      c.res.clone()
    ));
  } catch {
    // Outside the Workers runtime (tests); the header is still set.
  }
  return true;
}

export async function purgePaths(origin: string, paths: string[]): Promise<void> {
  if (!cacheAvailable()) return;
  await Promise.all(paths.map((path) => caches.default.delete(new Request(origin + path, { method: 'GET' }))));
}

// Returns FULL origin-prefixed URLs: purgePaths strips the origin again, so list
// pagination must be absolute like the detail paths to survive that strip.
async function listPagePaths(db: D1Database, origin: string, countSql: string, pageSize: number, bases: string[]): Promise<string[]> {
  const row = await db.prepare(countSql).first<{ c: number }>();
  const pages = Math.min(Math.ceil((row?.c || 0) / pageSize) + 1, 50);
  const paths: string[] = [];
  for (const base of bases) {
    for (let page = 1; page <= pages; page++) {
      paths.push(page > 1 ? `${origin}${base}?page=${page}` : `${origin}${base}`);
      // page=1 is stored as a distinct key when requested explicitly with ?page=1.
      if (page === 1) paths.push(`${origin}${base}?page=1`);
    }
  }
  return paths;
}

const homeAndSitemap = (origin: string) => [`${origin}/`, `${origin}/en`, `${origin}/en/`, `${origin}/sitemap.xml`];

export async function purgeProviderUpdate(db: D1Database, origin: string, slugs: string[]): Promise<void> {
  const paths = homeAndSitemap(origin);
  for (const slug of slugs) if (slug) paths.push(`${origin}/provider/${slug}`, `${origin}/en/provider/${slug}`);
  paths.push(...await listPagePaths(db, origin, `SELECT COUNT(*) AS c FROM vcc_providers WHERE status = 'active'`, 12, ['/providers', '/en/providers']));
  await purgePaths(origin, paths.map((p) => p.slice(origin.length)));
}

export async function purgeCardUpdate(db: D1Database, origin: string, cardSlugs: string[], providerSlugs: string[]): Promise<void> {
  const paths = homeAndSitemap(origin);
  for (const slug of cardSlugs) if (slug) paths.push(`${origin}/card/${slug}`, `${origin}/en/card/${slug}`);
  for (const slug of providerSlugs) if (slug) paths.push(`${origin}/provider/${slug}`, `${origin}/en/provider/${slug}`);
  paths.push(...await listPagePaths(db, origin,
    `SELECT COUNT(*) AS c FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id WHERE c.status = 'active' AND p.status = 'active'`,
    12, ['/cards', '/en/cards']));
  paths.push(...await listPagePaths(db, origin, `SELECT COUNT(*) AS c FROM vcc_providers WHERE status = 'active'`, 12, ['/providers', '/en/providers']));
  await purgePaths(origin, paths.map((p) => p.slice(origin.length)));
}

export async function purgeContentUpdate(db: D1Database, origin: string, slugs: string[]): Promise<void> {
  const paths = homeAndSitemap(origin);
  for (const slug of slugs) if (slug) paths.push(`${origin}/content/${slug}`, `${origin}/en/content/${slug}`);
  paths.push(...await listPagePaths(db, origin, `SELECT COUNT(*) AS c FROM content_posts WHERE status = 'published'`, 9, ['/content', '/en/content']));
  await purgePaths(origin, paths.map((p) => p.slice(origin.length)));
}

export async function purgeTagUpdate(db: D1Database, origin: string): Promise<void> {
  const paths = homeAndSitemap(origin);
  paths.push(...await listPagePaths(db, origin, `SELECT COUNT(*) AS c FROM vcc_providers WHERE status = 'active'`, 12, ['/providers', '/en/providers']));
  await purgePaths(origin, paths.map((p) => p.slice(origin.length)));
}

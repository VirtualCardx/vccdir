import { describe, expect, it } from 'vitest';
import { app, generateSlug, pageUrl, publicPageNumber, sanitizeContentHtml } from './index';

const baseEnv = {
  SITE_URL: 'https://www.vccdir.com',
  HERMES_API_TOKEN: 'a-secure-test-token',
} as CloudflareBindings;

interface MockOptions {
  assertQuery?: (query: string, params: unknown[]) => void;
  first?: Record<string, unknown> | null;
  results?: Record<string, unknown>[];
}

// Minimal D1 stub: statements run directly or through bind() and return the configured row and list.
function mockDatabase({ assertQuery, first = null, results = [] }: MockOptions = {}): D1Database {
  const execute = () => ({ first: async () => first, all: async () => ({ results }) });
  return {
    prepare(query: string) {
      return {
        ...execute(),
        bind: (...params: unknown[]) => {
          assertQuery?.(query, params);
          return execute();
        },
      };
    },
  } as unknown as D1Database;
}

describe('public routing', () => {
  it('does not expose the removed login route', async () => {
    const response = await app.request('https://www.vccdir.com/login', {}, baseEnv);
    expect(response.status).toBe(404);
  });

  it('redirects the bare domain to the www origin', async () => {
    const response = await app.request('https://vccdir.com/cards', {}, baseEnv);
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('https://www.vccdir.com/cards');
  });

  it('renders the homepage with an empty database and hardening headers', async () => {
    const response = await app.request('https://www.vccdir.com/', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('发现适合你的虚拟信用卡');
    expect(response.headers.get('Content-Security-Policy')).toContain('default-src');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('requires active providers on public detail pages', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (query, params) => {
          expect(query).toContain('status = ?');
          expect(params).toEqual(['hidden-provider', 'active']);
        },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/provider/hidden-provider', {}, env);
    expect(response.status).toBe(404);
  });

  it('requires active cards and providers on public card pages', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (query, params) => {
          expect(query).toContain('c.status = ?');
          expect(query).toContain('p.status = ?');
          expect(params).toEqual(['hidden-card', 'active', 'active']);
        },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/card/hidden-card', {}, env);
    expect(response.status).toBe(404);
  });

  it('renders the content index with an empty database', async () => {
    const response = await app.request('https://www.vccdir.com/content', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
  });

  it('marks card search results noindex while normal listings stay indexable', async () => {
    const env = { ...baseEnv, DB: mockDatabase() } as CloudflareBindings;
    const listing = await app.request('https://www.vccdir.com/cards', {}, env);
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain('index, follow');

    const search = await app.request('https://www.vccdir.com/cards?q=visa', {}, env);
    expect(search.status).toBe(200);
    expect(await search.text()).toContain('noindex, follow');
  });

  it('escapes LIKE wildcards in card search terms', async () => {
    let capturedQuery = '';
    let capturedParams: unknown[] = [];
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (query, params) => {
          capturedQuery = query;
          capturedParams = params;
        },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/cards?q=100%25', {}, env);
    expect(response.status).toBe(200);
    expect(capturedQuery).toContain("LIKE ? ESCAPE '\\'");
    expect(capturedParams.filter((param) => typeof param === 'string')).toEqual([
      'active', 'active', '%100\\%%', '%100\\%%', '%100\\%%', '%100\\%%', '%100\\%%', '%100\\%%', '%100\\%%',
    ]);
  });

  it('does not redirect language switches to an external referrer', async () => {
    const response = await app.request('https://www.vccdir.com/lang/en', {
      headers: { Referer: 'https://attacker.example/phish' },
    }, baseEnv);
    expect(response.headers.get('Location')).toBe('/');
  });

  it('serves robots.txt with the admin API disallowed', async () => {
    const response = await app.request('https://www.vccdir.com/robots.txt', {}, baseEnv);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Disallow: /api/admin');
    expect(body).toContain('Sitemap: https://www.vccdir.com/sitemap.xml');
  });

  it('serves a sitemap containing the static pages', async () => {
    const response = await app.request('https://www.vccdir.com/sitemap.xml', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<loc>https://www.vccdir.com/</loc>');
    expect(body).toContain('<loc>https://www.vccdir.com/content</loc>');
  });
});

describe('Hermes API security', () => {
  it('rejects requests without a bearer token', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/tags', {}, baseEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('serves list endpoints with a valid bearer token', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/content?status=published', {
      headers: { Authorization: 'Bearer a-secure-test-token' },
    }, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ results: [] });
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it('refuses to serve when only the placeholder token is configured', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/tags', {
      headers: { Authorization: 'Bearer change-me-in-production' },
    }, { ...baseEnv, HERMES_API_TOKEN: 'change-me-in-production' } as CloudflareBindings);
    expect(response.status).toBe(503);
  });
});

describe('content helpers', () => {
  it('creates URL-safe slugs', () => {
    expect(generateSlug('Example Provider 2026')).toBe('example-provider-2026');
  });

  it('removes scripts, event handlers, and unsafe links', () => {
    const html = sanitizeContentHtml('<script>alert(1)</script><p onclick="x">Safe</p><a href="javascript:alert(1)">link</a>');
    expect(html).toBe('<p>Safe</p><a>link</a>');
  });

  it('drops non-whitelisted elements entirely', () => {
    const html = sanitizeContentHtml('<p>ok</p><img src="x" onerror="alert(1)"><iframe src="https://evil.example"></iframe>');
    expect(html).toBe('<p>ok</p>');
  });

  it('keeps safe links and forces target and rel', () => {
    expect(sanitizeContentHtml('<a href="https://example.com/a?b=1">link</a>')).toBe(
      '<a href="https://example.com/a?b=1" target="_blank" rel="noopener noreferrer">link</a>'
    );
  });

  it('builds stable pagination URLs', () => {
    expect(pageUrl('/cards', 1)).toBe('/cards');
    expect(pageUrl('/cards', 2, { q: 'visa usd' })).toBe('/cards?q=visa+usd&page=2');
  });

  it('rejects invalid public page numbers', () => {
    expect(publicPageNumber('2')).toBe(2);
    expect(publicPageNumber('0')).toBeNull();
    expect(publicPageNumber('not-a-page')).toBeNull();
  });
});

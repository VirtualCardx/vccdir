import { describe, expect, it } from 'vitest';
import { app, generateSlug, pageUrl, publicPageNumber, sanitizeContentHtml } from './index';

const baseEnv = {
  SITE_URL: 'https://www.vccdir.com',
  HERMES_API_TOKEN: 'a-secure-test-token',
} as CloudflareBindings;

function emptyDatabase(assertQuery?: (query: string, params: unknown[]) => void): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          assertQuery?.(query, params);
          return { first: async () => null };
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

  it('requires active providers on public detail pages', async () => {
    const env = {
      ...baseEnv,
      DB: emptyDatabase((query, params) => {
        expect(query).toContain('status = ?');
        expect(params).toEqual(['hidden-provider', 'active']);
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/provider/hidden-provider', {}, env);
    expect(response.status).toBe(404);
  });

  it('requires active cards and providers on public card pages', async () => {
    const env = {
      ...baseEnv,
      DB: emptyDatabase((query, params) => {
        expect(query).toContain('c.status = ?');
        expect(query).toContain('p.status = ?');
        expect(params).toEqual(['hidden-card', 'active', 'active']);
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/card/hidden-card', {}, env);
    expect(response.status).toBe(404);
  });

  it('does not redirect language switches to an external referrer', async () => {
    const response = await app.request('https://www.vccdir.com/lang/en', {
      headers: { Referer: 'https://attacker.example/phish' },
    }, baseEnv);
    expect(response.headers.get('Location')).toBe('/');
  });
});

describe('Hermes API security', () => {
  it('rejects requests without a bearer token', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/tags', {}, baseEnv);
    expect(response.status).toBe(401);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
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

import { describe, expect, it } from 'vitest';
import { app } from './index';
import { generateSlug, sanitizeContentHtml, contentBodyHtml } from './lib/sanitize';
import { pageUrl, publicPageNumber, providerDesc } from './lib/seo';
import { assertLogoKey } from './lib/api';
import type { Provider } from './types';

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
  const execute = () => ({
    first: async () => first,
    all: async () => ({ results }),
    run: async () => ({ meta: { last_row_id: 1 } }),
  });
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
    batch: async (statements: unknown[]) => statements.map(() => ({ meta: { last_row_id: 1 } })),
  } as unknown as D1Database;
}

const authHeaders = { Authorization: 'Bearer a-secure-test-token', 'Content-Type': 'application/json' };

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
    const body = await response.text();
    expect(body).toContain('发现适合你的虚拟信用卡');
    expect(body).toContain('虚拟卡平台');
    expect(body).not.toContain('浏览全部虚拟卡');
    expect(response.headers.get('Content-Security-Policy')).toContain('default-src');
    expect(response.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('redirects the removed card directory to the platform directory', async () => {
    const zh = await app.request('https://www.vccdir.com/cards', {}, baseEnv);
    expect(zh.status).toBe(301);
    expect(zh.headers.get('Location')).toBe('/providers');

    const en = await app.request('https://www.vccdir.com/en/cards', {}, baseEnv);
    expect(en.status).toBe(301);
    expect(en.headers.get('Location')).toBe('/en/providers');
  });

  it('serves the English homepage at /en with hreflang alternates', async () => {
    const response = await app.request('https://www.vccdir.com/en', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Find the Right Virtual Card');
    expect(body).toContain('hreflang="en"');
    expect(body).toContain('hreflang="x-default"');
    expect(body).toContain('<link rel="canonical" href="https://www.vccdir.com/en"');
  });

  it('redirects cookie-preferring-English visitors to the /en pages', async () => {
    const response = await app.request('https://www.vccdir.com/cards', {
      headers: { Cookie: 'lang=en' },
    }, baseEnv);
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/en/cards');
  });

  it('does not redirect language switches to an external referrer', async () => {
    const response = await app.request('https://www.vccdir.com/lang/en', {
      headers: { Referer: 'https://attacker.example/phish' },
    }, baseEnv);
    expect(response.headers.get('Location')).toBe('/en');
  });

  it('strips the /en prefix when switching back to Chinese', async () => {
    const response = await app.request('https://www.vccdir.com/lang/zh', {
      headers: { Referer: 'https://www.vccdir.com/en/cards?q=visa' },
    }, baseEnv);
    expect(response.headers.get('Location')).toBe('/cards?q=visa');
  });

  it('returns 404 only for unknown providers', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (query, params) => {
          expect(query).toContain('FROM vcc_providers WHERE slug = ?');
          expect(params).toEqual(['hidden-provider']);
        },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/provider/hidden-provider', {}, env);
    expect(response.status).toBe(404);
  });

  it('serves inactive providers with an indexable stopped-operating notice', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        first: { id: 7, slug: 'gone-card', name_zh: '停运平台', name_en: 'Gone Platform', status: 'inactive' },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/provider/gone-card', {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('该平台已停止运营');
    expect(body).toContain('停运平台');
    expect(body).toContain('index, follow');
    expect(body).not.toContain('noindex');
    expect(body).toContain('hreflang="en"');
    expect(body).toContain('"@type":"Organization"');
    expect(body).not.toContain('FinancialProduct');
  });

  it('lists inactive providers in the sitemap at low priority', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({ results: [{ slug: 'gone-provider', updated_at: '2026-08-01 00:00:00', status: 'inactive' }] }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/sitemap.xml', {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<loc>https://www.vccdir.com/provider/gone-provider</loc>');
    expect(body).toContain('<loc>https://www.vccdir.com/en/provider/gone-provider</loc>');
    expect(body).toContain('<priority>0.3</priority>');
    expect(body).toContain('<changefreq>yearly</changefreq>');
  });

  it('returns 404 only for unknown cards', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (query, params) => {
          expect(query).toContain('FROM vcc_cards c INNER JOIN vcc_providers p');
          expect(query).not.toContain('c.status = ?');
          expect(params).toEqual(['hidden-card']);
        },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/card/hidden-card', {}, env);
    expect(response.status).toBe(404);
  });

  it('serves inactive cards with a stopped-offer notice', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        first: { id: 9, slug: 'gone-bin', bin: '556150', card_type: 'Mastercard', currency: 'USD', status: 'inactive', provider_status: 'active' },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/card/gone-bin', {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('该卡段已停用');
    expect(body).toContain('noindex');
    expect(body).not.toContain('FinancialProduct');
  });

  it('shows the platform notice when the owning provider is inactive', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        first: { id: 10, slug: 'gone-bin-2', bin: '556151', card_type: 'Visa', currency: 'USD', status: 'active', provider_status: 'inactive' },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/card/gone-bin-2', {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('该平台已停止运营');
    expect(body).toContain('noindex');
  });

  it('renders the content index with an empty database', async () => {
    const response = await app.request('https://www.vccdir.com/content', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
  });

  it('renders the provider directory in both languages', async () => {
    const zh = await app.request('https://www.vccdir.com/providers', {}, { ...baseEnv, DB: mockDatabase() });
    expect(zh.status).toBe(200);
    expect(await zh.text()).toContain('虚拟卡平台目录');

    const en = await app.request('https://www.vccdir.com/en/providers', {}, { ...baseEnv, DB: mockDatabase() });
    expect(en.status).toBe(200);
    expect(await en.text()).toContain('Virtual Card Platform Directory');
  });

  it('formats multi-line provider descriptions into paragraphs', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        first: { id: 1, slug: 'aven-card', name_zh: '测试平台', name_en: 'Test Platform', status: 'active', desc_zh: '第一段\n\n第二段', desc_en: 'Para one\n\nPara two' },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/provider/aven-card', {}, env);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('<p>第一段</p>');
    expect(body).toContain('<p>第二段</p>');
  });

  it('marks provider search results noindex while normal listings stay indexable', async () => {
    const env = { ...baseEnv, DB: mockDatabase() } as CloudflareBindings;
    const listing = await app.request('https://www.vccdir.com/providers', {}, env);
    expect(listing.status).toBe(200);
    expect(await listing.text()).toContain('index, follow');

    const search = await app.request('https://www.vccdir.com/providers?q=visa', {}, env);
    expect(search.status).toBe(200);
    expect(await search.text()).toContain('noindex, follow');
  });

  it('keeps LIKE patterns within the D1 50-byte budget', async () => {
    let capturedParams: unknown[] = [];
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        assertQuery: (_query, params) => { capturedParams = params; },
      }),
    } as CloudflareBindings;
    const response = await app.request(`https://www.vccdir.com/providers?q=${'a'.repeat(60)}`, {}, env);
    expect(response.status).toBe(200);
    const patterns = capturedParams.filter((param): param is string => typeof param === 'string' && param.startsWith('%'));
    expect(patterns.length).toBeGreaterThan(0);
    for (const pattern of patterns) {
      expect(new TextEncoder().encode(pattern).length).toBeLessThanOrEqual(50);
    }
  });

  it('serves robots.txt with the admin API disallowed', async () => {
    const response = await app.request('https://www.vccdir.com/robots.txt', {}, baseEnv);
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('Disallow: /api/admin');
    expect(body).toContain('Sitemap: https://www.vccdir.com/sitemap.xml');
  });

  it('serves the IndexNow key verification file', async () => {
    const response = await app.request('https://www.vccdir.com/vccdirindexnow42k7q9m3xp1w5n8z6.txt', {}, baseEnv);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('vccdirindexnow42k7q9m3xp1w5n8z6');
  });

  it('serves a bilingual sitemap with hreflang alternates', async () => {
    const response = await app.request('https://www.vccdir.com/sitemap.xml', {}, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('xmlns:xhtml');
    expect(body).toContain('<loc>https://www.vccdir.com/</loc>');
    expect(body).toContain('<loc>https://www.vccdir.com/en</loc>');
    expect(body).toContain('<loc>https://www.vccdir.com/providers</loc>');
    expect(body).not.toContain('/cards</loc>');
    expect(body).toContain('hreflang="x-default"');
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

describe('Hermes API mutations', () => {
  it('creates providers and returns them with tags and card count', async () => {
    const env = {
      ...baseEnv,
      DB: mockDatabase({
        first: { id: 1, name_zh: '测试平台', name_en: 'Test Provider', slug: 'test-provider', status: 'active' },
      }),
    } as CloudflareBindings;
    const response = await app.request('https://www.vccdir.com/api/admin/providers', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name_zh: '测试平台', name_en: 'Test Provider' }),
    }, env);
    expect(response.status).toBe(201);
    const provider = (await response.json()) as Record<string, unknown>;
    expect(provider.name_en).toBe('Test Provider');
    expect(provider.tags).toEqual([]);
    expect(provider.card_count).toBe(0);
  });

  it('rejects card BINs that are not 6 to 19 digits', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/cards', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ provider_id: 1, bin: 'abc12', card_type: 'Visa' }),
    }, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(400);
    expect(await response.json()).toHaveProperty('error');
  });

  it('deletes cards through the admin API', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/cards/5', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer a-secure-test-token' },
    }, { ...baseEnv, DB: mockDatabase() });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});

describe('meta description sanitizing', () => {
  const providerWith = (desc_zh: string) => ({ name_zh: '测试平台', name_en: 'Test', desc_zh, desc_en: '' }) as unknown as Provider;

  it('strips tags and entities from provider descriptions and clamps length', () => {
    const meta = providerDesc(providerWith(`<p><strong>安全</strong>可靠&amp;快捷</p>\n${'很好'.repeat(120)}`), 'zh');
    expect(meta).not.toContain('<');
    expect(meta).not.toContain('&amp');
    expect(meta.length).toBeLessThanOrEqual(160);
    expect(meta.endsWith('…')).toBe(true);
  });

  it('pads short provider descriptions with the fallback sentence', () => {
    const meta = providerDesc(providerWith('很短'), 'zh');
    expect(meta).toContain('很短');
    expect(meta).toContain('虚拟信用卡平台');
  });

  it('clamps the padded fallback path for English descriptions', () => {
    const provider = { name_zh: '测试平台', name_en: 'Test Platform', desc_zh: '', desc_en: 'Short but valid description for testing.' } as unknown as Provider;
    const meta = providerDesc(provider, 'en');
    expect(meta.length).toBeLessThanOrEqual(160);
    expect(meta.endsWith('…')).toBe(true);
  });

  it('decodes common HTML entities instead of dropping them', () => {
    const meta = providerDesc(providerWith('BitGo Bank &amp; Trust 托管。'), 'zh');
    expect(meta).toContain('BitGo Bank & Trust');
  });

  it('accepts legacy ico and svg logo keys but rejects other formats', () => {
    expect(assertLogoKey('logos/old-logo.ico')).toBe('logos/old-logo.ico');
    expect(assertLogoKey('logos/old-logo.svg')).toBe('logos/old-logo.svg');
    expect(assertLogoKey(null)).toBeNull();
    expect(() => assertLogoKey('logos/bad.txt')).toThrow();
  });

  it('deletes non-UUID legacy image keys', async () => {
    const response = await app.request('https://www.vccdir.com/api/admin/images/logos/easypay-1786273844.png', {
      method: 'DELETE',
      headers: { Authorization: 'Bearer a-secure-test-token' },
    }, { ...baseEnv, DB: mockDatabase(), R2: { delete: async () => undefined } as unknown as R2Bucket });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
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

  it('wraps leading bare text only before block-level tags', () => {
    expect(contentBodyHtml('平台介绍文字\n\n<p><strong>产品费率：</strong>详情</p>')).toBe(
      '<p>平台介绍文字</p><p><strong>产品费率：</strong>详情</p>'
    );
    expect(contentBodyHtml('介绍\n<strong>费率</strong>说明')).toBe('介绍\n<strong>费率</strong>说明');
    expect(contentBodyHtml('  \n<p>仅块级</p>')).toBe('  \n<p>仅块级</p>');
  });

  it('rejects invalid public page numbers', () => {
    expect(publicPageNumber('2')).toBe(2);
    expect(publicPageNumber('0')).toBeNull();
    expect(publicPageNumber('not-a-page')).toBeNull();
  });
});

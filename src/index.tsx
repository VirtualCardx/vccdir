import { Hono } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { Layout } from './layout';
import { t, getLang } from './i18n';
import type { Provider, Card, Tag, ProviderWithTags, CardWithProvider, Lang } from './types';

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

function isLoggedIn(c: { req: { raw: Request } }): boolean {
  const cookie = c.req.raw.headers.get('Cookie') || '';
  return cookie.includes('admin_session=1');
}

function providerName(p: Provider | { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? p.name_zh : p.name_en;
}

function providerDesc(p: Provider, lang: Lang): string {
  return (lang === 'zh' ? p.desc_zh : p.desc_en) || '';
}

function tagName(tag: Tag, lang: Lang): string {
  return lang === 'zh' ? tag.name_zh : tag.name_en;
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
app.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.R2.get(key);
  if (!object) return c.notFound();
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'public, max-age=86400');
  return new Response(object.body, { headers });
});

// ==========================================
// Homepage - Provider Grid
// ==========================================
app.get('/', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const admin = isLoggedIn(c);
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

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: t('site.title', lang),
    description: t('site.description', lang),
    numberOfItems: providers.results.length,
    itemListElement: providersWithTags.map((p, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      item: {
        '@type': 'FinancialProduct',
        name: providerName(p, 'en'),
        description: p.desc_en || p.desc_zh,
        url: `/provider/${p.id}`,
        provider: { '@type': 'Organization', name: p.name_en },
      },
    })),
  };

  return c.html(
    <Layout title={t('home.hero.title', lang)} lang={lang} isAdmin={admin} jsonLd={jsonLd}>
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
              <a href={`/provider/${p.id}`} class="card-hover block bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
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
app.get('/provider/:id', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const admin = isLoggedIn(c);
  const id = c.req.param('id');

  const provider = await db.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>();
  if (!provider) {
    return c.html(
      <Layout title={t('provider.not_found', lang)} lang={lang} isAdmin={admin}>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold text-gray-900 mb-4">{t('provider.not_found', lang)}</h1>
          <a href="/" class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const [cards, providerTags] = await Promise.all([
    db.prepare('SELECT * FROM vcc_cards WHERE provider_id = ? AND status = ? ORDER BY issuance_fee ASC').bind(id, 'active').all<Card>(),
    db.prepare('SELECT t.* FROM vcc_tags t INNER JOIN vcc_provider_tags pt ON t.id = pt.tag_id WHERE pt.provider_id = ?').bind(id).all<Tag>(),
  ]);

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: providerName(provider, 'en'),
    description: provider.desc_en || provider.desc_zh,
    provider: {
      '@type': 'Organization',
      name: provider.name_en,
      url: provider.website,
      foundingDate: provider.founded_date,
    },
    offers: cards.results.map((card) => ({
      '@type': 'Offer',
      name: `${card.card_type} ${card.bin}`,
      priceCurrency: card.currency,
      price: card.issuance_fee,
    })),
  };

  return c.html(
    <Layout title={providerName(provider, lang)} description={providerDesc(provider, lang)} lang={lang} isAdmin={admin} jsonLd={jsonLd}>
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
              <a href={`/card/${card.id}`} class="card-hover block bg-white rounded-xl shadow-sm border border-gray-100 p-5">
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
app.get('/card/:id', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const admin = isLoggedIn(c);
  const id = c.req.param('id');

  const card = await db.prepare(
    'SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id WHERE c.id = ?'
  ).bind(id).first<CardWithProvider>();

  if (!card) {
    return c.html(
      <Layout title={t('card.not_found', lang)} lang={lang} isAdmin={admin}>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="text-2xl font-bold text-gray-900 mb-4">{t('card.not_found', lang)}</h1>
          <a href="/" class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const pName = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: `${card.card_type} ${card.bin}`,
    description: card.description,
    provider: { '@type': 'Organization', name: card.provider_name_en },
    offers: {
      '@type': 'Offer',
      priceCurrency: card.currency,
      price: card.issuance_fee,
    },
  };

  return c.html(
    <Layout title={`${card.card_type} ${card.bin}`} lang={lang} isAdmin={admin} jsonLd={jsonLd}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <nav class="mb-6 text-sm text-gray-500">
          <a href="/" class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href={`/provider/${card.provider_id}`} class="hover:text-brand-600">{pName}</a>
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
              <a href={`/provider/${card.provider_id}`} class="text-brand-600 hover:underline font-medium">{pName}</a>
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
          <a href={`/provider/${card.provider_id}`} class="text-brand-600 hover:underline text-sm">&larr; {t('card.back_provider', lang)}</a>
        </div>
      </div>
    </Layout>
  );
});

// ==========================================
// Login
// ==========================================
app.get('/login', (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const error = c.req.query('error');

  return c.html(
    <Layout title={t('login.title', lang)} lang={lang}>
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

  const hash = await sha256(password);
  const user = await db.prepare('SELECT * FROM admin_users WHERE username = ? AND password_hash = ?').bind(username, hash).first();

  if (!user) {
    return c.redirect('/login?error=1');
  }

  setCookie(c, 'admin_session', '1', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24, // 24 hours
  });
  return c.redirect('/admin');
});

app.get('/logout', (c) => {
  deleteCookie(c, 'admin_session', { path: '/' });
  return c.redirect('/');
});

// ==========================================
// Admin Middleware
// ==========================================
app.use('/admin/*', async (c, next) => {
  if (!isLoggedIn(c)) return c.redirect('/login');
  await next();
});

// ==========================================
// Admin Dashboard
// ==========================================
app.get('/admin', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;

  const [providers, cards] = await Promise.all([
    db.prepare('SELECT * FROM vcc_providers ORDER BY updated_at DESC').all<Provider>(),
    db.prepare('SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id ORDER BY c.created_at DESC').all<CardWithProvider>(),
  ]);

  return c.html(
    <Layout title={t('admin.title', lang)} lang={lang} isAdmin={true}>
      <div class="max-w-7xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-8">{t('admin.title', lang)}</h1>

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
                      <td class="px-4 py-3 font-medium text-gray-900">{p.name_zh}</td>
                      <td class="px-4 py-3 text-gray-700">{p.name_en}</td>
                      <td class="px-4 py-3 text-gray-500">{p.region || '-'}</td>
                      <td class="px-4 py-3">
                        <span class={`px-2 py-0.5 rounded text-xs font-medium ${p.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                          {p.status === 'active' ? t('common.active', lang) : t('common.inactive', lang)}
                        </span>
                      </td>
                      <td class="px-4 py-3 space-x-2">
                        <a href={`/admin/provider/${p.id}/edit`} class="text-brand-600 hover:underline text-xs">{t('admin.edit', lang)}</a>
                        <a href={`/admin/provider/${p.id}/delete`} class="text-red-500 hover:underline text-xs" onclick="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>{t('admin.delete', lang)}</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Cards Section */}
        <div>
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
                      <td class="px-4 py-3 space-x-2">
                        <a href={`/admin/card/${card.id}/edit`} class="text-brand-600 hover:underline text-xs">{t('admin.edit', lang)}</a>
                        <a href={`/admin/card/${card.id}/delete`} class="text-red-500 hover:underline text-xs" onclick="return confirm(this.dataset.msg)" data-msg={t('admin.confirm_delete', lang)}>{t('admin.delete', lang)}</a>
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
// Admin: Provider CRUD
// ==========================================

// Provider Form Component
function ProviderForm({ provider, tags, selectedTags, lang, action }: {
  provider?: Provider;
  tags: Tag[];
  selectedTags: number[];
  lang: Lang;
  action: string;
}) {
  return (
    <form method="post" action={action} enctype="multipart/form-data" class="space-y-6">
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
  const tags = await c.env.DB.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>();

  return c.html(
    <Layout title={t('admin.add_provider', lang)} lang={lang} isAdmin={true}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.add_provider', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ProviderForm tags={tags.results} selectedTags={[]} lang={lang} action="/admin/provider/new" />
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

  const result = await db.prepare(
    'INSERT INTO vcc_providers (name_zh, name_en, website, founded_date, apply_method, desc_zh, desc_en, need_kyc, region, status, logo_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body['name_zh'], body['name_en'], body['website'] || null, body['founded_date'] || null,
    body['apply_method'] || null, body['desc_zh'] || null, body['desc_en'] || null,
    Number(body['need_kyc'] || 0), body['region'] || null, body['status'] || 'active', logoUrl
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

  const [provider, tags, selectedTagsResult] = await Promise.all([
    db.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>(),
    db.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>(),
    db.prepare('SELECT tag_id FROM vcc_provider_tags WHERE provider_id = ?').bind(id).all<{ tag_id: number }>(),
  ]);

  if (!provider) return c.redirect('/admin');

  const selectedTags = selectedTagsResult.results.map(r => r.tag_id);

  return c.html(
    <Layout title={t('admin.edit_provider', lang)} lang={lang} isAdmin={true}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.edit_provider', lang)}: {providerName(provider, lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <ProviderForm provider={provider} tags={tags.results} selectedTags={selectedTags} lang={lang} action={`/admin/provider/${id}/edit`} />
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

  await db.prepare(
    `UPDATE vcc_providers SET name_zh = ?, name_en = ?, website = ?, founded_date = ?, apply_method = ?, desc_zh = ?, desc_en = ?, need_kyc = ?, region = ?, status = ?, updated_at = datetime('now')${logoUpdate} WHERE id = ?`
  ).bind(
    body['name_zh'], body['name_en'], body['website'] || null, body['founded_date'] || null,
    body['apply_method'] || null, body['desc_zh'] || null, body['desc_en'] || null,
    Number(body['need_kyc'] || 0), body['region'] || null, body['status'] || 'active',
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
app.get('/admin/provider/:id/delete', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM vcc_providers WHERE id = ?').bind(id).run();
  return c.redirect('/admin');
});

// ==========================================
// Admin: Card CRUD
// ==========================================

function CardForm({ card, providers, lang, action }: {
  card?: Card;
  providers: Provider[];
  lang: Lang;
  action: string;
}) {
  return (
    <form method="post" action={action} class="space-y-6">
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
  const providers = await c.env.DB.prepare('SELECT * FROM vcc_providers ORDER BY name_en').all<Provider>();

  return c.html(
    <Layout title={t('admin.add_card', lang)} lang={lang} isAdmin={true}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.add_card', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <CardForm providers={providers.results} lang={lang} action="/admin/card/new" />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/card/new', async (c) => {
  const db = c.env.DB;
  const body = await c.req.parseBody();

  await db.prepare(
    'INSERT INTO vcc_cards (provider_id, bin, card_type, currency, issuance_fee, fee_rate, monthly_fee, initial_load, quota, usage, description, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    body['provider_id'], body['bin'], body['card_type'], body['currency'] || 'USD',
    Number(body['issuance_fee'] || 0), Number(body['fee_rate'] || 0),
    Number(body['monthly_fee'] || 0), Number(body['initial_load'] || 0),
    body['quota'] || null, body['usage'] || null, body['description'] || null,
    body['status'] || 'active'
  ).run();

  return c.redirect('/admin');
});

// Edit Card
app.get('/admin/card/:id/edit', async (c) => {
  const lang = getLang(getCookie(c, 'lang'));
  const db = c.env.DB;
  const id = c.req.param('id');

  const [card, providers] = await Promise.all([
    db.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>(),
    db.prepare('SELECT * FROM vcc_providers ORDER BY name_en').all<Provider>(),
  ]);

  if (!card) return c.redirect('/admin');

  return c.html(
    <Layout title={t('admin.edit_card', lang)} lang={lang} isAdmin={true}>
      <div class="max-w-4xl mx-auto px-4 py-8">
        <h1 class="text-2xl font-bold text-gray-900 mb-6">{t('admin.edit_card', lang)}</h1>
        <div class="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <CardForm card={card} providers={providers.results} lang={lang} action={`/admin/card/${id}/edit`} />
        </div>
      </div>
    </Layout>
  );
});

app.post('/admin/card/:id/edit', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const body = await c.req.parseBody();

  await db.prepare(
    'UPDATE vcc_cards SET provider_id = ?, bin = ?, card_type = ?, currency = ?, issuance_fee = ?, fee_rate = ?, monthly_fee = ?, initial_load = ?, quota = ?, usage = ?, description = ?, status = ? WHERE id = ?'
  ).bind(
    body['provider_id'], body['bin'], body['card_type'], body['currency'] || 'USD',
    Number(body['issuance_fee'] || 0), Number(body['fee_rate'] || 0),
    Number(body['monthly_fee'] || 0), Number(body['initial_load'] || 0),
    body['quota'] || null, body['usage'] || null, body['description'] || null,
    body['status'] || 'active', id
  ).run();

  return c.redirect('/admin');
});

// Delete Card
app.get('/admin/card/:id/delete', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM vcc_cards WHERE id = ?').bind(id).run();
  return c.redirect('/admin');
});

// ==========================================
// Export
// ==========================================
export default app;

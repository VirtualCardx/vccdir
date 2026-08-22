// Public page handlers. Language comes from the URL: /en/* is English, unprefixed is Chinese.
import type { Context } from 'hono';
import { Layout } from './layout';
import { t, langPath, pathLang } from './i18n';
import { Pagination, CardTile, ArticleTile, ProviderTile } from './components';
import { apiProvidersWithTags } from './lib/db';
import {
  siteOrigin, absoluteUrl, baseJsonLd, breadcrumbJsonLd, publicPageNumber, pageUrl,
  providerName, providerDesc, cardMetaDescription, contentTitle, contentExcerpt, contentBody, tagName,
} from './lib/seo';
import { truncateSearchTerm, contentBodyHtml } from './lib/sanitize';
import type { Provider, Card, CardWithProvider, ContentPost, Tag, Env } from './types';

// ==========================================
// Homepage
// ==========================================
export async function homePage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const db = c.env.DB;
  const cardSelect = `SELECT c.*, p.name_zh AS provider_name_zh, p.name_en AS provider_name_en, p.slug AS provider_slug, p.logo_url AS provider_logo_url
    FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id
    WHERE c.status = ? AND p.status = ?`;

  const [stats, homepageCards, homepagePosts, platformRows] = await Promise.all([
    db.prepare(`SELECT
      (SELECT COUNT(*) FROM vcc_providers WHERE status = 'active') AS providers,
      (SELECT COUNT(*) FROM vcc_cards WHERE status = 'active') AS cards,
      (SELECT COUNT(*) FROM vcc_tags) AS tags`).first<{ providers: number; cards: number; tags: number }>(),
    db.prepare(`${cardSelect} ORDER BY c.is_featured DESC, c.created_at DESC LIMIT 6`).bind('active', 'active').all<CardWithProvider>(),
    db.prepare('SELECT * FROM content_posts WHERE status = ? ORDER BY is_featured DESC, published_at DESC LIMIT 6').bind('published').all<ContentPost>(),
    db.prepare('SELECT * FROM vcc_providers WHERE status = ? ORDER BY updated_at DESC LIMIT 6').bind('active').all<Provider>(),
  ]);
  const platforms = await apiProvidersWithTags(db, platformRows.results, true);

  const jsonLd = [
    ...baseJsonLd(c, lang),
    {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: t('home.cards', lang),
      numberOfItems: homepageCards.results.length,
      itemListElement: homepageCards.results.map((card, index) => ({
        '@type': 'ListItem', position: index + 1, url: absoluteUrl(c, langPath(lang, `/card/${card.slug}`)), name: `${card.provider_name_en} ${card.bin}`,
      })),
    },
  ];

  return c.html(
    <Layout title={t('home.hero.title', lang)} description={t('site.description', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, '/'))} alternates={{ zh: absoluteUrl(c, '/'), en: absoluteUrl(c, '/en') }} jsonLd={jsonLd}>
      <section class="relative overflow-hidden bg-slate-950 text-white">
        <div class="absolute inset-0" style="background-image: radial-gradient(circle at 12% 10%, rgba(99,102,241,.52), transparent 30rem), radial-gradient(circle at 88% 65%, rgba(6,182,212,.3), transparent 30rem);"></div>
        <div class="absolute inset-0 opacity-[.08]" style="background-image: linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px); background-size: 44px 44px;"></div>
        <div class="relative page-shell grid items-center gap-14 py-20 sm:py-24 lg:grid-cols-[1.08fr_.92fr] lg:py-28">
          <div>
            <span class="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-4 py-2 text-xs font-semibold tracking-wide text-brand-100 backdrop-blur"><span class="h-1.5 w-1.5 rounded-full bg-accent-400 shadow-[0_0_0_4px_rgba(34,211,238,.12)]"></span>VCC Directory · Independent Comparison</span>
            <h1 class="max-w-3xl text-4xl font-bold tracking-[-.04em] sm:text-5xl md:text-6xl lg:text-7xl">{t('home.hero.title', lang)}</h1>
            <p class="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">{t('home.hero.desc', lang)}</p>
            <div class="mt-9 flex flex-wrap gap-3">
            <a href={langPath(lang, '/providers')} class="rounded-2xl bg-white px-6 py-3.5 font-bold text-brand-700 shadow-xl shadow-black/20 transition-transform hover:-translate-y-0.5 hover:bg-brand-50">{t('home.view_all_providers', lang)} &rarr;</a>
            <a href={langPath(lang, '/cards')} class="rounded-2xl border border-white/20 bg-white/10 px-6 py-3.5 font-bold text-white backdrop-blur transition-colors hover:bg-white/15">{t('nav.cards', lang)}</a>
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
            <div class="absolute -bottom-8 -left-8 -rotate-3 rounded-2xl border border-white/15 bg-slate-900/80 px-5 py-4 shadow-xl backdrop-blur"><div class="text-xs text-slate-400">{t('home.stats.cards', lang)}</div><div class="mt-1 text-2xl font-black text-white">{stats?.cards || 0}<span class="ml-2 text-xs font-semibold text-accent-300">Verified</span></div></div>
          </div>
        </div>
      </section>

      <section class="relative z-10 mx-auto -mt-8 max-w-4xl px-4">
        <div class="grid grid-cols-3 overflow-hidden rounded-3xl border border-white bg-white/95 shadow-lift backdrop-blur">
          {[
            { label: t('home.stats.platforms', lang), value: stats?.providers || 0 },
            { label: t('home.stats.cards', lang), value: stats?.cards || 0 },
            { label: t('home.stats.tags', lang), value: stats?.tags || 0 },
          ].map((stat, index) => (
            <div class={`px-3 py-5 text-center sm:p-6 ${index > 0 ? 'border-l border-slate-100' : ''}`}><div class="text-2xl font-black tracking-tight text-brand-600 sm:text-3xl">{stat.value}</div><div class="mt-1 text-[11px] font-medium text-slate-500 sm:text-sm">{stat.label}</div></div>
          ))}
        </div>
      </section>

      <section class="page-shell py-16 sm:py-20">
        <div class="mb-8 flex items-end justify-between gap-4"><div><p class="eyebrow mb-2">PLATFORMS</p><h2 class="section-title">{t('home.providers', lang)}</h2></div><a href={langPath(lang, '/providers')} class="hidden rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 sm:block">{t('home.view_all_providers', lang)} &rarr;</a></div>
        {platforms.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{platforms.map((provider) => <ProviderTile provider={provider} lang={lang} />)}</div> : <div class="empty-state">{t('home.no_results', lang)}</div>}
      </section>

      <section class="border-b border-slate-200/70 bg-white/50">
        <div class="page-shell py-16 sm:py-20">
          <div class="mb-8 flex items-end justify-between gap-4"><div><p class="eyebrow mb-2">VIRTUAL CARDS</p><h2 class="section-title">{t('home.cards', lang)}</h2></div><a href={langPath(lang, '/cards')} class="hidden rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 sm:block">{t('home.view_all_cards', lang)} &rarr;</a></div>
          <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{homepageCards.results.map((card) => <CardTile card={card} lang={lang} />)}</div>
        </div>
      </section>

      <section class="page-shell py-16 sm:py-20">
        <div class="mb-8 flex items-end justify-between gap-4"><div><p class="eyebrow mb-2">INDUSTRY NEWS</p><h2 class="section-title">{t('home.posts', lang)}</h2></div><a href={langPath(lang, '/content')} class="hidden rounded-xl bg-brand-50 px-4 py-2 text-sm font-bold text-brand-700 transition-colors hover:bg-brand-100 sm:block">{t('home.view_all_posts', lang)} &rarr;</a></div>
        {homepagePosts.results.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{homepagePosts.results.map((post) => <ArticleTile post={post} lang={lang} />)}</div> : <div class="empty-state">{t('content.no_results', lang)}</div>}
      </section>
    </Layout>
  );
}

// ==========================================
// Virtual Card Directory
// ==========================================
export async function cardsPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const page = publicPageNumber(c.req.query('page'));
  const search = truncateSearchTerm((c.req.query('q') || '').trim());
  if (!page) return c.redirect(pageUrl(langPath(lang, '/cards'), 1, { q: search }), 301);

  const pageSize = 12;
  const where = ['c.status = ?', 'p.status = ?'];
  const params: unknown[] = ['active', 'active'];
  if (search) {
    const columns = ['c.bin', 'c.card_type', 'c.currency', 'c.usage', 'c.description', 'p.name_zh', 'p.name_en'];
    where.push(`(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(...columns.map(() => pattern));
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
    return c.html(<Layout title={t('cards.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, '/cards'))} noIndex><div class="page-shell py-20"><div class="empty-state">{t('cards.no_results', lang)}</div></div></Layout>, 404);
  }

  const canonicalPath = langPath(lang, search ? '/cards' : pageUrl('/cards', page));
  const title = page > 1 ? `${t('cards.title', lang)} - ${lang === 'zh' ? `第 ${page} 页` : `Page ${page}`}` : t('cards.title', lang);
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [{ name: t('nav.home', lang), path: langPath(lang, '/') }, { name: t('cards.title', lang), path: langPath(lang, '/cards') }]),
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: cardRows.results.length,
      itemListElement: cardRows.results.map((card, index) => ({ '@type': 'ListItem', position: (page - 1) * pageSize + index + 1, url: absoluteUrl(c, langPath(lang, `/card/${card.slug}`)), name: `${card.provider_name_en} ${card.bin}` })),
    },
  ];

  return c.html(
    <Layout
      title={title}
      description={t('cards.desc', lang)}
      lang={lang}
      canonicalUrl={absoluteUrl(c, canonicalPath)}
      alternates={search ? undefined : { zh: absoluteUrl(c, '/cards'), en: absoluteUrl(c, '/en/cards') }}
      noIndex={Boolean(search)}
      followWhenNoIndex={Boolean(search)}
      prevUrl={page > 1 ? absoluteUrl(c, pageUrl(langPath(lang, '/cards'), page - 1, { q: search })) : undefined}
      nextUrl={page < totalPages ? absoluteUrl(c, pageUrl(langPath(lang, '/cards'), page + 1, { q: search })) : undefined}
      jsonLd={jsonLd}
    >
      <section class="page-hero">
        <div class="page-shell py-14 sm:py-16">
          <nav class="mb-6 text-sm font-medium text-slate-400"><a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a><span class="mx-2 text-slate-300">/</span><span>{t('cards.title', lang)}</span></nav>
          <div class="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div><p class="eyebrow mb-2">VCC CATALOG</p><h1 class="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{t('cards.title', lang)}</h1><p class="mt-4 max-w-2xl leading-7 text-slate-500">{t('cards.desc', lang)}</p></div>
            <form method="get" action={langPath(lang, '/cards')} class="flex w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70">
              <label for="card-search" class="sr-only">{t('cards.search', lang)}</label>
              <input id="card-search" type="search" name="q" value={search} placeholder={t('cards.search', lang)} class="min-w-0 flex-1 bg-transparent px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
              <button type="submit" class="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">{lang === 'zh' ? '搜索' : 'Search'}</button>
            </form>
          </div>
        </div>
      </section>
      <section class="page-shell py-12 sm:py-14">
        <div class="mb-7 flex items-center justify-between gap-3"><p class="text-sm text-slate-500"><span class="font-bold text-slate-950">{total}</span> {t('cards.results', lang)}</p>{search && <a href={langPath(lang, '/cards')} class="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 hover:bg-brand-100">{lang === 'zh' ? '清除搜索' : 'Clear search'}</a>}</div>
        {cardRows.results.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{cardRows.results.map((card) => <CardTile card={card} lang={lang} />)}</div> : <div class="empty-state">{t('cards.no_results', lang)}</div>}
        <Pagination path={langPath(lang, '/cards')} page={page} totalPages={totalPages} query={{ q: search }} lang={lang} />
      </section>
    </Layout>
  );
}

// ==========================================
// Provider Directory
// ==========================================
export async function providersPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const page = publicPageNumber(c.req.query('page'));
  const search = truncateSearchTerm((c.req.query('q') || '').trim());
  if (!page) return c.redirect(pageUrl(langPath(lang, '/providers'), 1, { q: search }), 301);

  const pageSize = 12;
  const where = ['status = ?'];
  const params: unknown[] = ['active'];
  if (search) {
    const columns = ['name_zh', 'name_en', 'region', 'desc_zh', 'desc_en'];
    where.push(`(${columns.map((column) => `${column} LIKE ? ESCAPE '\\'`).join(' OR ')})`);
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    params.push(...columns.map(() => pattern));
  }
  const whereSql = where.join(' AND ');
  const [countRow, providerRows] = await Promise.all([
    c.env.DB.prepare(`SELECT COUNT(*) AS c FROM vcc_providers WHERE ${whereSql}`).bind(...params).first<{ c: number }>(),
    c.env.DB.prepare(`SELECT * FROM vcc_providers WHERE ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).bind(...params, pageSize, (page - 1) * pageSize).all<Provider>(),
  ]);
  const total = countRow?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    return c.html(<Layout title={t('providers.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, '/providers'))} noIndex><div class="page-shell py-20"><div class="empty-state">{t('providers.no_results', lang)}</div></div></Layout>, 404);
  }
  const providers = await apiProvidersWithTags(c.env.DB, providerRows.results, true);

  const canonicalPath = langPath(lang, search ? '/providers' : pageUrl('/providers', page));
  const title = page > 1 ? `${t('providers.title', lang)} - ${lang === 'zh' ? `第 ${page} 页` : `Page ${page}`}` : t('providers.title', lang);
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [{ name: t('nav.home', lang), path: langPath(lang, '/') }, { name: t('providers.title', lang), path: langPath(lang, '/providers') }]),
    {
      '@context': 'https://schema.org', '@type': 'ItemList', name: title, numberOfItems: providers.length,
      itemListElement: providers.map((provider, index) => ({ '@type': 'ListItem', position: (page - 1) * pageSize + index + 1, url: absoluteUrl(c, langPath(lang, `/provider/${provider.slug}`)), name: providerName(provider, lang) })),
    },
  ];

  return c.html(
    <Layout
      title={title}
      description={t('providers.desc', lang)}
      lang={lang}
      canonicalUrl={absoluteUrl(c, canonicalPath)}
      alternates={search ? undefined : { zh: absoluteUrl(c, '/providers'), en: absoluteUrl(c, '/en/providers') }}
      noIndex={Boolean(search)}
      followWhenNoIndex={Boolean(search)}
      prevUrl={page > 1 ? absoluteUrl(c, pageUrl(langPath(lang, '/providers'), page - 1, { q: search })) : undefined}
      nextUrl={page < totalPages ? absoluteUrl(c, pageUrl(langPath(lang, '/providers'), page + 1, { q: search })) : undefined}
      jsonLd={jsonLd}
    >
      <section class="page-hero">
        <div class="page-shell py-14 sm:py-16">
          <nav class="mb-6 text-sm font-medium text-slate-400"><a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a><span class="mx-2 text-slate-300">/</span><span>{t('providers.title', lang)}</span></nav>
          <div class="flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
            <div><p class="eyebrow mb-2">VCC PLATFORMS</p><h1 class="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{t('providers.title', lang)}</h1><p class="mt-4 max-w-2xl leading-7 text-slate-500">{t('providers.desc', lang)}</p></div>
            <form method="get" action={langPath(lang, '/providers')} class="flex w-full max-w-xl overflow-hidden rounded-2xl border border-slate-200 bg-white p-1.5 shadow-soft focus-within:border-brand-300 focus-within:ring-4 focus-within:ring-brand-100/70">
              <label for="provider-search" class="sr-only">{t('providers.search', lang)}</label>
              <input id="provider-search" type="search" name="q" value={search} placeholder={t('providers.search', lang)} class="min-w-0 flex-1 bg-transparent px-4 py-3 text-slate-900 outline-none placeholder:text-slate-400" />
              <button type="submit" class="rounded-xl bg-brand-600 px-5 py-3 font-bold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700">{lang === 'zh' ? '搜索' : 'Search'}</button>
            </form>
          </div>
        </div>
      </section>
      <section class="page-shell py-12 sm:py-14">
        <div class="mb-7 flex items-center justify-between gap-3"><p class="text-sm text-slate-500"><span class="font-bold text-slate-950">{total}</span> {t('providers.results', lang)}</p>{search && <a href={langPath(lang, '/providers')} class="rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-bold text-brand-700 hover:bg-brand-100">{lang === 'zh' ? '清除搜索' : 'Clear search'}</a>}</div>
        {providers.length ? <div class="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">{providers.map((provider) => <ProviderTile provider={provider} lang={lang} />)}</div> : <div class="empty-state">{t('providers.no_results', lang)}</div>}
        <Pagination path={langPath(lang, '/providers')} page={page} totalPages={totalPages} query={{ q: search }} lang={lang} />
      </section>
    </Layout>
  );
}

// ==========================================
// Provider Detail
// ==========================================
export async function providerPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const db = c.env.DB;
  const slug = c.req.param('slug');

  const provider = await db.prepare('SELECT * FROM vcc_providers WHERE slug = ? AND status = ?').bind(slug, 'active').first<Provider>();
  if (!provider) {
    return c.html(
      <Layout title={t('provider.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/provider/${slug}`))} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('provider.not_found', lang)}</h1>
          <a href={langPath(lang, '/')} class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
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
      { name: t('nav.home', lang), path: langPath(lang, '/') },
      { name: providerName(provider, lang), path: langPath(lang, `/provider/${provider.slug}`) },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: providerName(provider, lang),
      description: providerDesc(provider, lang),
      url: absoluteUrl(c, langPath(lang, `/provider/${provider.slug}`)),
      provider: {
        '@type': 'Organization',
        name: provider.name_en,
        url: provider.website,
        foundingDate: provider.founded_date,
      },
      offers: cards.results.map((card) => ({
        '@type': 'Offer',
        url: absoluteUrl(c, langPath(lang, `/card/${card.slug}`)),
        name: `${card.card_type} ${card.bin}`,
        priceCurrency: card.currency,
        price: card.issuance_fee,
      })),
    },
  ];

  return c.html(
    <Layout title={providerName(provider, lang)} description={providerDesc(provider, lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/provider/${provider.slug}`))} alternates={{ zh: absoluteUrl(c, `/provider/${provider.slug}`), en: absoluteUrl(c, `/en/provider/${provider.slug}`) }} jsonLd={jsonLd}>
      <div class="page-shell py-10 sm:py-14">
        {/* Breadcrumb */}
        <nav class="breadcrumb mb-6">
          <a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a>
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
              <a href={langPath(lang, `/card/${card.slug}`)} class="card-hover group block rounded-3xl border border-slate-200/70 bg-white p-6 shadow-soft">
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
}

// ==========================================
// Card Detail
// ==========================================
export async function cardPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const db = c.env.DB;
  const slug = c.req.param('slug');

  const card = await db.prepare(
    'SELECT c.*, p.name_zh as provider_name_zh, p.name_en as provider_name_en, p.slug as provider_slug, p.logo_url as provider_logo_url FROM vcc_cards c INNER JOIN vcc_providers p ON c.provider_id = p.id WHERE c.slug = ? AND c.status = ? AND p.status = ?'
  ).bind(slug, 'active', 'active').first<CardWithProvider>();

  if (!card) {
    return c.html(
      <Layout title={t('card.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/card/${slug}`))} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('card.not_found', lang)}</h1>
          <a href={langPath(lang, '/')} class="text-brand-600 hover:underline">{t('provider.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const pName = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;

  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: langPath(lang, '/') },
      { name: t('cards.title', lang), path: langPath(lang, '/cards') },
      { name: `${card.card_type} ${card.bin}`, path: langPath(lang, `/card/${card.slug}`) },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'FinancialProduct',
      name: `${card.card_type} ${card.bin}`,
      description: cardMetaDescription(card, lang),
      url: absoluteUrl(c, langPath(lang, `/card/${card.slug}`)),
      provider: { '@type': 'Organization', name: card.provider_name_en },
      offers: {
        '@type': 'Offer',
        priceCurrency: card.currency,
        price: card.issuance_fee,
      },
    },
  ];

  return c.html(
    <Layout title={`${card.card_type} ${card.bin}`} description={cardMetaDescription(card, lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/card/${card.slug}`))} alternates={{ zh: absoluteUrl(c, `/card/${card.slug}`), en: absoluteUrl(c, `/en/card/${card.slug}`) }} jsonLd={jsonLd}>
      <div class="mx-auto max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
        <nav class="breadcrumb mb-7">
          <a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href={langPath(lang, '/cards')} class="hover:text-brand-600">{t('cards.title', lang)}</a>
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
              <a href={langPath(lang, `/provider/${card.provider_slug}`)} class="font-semibold text-brand-600 hover:underline">{pName}</a>
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
          <a href={langPath(lang, `/provider/${card.provider_slug}`)} class="button-secondary text-sm">&larr; {t('card.back_provider', lang)}</a>
        </div>
      </div>
    </Layout>
  );
}

// ==========================================
// Content
// ==========================================
export async function contentListPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const page = publicPageNumber(c.req.query('page'));
  if (!page) return c.redirect(langPath(lang, '/content'), 301);
  const pageSize = 9;
  const [countRow, posts] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS c FROM content_posts WHERE status = ?').bind('published').first<{ c: number }>(),
    c.env.DB.prepare('SELECT * FROM content_posts WHERE status = ? ORDER BY published_at DESC, updated_at DESC LIMIT ? OFFSET ?').bind('published', pageSize, (page - 1) * pageSize).all<ContentPost>(),
  ]);
  const total = countRow?.c || 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) {
    return c.html(<Layout title={t('content.title', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, '/content'))} noIndex><div class="page-shell py-20"><div class="empty-state">{t('content.no_results', lang)}</div></div></Layout>, 404);
  }
  const canonicalPath = langPath(lang, pageUrl('/content', page));
  const title = page > 1 ? `${t('content.title', lang)} - ${lang === 'zh' ? `第 ${page} 页` : `Page ${page}`}` : t('content.title', lang);
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [{ name: t('nav.home', lang), path: langPath(lang, '/') }, { name: t('content.title', lang), path: langPath(lang, '/content') }]),
    {
      '@context': 'https://schema.org', '@type': 'Blog', name: title, description: t('content.desc', lang), url: absoluteUrl(c, canonicalPath),
      blogPost: posts.results.map((post) => ({
        '@type': 'BlogPosting', headline: contentTitle(post, lang), url: absoluteUrl(c, langPath(lang, `/content/${post.slug}`)), datePublished: post.published_at, dateModified: post.updated_at,
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
      alternates={{ zh: absoluteUrl(c, pageUrl('/content', page)), en: absoluteUrl(c, pageUrl('/en/content', page)) }}
      prevUrl={page > 1 ? absoluteUrl(c, pageUrl(langPath(lang, '/content'), page - 1)) : undefined}
      nextUrl={page < totalPages ? absoluteUrl(c, pageUrl(langPath(lang, '/content'), page + 1)) : undefined}
      jsonLd={jsonLd}
    >
      <section class="page-hero">
        <div class="page-shell py-14 sm:py-16">
          <nav class="mb-6 text-sm font-medium text-slate-400"><a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a><span class="mx-2 text-slate-300">/</span><span>{t('content.title', lang)}</span></nav>
          <p class="eyebrow mb-3">VCC INDUSTRY INSIGHTS</p>
          <h1 class="text-3xl font-bold tracking-tight text-slate-950 md:text-5xl">{t('content.title', lang)}</h1>
          <p class="mt-4 max-w-2xl leading-7 text-slate-500">{t('content.desc', lang)}</p>
        </div>
      </section>
      <section class="page-shell py-12 sm:py-14">
        {posts.results.length ? <div class="grid grid-cols-1 gap-7 md:grid-cols-2 lg:grid-cols-3">{posts.results.map((post) => <ArticleTile post={post} lang={lang} prominent />)}</div> : <div class="empty-state">{t('content.no_results', lang)}</div>}
        <Pagination path={langPath(lang, '/content')} page={page} totalPages={totalPages} lang={lang} />
      </section>
    </Layout>
  );
}

export async function contentDetailPage(c: Context<Env>) {
  const lang = pathLang(c.req.path);
  const slug = c.req.param('slug');
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE slug = ? AND status = ?').bind(slug, 'published').first<ContentPost>();

  if (!post) {
    return c.html(
      <Layout title={t('content.not_found', lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/content/${slug}`))} noIndex>
        <div class="max-w-7xl mx-auto px-4 py-16 text-center">
          <h1 class="mb-4 text-2xl font-bold text-slate-900">{t('content.not_found', lang)}</h1>
          <a href={langPath(lang, '/content')} class="text-brand-600 hover:underline">{t('content.back', lang)}</a>
        </div>
      </Layout>,
      404
    );
  }

  const bodyHtml = contentBodyHtml(contentBody(post, lang));
  const jsonLd = [
    ...baseJsonLd(c, lang),
    breadcrumbJsonLd(c, [
      { name: t('nav.home', lang), path: langPath(lang, '/') },
      { name: t('content.title', lang), path: langPath(lang, '/content') },
      { name: contentTitle(post, lang), path: langPath(lang, `/content/${post.slug}`) },
    ]),
    {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: contentTitle(post, lang),
      description: contentExcerpt(post, lang),
      url: absoluteUrl(c, langPath(lang, `/content/${post.slug}`)),
      mainEntityOfPage: absoluteUrl(c, langPath(lang, `/content/${post.slug}`)),
      datePublished: post.published_at,
      dateModified: post.updated_at,
      publisher: { '@id': `${siteOrigin(c)}/#organization` },
      ...(post.featured_image_url ? { image: absoluteUrl(c, `/images/${post.featured_image_url}`) } : {}),
    },
  ];

  return c.html(
    <Layout title={contentTitle(post, lang)} description={contentExcerpt(post, lang)} lang={lang} canonicalUrl={absoluteUrl(c, langPath(lang, `/content/${post.slug}`))} alternates={{ zh: absoluteUrl(c, `/content/${post.slug}`), en: absoluteUrl(c, `/en/content/${post.slug}`) }} ogType="article" ogImage={post.featured_image_url ? absoluteUrl(c, `/images/${post.featured_image_url}`) : undefined} jsonLd={jsonLd}>
      <article class="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
        <nav class="breadcrumb mb-8">
          <a href={langPath(lang, '/')} class="hover:text-brand-600">{t('nav.home', lang)}</a>
          <span class="mx-2">/</span>
          <a href={langPath(lang, '/content')} class="hover:text-brand-600">{t('content.title', lang)}</a>
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
}

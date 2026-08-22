// Shared presentational components for the public pages.
import { t, langPath } from './i18n';
import type { CardWithProvider, ContentPost, Lang, ProviderWithTags } from './types';
import { contentTitle, contentExcerpt, pageUrl, providerName, tagName } from './lib/seo';

export function Pagination({ path, page, totalPages, query, lang }: {
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
  const linkClass = (active: boolean) => `flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition-colors ${active ? 'bg-brand-600 text-white shadow-lg shadow-brand-600/20' : 'border border-slate-200 bg-white text-slate-600 hover:border-brand-200 hover:text-brand-600'}`;
  return (
    <nav class="mt-12 flex flex-wrap items-center justify-center gap-2" aria-label={lang === 'zh' ? '分页导航' : 'Pagination'}>
      {page > 1 && (
        <a rel="prev" href={pageUrl(path, page - 1, query)} class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-brand-200 hover:text-brand-600">
          &larr; {t('common.previous', lang)}
        </a>
      )}
      {first > 1 && (
        <a href={pageUrl(path, 1, query)} class={linkClass(false)}>1</a>
      )}
      {first > 2 && <span class="px-2 text-slate-400">…</span>}
      {pages.map((number) => (
        <a
          href={pageUrl(path, number, query)}
          aria-current={number === page ? 'page' : undefined}
          class={linkClass(number === page)}
        >
          {number}
        </a>
      ))}
      {last < totalPages - 1 && <span class="px-2 text-slate-400">…</span>}
      {last < totalPages && (
        <a href={pageUrl(path, totalPages, query)} class={linkClass(false)}>{totalPages}</a>
      )}
      {page < totalPages && (
        <a rel="next" href={pageUrl(path, page + 1, query)} class="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-600 shadow-sm transition-colors hover:border-brand-200 hover:text-brand-600">
          {t('common.next', lang)} &rarr;
        </a>
      )}
    </nav>
  );
}

export function ProviderTile({ provider, lang }: { provider: ProviderWithTags; lang: Lang }) {
  const name = providerName(provider, lang);
  return (
    <a href={langPath(lang, `/provider/${provider.slug}`)} class="card-hover group block rounded-3xl border border-slate-200/70 bg-white p-6 shadow-soft">
      <div class="mb-4 flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-3">
          {provider.logo_url ? (
            <img src={`/images/${provider.logo_url}`} alt="" width="44" height="44" loading="lazy" class="h-11 w-11 rounded-xl object-cover" />
          ) : (
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-100 to-accent-50 font-bold text-brand-700 ring-1 ring-brand-100">{name.charAt(0)}</div>
          )}
          <div class="min-w-0">
            <h3 class="truncate text-lg font-bold tracking-tight text-slate-950 transition-colors group-hover:text-brand-600">{name}</h3>
            <div class="truncate text-xs text-slate-400">{provider.region || t('common.na', lang)}{provider.founded_date ? ` · ${provider.founded_date}` : ''}</div>
          </div>
        </div>
        <span class="shrink-0 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700 ring-1 ring-brand-100">{provider.card_count} {t('provider.cards_count', lang)}</span>
      </div>
      {provider.tags.length > 0 && (
        <div class="mb-4 flex flex-wrap gap-1.5">
          {provider.tags.slice(0, 4).map((tag) => (
            <span class="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">{tagName(tag, lang)}</span>
          ))}
        </div>
      )}
      <div class="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 text-sm">
        <span class={`rounded-full px-2.5 py-1 text-xs font-bold ${provider.need_kyc ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
          {t('provider.kyc', lang)}: {provider.need_kyc ? t('provider.kyc_yes', lang) : t('provider.kyc_no', lang)}
        </span>
        <span class="shrink-0 font-medium text-brand-600 transition-transform group-hover:translate-x-0.5">{t('provider.view_detail', lang)} &rarr;</span>
      </div>
    </a>
  );
}

export function CardTile({ card, lang }: { card: CardWithProvider; lang: Lang }) {
  const name = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;
  return (
    <a href={langPath(lang, `/card/${card.slug}`)} class="card-hover group relative block overflow-hidden rounded-3xl border border-slate-200/70 bg-white p-6 shadow-soft">
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

export function ArticleTile({ post, lang, prominent = false }: { post: ContentPost; lang: Lang; prominent?: boolean }) {
  return (
    <article class="card-hover group overflow-hidden rounded-3xl border border-slate-200/70 bg-white shadow-soft">
      <a href={langPath(lang, `/content/${post.slug}`)} class="block">
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

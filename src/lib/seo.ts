// URL construction, pagination parsing, meta descriptions, and structured data.
import type { Context } from 'hono';
import type { Provider, CardWithProvider, ContentPost, Tag, Lang, Env } from '../types';
import { t, langPath } from '../i18n';

export function siteOrigin(c: Context<Env>): string {
  const configured = c.env.SITE_URL?.replace(/\/+$/, '');
  if (configured && configured !== 'https://example.com') return configured;
  return new URL(c.req.url).origin;
}

export function absoluteUrl(c: Context<Env>, path: string): string {
  return `${siteOrigin(c)}${path.startsWith('/') ? path : `/${path}`}`;
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

export function providerName(p: Provider | { name_zh: string; name_en: string }, lang: Lang): string {
  return lang === 'zh' ? p.name_zh : p.name_en;
}

// Meta descriptions must be plain text: strip markup and clamp to search-engine lengths.
const DECODED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntity(entity: string): string {
  const name = entity.toLowerCase();
  const code = name.startsWith('#x') ? Number.parseInt(entity.slice(2), 16) : name.startsWith('#') ? Number.parseInt(entity.slice(1), 10) : NaN;
  if (Number.isFinite(code)) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : ' ';
  return DECODED_ENTITIES[name] ?? ' ';
}

function metaPlainText(html: string): string {
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&([a-z#0-9]+);/gi, (_match, entity: string) => decodeEntity(entity))
    .replace(/\s+/g, ' ')
    .trim();
}

function clampMetaDescription(text: string): string {
  if (text.length <= 160) return text;
  const clipped = Array.from(text).slice(0, 157).join('');
  return `${clipped.replace(/[,，、;；:：\s]+$/, '')}…`;
}

export function providerDesc(p: Provider, lang: Lang): string {
  const description = metaPlainText((lang === 'zh' ? p.desc_zh : p.desc_en) || '');
  const name = providerName(p, lang);
  const fallback = lang === 'zh'
    ? `查看${name}虚拟信用卡平台的开卡方式、费率、KYC要求、支持地区和可用卡段，并与其他虚拟卡平台进行对比。`
    : `Review ${name} virtual card issuance, fees, KYC requirements, supported regions, and available cards, then compare it with other VCC platforms.`;
  if (!description) return fallback;
  if (description.length < 70) return clampMetaDescription(`${description}${/[。.!?]$/.test(description) ? '' : '。'}${fallback}`);
  return clampMetaDescription(description);
}

// Bilingual card description: prefer the language field, fall back to the legacy column.
export function cardDescription(card: { description: string | null; description_zh: string | null; description_en: string | null }, lang: Lang): string {
  const localized = (lang === 'zh' ? card.description_zh : card.description_en)?.trim();
  return localized || card.description?.trim() || '';
}

export function cardDetailTitle(card: CardWithProvider, lang: Lang): string {
  const name = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;
  return lang === 'zh'
    ? `${name} ${card.card_type} ${card.bin}：${t('card.title_suffix', lang)}`
    : `${name} ${card.card_type} ${card.bin}: ${t('card.title_suffix', lang)}`;
}

export function cardMetaDescription(card: CardWithProvider, lang: Lang): string {
  const name = lang === 'zh' ? card.provider_name_zh : card.provider_name_en;
  const description = metaPlainText(cardDescription(card, lang));
  const fallback = lang === 'zh'
    ? `了解${name} ${card.card_type} 虚拟卡（BIN ${card.bin}）的开卡费、充值费率、月费、支持币种、额度和适用场景，并与其他虚拟信用卡进行比较。`
    : `Explore the ${name} ${card.card_type} virtual card (BIN ${card.bin}), including issuance fees, funding rates, monthly costs, currency, limits, and supported use cases.`;
  if (!description) return fallback;
  return clampMetaDescription(lang === 'zh' ? `${name}：${description}` : `${name}: ${description}`);
}

export function contentTitle(post: ContentPost, lang: Lang): string {
  return lang === 'zh' ? post.title_zh : post.title_en;
}

export function contentExcerpt(post: ContentPost, lang: Lang): string {
  const excerpt = metaPlainText((lang === 'zh' ? post.excerpt_zh : post.excerpt_en) || '');
  const title = contentTitle(post, lang);
  const fallback = lang === 'zh'
    ? `深入了解${title}的费率、申请或使用方式、适用场景和注意事项，帮助你比较并选择合适的虚拟信用卡服务。`
    : `Learn about ${title}, including fees, setup or usage, suitable use cases, and important considerations when comparing virtual card services.`;
  if (!excerpt) return fallback;
  if (excerpt.length < 70) return clampMetaDescription(`${excerpt}${/[。.!?]$/.test(excerpt) ? '' : '。'}${fallback}`);
  return clampMetaDescription(excerpt);
}

export function contentBody(post: ContentPost, lang: Lang): string {
  return lang === 'zh' ? post.body_zh : post.body_en;
}

export function tagName(tag: Tag, lang: Lang): string {
  return lang === 'zh' ? tag.name_zh : tag.name_en;
}

export function baseJsonLd(c: Context<Env>, lang: Lang) {
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
        target: `${origin}${langPath(lang, '/providers')}?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];
}

export function breadcrumbJsonLd(c: Context<Env>, items: { name: string; path: string }[]) {
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

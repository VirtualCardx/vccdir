import type { Lang } from './types';

const translations = {
  // Site
  'site.title': { zh: 'VCC虚拟卡目录', en: 'VCC Directory' },
  'site.description': { zh: 'VCC虚拟卡目录收录全球虚拟信用卡平台，提供开卡费、充值费率、月费、支持币种及使用场景对比，帮助你筛选适合广告投放、订阅和跨境支付的虚拟卡。', en: 'Explore global virtual credit card platforms and compare issuance fees, funding rates, monthly costs, supported currencies, and use cases for advertising, subscriptions, and cross-border payments.' },

  // Navigation
  'nav.home': { zh: '首页', en: 'Home' },
  'nav.providers': { zh: '平台', en: 'Platforms' },
  'nav.cards': { zh: '虚拟信用卡', en: 'Virtual Cards' },
  'nav.content': { zh: '行业动态', en: 'Industry News' },
  'nav.language': { zh: 'EN', en: '中文' },

  // Homepage
  'home.hero.title': { zh: '发现适合你的虚拟信用卡', en: 'Find the Right Virtual Card' },
  'home.hero.desc': { zh: '比较开卡费、手续费、币种和使用场景，掌握虚拟卡行业最新动态。', en: 'Compare fees, currencies, and use cases, and follow the latest virtual card industry updates.' },
  'home.providers': { zh: '虚拟卡平台', en: 'Virtual Card Platforms' },
  'home.cards': { zh: '虚拟信用卡', en: 'Virtual Cards' },
  'home.posts': { zh: '行业动态', en: 'Industry News' },
  'home.pinned': { zh: '精选', en: 'Featured' },
  'home.view_all_providers': { zh: '浏览全部平台', en: 'Browse All Platforms' },
  'home.view_all_cards': { zh: '浏览全部虚拟卡', en: 'Browse All Cards' },
  'home.view_all_posts': { zh: '查看全部行业动态', en: 'View All Industry News' },
  'home.no_results': { zh: '暂无平台数据', en: 'No platforms found' },
  'home.stats.platforms': { zh: '平台数量', en: 'Platforms' },
  'home.stats.cards': { zh: '卡段数量', en: 'Card BINs' },
  'home.stats.tags': { zh: '标签数量', en: 'Tags' },

  // Provider
  'provider.website': { zh: '官网', en: 'Website' },
  'provider.founded': { zh: '建立日期', en: 'Founded' },
  'provider.apply_method': { zh: '开户途径', en: 'Apply Method' },
  'provider.kyc': { zh: 'KYC要求', en: 'KYC Required' },
  'provider.kyc_yes': { zh: '需要', en: 'Yes' },
  'provider.kyc_no': { zh: '不需要', en: 'No' },
  'provider.region': { zh: '地区', en: 'Region' },
  'provider.description': { zh: '平台描述', en: 'Description' },
  'provider.cards': { zh: '卡段列表', en: 'Card BINs' },
  'provider.cards_count': { zh: '个卡段', en: 'BINs' },
  'provider.view_detail': { zh: '查看详情', en: 'View Details' },
  'provider.back': { zh: '返回首页', en: 'Back to Home' },
  'provider.not_found': { zh: '平台未找到', en: 'Platform not found' },
  'provider.closed_title': { zh: '该平台已停止运营', en: 'This platform has stopped operating' },
  'provider.closed_desc': { zh: '该虚拟卡平台已关闭或停止服务，页面信息仅作历史参考。请勿进行新的充值或申请，如有未用余额请尽快通过官方渠道处理。', en: 'This virtual card platform has shut down or stopped serving; the information on this page is historical reference only. Do not make new deposits or applications, and settle any remaining balance through official channels promptly.' },

  // Card
  'card.currency': { zh: '币种', en: 'Currency' },
  'card.issuance_fee': { zh: '开卡费', en: 'Issuance Fee' },
  'card.fee_rate': { zh: '手续费率', en: 'Fee Rate' },
  'card.monthly_fee': { zh: '月费', en: 'Monthly Fee' },
  'card.initial_load': { zh: '起充额度', en: 'Min. Load' },
  'card.quota': { zh: '额度限制', en: 'Quota' },
  'card.usage': { zh: '使用场景', en: 'Usage' },
  'card.provider': { zh: '所属平台', en: 'Platform' },
  'card.back_provider': { zh: '返回平台', en: 'Back to Platform' },
  'card.not_found': { zh: '卡段未找到', en: 'Card BIN not found' },

  // Card Directory
  'cards.title': { zh: '虚拟信用卡目录', en: 'Virtual Card Directory' },
  'cards.desc': { zh: '搜索并比较全球虚拟信用卡的卡组织、币种、开卡费、手续费率、月费和适用场景。', en: 'Search and compare virtual cards by network, currency, issuance fee, funding rate, monthly fee, and use case.' },
  'cards.search': { zh: '搜索卡号段、提供商、币种或使用场景', en: 'Search BIN, provider, currency, or use case' },
  'cards.results': { zh: '张虚拟卡', en: 'virtual cards' },
  'cards.no_results': { zh: '没有找到匹配的虚拟信用卡', en: 'No matching virtual cards found' },

  // Provider Directory
  'providers.title': { zh: '虚拟卡平台目录', en: 'Virtual Card Platform Directory' },
  'providers.desc': { zh: '比较虚拟信用卡平台的开户方式、KYC 要求、支持地区、标签和可用卡段数量，进入平台详情查看完整卡段列表。', en: 'Compare virtual card platforms by onboarding, KYC requirements, supported regions, tags, and available BIN counts, then open a platform for its full card list.' },
  'providers.search': { zh: '搜索平台名称或地区', en: 'Search platform name or region' },
  'providers.results': { zh: '家平台', en: 'platforms' },
  'providers.no_results': { zh: '没有找到匹配的虚拟卡平台', en: 'No matching platforms found' },

  // Content
  'content.title': { zh: '行业动态', en: 'Industry News' },
  'content.desc': { zh: '关注虚拟信用卡行业动态、平台评测、费率变化、合规趋势和实用指南。', en: 'Follow virtual card industry news, provider reviews, fee changes, compliance trends, and practical guides.' },
  'content.read_more': { zh: '阅读全文', en: 'Read More' },
  'content.no_results': { zh: '暂无行业动态', en: 'No industry news yet' },
  'content.not_found': { zh: '文章未找到', en: 'Article not found' },
  'content.back': { zh: '返回行业动态', en: 'Back to Industry News' },

  // Common
  'common.free': { zh: '免费', en: 'Free' },
  'common.visit': { zh: '访问', en: 'Visit' },
  'common.na': { zh: '暂无', en: 'N/A' },
  'common.previous': { zh: '上一页', en: 'Previous' },
  'common.next': { zh: '下一页', en: 'Next' },

  // Footer
  'footer.text': { zh: '虚拟信用卡平台目录 — 信息仅供参考，请自行验证', en: 'VCC Platform Directory — Information for reference only, please verify independently' },
} as const;

type TranslationKey = keyof typeof translations;

export function t(key: string, lang: Lang): string {
  const entry = translations[key as TranslationKey];
  if (!entry) return key;
  return entry[lang] || key;
}

export function getLang(value: string | undefined): Lang {
  if (value === 'en') return 'en';
  return 'zh';
}

// Language lives in the URL: /en/* serves English, unprefixed paths serve Chinese.
export function pathLang(path: string): Lang {
  return path === '/en' || path.startsWith('/en/') ? 'en' : 'zh';
}

export function langPath(lang: Lang, path: string): string {
  return lang === 'en' ? `/en${path === '/' ? '' : path}` : path;
}

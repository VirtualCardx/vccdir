import type { Child } from 'hono/jsx';
import { raw } from 'hono/html';
import type { Lang } from './types';
import { t, langPath } from './i18n';
import styles from './styles.css';

interface LayoutProps {
  title: string;
  description?: string;
  lang: Lang;
  active?: 'home' | 'providers' | 'cards' | 'content';
  canonicalUrl?: string;
  alternates?: { zh: string; en: string };
  noIndex?: boolean;
  followWhenNoIndex?: boolean;
  ogType?: string;
  ogImage?: string;
  prevUrl?: string;
  nextUrl?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  children: Child;
}

export function Layout({ title, description, lang, active, canonicalUrl, alternates, noIndex, followWhenNoIndex, ogType, ogImage, prevUrl, nextUrl, jsonLd, children }: LayoutProps) {
  const desc = description || t('site.description', lang);
  const switchLang = lang === 'zh' ? 'en' : 'zh';
  const switchUrl = `/lang/${switchLang}`;
  const canonical = canonicalUrl || '/';
  const fullTitle = `${title} | ${t('site.title', lang)}`;
  const serializedJsonLd = jsonLd
    ? JSON.stringify(jsonLd).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
    : '';
  const navLink = (key: 'home' | 'providers' | 'cards' | 'content', extra = '') =>
    `rounded-xl px-2.5 py-2 text-xs font-semibold sm:px-3 sm:text-sm transition-colors ${active === key ? 'bg-white text-brand-600 shadow-sm' : 'text-slate-600 hover:bg-white hover:text-brand-600 hover:shadow-sm'} ${extra}`;

  return (
    <>
      {raw('<!doctype html>')}
      <html lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#4f46e5" />
        <link rel="icon" href="/favicon.ico" sizes="32x32" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <meta name="robots" content={noIndex ? `noindex, ${followWhenNoIndex ? 'follow' : 'nofollow'}` : 'index, follow, max-image-preview:large'} />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content={ogType || 'website'} />
        <meta property="og:url" content={canonical} />
        <meta property="og:site_name" content={t('site.title', lang)} />
        {ogImage && <meta property="og:image" content={ogImage} />}
        <meta name="twitter:card" content={ogImage ? 'summary_large_image' : 'summary'} />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={desc} />
        {ogImage && <meta name="twitter:image" content={ogImage} />}
        <link rel="canonical" href={canonical} />
        {alternates && (
          <>
            <link rel="alternate" hreflang="zh-CN" href={alternates.zh} />
            <link rel="alternate" hreflang="en" href={alternates.en} />
            <link rel="alternate" hreflang="x-default" href={alternates.zh} />
          </>
        )}
        {prevUrl && <link rel="prev" href={prevUrl} />}
        {nextUrl && <link rel="next" href={nextUrl} />}
        {jsonLd && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializedJsonLd }} />
        )}
        <style dangerouslySetInnerHTML={{
          __html: `${styles}
            .card-hover { transition: transform 0.25s ease, border-color 0.25s ease, box-shadow 0.25s ease; }
            .card-hover:hover { transform: translateY(-4px); border-color: rgba(99,102,241,.22); box-shadow: 0 24px 55px -24px rgba(79,70,229,.28); }
            .content-prose > * + * { margin-top: 1rem; }
            .content-prose h2 { font-size: 1.5rem; line-height: 1.3; font-weight: 750; color: #0f172a; margin-top: 2.25rem; letter-spacing: -.02em; }
            .content-prose h3 { font-size: 1.2rem; line-height: 1.4; font-weight: 700; color: #0f172a; margin-top: 1.75rem; }
            .content-prose ul, .content-prose ol { padding-left: 1.5rem; }
            .content-prose ul { list-style: disc; }
            .content-prose ol { list-style: decimal; }
            .content-prose blockquote { border-left: 3px solid #818cf8; padding: 1rem 1.25rem; color: #475569; background: #eef2ff; border-radius: 0 1rem 1rem 0; }
            .content-prose a { color: #4f46e5; text-decoration: underline; text-underline-offset: 3px; }
          `
        }} />
      </head>
      <body class="min-h-screen flex flex-col">
        {/* Navigation */}
        <nav class="sticky top-0 z-50 border-b border-slate-200/60 bg-white/80 shadow-[0_1px_0_rgba(15,23,42,.02)] backdrop-blur-xl">
          <div class="page-shell">
            <div class="flex h-[4.5rem] items-center justify-between gap-4">
              <a href={langPath(lang, '/')} class="group flex min-w-0 items-center gap-3" aria-label={t('site.title', lang)}>
                <img src="/logo.svg" alt={t('site.title', lang)} width="40" height="40" class="h-10 w-10 rounded-2xl shadow-lg shadow-brand-600/20 transition-transform group-hover:rotate-3" />
                <span class="hidden min-w-0 sm:block"><span class="block truncate text-sm font-bold tracking-tight text-slate-950">VCC Directory</span><span class="block truncate text-[11px] text-slate-400">Virtual card intelligence</span></span>
              </a>
              <div class="flex items-center gap-1.5">
                <div class="flex items-center rounded-2xl border border-slate-200/70 bg-slate-50/80 p-1">
                  <a href={langPath(lang, '/')} class={navLink('home', 'hidden px-3 text-sm sm:block')}>{t('nav.home', lang)}</a>
                  <a href={langPath(lang, '/providers')} class={navLink('providers')}>{t('nav.providers', lang)}</a>
                  <a href={langPath(lang, '/cards')} class={navLink('cards')}>{t('nav.cards', lang)}</a>
                  <a href={langPath(lang, '/content')} class={navLink('content')}>{t('nav.content', lang)}</a>
                </div>
                <a
                  href={switchUrl}
                  class="rounded-xl border border-brand-100 bg-brand-50 px-2.5 py-2.5 text-xs font-bold text-brand-700 hover:border-brand-200 hover:bg-brand-100 sm:px-3 sm:text-sm"
                >
                  {t('nav.language', lang)}
                </a>
              </div>
            </div>
          </div>
        </nav>

        {/* Main Content */}
        <main class="flex-1">
          {children}
        </main>

        {/* Footer */}
        <footer class="mt-16 overflow-hidden border-t border-slate-800 bg-slate-950 text-slate-300">
          <div class="page-shell relative py-12">
            <div class="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-brand-600/10 blur-3xl"></div>
            <div class="relative flex flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
              <div class="max-w-lg"><div class="mb-4 flex items-center gap-3"><img src="/logo.svg" alt={t('site.title', lang)} width="40" height="40" class="h-10 w-10 rounded-2xl shadow-lg shadow-brand-950/30" /><div><span class="block font-bold text-white">VCC Directory</span><span class="block text-xs text-slate-500">Virtual card intelligence</span></div></div><p class="text-sm leading-6 text-slate-400">{t('footer.text', lang)}</p></div>
              <div class="flex flex-wrap gap-x-7 gap-y-3 text-sm font-semibold"><a href={langPath(lang, '/')} class="hover:text-white">{t('nav.home', lang)}</a><a href={langPath(lang, '/providers')} class="hover:text-white">{t('nav.providers', lang)}</a><a href={langPath(lang, '/cards')} class="hover:text-white">{t('nav.cards', lang)}</a><a href={langPath(lang, '/content')} class="hover:text-white">{t('nav.content', lang)}</a><a href={switchUrl} class="hover:text-white">{t('nav.language', lang)}</a></div>
            </div>
            <div class="mt-8 border-t border-slate-800 pt-6 text-xs text-slate-500">&copy; {new Date().getFullYear()} VCC Directory</div>
          </div>
        </footer>
      </body>
    </html>
    </>
  );
}

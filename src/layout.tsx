import type { Child } from 'hono/jsx';
import type { Lang } from './types';
import { t } from './i18n';

interface LayoutProps {
  title: string;
  description?: string;
  lang: Lang;
  isAdmin?: boolean;
  canonicalUrl?: string;
  noIndex?: boolean;
  ogType?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
  children: Child;
}

export function Layout({ title, description, lang, isAdmin, canonicalUrl, noIndex, ogType, jsonLd, children }: LayoutProps) {
  const desc = description || t('site.description', lang);
  const switchLang = lang === 'zh' ? 'en' : 'zh';
  const switchUrl = `/lang/${switchLang}`;
  const canonical = canonicalUrl || '/';
  const fullTitle = `${title} | ${t('site.title', lang)}`;

  return (
    <html lang={lang === 'zh' ? 'zh-CN' : 'en'}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>{fullTitle}</title>
        <meta name="description" content={desc} />
        <meta name="robots" content={noIndex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large'} />
        <meta property="og:title" content={fullTitle} />
        <meta property="og:description" content={desc} />
        <meta property="og:type" content={ogType || 'website'} />
        <meta property="og:url" content={canonical} />
        <meta property="og:site_name" content={t('site.title', lang)} />
        <meta name="twitter:card" content="summary" />
        <meta name="twitter:title" content={fullTitle} />
        <meta name="twitter:description" content={desc} />
        <link rel="canonical" href={canonical} />
        <script src="https://cdn.tailwindcss.com"></script>
        <script dangerouslySetInnerHTML={{
          __html: `tailwind.config = {
            theme: {
              extend: {
                colors: {
                  brand: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af', 900: '#1e3a8a' }
                }
              }
            }
          }`
        }} />
        {jsonLd && (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
        )}
        <style dangerouslySetInnerHTML={{
          __html: `
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
            .card-hover { transition: all 0.2s ease; }
            .card-hover:hover { transform: translateY(-2px); box-shadow: 0 10px 25px -5px rgba(0,0,0,0.1); }
            .tag-pill { transition: all 0.15s ease; }
            .tag-pill:hover { transform: scale(1.05); }
            .content-prose > * + * { margin-top: 1rem; }
            .content-prose h2 { font-size: 1.375rem; line-height: 1.3; font-weight: 700; color: #111827; margin-top: 1.75rem; }
            .content-prose h3 { font-size: 1.125rem; line-height: 1.4; font-weight: 700; color: #111827; margin-top: 1.5rem; }
            .content-prose ul, .content-prose ol { padding-left: 1.5rem; }
            .content-prose ul { list-style: disc; }
            .content-prose ol { list-style: decimal; }
            .content-prose blockquote { border-left: 3px solid #93c5fd; padding-left: 1rem; color: #4b5563; background: #eff6ff; border-radius: 0 0.5rem 0.5rem 0; padding-top: 0.75rem; padding-bottom: 0.75rem; }
            .content-prose a { color: #2563eb; text-decoration: underline; }
            .rich-editor:empty:before { content: attr(data-placeholder); color: #9ca3af; }
            .rich-editor:focus { outline: none; box-shadow: 0 0 0 2px #3b82f6; border-color: transparent; }
          `
        }} />
      </head>
      <body class="bg-gray-50 min-h-screen flex flex-col">
        {/* Navigation */}
        <nav class="bg-white border-b border-gray-200 sticky top-0 z-50">
          <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div class="flex justify-between h-16 items-center">
              <a href="/" class="flex items-center space-x-2">
                <span class="text-2xl font-bold text-brand-600">VCC</span>
                <span class="text-gray-500 text-sm hidden sm:inline">{t('site.title', lang)}</span>
              </a>
              <div class="flex items-center space-x-4">
                <a href="/" class="text-gray-600 hover:text-brand-600 text-sm font-medium">{t('nav.home', lang)}</a>
                <a href="/content" class="text-gray-600 hover:text-brand-600 text-sm font-medium">{t('nav.content', lang)}</a>
                {isAdmin ? (
                  <>
                    <a href="/admin" class="text-gray-600 hover:text-brand-600 text-sm font-medium">{t('nav.admin', lang)}</a>
                    <a href="/logout" class="text-red-500 hover:text-red-700 text-sm font-medium">{t('nav.logout', lang)}</a>
                  </>
                ) : (
                  <a href="/login" class="text-gray-600 hover:text-brand-600 text-sm font-medium">{t('nav.login', lang)}</a>
                )}
                <a
                  href={switchUrl}
                  class="px-3 py-1.5 bg-brand-50 text-brand-600 rounded-full text-sm font-medium hover:bg-brand-100 transition-colors"
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
        <footer class="bg-white border-t border-gray-200 mt-12">
          <div class="max-w-7xl mx-auto px-4 py-8 text-center text-gray-400 text-sm">
            <p>{t('footer.text', lang)}</p>
            <p class="mt-2">&copy; {new Date().getFullYear()} VCC Directory</p>
          </div>
        </footer>
      </body>
    </html>
  );
}

# VCC Directory

A bilingual virtual credit card directory on Cloudflare Workers. The public site displays providers, card BINs, and editorial content. Hermes agents maintain all data through a protected API; there is no login page or web admin dashboard.

Chinese documentation: [README.zh-CN.md](./README.zh-CN.md)

## Stack

- Cloudflare Workers, D1, and R2
- Hono, Hono JSX, and TypeScript
- Build-time Tailwind CSS
- Vitest

## Structure

```text
src/index.tsx       Worker entry: middleware, language routing, sitemap, wiring
src/pages.tsx       Public page handlers (Chinese and /en English)
src/admin.ts        Hermes admin API, mounted at /api/admin
src/components.tsx  Pagination, card, and article tiles
src/layout.tsx      HTML layout, SEO, and page styles
src/lib/            sanitize, api validation, seo helpers, and D1 utilities
src/i18n.ts         Chinese and English translations and URL language helpers
src/types.ts        Data types
schema.sql          Fresh database schema and sample data
migrations/         Existing database migrations
hermes-skills/      Hermes maintenance skill
```

## Configuration

Configure the production management token:

```bash
wrangler secret put HERMES_API_TOKEN
```

Create `.dev.vars` for local development:

```env
HERMES_API_TOKEN="replace-with-a-strong-local-random-token"
SITE_URL="http://127.0.0.1:8787"
```

D1, R2, and the production site origin are configured in `wrangler.jsonc`.

## Local Development

```bash
npm install
npm run db:init
npm run dev
```

Useful URLs include `/`, `/content`, and `/sitemap.xml` on `http://127.0.0.1:8787`.

Run all checks with:

```bash
npm run check
npm audit --omit=dev
```

## Database

Use `npm run db:init` or `npm run db:init:remote` for a new environment. When upgrading an installation that had the old web admin, also run:

```bash
npm run db:migrate
# After confirming the production target:
npm run db:migrate:remote
```

The migration removes the obsolete `admin_users` table and adds common query indexes. Remote commands mutate production data; verify the Cloudflare account and D1 target first.

## Routes

Public routes include `/`, `/providers`, `/cards`, `/provider/:slug`, `/card/:slug`, `/content`, `/content/:slug`, `/images/*`, `/sitemap.xml`, `/robots.txt`, and `/lang/:lang`. Both directories support `q` search and `page` pagination. Search terms are truncated to keep SQL LIKE patterns within D1's 50-byte limit.

Platforms and card BINs form a parent-child hierarchy: `/providers` browses by platform (region, KYC, tags, and BIN counts), each platform page lists all of its card BINs, and `/cards` browses and compares individual BINs across every platform. The homepage offers both a platforms section and a virtual cards section.

Language lives in the URL: unprefixed paths serve Chinese and `/en/*` serves English. Every indexed page emits `hreflang` alternates (`zh-CN`, `en`, and `x-default`) and the sitemap lists both language versions. Visitors whose `lang` cookie is `en` are redirected (302) to the `/en` page; crawlers without cookies always see the default Chinese URLs, so existing indexed URLs are unchanged.

Inactive providers keep their detail URL with a prominent stopped-operating notice (HTTP 200, noindex, historical reference only); inactive cards stay unavailable through public detail URLs. Draft posts are also private.

The homepage uses two combined feeds: featured virtual cards are pinned above the latest cards, and featured articles are pinned above the latest articles without duplicates. Hermes controls pinned entries through each card or post's `is_featured` field. Industry News at `/content` displays 9 posts per page; `/cards` displays 12 cards per page.

Hermes API resources use `Authorization: Bearer <HERMES_API_TOKEN>`:

- `/api/admin/providers`
- `/api/admin/cards`
- `/api/admin/tags`
- `/api/admin/content`
- `/api/admin/images`

See the [Hermes skill](./hermes-skills/vcc-content-publisher/SKILL.md) for fields, upload constraints, and the maintenance workflow.

Articles support `featured_image_url`. Upload PNG, JPEG, WebP, or GIF through `POST /api/admin/images?kind=content`, then save the returned `content/...` key on the post. The image is used on homepage/news cards, the article hero, Open Graph, and BlogPosting structured data.

## Deployment

```bash
npm run check
npm run deploy
```

Before deployment, initialize or migrate remote D1, verify the R2 bucket and `SITE_URL`, and configure a strong random `HERMES_API_TOKEN`.

## Security

- The management API rejects missing and placeholder tokens.
- JSON bodies are limited to 256 KiB.
- Logos are limited to PNG, JPEG, WebP, or GIF files up to 2 MiB.
- Management responses are non-cacheable and non-indexable.
- Public responses include CSP, clickjacking, MIME-sniffing, and referrer protections.
- Article HTML uses a tag allowlist; JSON-LD escapes script-boundary characters.
- Paginated pages have self-referencing canonicals and `rel=prev/next`; internal search results use `noindex,follow` to avoid duplicate indexing.

# VCC Directory

VCC Directory is a bilingual virtual credit card platform directory built on Cloudflare Workers. It lists VCC providers, card BINs, tags, and editorial content, with an admin dashboard and a protected API for Hermes agent publishing.

Chinese documentation: [README.zh-CN.md](./README.zh-CN.md)

## Features

- Provider directory with search and tag filtering
- Provider detail pages with active card BINs
- Card BIN detail pages with fees, currency, quota, and usage fields
- Bilingual UI: Chinese and English
- Content publishing: public content hub and article detail pages
- Admin dashboard for providers, cards, tags, content, and password changes
- Logo upload through Cloudflare R2
- Cloudflare D1 database schema and seed data
- Hermes agent API protected by Bearer Token
- SEO support: sitemap, robots.txt, canonical URLs, noindex admin pages, Open Graph tags, and JSON-LD structured data

## Tech Stack

- Runtime: Cloudflare Workers
- Web framework: Hono with Hono JSX
- Database: Cloudflare D1
- Object storage: Cloudflare R2
- Language: TypeScript
- Styling: Tailwind CSS CDN

## Project Structure

```text
src/
  index.tsx       Main Worker app, routes, API, admin pages
  layout.tsx      HTML layout, meta tags, navigation
  i18n.ts         Chinese/English translations
  types.ts        TypeScript data types
schema.sql        D1 schema and seed data
wrangler.jsonc    Cloudflare Worker configuration
hermes-skills/    Hermes agent skill documentation
```

## Requirements

- Node.js
- npm
- Cloudflare account
- Wrangler CLI, installed through project dependencies

Install dependencies:

```bash
npm install
```

## Configuration

`wrangler.jsonc` defines bindings for D1, R2, and environment variables:

```json
{
  "vars": {
    "ADMIN_PASSWORD": "change-me-in-production",
    "SESSION_SECRET": "change-me-in-production",
    "HERMES_API_TOKEN": "change-me-in-production",
    "SITE_URL": "https://example.com"
  }
}
```

Set `SITE_URL` to the production origin, for example:

```json
"SITE_URL": "https://your-domain.com"
```

For production secrets, use Wrangler secrets instead of committing real values:

```bash
wrangler secret put SESSION_SECRET
wrangler secret put HERMES_API_TOKEN
```

For local development, create `.dev.vars`:

```env
ADMIN_PASSWORD="change-me-in-production"
SESSION_SECRET="your-local-session-secret"
HERMES_API_TOKEN="your-local-hermes-token"
SITE_URL="http://127.0.0.1:8787"
```

`.dev.vars` is ignored by Git.

## Database

Initialize the local D1 database:

```bash
npm run db:init
```

Initialize the remote D1 database:

```bash
npm run db:init:remote
```

The schema creates:

- `vcc_providers`
- `vcc_cards`
- `vcc_tags`
- `vcc_provider_tags`
- `admin_users`
- `content_posts`

Seed data includes sample tags, providers, card BINs, and an initial admin user.

Default admin credentials:

```text
username: admin
password: admin123
```

Change the password immediately after first login.

## Development

Start the local Worker:

```bash
npm run dev
```

Common local URLs:

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/content`
- `http://127.0.0.1:8787/login`
- `http://127.0.0.1:8787/admin`
- `http://127.0.0.1:8787/sitemap.xml`
- `http://127.0.0.1:8787/robots.txt`

Run TypeScript checks:

```bash
npx tsc --noEmit
```

## Deployment

Deploy to Cloudflare Workers:

```bash
npm run deploy
```

Before deployment:

- Set `SITE_URL` to the real production domain.
- Configure `SESSION_SECRET` and `HERMES_API_TOKEN` with `wrangler secret put`.
- Run `npm run db:init:remote`.
- Confirm the D1 database and R2 bucket in `wrangler.jsonc`.

## Public Routes

- `GET /` - provider directory homepage
- `GET /provider/:slug` - provider details
- `GET /card/:slug` - card BIN details
- `GET /content` - content hub
- `GET /content/:slug` - content article
- `GET /sitemap.xml` - XML sitemap
- `GET /robots.txt` - crawler rules
- `GET /images/*` - R2 image proxy
- `GET /lang/:lang` - language switch

## Admin Routes

Admin pages use signed cookies and CSRF protection.

- `GET /login`
- `POST /login`
- `GET /logout`
- `GET /admin`
- Provider CRUD under `/admin/provider/...`
- Card CRUD under `/admin/card/...`
- Content CRUD under `/admin/content/...`
- Tag creation and deletion under `/admin/tag/...`
- Password change under `/admin/password`

## Hermes Agent API

Hermes API routes are protected with:

```http
Authorization: Bearer <HERMES_API_TOKEN>
Content-Type: application/json
```

Endpoints:

- `GET /api/admin/content`
- `GET /api/admin/content/:id`
- `POST /api/admin/content`
- `PUT /api/admin/content/:id`
- `DELETE /api/admin/content/:id`

Example create request:

```bash
curl -X POST "$SITE_URL/api/admin/content" \
  -H "Authorization: Bearer $HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title_zh": "虚拟卡费用指南",
    "title_en": "Virtual Card Fee Guide",
    "slug": "virtual-card-fee-guide",
    "excerpt_zh": "快速了解开卡费、月费和充值手续费。",
    "excerpt_en": "A quick guide to issuance fees, monthly fees, and top-up rates.",
    "body_zh": "第一段中文正文。\n\n第二段中文正文。",
    "body_en": "First English paragraph.\n\nSecond English paragraph.",
    "status": "published"
  }'
```

Hermes skill documentation:

```text
hermes-skills/vcc-content-publisher/SKILL.md
```

## SEO Notes

The site includes:

- Absolute canonical URLs based on `SITE_URL`
- `robots.txt`
- `sitemap.xml`
- `noindex,nofollow` for login, admin, and API surfaces
- Open Graph and Twitter summary tags
- JSON-LD for WebSite, Organization, ItemList, BreadcrumbList, FinancialProduct, Blog, and BlogPosting

After deploying, submit the production sitemap to Google Search Console:

```text
https://your-domain.com/sitemap.xml
```

## Security Notes

- Change the default admin password immediately.
- Use strong production secrets for `SESSION_SECRET` and `HERMES_API_TOKEN`.
- Do not commit `.dev.vars`.
- Admin delete actions use POST and CSRF protection.
- Hermes API uses Bearer Token authentication and is marked `noindex`.

## Useful Commands

```bash
npm install
npm run dev
npm run db:init
npm run db:init:remote
npx tsc --noEmit
npm run deploy
```

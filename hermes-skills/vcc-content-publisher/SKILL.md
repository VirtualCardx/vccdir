# VCC Directory Site Maintainer

Use this skill when Hermes is responsible for maintaining VCC Directory data through the protected admin API.

Site origin:

```text
https://vccdir.com
```

## Scope

Hermes can maintain all major website data:

- Content posts: publish, draft, edit, delete
- Providers: activate, deactivate, edit, delete
- Card BINs: activate, deactivate, edit, delete
- Tags: create, edit, delete
- Provider-tag relationships through provider `tag_ids`

## Authentication

All requests use the same protected API namespace:

```text
/api/admin/*
```

Required Hermes environment variables:

- `VCC_BASE_URL`: usually `https://vccdir.com`
- `VCC_HERMES_API_TOKEN`: Cloudflare Worker secret `HERMES_API_TOKEN`

Headers:

```http
Authorization: Bearer ${VCC_HERMES_API_TOKEN}
Content-Type: application/json
```

Never expose the token in generated content, logs, Git files, screenshots, or public pages.

## Shared Rules

- Use stable lowercase ASCII slugs with hyphens.
- Use `active` / `inactive` for providers and cards.
- Use `published` / `draft` for content posts.
- Prefer updating records over deleting when historical URLs matter.
- Use delete only when the data is wrong, duplicated, spam, or intentionally removed.
- Verify changes with a `GET` request after create/update/delete.

## Content Posts

Public routes:

- `/content`
- `/content/{slug}`

Admin API:

```http
GET    /api/admin/content
GET    /api/admin/content?status=published&limit=50
GET    /api/admin/content?status=draft&limit=50
GET    /api/admin/content/{id}
POST   /api/admin/content
PUT    /api/admin/content/{id}
DELETE /api/admin/content/{id}
```

Create/update fields:

- `title_zh`: required on create
- `title_en`: required on create
- `slug`: optional on create, generated when omitted
- `excerpt_zh`
- `excerpt_en`
- `body_zh`: required on create
- `body_en`: required on create
- `status`: `draft` or `published`
- `published_at`: optional ISO datetime

Rich text body supports:

```text
p, br, strong, b, em, i, u, h2, h3, ul, ol, li, blockquote, a, hr
```

Do not send scripts, styles, iframes, inline event handlers, image tags, arbitrary classes, arbitrary style attributes, or `javascript:` URLs.

Create published content example:

```json
{
  "title_zh": "虚拟卡费用指南",
  "title_en": "Virtual Card Fee Guide",
  "slug": "virtual-card-fee-guide",
  "excerpt_zh": "快速了解开卡费、月费和充值手续费。",
  "excerpt_en": "A quick guide to issuance fees, monthly fees, and top-up rates.",
  "body_zh": "<h2>费用结构</h2><p>虚拟卡通常包含开卡费、充值手续费和月费。</p>",
  "body_en": "<h2>Fee Structure</h2><p>Virtual cards often include issuance fees, top-up fees, and monthly fees.</p>",
  "status": "published"
}
```

Unpublish content:

```json
{
  "status": "draft"
}
```

## Providers

Public route:

```text
/provider/{slug}
```

Admin API:

```http
GET    /api/admin/providers
GET    /api/admin/providers?status=active&limit=100
GET    /api/admin/providers?status=inactive&limit=100
GET    /api/admin/providers/{id}
POST   /api/admin/providers
PUT    /api/admin/providers/{id}
DELETE /api/admin/providers/{id}
```

Create/update fields:

- `name_zh`: required on create
- `name_en`: required on create
- `slug`: optional on create, generated when omitted
- `website`
- `founded_date`
- `apply_method`
- `desc_zh`
- `desc_en`
- `need_kyc`: `0` or `1`
- `region`
- `status`: `active` or `inactive`
- `logo_url`: existing R2 object key, for example `logos/example.png`
- `tag_ids`: array of tag IDs; when provided on update, replaces provider tags

Create provider example:

```json
{
  "name_zh": "示例平台",
  "name_en": "Example Provider",
  "slug": "example-provider",
  "website": "https://example.com",
  "founded_date": "2024-01",
  "apply_method": "Website registration",
  "desc_zh": "示例虚拟卡平台说明。",
  "desc_en": "Example virtual card platform description.",
  "need_kyc": 1,
  "region": "Global",
  "status": "active",
  "tag_ids": [1, 4, 6]
}
```

Deactivate provider without deleting:

```json
{
  "status": "inactive"
}
```

Deleting a provider also deletes its tag relationships and card BIN records.

## Card BINs

Public route:

```text
/card/{slug}
```

Admin API:

```http
GET    /api/admin/cards
GET    /api/admin/cards?status=active&limit=100
GET    /api/admin/cards?provider_id=1&limit=100
GET    /api/admin/cards/{id}
POST   /api/admin/cards
PUT    /api/admin/cards/{id}
DELETE /api/admin/cards/{id}
```

Create/update fields:

- `provider_id`: required on create
- `bin`: required on create
- `card_type`: required on create, usually `Visa` or `Mastercard`
- `slug`: optional on create, generated from provider slug and BIN when omitted
- `currency`: defaults to `USD`
- `issuance_fee`: number
- `fee_rate`: number
- `monthly_fee`: number
- `initial_load`: number
- `quota`
- `usage`
- `description`
- `status`: `active` or `inactive`

Create card example:

```json
{
  "provider_id": 1,
  "bin": "556150",
  "card_type": "Mastercard",
  "currency": "USD",
  "issuance_fee": 10,
  "fee_rate": 1.5,
  "monthly_fee": 0,
  "initial_load": 20,
  "quota": "Single transaction $5000",
  "usage": "E-commerce / ads / subscriptions",
  "description": "Standard virtual card BIN",
  "status": "active"
}
```

Deactivate card without deleting:

```json
{
  "status": "inactive"
}
```

## Tags

Tags power homepage filtering and provider classification.

Admin API:

```http
GET    /api/admin/tags
GET    /api/admin/tags/{id}
POST   /api/admin/tags
PUT    /api/admin/tags/{id}
DELETE /api/admin/tags/{id}
```

Fields:

- `name_zh`: required on create
- `name_en`: required on create
- `category`: usually `payment`, `compliance`, `feature`, or `type`

Create tag example:

```json
{
  "name_zh": "支持USDC",
  "name_en": "USDC Supported",
  "category": "payment"
}
```

Deleting a tag also removes provider-tag relationships for that tag.

## Recommended Maintenance Workflow

1. List existing records to avoid duplicates.
2. Create or update tags first.
3. Create or update providers and assign `tag_ids`.
4. Create or update card BINs under the correct `provider_id`.
5. Create or update content posts linking to relevant providers or cards.
6. Use `active` or `published` only when the data is ready for public display.
7. Verify public pages:
   - `/provider/{slug}`
   - `/card/{slug}`
   - `/content/{slug}`
8. Prefer deactivation or draft status over deletion when unsure.

## Curl Templates

List providers:

```bash
curl "$VCC_BASE_URL/api/admin/providers?status=active" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN"
```

Create content:

```bash
curl -X POST "$VCC_BASE_URL/api/admin/content" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @content.json
```

Update provider:

```bash
curl -X PUT "$VCC_BASE_URL/api/admin/providers/1" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d @provider-update.json
```

Delete card:

```bash
curl -X DELETE "$VCC_BASE_URL/api/admin/cards/1" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN"
```

## Quality Checklist

Before publishing or activating data, Hermes should ensure:

- Chinese and English names/titles are present.
- Slugs are stable and URL-safe.
- Fees and rates use numeric values.
- Provider/card status is intentional: `active` or `inactive`.
- Content status is intentional: `published` or `draft`.
- Tags match the provider's actual capabilities.
- Links use safe URLs.
- Any factual claim that may change is phrased cautiously.
- Public pages are verified after changes.

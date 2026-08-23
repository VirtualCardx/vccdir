---
name: vcc-content-publisher
description: Maintain VCC Directory providers, card BINs, tags, images, and bilingual content through its protected Hermes API. Use for listing, creating, correcting, publishing, deactivating, or removing site data; there is no web admin interface.
---

# VCC Directory Maintainer

Maintain `https://www.vccdir.com` only through `/api/admin/*`. The website has no login or admin UI.

## Public Site

Public pages: `/providers` (platform directory), `/provider/{slug}` (platform with its card BINs), `/cards` (BIN directory), `/card/{slug}`, `/content`, and `/content/{slug}`. Chinese pages are unprefixed; English versions live under `/en/` with the same paths and render from the same records. The homepage shows a platforms section (most recently updated first), featured and latest cards, and featured and latest articles.

## Authentication

Set these Hermes environment variables:

- `VCC_BASE_URL`, normally `https://www.vccdir.com` (use the `www` host; the bare domain redirects every request, including API calls)
- `VCC_HERMES_API_TOKEN`, matching the Worker secret `HERMES_API_TOKEN`

Send JSON requests with:

```http
Authorization: Bearer ${VCC_HERMES_API_TOKEN}
Content-Type: application/json
```

Never expose the token in content, logs, Git files, screenshots, or public pages. Stop if authentication returns `401` or the server reports that the token is not configured.

## Maintenance Rules

- List records before creating anything to avoid duplicates.
- Use lowercase ASCII slugs separated by hyphens; once public, keep slugs stable.
- Use `active` / `inactive` for providers and cards, and `published` / `draft` for content.
- Prefer deactivation or draft status instead of deleting data. A deactivated provider keeps its public URL with a prominent stopped-operating notice (HTTP 200, noindex); deactivated cards remain unavailable.
- Send `null` to clear an optional field. Omitting it preserves the current value.
- Use numeric values for fees and rates; they must be non-negative.
- Verify every mutation with the corresponding API `GET`, then check its public URL in either language (`/path` or `/en/path`) when active or published.
- Delete only incorrect, duplicate, spam, or intentionally removed records.

## Images

Upload a provider logo before creating or updating the provider:

```bash
curl -X POST "$VCC_BASE_URL/api/admin/images" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN" \
  -F "file=@logo.webp"
```

The API accepts PNG, JPEG, WebP, or GIF up to 2 MiB and returns a `key` such as `logos/<uuid>.webp`. Store that key in `logo_url`.

For an article featured image, add `?kind=content` and store the returned `content/<uuid>.<ext>` key in `featured_image_url`:

```bash
curl -X POST "$VCC_BASE_URL/api/admin/images?kind=content" \
  -H "Authorization: Bearer $VCC_HERMES_API_TOKEN" \
  -F "file=@article-cover.webp"
```

Use landscape images close to a 16:9 ratio, with a meaningful subject and no embedded UI controls. The public page uses the image for article cards, the article hero, Open Graph, Twitter cards, and BlogPosting structured data.

Delete an unused managed image only after confirming no provider references it:

```http
DELETE /api/admin/images/{logos-or-content}/{managed-file}
```

## Providers

```http
GET    /api/admin/providers?status=active&limit=100
GET    /api/admin/providers/{id}
POST   /api/admin/providers
PUT    /api/admin/providers/{id}
DELETE /api/admin/providers/{id}
```

Create requires `name_zh` and `name_en`. Other fields are `slug`, `website` (HTTPS), `founded_date`, `apply_method`, `desc_zh`, `desc_en`, `need_kyc` (`0` or `1`), `region`, `status`, `logo_url`, and `tag_ids` (an array of existing tag IDs). Supplying `tag_ids` on update replaces all tag relationships.

```json
{
  "name_zh": "示例平台",
  "name_en": "Example Provider",
  "slug": "example-provider",
  "website": "https://example.com/",
  "need_kyc": 1,
  "region": "Global",
  "status": "active",
  "logo_url": "logos/example.webp",
  "tag_ids": [1, 4, 6]
}
```

Deleting a provider also deletes its card BINs and tag relationships. Active providers appear in the `/providers` directory and the homepage platforms section, ordered by most recently updated.

## Card BINs

```http
GET    /api/admin/cards?status=active&provider_id=1&featured=1&limit=100
GET    /api/admin/cards/{id}
POST   /api/admin/cards
PUT    /api/admin/cards/{id}
DELETE /api/admin/cards/{id}
```

Create requires `provider_id`, `bin` (6–19 digits), and `card_type`. Other fields are `slug`, three-letter `currency`, `issuance_fee`, `fee_rate`, `monthly_fee`, `initial_load`, `quota`, `usage`, `description`, `status`, and `is_featured` (`0` or `1`). Featured active cards appear in the curated homepage section.

## Tags

```http
GET    /api/admin/tags
GET    /api/admin/tags/{id}
POST   /api/admin/tags
PUT    /api/admin/tags/{id}
DELETE /api/admin/tags/{id}
```

Create requires `name_zh` and `name_en`; `category` is optional and commonly `payment`, `compliance`, `feature`, or `type`. Deleting a tag also removes its provider relationships.

## Content

```http
GET    /api/admin/content?status=published&featured=1&limit=50
GET    /api/admin/content/{id}
POST   /api/admin/content
PUT    /api/admin/content/{id}
DELETE /api/admin/content/{id}
```

Create requires `title_zh`, `title_en`, `body_zh`, and `body_en`. Other fields are `slug`, `excerpt_zh`, `excerpt_en`, `status`, ISO `published_at`, `is_featured` (`0` or `1`), and `featured_image_url` (a managed `content/...` key). Featured published articles appear in the homepage curated section.

Bodies may contain `p`, `br`, `strong`, `b`, `em`, `i`, `u`, `h2`, `h3`, `ul`, `ol`, `li`, `blockquote`, `a`, and `hr`. Do not send scripts, styles, iframes, images, event handlers, classes, style attributes, or `javascript:` URLs.

## Recommended Order

1. List and update or create tags.
2. Upload required provider logos and article featured images.
3. Update or create providers and assign `tag_ids`.
4. Update or create card BINs under the verified provider ID.
5. Draft and review bilingual industry news, then publish it with an intentional featured status.
6. Verify the API record and the public `/provider/{slug}`, `/card/{slug}`, or `/content/{slug}` page in either language.

Treat `400` as invalid data, `409` as a duplicate unique value, `413` as an oversized request, and `415` as an unsupported content type. Correct the request rather than retrying it unchanged.

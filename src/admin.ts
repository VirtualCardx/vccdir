// Hermes agent admin API, mounted at /api/admin.
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type { Provider, Card, Tag, ContentPost, Env } from './types';
import {
  ApiError, parseLimit, assertSlug, assertSafeWebsite, parseJsonBody, requireHermesAuth,
  stringField, requiredStringField, nullableStringField, patchedNullableString, normalizeContentStatus, normalizeActiveStatus,
  assertLogoKey, assertContentImageKey, optionalIsoDate, nonNegativeNumberField, optionalNumberField, binaryFlagField,
  detectImageType, numberArrayField,
} from './lib/api';
import { apiProvidersWithTags, updateProviderTags, validateTagIds } from './lib/db';
import { absoluteUrl, siteOrigin } from './lib/seo';
import { generateSlug } from './lib/sanitize';
import { purgeProviderUpdate, purgeCardUpdate, purgeContentUpdate, purgeTagUpdate } from './lib/cache';

export const adminApi = new Hono<Env>();

// Cache purging is best-effort: a purge failure must not fail an already-committed mutation.
const purge = async (run: () => Promise<void>) => {
  try {
    await run();
  } catch (error) {
    console.error('cache purge failed', error);
  }
};

adminApi.use('*', bodyLimit({
  // 2 MiB file limit plus headroom for multipart framing so near-limit images are not rejected here.
  maxSize: 2 * 1024 * 1024 + 200 * 1024,
  onError: (c) => c.json({ error: 'Request body exceeds 2 MiB' }, 413),
}));

adminApi.use('*', async (c, next) => {
  c.header('Cache-Control', 'no-store');
  c.header('X-Robots-Tag', 'noindex, nofollow');
  const unauthorized = requireHermesAuth(c);
  if (unauthorized) return unauthorized;
  await next();
});

adminApi.get('/content', async (c) => {
  const status = c.req.query('status');
  const featured = c.req.query('featured');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const params: unknown[] = [];
  let query = 'SELECT * FROM content_posts';
  const where: string[] = [];

  if (status === 'draft' || status === 'published') {
    where.push('status = ?');
    params.push(status);
  }

  if (featured === '0' || featured === '1') {
    where.push('is_featured = ?');
    params.push(Number(featured));
  }

  if (where.length) query += ` WHERE ${where.join(' AND ')}`;

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all<ContentPost>();
  return c.json({ results: posts.results });
});

adminApi.get('/content/:id', async (c) => {
  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(c.req.param('id')).first<ContentPost>();
  if (!post) return c.json({ error: 'Content not found' }, 404);
  return c.json(post);
});

adminApi.post('/content', async (c) => {
  const body = await parseJsonBody(c);
  const titleZh = requiredStringField(body, 'title_zh', 200);
  const titleEn = requiredStringField(body, 'title_en', 200);
  const bodyZh = requiredStringField(body, 'body_zh', 100000);
  const bodyEn = requiredStringField(body, 'body_en', 100000);
  const slug = assertSlug(stringField(body, 'slug') || generateSlug(titleEn));
  const status = normalizeContentStatus(stringField(body, 'status'));
  const isFeatured = binaryFlagField(body, 'is_featured', 0);
  const featuredImageUrl = assertContentImageKey(nullableStringField(body, 'featured_image_url'));
  const publishedAt = status === 'published'
    ? (optionalIsoDate(nullableStringField(body, 'published_at'), 'published_at') || new Date().toISOString())
    : null;
  const result = await c.env.DB.prepare(
    'INSERT INTO content_posts (title_zh, title_en, slug, excerpt_zh, excerpt_en, body_zh, body_en, status, is_featured, featured_image_url, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    titleZh, titleEn, slug, nullableStringField(body, 'excerpt_zh'), nullableStringField(body, 'excerpt_en'),
    bodyZh, bodyEn, status, isFeatured, featuredImageUrl, publishedAt
  ).run();

  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(result.meta.last_row_id).first<ContentPost>();
  await purge(() => purgeContentUpdate(c.env.DB, siteOrigin(c), [slug]));
  return c.json(post, 201);
});

adminApi.put('/content/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  if (!existing) return c.json({ error: 'Content not found' }, 404);

  const body = await parseJsonBody(c);
  const status = normalizeContentStatus(stringField(body, 'status', existing.status));
  const publishedAt = status === 'published'
    ? (optionalIsoDate(patchedNullableString(body, 'published_at', existing.published_at), 'published_at') || new Date().toISOString())
    : null;
  const titleZh = stringField(body, 'title_zh', existing.title_zh);
  const titleEn = stringField(body, 'title_en', existing.title_en);
  const bodyZh = stringField(body, 'body_zh', existing.body_zh);
  const bodyEn = stringField(body, 'body_en', existing.body_en);
  if (!titleZh || !titleEn || !bodyZh || !bodyEn) throw new ApiError(400, 'Bilingual titles and bodies cannot be empty');
  const newSlug = assertSlug(stringField(body, 'slug', existing.slug));

  await c.env.DB.prepare(
    `UPDATE content_posts SET title_zh = ?, title_en = ?, slug = ?, excerpt_zh = ?, excerpt_en = ?, body_zh = ?, body_en = ?, status = ?, is_featured = ?, featured_image_url = ?, published_at = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    titleZh,
    titleEn,
    newSlug,
    patchedNullableString(body, 'excerpt_zh', existing.excerpt_zh),
    patchedNullableString(body, 'excerpt_en', existing.excerpt_en),
    bodyZh,
    bodyEn,
    status,
    binaryFlagField(body, 'is_featured', existing.is_featured),
    assertContentImageKey(patchedNullableString(body, 'featured_image_url', existing.featured_image_url)),
    publishedAt,
    id
  ).run();

  const post = await c.env.DB.prepare('SELECT * FROM content_posts WHERE id = ?').bind(id).first<ContentPost>();
  await purge(() => purgeContentUpdate(c.env.DB, siteOrigin(c), [existing.slug, post?.slug].filter((s): s is string => Boolean(s))));
  return c.json(post);
});

adminApi.delete('/content/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT slug FROM content_posts WHERE id = ?').bind(id).first<{ slug: string }>();
  await c.env.DB.prepare('DELETE FROM content_posts WHERE id = ?').bind(id).run();
  if (existing) await purge(() => purgeContentUpdate(c.env.DB, siteOrigin(c), [existing.slug]));
  return c.json({ ok: true });
});

adminApi.post('/images', async (c) => {
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > 2 * 1024 * 1024) throw new ApiError(413, 'Image exceeds 2 MiB');
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) throw new ApiError(415, 'Content-Type must be multipart/form-data');
  const form = await c.req.parseBody();
  const file = form['file'];
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, 'file is required');
  if (file.size > 2 * 1024 * 1024) throw new ApiError(413, 'Image exceeds 2 MiB');
  const buffer = await file.arrayBuffer();
  const detected = detectImageType(new Uint8Array(buffer));
  if (!detected || detected.mime !== file.type) throw new ApiError(415, 'File content must be a valid PNG, JPEG, WebP, or GIF image');
  const kindParam = c.req.query('kind');
  if (kindParam && kindParam !== 'content' && kindParam !== 'logo' && kindParam !== 'logos') throw new ApiError(400, 'kind must be content or logo');
  const kind = kindParam === 'content' ? 'content' : 'logos';
  const key = `${kind}/${crypto.randomUUID()}.${detected.extension}`;
  await c.env.R2.put(key, buffer, { httpMetadata: { contentType: detected.mime } });
  return c.json({ key, url: absoluteUrl(c, `/images/${key}`) }, 201);
});

adminApi.delete('/images/*', async (c) => {
  const key = c.req.path.replace('/api/admin/images/', '');
  // [a-z0-9-] matches the validation charset: legacy keys such as "easypay-1786273844" are not UUID-shaped.
  if (!/^(?:logos|content)\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|ico|svg)$/i.test(key)) throw new ApiError(400, 'Invalid managed image key');
  await c.env.R2.delete(key);
  return c.json({ ok: true });
});

adminApi.get('/providers', async (c) => {
  const status = c.req.query('status');
  const limit = parseLimit(c.req.query('limit'), 100, 200);
  const params: unknown[] = [];
  let query = 'SELECT * FROM vcc_providers';

  if (status === 'active' || status === 'inactive') {
    query += ' WHERE status = ?';
    params.push(status);
  }

  query += ' ORDER BY updated_at DESC LIMIT ?';
  params.push(limit);

  const providers = await c.env.DB.prepare(query).bind(...params).all<Provider>();
  const results = await apiProvidersWithTags(c.env.DB, providers.results);
  return c.json({ results });
});

adminApi.get('/providers/:id', async (c) => {
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(c.req.param('id')).first<Provider>();
  if (!provider) return c.json({ error: 'Provider not found' }, 404);
  return c.json((await apiProvidersWithTags(c.env.DB, [provider]))[0]);
});

adminApi.post('/providers', async (c) => {
  const body = await parseJsonBody(c);
  const nameZh = requiredStringField(body, 'name_zh', 120);
  const nameEn = requiredStringField(body, 'name_en', 120);
  const slug = assertSlug(stringField(body, 'slug') || generateSlug(nameEn));
  const tagIds = numberArrayField(body, 'tag_ids');

  const result = await c.env.DB.prepare(
    'INSERT INTO vcc_providers (name_zh, name_en, website, founded_date, apply_method, desc_zh, desc_en, need_kyc, region, status, logo_url, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    nameZh,
    nameEn,
    assertSafeWebsite(nullableStringField(body, 'website')),
    nullableStringField(body, 'founded_date'),
    nullableStringField(body, 'apply_method'),
    nullableStringField(body, 'desc_zh'),
    nullableStringField(body, 'desc_en'),
    binaryFlagField(body, 'need_kyc', 0),
    nullableStringField(body, 'region'),
    normalizeActiveStatus(stringField(body, 'status')),
    assertLogoKey(nullableStringField(body, 'logo_url')),
    slug
  ).run();

  const providerId = Number(result.meta.last_row_id);
  await updateProviderTags(c.env.DB, providerId, tagIds);
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(providerId).first<Provider>();
  await purge(() => purgeProviderUpdate(c.env.DB, siteOrigin(c), [slug]));
  return c.json(provider ? (await apiProvidersWithTags(c.env.DB, [provider]))[0] : null, 201);
});

adminApi.put('/providers/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>();
  if (!existing) return c.json({ error: 'Provider not found' }, 404);

  const body = await parseJsonBody(c);
  const nameZh = stringField(body, 'name_zh', existing.name_zh);
  const nameEn = stringField(body, 'name_en', existing.name_en);
  const tagIds = numberArrayField(body, 'tag_ids');
  if (tagIds) await validateTagIds(c.env.DB, tagIds);
  if (!nameZh || !nameEn) throw new ApiError(400, 'Bilingual provider names cannot be empty');
  const newSlug = assertSlug(stringField(body, 'slug', existing.slug));
  const update = c.env.DB.prepare(
    `UPDATE vcc_providers SET name_zh = ?, name_en = ?, website = ?, founded_date = ?, apply_method = ?, desc_zh = ?, desc_en = ?, need_kyc = ?, region = ?, status = ?, logo_url = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    nameZh,
    nameEn,
    assertSafeWebsite(patchedNullableString(body, 'website', existing.website)),
    patchedNullableString(body, 'founded_date', existing.founded_date),
    patchedNullableString(body, 'apply_method', existing.apply_method),
    patchedNullableString(body, 'desc_zh', existing.desc_zh),
    patchedNullableString(body, 'desc_en', existing.desc_en),
    binaryFlagField(body, 'need_kyc', existing.need_kyc),
    patchedNullableString(body, 'region', existing.region),
    normalizeActiveStatus(stringField(body, 'status', existing.status)),
    assertLogoKey(patchedNullableString(body, 'logo_url', existing.logo_url)),
    newSlug,
    id
  );

  if (tagIds) {
    await c.env.DB.batch([
      update,
      c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(id),
      ...tagIds.map((tagId) => c.env.DB.prepare('INSERT INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(id, tagId)),
    ]);
  } else {
    await update.run();
  }
  const provider = await c.env.DB.prepare('SELECT * FROM vcc_providers WHERE id = ?').bind(id).first<Provider>();
  await purge(() => purgeProviderUpdate(c.env.DB, siteOrigin(c), [existing.slug, newSlug]));
  return c.json(provider ? (await apiProvidersWithTags(c.env.DB, [provider]))[0] : null);
});

adminApi.delete('/providers/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(id).first<{ slug: string }>();
  const cardSlugs = await c.env.DB.prepare('SELECT slug FROM vcc_cards WHERE provider_id = ?').bind(id).all<{ slug: string }>();
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_cards WHERE provider_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_providers WHERE id = ?').bind(id),
  ]);
  if (existing) {
    const origin = siteOrigin(c);
    await purge(() => purgeProviderUpdate(c.env.DB, origin, [existing.slug]));
    await purge(() => purgeCardUpdate(c.env.DB, origin, cardSlugs.results.map((row) => row.slug), [existing.slug]));
  }
  return c.json({ ok: true });
});

adminApi.get('/cards', async (c) => {
  const status = c.req.query('status');
  const featured = c.req.query('featured');
  const providerId = c.req.query('provider_id');
  const limit = parseLimit(c.req.query('limit'), 100, 200);
  const params: unknown[] = [];
  let query = 'SELECT * FROM vcc_cards';
  const where: string[] = [];

  if (status === 'active' || status === 'inactive') {
    where.push('status = ?');
    params.push(status);
  }
  if (providerId) {
    if (!/^\d+$/.test(providerId)) throw new ApiError(400, 'provider_id must be a positive integer');
    where.push('provider_id = ?');
    params.push(providerId);
  }
  if (featured === '0' || featured === '1') {
    where.push('is_featured = ?');
    params.push(Number(featured));
  }
  if (where.length) query += ` WHERE ${where.join(' AND ')}`;
  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const cards = await c.env.DB.prepare(query).bind(...params).all<Card>();
  return c.json({ results: cards.results });
});

adminApi.get('/cards/:id', async (c) => {
  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(c.req.param('id')).first<Card>();
  if (!card) return c.json({ error: 'Card not found' }, 404);
  return c.json(card);
});

adminApi.post('/cards', async (c) => {
  const body = await parseJsonBody(c);
  const providerId = optionalNumberField(body, 'provider_id');
  const bin = requiredStringField(body, 'bin', 19);
  const cardType = requiredStringField(body, 'card_type', 40);
  if (!providerId || !Number.isInteger(providerId) || providerId < 1) throw new ApiError(400, 'provider_id must be a positive integer');
  if (!/^\d{6,19}$/.test(bin)) throw new ApiError(400, 'bin must contain 6 to 19 digits');
  const provider = await c.env.DB.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(providerId).first<{ slug: string }>();
  if (!provider) throw new ApiError(400, 'provider_id does not exist');

  let slug = stringField(body, 'slug');
  if (!slug) slug = `${provider.slug}-${bin}`;
  assertSlug(slug);
  const currency = stringField(body, 'currency', 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a three-letter code');

  const result = await c.env.DB.prepare(
    'INSERT INTO vcc_cards (provider_id, bin, card_type, currency, issuance_fee, fee_rate, monthly_fee, initial_load, quota, usage, description, description_zh, description_en, status, is_featured, slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    providerId,
    bin,
    cardType,
    currency,
    nonNegativeNumberField(body, 'issuance_fee', 0),
    nonNegativeNumberField(body, 'fee_rate', 0),
    nonNegativeNumberField(body, 'monthly_fee', 0),
    nonNegativeNumberField(body, 'initial_load', 0),
    nullableStringField(body, 'quota'),
    nullableStringField(body, 'usage'),
    nullableStringField(body, 'description'),
    nullableStringField(body, 'description_zh'),
    nullableStringField(body, 'description_en'),
    normalizeActiveStatus(stringField(body, 'status')),
    binaryFlagField(body, 'is_featured', 0),
    slug
  ).run();

  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(result.meta.last_row_id).first<Card>();
  await purge(() => purgeCardUpdate(c.env.DB, siteOrigin(c), [slug], [provider.slug]));
  return c.json(card, 201);
});

adminApi.put('/cards/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>();
  if (!existing) return c.json({ error: 'Card not found' }, 404);

  const body = await parseJsonBody(c);
  const providerId = optionalNumberField(body, 'provider_id') ?? existing.provider_id;
  if (!Number.isInteger(providerId) || providerId < 1) throw new ApiError(400, 'provider_id must be a positive integer');
  const provider = await c.env.DB.prepare('SELECT id, slug FROM vcc_providers WHERE id = ?').bind(providerId).first<{ id: number; slug: string }>();
  if (!provider) throw new ApiError(400, 'provider_id does not exist');
  const previousProvider = await c.env.DB.prepare('SELECT slug FROM vcc_providers WHERE id = ?').bind(existing.provider_id).first<{ slug: string }>();
  // Historical rows may carry product names as bin; only validate when the value actually changes.
  const requestedBin = stringField(body, 'bin', existing.bin);
  const binChanged = requestedBin !== existing.bin;
  if (binChanged && !/^\d{6,19}$/.test(requestedBin)) throw new ApiError(400, 'bin must contain 6 to 19 digits');
  const bin = requestedBin;
  const currency = stringField(body, 'currency', existing.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw new ApiError(400, 'currency must be a three-letter code');
  const newSlug = assertSlug(stringField(body, 'slug', existing.slug));
  await c.env.DB.prepare(
    `UPDATE vcc_cards SET provider_id = ?, bin = ?, card_type = ?, currency = ?, issuance_fee = ?, fee_rate = ?, monthly_fee = ?, initial_load = ?, quota = ?, usage = ?, description = ?, description_zh = ?, description_en = ?, status = ?, is_featured = ?, slug = ?, updated_at = datetime('now') WHERE id = ?`
  ).bind(
    providerId,
    bin,
    stringField(body, 'card_type', existing.card_type),
    currency,
    nonNegativeNumberField(body, 'issuance_fee', existing.issuance_fee),
    nonNegativeNumberField(body, 'fee_rate', existing.fee_rate),
    nonNegativeNumberField(body, 'monthly_fee', existing.monthly_fee),
    nonNegativeNumberField(body, 'initial_load', existing.initial_load),
    patchedNullableString(body, 'quota', existing.quota),
    patchedNullableString(body, 'usage', existing.usage),
    patchedNullableString(body, 'description', existing.description),
    patchedNullableString(body, 'description_zh', existing.description_zh ?? null),
    patchedNullableString(body, 'description_en', existing.description_en ?? null),
    normalizeActiveStatus(stringField(body, 'status', existing.status)),
    binaryFlagField(body, 'is_featured', existing.is_featured),
    newSlug,
    id
  ).run();

  const card = await c.env.DB.prepare('SELECT * FROM vcc_cards WHERE id = ?').bind(id).first<Card>();
  await purge(() => purgeCardUpdate(
    c.env.DB,
    siteOrigin(c),
    [existing.slug, newSlug],
    [previousProvider?.slug, provider.slug].filter((s): s is string => Boolean(s))
  ));
  return c.json(card);
});

adminApi.delete('/cards/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    'SELECT c.slug, p.slug AS provider_slug FROM vcc_cards c INNER JOIN vcc_providers p ON p.id = c.provider_id WHERE c.id = ?'
  ).bind(id).first<{ slug: string; provider_slug: string }>();
  await c.env.DB.prepare('DELETE FROM vcc_cards WHERE id = ?').bind(id).run();
  if (existing) await purge(() => purgeCardUpdate(c.env.DB, siteOrigin(c), [existing.slug], [existing.provider_slug]));
  return c.json({ ok: true });
});

adminApi.get('/tags', async (c) => {
  const tags = await c.env.DB.prepare('SELECT * FROM vcc_tags ORDER BY category, id').all<Tag>();
  return c.json({ results: tags.results });
});

adminApi.get('/tags/:id', async (c) => {
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(c.req.param('id')).first<Tag>();
  if (!tag) return c.json({ error: 'Tag not found' }, 404);
  return c.json(tag);
});

adminApi.post('/tags', async (c) => {
  const body = await parseJsonBody(c);
  const nameZh = requiredStringField(body, 'name_zh', 80);
  const nameEn = requiredStringField(body, 'name_en', 80);

  const result = await c.env.DB.prepare('INSERT INTO vcc_tags (name_zh, name_en, category) VALUES (?, ?, ?)').bind(
    nameZh,
    nameEn,
    nullableStringField(body, 'category')
  ).run();
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(result.meta.last_row_id).first<Tag>();
  await purge(() => purgeTagUpdate(c.env.DB, siteOrigin(c)));
  return c.json(tag, 201);
});

adminApi.put('/tags/:id', async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(id).first<Tag>();
  if (!existing) return c.json({ error: 'Tag not found' }, 404);

  const body = await parseJsonBody(c);
  await c.env.DB.prepare('UPDATE vcc_tags SET name_zh = ?, name_en = ?, category = ? WHERE id = ?').bind(
    stringField(body, 'name_zh', existing.name_zh),
    stringField(body, 'name_en', existing.name_en),
    patchedNullableString(body, 'category', existing.category),
    id
  ).run();
  const tag = await c.env.DB.prepare('SELECT * FROM vcc_tags WHERE id = ?').bind(id).first<Tag>();
  await purge(() => purgeTagUpdate(c.env.DB, siteOrigin(c)));
  return c.json(tag);
});

adminApi.delete('/tags/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM vcc_provider_tags WHERE tag_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM vcc_tags WHERE id = ?').bind(id),
  ]);
  await purge(() => purgeTagUpdate(c.env.DB, siteOrigin(c)));
  return c.json({ ok: true });
});

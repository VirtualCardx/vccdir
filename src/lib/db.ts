// D1 helpers shared by the admin API.
import type { Provider, Tag, ProviderWithTags } from '../types';
import { ApiError } from './api';

export async function apiProvidersWithTags(db: D1Database, providers: Provider[], activeCardsOnly = false): Promise<ProviderWithTags[]> {
  if (!providers.length) return [];
  const tagRows: (Tag & { provider_id: number })[] = [];
  const countRows: { provider_id: number; card_count: number }[] = [];
  // D1 caps bound parameters per query at 100, so query in chunks below that and merge.
  for (let index = 0; index < providers.length; index += 90) {
    const chunk = providers.slice(index, index + 90);
    const placeholders = chunk.map(() => '?').join(',');
    const ids = chunk.map((provider) => provider.id);
    const [tags, counts] = await Promise.all([
      db.prepare(
        `SELECT pt.provider_id, t.* FROM vcc_provider_tags pt INNER JOIN vcc_tags t ON t.id = pt.tag_id WHERE pt.provider_id IN (${placeholders}) ORDER BY t.category, t.id`
      ).bind(...ids).all<Tag & { provider_id: number }>(),
      db.prepare(
        `SELECT provider_id, COUNT(*) AS card_count FROM vcc_cards WHERE provider_id IN (${placeholders})${activeCardsOnly ? ' AND status = ?' : ''} GROUP BY provider_id`
      ).bind(...ids, ...(activeCardsOnly ? ['active'] : [])).all<{ provider_id: number; card_count: number }>(),
    ]);
    tagRows.push(...tags.results);
    countRows.push(...counts.results);
  }
  const tagsByProvider = new Map<number, Tag[]>();
  for (const row of tagRows) {
    const tags = tagsByProvider.get(row.provider_id) || [];
    const { provider_id: _providerId, ...tag } = row;
    tags.push(tag);
    tagsByProvider.set(row.provider_id, tags);
  }
  const counts = new Map(countRows.map((row) => [row.provider_id, row.card_count]));
  return providers.map((provider) => ({
    ...provider,
    tags: tagsByProvider.get(provider.id) || [],
    card_count: counts.get(provider.id) || 0,
  }));
}

export async function validateTagIds(db: D1Database, tagIds: number[]): Promise<void> {
  if (!tagIds.length) return;
  const placeholders = tagIds.map(() => '?').join(',');
  const existing = await db.prepare(`SELECT id FROM vcc_tags WHERE id IN (${placeholders})`).bind(...tagIds).all<{ id: number }>();
  if (existing.results.length !== tagIds.length) throw new ApiError(400, 'tag_ids contains an unknown tag');
}

export async function updateProviderTags(db: D1Database, providerId: number, tagIds: number[] | null): Promise<void> {
  if (!tagIds) return;
  await validateTagIds(db, tagIds);
  await db.batch([
    db.prepare('DELETE FROM vcc_provider_tags WHERE provider_id = ?').bind(providerId),
    ...tagIds.map((tagId) => db.prepare('INSERT INTO vcc_provider_tags (provider_id, tag_id) VALUES (?, ?)').bind(providerId, tagId)),
  ]);
}

// Request validation and Hermes API plumbing shared by the admin routes.
import type { Context } from 'hono';
import type { Env } from '../types';

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export class ApiError extends Error {
  constructor(public status: 400 | 404 | 409 | 413 | 415, message: string) {
    super(message);
  }
}

export function parseLimit(value: string | undefined, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

export function assertSlug(slug: string): string {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 120) {
    throw new ApiError(400, 'slug must be lowercase ASCII words separated by hyphens');
  }
  return slug;
}

export function assertSafeWebsite(value: string | null): string | null {
  if (!value) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ApiError(400, 'website must be a valid HTTPS URL');
  }
  if (url.protocol !== 'https:') throw new ApiError(400, 'website must use HTTPS');
  return url.toString();
}

export async function parseJsonBody(c: Context<Env>): Promise<Record<string, unknown>> {
  const contentType = c.req.header('Content-Type') || '';
  if (!contentType.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'Content-Type must be application/json');
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (contentLength > 256 * 1024) throw new ApiError(413, 'JSON body exceeds 256 KiB');
  try {
    const body = await c.req.json<unknown>();
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > 256 * 1024) throw new ApiError(413, 'JSON body exceeds 256 KiB');
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, 'Request body must be a JSON object');
  }
}

export function requireHermesAuth(c: Context<Env>): Response | null {
  const expected = c.env.HERMES_API_TOKEN;
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!expected || expected === 'change-me-in-production') {
    return c.json({ error: 'HERMES_API_TOKEN is not configured' }, 503);
  }

  if (!token || !constantTimeEqual(token, expected)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  return null;
}

export function stringField(body: Record<string, unknown>, key: string, fallback = ''): string {
  const value = body[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

export function requiredStringField(body: Record<string, unknown>, key: string, maximum: number): string {
  const value = stringField(body, key);
  if (!value) throw new ApiError(400, `${key} is required`);
  if (value.length > maximum) throw new ApiError(400, `${key} exceeds ${maximum} characters`);
  return value;
}

export function nullableStringField(body: Record<string, unknown>, key: string): string | null {
  const value = stringField(body, key);
  return value || null;
}

export function patchedNullableString(body: Record<string, unknown>, key: string, current: string | null): string | null {
  if (!(key in body)) return current;
  if (body[key] === null) return null;
  if (typeof body[key] !== 'string') throw new ApiError(400, `${key} must be a string or null`);
  return String(body[key]).trim() || null;
}

export function normalizeContentStatus(value: string): string {
  if (value && value !== 'draft' && value !== 'published') throw new ApiError(400, 'status must be draft or published');
  return value === 'published' ? 'published' : 'draft';
}

export function normalizeActiveStatus(value: string): string {
  if (value && value !== 'active' && value !== 'inactive') throw new ApiError(400, 'status must be active or inactive');
  return value === 'inactive' ? 'inactive' : 'active';
}

export function assertLogoKey(value: string | null): string | null {
  if (!value) return null;
  // ico/svg are accepted for legacy keys uploaded before the current format restrictions.
  if (!/^logos\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif|ico|svg)$/i.test(value)) throw new ApiError(400, 'logo_url must be a managed image key');
  return value;
}

export function assertContentImageKey(value: string | null): string | null {
  if (!value) return null;
  if (!/^content\/[a-z0-9-]+\.(?:png|jpg|jpeg|webp|gif)$/i.test(value)) {
    throw new ApiError(400, 'featured_image_url must be a managed content image key');
  }
  return value;
}

export function optionalIsoDate(value: string | null, key: string): string | null {
  if (!value) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new ApiError(400, `${key} must be a valid ISO date`);
  return new Date(timestamp).toISOString();
}

export function numberField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const value = body[key];
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new ApiError(400, `${key} must be a finite number`);
  return numberValue;
}

export function nonNegativeNumberField(body: Record<string, unknown>, key: string, fallback = 0): number {
  const value = numberField(body, key, fallback);
  if (value < 0) throw new ApiError(400, `${key} must be zero or greater`);
  return value;
}

export function optionalNumberField(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  if (value === undefined || value === null || value === '') return null;
  const numberValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numberValue)) throw new ApiError(400, `${key} must be a finite number`);
  return numberValue;
}

export function binaryFlagField(body: Record<string, unknown>, key: string, fallback: number): number {
  const value = numberField(body, key, fallback);
  if (value !== 0 && value !== 1) throw new ApiError(400, `${key} must be 0 or 1`);
  return value;
}

export function detectImageType(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes.length >= 8 && bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index])) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: 'image/jpeg', extension: 'jpg' };
  const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
  if (bytes.length >= 6 && (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a')) return { mime: 'image/gif', extension: 'gif' };
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return { mime: 'image/webp', extension: 'webp' };
  return null;
}

export function numberArrayField(body: Record<string, unknown>, key: string): number[] | null {
  const value = body[key];
  if (!Array.isArray(value)) return null;
  const numbers = [...new Set(value.map((item) => Number(item)))];
  if (numbers.some((item) => !Number.isInteger(item) || item < 1)) throw new ApiError(400, `${key} must contain positive integer IDs`);
  return numbers;
}

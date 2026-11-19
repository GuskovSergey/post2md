import { createHash } from 'node:crypto';
import type { PostMetadata } from '../types/post.js';

const MAX_SLUG_LENGTH = 80;

const CYRILLIC_TO_LATIN_MAP: Readonly<Record<string, string>> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'kh',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'shch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  є: 'ye',
  і: 'i',
  ї: 'yi',
  ґ: 'g',
};

/**
 * Transliterates Cyrillic text and normalizes any string into a clean lowercase ASCII slug.
 */
export function slugifyText(input: string, maxLength: number = MAX_SLUG_LENGTH): string {
  const lower = input.normalize('NFC').toLowerCase();
  let transliterated = '';

  for (const char of lower) {
    const mapped = CYRILLIC_TO_LATIN_MAP[char];
    if (mapped !== undefined) {
      transliterated += mapped;
      continue;
    }
    transliterated += char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  }

  const collapsed = transliterated
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (collapsed.length <= maxLength) {
    return collapsed;
  }

  return collapsed.slice(0, maxLength).replace(/-+$/g, '');
}

/**
 * Generates an ASCII slug from a post title, falling back to the URL path segment
 * or a deterministic short hash if neither yields a valid slug.
 */
export function buildPostSlug(title: string, sourceUrl: string): string {
  const titleSlug = slugifyText(title);
  if (titleSlug.length > 0) {
    return titleSlug;
  }

  try {
    const parsed = new URL(sourceUrl);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSegment = segments.at(-1) ?? '';
    const withoutExtension = lastSegment.replace(/\.[a-z0-9]{1,6}$/i, '');
    const urlSlug = slugifyText(decodeURIComponent(withoutExtension));
    if (urlSlug.length > 0) {
      return urlSlug;
    }
  } catch {
    // Fall through to hash fallback when URL parsing fails.
  }

  const hash = createHash('sha256').update(sourceUrl).digest('hex').slice(0, 8);
  return `post-${hash}`;
}

/**
 * Extracts a filesystem-safe domain identifier (e.g. `example.com`) without leading `www.`.
 */
export function extractDomainName(sourceUrl: string): string {
  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase().replace(/^www\./, '');
    const cleaned = hostname.replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '');
    return cleaned || 'unknown-domain';
  } catch {
    return 'unknown-domain';
  }
}

/**
 * Formats an ISO or arbitrary date string into `YYYY-MM-DD`, falling back to `fetchedAt` or today.
 */
export function formatDateForFilename(publishedAt?: string, fetchedAt?: string): string {
  const candidates = [publishedAt, fetchedAt];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const directMatch = candidate.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    if (directMatch?.[1]) {
      return directMatch[1];
    }
    const parsed = new Date(candidate);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString().slice(0, 10);
    }
  }

  return new Date().toISOString().slice(0, 10);
}

/**
 * Renders a filename stem from a template supporting `{slug}`, `{date}`, `{domain}`, and `{author}`.
 */
export function formatFilenameTemplate(
  template: string,
  metadata: PostMetadata,
  postSlug: string,
): string {
  const dateStr = formatDateForFilename(metadata.publishedAt, metadata.fetchedAt);
  const domainStr = extractDomainName(metadata.sourceUrl).replace(/\./g, '-');
  const authorStr = metadata.author ? slugifyText(metadata.author, 40) || 'unknown' : 'unknown';

  const rendered = template
    .replace(/\{slug\}/gi, postSlug)
    .replace(/\{date\}/gi, dateStr)
    .replace(/\{domain\}/gi, domainStr)
    .replace(/\{author\}/gi, authorStr)
    .replace(/\.md$/i, '');

  const sanitized = rendered
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return sanitized || postSlug;
}

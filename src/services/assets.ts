import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import type { Logger } from 'pino';
import type { FetchOptions } from '../types/post.js';
import { slugifyText } from '../utils/slug.js';
import { fetchBinary } from './fetcher.js';

const MIME_EXTENSION_MAP: Readonly<Record<string, string>> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/bmp': '.bmp',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
};

export interface DownloadImagesOptions {
  markdownFilePath: string;
  postSlug: string;
  fetchOptions: FetchOptions;
  concurrency: number;
  logger: Logger;
  onProgress?: (downloaded: number, total: number) => void;
}

export interface DownloadImagesResult {
  contentHtml: string;
  downloadedCount: number;
}

function resolveImageExtension(contentType: string, url: string): string {
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  const fromMime = MIME_EXTENSION_MAP[mime];
  if (fromMime) {
    return fromMime;
  }

  try {
    const pathname = new URL(url).pathname;
    const ext = path.extname(pathname).toLowerCase();
    if (/^\.[a-z0-9]{2,5}$/.test(ext)) {
      return ext;
    }
  } catch {
    // Ignore invalid URL and use fallback extension.
  }

  return '.img';
}

function buildImageFileName(imageUrl: string, contentType: string, index: number): string {
  const hash = createHash('sha256').update(imageUrl).digest('hex').slice(0, 8);
  const ext = resolveImageExtension(contentType, imageUrl);

  try {
    const pathname = new URL(imageUrl).pathname;
    const base = path.basename(pathname, path.extname(pathname));
    const slug = slugifyText(base, 40);
    if (slug) {
      return `${String(index + 1).padStart(2, '0')}-${slug}-${hash}${ext}`;
    }
  } catch {
    // Fallback to generic indexed filename.
  }

  return `${String(index + 1).padStart(2, '0')}-image-${hash}${ext}`;
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, limit), items.length);

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const currentIndex = cursor;
      cursor += 1;
      const item = items[currentIndex];
      if (item !== undefined) {
        await worker(item, currentIndex);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runNext()));
}

/**
 * Downloads remote images referenced in extracted post HTML into `assets/<postSlug>/`
 * next to the Markdown file and rewrites `img[src]` attributes to relative paths.
 */
export async function downloadPostImages(
  contentHtml: string,
  options: DownloadImagesOptions,
): Promise<DownloadImagesResult> {
  const dom = new JSDOM(`<body>${contentHtml}</body>`);
  const { document } = dom.window;
  const imageElements = Array.from(document.querySelectorAll('img'));

  const remoteUrls: string[] = [];
  const seen = new Set<string>();

  for (const img of imageElements) {
    const src = img.getAttribute('src')?.trim() ?? '';
    if (!src.startsWith('http://') && !src.startsWith('https://')) {
      continue;
    }
    if (!seen.has(src)) {
      seen.add(src);
      remoteUrls.push(src);
    }
  }

  if (remoteUrls.length === 0) {
    options.onProgress?.(0, 0);
    return { contentHtml, downloadedCount: 0 };
  }

  options.onProgress?.(0, remoteUrls.length);

  const markdownDir = path.dirname(options.markdownFilePath);
  const assetsDir = path.join(markdownDir, 'assets', options.postSlug);
  await mkdir(assetsDir, { recursive: true });

  const urlToRelativePath = new Map<string, string>();
  let processedCount = 0;

  await runWithConcurrency(remoteUrls, options.concurrency, async (imageUrl, index) => {
    try {
      const binary = await fetchBinary(imageUrl, options.fetchOptions, options.logger);
      const fileName = buildImageFileName(imageUrl, binary.contentType, index);
      const targetPath = path.join(assetsDir, fileName);
      await writeFile(targetPath, binary.data);

      const relativePath = `./${path.posix.join('assets', options.postSlug, fileName)}`;
      urlToRelativePath.set(imageUrl, relativePath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger.warn({ imageUrl, err: message }, 'Failed to download image, keeping remote URL');
    } finally {
      processedCount += 1;
      options.onProgress?.(processedCount, remoteUrls.length);
    }
  });

  for (const img of imageElements) {
    const src = img.getAttribute('src')?.trim() ?? '';
    const localRelative = urlToRelativePath.get(src);
    if (localRelative) {
      img.setAttribute('src', localRelative);
    }
  }

  return {
    contentHtml: document.body.innerHTML,
    downloadedCount: urlToRelativePath.size,
  };
}

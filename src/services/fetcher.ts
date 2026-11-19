import type { Logger } from 'pino';
import type { FetchOptions, FetchedHtml } from '../types/post.js';

export const DEFAULT_USER_AGENT =
  'post2md/0.1.0 (+https://github.com/post2md; Node.js)';
export const DEFAULT_TIMEOUT_MS = 15_000;
export const DEFAULT_RETRIES = 2;

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);
const BASE_RETRY_DELAY_MS = 400;

export interface FetchedBinary {
  data: Buffer;
  contentType: string;
  finalUrl: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

function isHtmlContentType(contentType: string): boolean {
  if (!contentType) {
    return true;
  }
  const mime = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return mime === 'text/html' || mime === 'application/xhtml+xml' || mime === 'text/plain';
}

async function fetchWithRetry(
  url: string,
  options: FetchOptions,
  acceptHeader: string,
  logger: Logger,
): Promise<Response> {
  const maxAttempts = Math.max(1, options.retries + 1);
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: {
          'User-Agent': options.userAgent,
          Accept: acceptHeader,
          ...options.headers,
        },
      });

      if (response.ok) {
        return response;
      }

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
      }

      logger.warn(
        { url, status: response.status, attempt, maxAttempts },
        'Retryable HTTP response received, retrying',
      );
    } catch (error: unknown) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      lastError = normalized;

      const isHttpFatal = normalized.message.startsWith('HTTP ');
      if (isHttpFatal || attempt === maxAttempts) {
        throw normalized;
      }

      logger.warn(
        { url, attempt, maxAttempts, err: normalized.message },
        'Network error during fetch, retrying',
      );
    }

    const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`Failed to fetch ${url}`);
}

/**
 * Fetches an HTML document from the given URL with retries and timeout handling.
 */
export async function fetchHtml(
  url: string,
  options: FetchOptions,
  logger: Logger,
): Promise<FetchedHtml> {
  logger.debug({ url }, 'Fetching HTML document');
  const response = await fetchWithRetry(
    url,
    options,
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    logger,
  );

  const contentType = response.headers.get('content-type') ?? '';
  if (!isHtmlContentType(contentType)) {
    throw new Error(`Expected HTML response but got "${contentType}" from ${response.url || url}`);
  }

  const html = await response.text();
  return {
    html,
    finalUrl: response.url || url,
    contentType,
  };
}

/**
 * Fetches a binary asset (such as an image) from the given URL.
 */
export async function fetchBinary(
  url: string,
  options: FetchOptions,
  logger: Logger,
): Promise<FetchedBinary> {
  logger.debug({ url }, 'Fetching binary asset');
  const response = await fetchWithRetry(
    url,
    options,
    'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
    logger,
  );

  const arrayBuffer = await response.arrayBuffer();
  return {
    data: Buffer.from(arrayBuffer),
    contentType: response.headers.get('content-type') ?? '',
    finalUrl: response.url || url,
  };
}

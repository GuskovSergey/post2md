/**
 * Validates that the input string is an HTTP or HTTPS URL and returns a normalized URL instance.
 */
export function parseHttpUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`Invalid URL: "${rawUrl}"`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Unsupported URL protocol "${parsed.protocol}" for "${rawUrl}". Only http and https are allowed.`);
  }

  return parsed;
}

/**
 * Resolves a potentially relative URL against a base URL.
 * Returns null if the value is empty, a data/javascript URI, or invalid.
 */
export function resolveAbsoluteUrl(candidate: string | null | undefined, baseUrl: string): string | null {
  if (!candidate) {
    return null;
  }

  const trimmed = candidate.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) {
    return null;
  }

  if (lower.startsWith('data:')) {
    return trimmed;
  }

  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return null;
  }
}

/**
 * Picks the highest-resolution image URL from an HTML srcset attribute.
 */
export function pickBestFromSrcset(srcset: string, baseUrl: string): string | null {
  const entries = srcset
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);

  let bestUrl: string | null = null;
  let bestScore = -1;

  for (const entry of entries) {
    const tokens = entry.split(/\s+/);
    const rawUrl = tokens[0];
    if (!rawUrl) {
      continue;
    }

    const resolved = resolveAbsoluteUrl(rawUrl, baseUrl);
    if (!resolved) {
      continue;
    }

    const descriptor = tokens[1] ?? '';
    let score = 1;
    if (descriptor.endsWith('w')) {
      const width = Number.parseFloat(descriptor.slice(0, -1));
      if (Number.isFinite(width)) {
        score = width;
      }
    } else if (descriptor.endsWith('x')) {
      const density = Number.parseFloat(descriptor.slice(0, -1));
      if (Number.isFinite(density)) {
        score = density * 1000;
      }
    }

    if (score >= bestScore) {
      bestScore = score;
      bestUrl = resolved;
    }
  }

  return bestUrl;
}

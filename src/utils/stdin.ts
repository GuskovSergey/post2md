import type { Readable } from 'node:stream';

/**
 * Splits multiline or whitespace/comma-separated text into raw URL entries,
 * ignoring empty lines and `#` comments.
 */
export function extractUrlLinesFromText(text: string): string[] {
  const entries: string[] = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const tokens = trimmed
      .split(/[\s,]+/)
      .map((token) => token.trim())
      .filter(Boolean);
    entries.push(...tokens);
  }

  return entries;
}

/**
 * Reads all UTF-8 text from a non-TTY readable stream (e.g. piped `process.stdin`).
 */
export async function readStreamText(stream: Readable = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (typeof chunk === 'string') {
      chunks.push(Buffer.from(chunk, 'utf8'));
    } else if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
  }
  return Buffer.concat(chunks).toString('utf8');
}


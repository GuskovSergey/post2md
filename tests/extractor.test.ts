import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPost } from '../src/services/extractor.js';

const FIXTURE_PATH = path.resolve(import.meta.dirname, 'fixtures/sample-post.html');

describe('extractPost', () => {
  it('extracts article metadata and normalizes lazy/relative URLs with Readability', async () => {
    const html = await readFile(FIXTURE_PATH, 'utf8');
    const post = extractPost(html, 'https://example.com/articles/ts-guide');

    expect(post.metadata.title).toBe('Пост про TypeScript');
    expect(post.metadata.author).toBe('Иван Петров');
    expect(post.metadata.publishedAt).toBe('2026-10-01T10:00:00Z');
    expect(post.metadata.sourceUrl).toBe('https://example.com/articles/ts-guide');

    expect(post.contentHtml).toContain('https://example.com/docs/intro');
    expect(post.contentHtml).toContain('https://example.com/images/arch.png');
    expect(post.contentHtml).toContain('https://example.com/images/large.jpg');
    expect(post.contentHtml).not.toContain('Реклама и подписка');
  });

  it('supports custom CSS selector extraction', async () => {
    const html = await readFile(FIXTURE_PATH, 'utf8');
    const post = extractPost(html, 'https://example.com/articles/ts-guide', 'article.post-body');

    expect(post.contentHtml).toContain('строгую');
    expect(post.contentHtml).not.toContain('Главная');
  });

  it('throws clear error when CSS selector matches nothing', async () => {
    const html = await readFile(FIXTURE_PATH, 'utf8');
    expect(() =>
      extractPost(html, 'https://example.com/articles/ts-guide', '.does-not-exist'),
    ).toThrow(/No elements matched CSS selector/);
  });
});

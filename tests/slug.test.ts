import { describe, expect, it } from 'vitest';
import {
  buildPostSlug,
  extractDomainName,
  formatDateForFilename,
  formatFilenameTemplate,
  slugifyText,
} from '../src/utils/slug.js';

describe('slug utilities', () => {
  it('transliterates Cyrillic titles to ASCII slugs', () => {
    expect(slugifyText('Пост про JS и Щуку!')).toBe('post-pro-js-i-shchuku');
    expect(slugifyText('Пишем свой минимальный RxJS')).toBe('pishem-svoy-minimalnyy-rxjs');
  });

  it('collapses punctuation and trims hyphens within maxLength', () => {
    expect(slugifyText('  --- Hello, World!! 2026 ---  ')).toBe('hello-world-2026');
    const longSlug = slugifyText('a'.repeat(100), 20);
    expect(longSlug.length).toBeLessThanOrEqual(20);
  });

  it('falls back to URL path segment when title yields empty slug', () => {
    expect(buildPostSlug('!!!', 'https://example.com/blog/my-awesome-post.html')).toBe(
      'my-awesome-post',
    );
  });

  it('falls back to deterministic hash when both title and URL segment are empty', () => {
    const slugA = buildPostSlug('***', 'https://example.com/');
    const slugB = buildPostSlug('***', 'https://example.com/');
    expect(slugA).toMatch(/^post-[a-f0-9]{8}$/);
    expect(slugA).toBe(slugB);
  });

  it('extracts normalized domain name without www prefix', () => {
    expect(extractDomainName('https://www.Habr.com/ru/articles/123/')).toBe('habr.com');
    expect(extractDomainName('https://sub.example.co.uk/post')).toBe('sub.example.co.uk');
  });

  it('formats filename templates with {date}, {domain}, {author}, and {slug}', () => {
    expect(formatDateForFilename('2026-05-14T10:20:30Z')).toBe('2026-05-14');

    const rendered = formatFilenameTemplate(
      '{date}-{domain}-{author}-{slug}',
      {
        title: 'Hello World',
        sourceUrl: 'https://www.example.com/posts/hello',
        author: 'Иван Петров',
        publishedAt: '2026-05-14T08:00:00.000Z',
        fetchedAt: '2026-11-18T12:00:00.000Z',
      },
      'hello-world',
    );

    expect(rendered).toBe('2026-05-14-example-com-ivan-petrov-hello-world');
  });
});

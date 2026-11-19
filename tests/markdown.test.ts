import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractPost } from '../src/services/extractor.js';
import { convertPostToMarkdown } from '../src/services/markdown.js';

const FIXTURE_PATH = path.resolve(import.meta.dirname, 'fixtures/sample-post.html');

describe('convertPostToMarkdown', () => {
  it('produces YAML frontmatter, GFM tables, and fenced code blocks with language', async () => {
    const html = await readFile(FIXTURE_PATH, 'utf8');
    const post = extractPost(html, 'https://example.com/articles/ts-guide', 'article.post-body');
    const md = convertPostToMarkdown(post, { includeFrontmatter: true });

    expect(md).toMatch(/^---\n/);
    expect(md).toContain('title: Пост про TypeScript');
    expect(md).toContain('source_url: https://example.com/articles/ts-guide');
    expect(md).toContain('author: Иван Петров');
    expect(md).toContain('published_at: 2026-10-01T10:00:00Z');
    expect(md).toContain('# Пост про TypeScript');
    expect(md).toContain('```typescript\nconst greet = (name: string): string => `Hello, ${name}`;\n```');
    expect(md).toContain('| Флаг | Описание |');
    expect(md).toContain('![Архитектура](https://example.com/images/arch.png)');
  });

  it('omits YAML frontmatter when includeFrontmatter is false', async () => {
    const html = await readFile(FIXTURE_PATH, 'utf8');
    const post = extractPost(html, 'https://example.com/articles/ts-guide', 'article.post-body');
    const md = convertPostToMarkdown(post, { includeFrontmatter: false });

    expect(md.startsWith('# Пост про TypeScript')).toBe(true);
    expect(md).not.toContain('source_url:');
  });

  it('reads data-language attribute without falling back to hljs class name', () => {
    const md = convertPostToMarkdown(
      {
        metadata: {
          title: 'Code Sample',
          sourceUrl: 'https://example.com/code',
          fetchedAt: '2026-11-17T12:00:00.000Z',
        },
        contentHtml: '<pre class="hljs"><code data-language="python">print(42)</code></pre>',
      },
      { includeFrontmatter: false },
    );

    expect(md).toContain('```python\nprint(42)\n```');
  });

  it('converts bare <pre class="brush:java;"> blocks without inner <code> element', () => {
    const md = convertPostToMarkdown(
      {
        metadata: {
          title: 'Java Sample',
          sourceUrl: 'https://example.com/java',
          fetchedAt: '2026-11-17T12:00:00.000Z',
        },
        contentHtml: '<pre class="brush:java;">\r\npublic interface Collection&lt;E&gt; {}\r\n</pre>',
      },
      { includeFrontmatter: false },
    );

    expect(md).toContain('```java\npublic interface Collection<E> {}\n```');
  });
});

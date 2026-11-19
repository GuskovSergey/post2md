import { gfm } from '@joplin/turndown-plugin-gfm';
import TurndownService from 'turndown';
import { stringify as stringifyYaml } from 'yaml';
import type { ExtractedPost, PostMetadata } from '../types/post.js';

export interface MarkdownConversionOptions {
  includeFrontmatter: boolean;
}

const CODE_LANGUAGE_REGEX =
  /(?:language-|lang-|highlight-source-|brush:\s*)([a-z0-9_+-]+)/i;

function detectCodeLanguage(codeNode: Element | null, preNode: Element): string {
  const classCandidates = [
    codeNode?.getAttribute('class') ?? '',
    preNode.getAttribute('class') ?? '',
  ];

  for (const candidate of classCandidates) {
    const match = candidate.match(CODE_LANGUAGE_REGEX);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  const dataCandidates = [
    codeNode?.getAttribute('data-language') ?? '',
    codeNode?.getAttribute('data-lang') ?? '',
    preNode.getAttribute('data-language') ?? '',
    preNode.getAttribute('data-lang') ?? '',
  ];

  for (const candidate of dataCandidates) {
    const trimmed = candidate.trim();
    if (trimmed && /^[a-z0-9_+-]+$/i.test(trimmed)) {
      return trimmed.toLowerCase();
    }
  }

  return '';
}

function createTurndownService(): TurndownService {
  const turndown = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    fence: '```',
    emDelimiter: '*',
    strongDelimiter: '**',
    linkStyle: 'inlined',
  });

  turndown.use(gfm);
  turndown.remove(['script', 'style', 'noscript', 'iframe']);

  turndown.addRule('fencedCodeBlockWithLanguage', {
    filter(node): boolean {
      return node.nodeName === 'PRE';
    },
    replacement(_content, node, options): string {
      const firstChild = node.firstElementChild;
      const codeElement =
        firstChild && firstChild.nodeName === 'CODE' ? firstChild : null;
      const targetNode = codeElement ?? node;

      const language = detectCodeLanguage(codeElement, node);
      const rawCode = (targetNode.textContent ?? '')
        .replace(/\r\n/g, '\n')
        .replace(/^\n+|\n+$/g, '');
      const fence = options.fence ?? '```';
      return `\n\n${fence}${language}\n${rawCode}\n${fence}\n\n`;
    },
  });

  return turndown;
}

function formatFrontmatter(metadata: PostMetadata): string {
  const payload: Record<string, string> = {
    title: metadata.title,
    source_url: metadata.sourceUrl,
  };

  if (metadata.author) {
    payload['author'] = metadata.author;
  }
  if (metadata.publishedAt) {
    payload['published_at'] = metadata.publishedAt;
  }
  payload['fetched_at'] = metadata.fetchedAt;

  const yamlBody = stringifyYaml(payload).trimEnd();
  return `---\n${yamlBody}\n---\n\n`;
}

function normalizeMarkdownWhitespace(markdown: string): string {
  return markdown.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Converts an extracted post into GFM Markdown with optional YAML frontmatter.
 */
export function convertPostToMarkdown(
  post: ExtractedPost,
  options: MarkdownConversionOptions,
): string {
  const turndown = createTurndownService();
  const rawBody = turndown.turndown(post.contentHtml);
  const cleanBody = normalizeMarkdownWhitespace(rawBody);

  const hasLeadingH1 = /^#\s+/.test(cleanBody);
  const bodyWithHeading = hasLeadingH1
    ? cleanBody
    : `# ${post.metadata.title}\n\n${cleanBody}`;

  const frontmatter = options.includeFrontmatter
    ? formatFrontmatter(post.metadata)
    : '';

  return `${frontmatter}${bodyWithHeading}\n`;
}

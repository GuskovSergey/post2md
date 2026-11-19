import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import type { ExtractedPost, PostMetadata } from '../types/post.js';
import { pickBestFromSrcset, resolveAbsoluteUrl } from '../utils/url.js';

const LAZY_IMAGE_ATTRIBUTES = ['data-src', 'data-lazy-src', 'data-original', 'data-url'] as const;

function getMetaContent(document: Document, selectors: readonly string[]): string | undefined {
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const content = element?.getAttribute('content')?.trim() || element?.getAttribute('datetime')?.trim();
    if (content) {
      return content;
    }
  }
  return undefined;
}

function normalizeImageAttributes(document: Document, baseUrl: string): void {
  const images = document.querySelectorAll('img');
  for (const img of images) {
    let resolvedSrc: string | null = null;

    for (const attr of LAZY_IMAGE_ATTRIBUTES) {
      const candidate = img.getAttribute(attr);
      resolvedSrc = resolveAbsoluteUrl(candidate, baseUrl);
      if (resolvedSrc) {
        break;
      }
    }

    if (!resolvedSrc) {
      const srcset = img.getAttribute('srcset') ?? img.getAttribute('data-srcset');
      if (srcset) {
        resolvedSrc = pickBestFromSrcset(srcset, baseUrl);
      }
    }

    if (!resolvedSrc) {
      resolvedSrc = resolveAbsoluteUrl(img.getAttribute('src'), baseUrl);
    }

    if (resolvedSrc) {
      img.setAttribute('src', resolvedSrc);
    }
    img.removeAttribute('srcset');
  }
}

function normalizeAnchorUrls(document: Document, baseUrl: string): void {
  const anchors = document.querySelectorAll('a[href]');
  for (const anchor of anchors) {
    const resolved = resolveAbsoluteUrl(anchor.getAttribute('href'), baseUrl);
    if (resolved) {
      anchor.setAttribute('href', resolved);
    }
  }
}

function resolveDocumentTitle(document: Document, readabilityTitle?: string | null): string {
  const candidates = [
    readabilityTitle?.trim(),
    getMetaContent(document, ['meta[property="og:title"]', 'meta[name="twitter:title"]']),
    document.querySelector('h1')?.textContent?.trim(),
    document.title.trim(),
  ];

  for (const candidate of candidates) {
    if (candidate) {
      return candidate;
    }
  }

  return 'Untitled Post';
}

function extractBySelector(document: Document, selector: string): string {
  const matched = document.querySelectorAll(selector);
  if (matched.length === 0) {
    throw new Error(`No elements matched CSS selector "${selector}"`);
  }

  const wrapper = document.createElement('div');
  for (const node of matched) {
    wrapper.appendChild(node.cloneNode(true));
  }

  const html = wrapper.innerHTML.trim();
  if (!html) {
    throw new Error(`Matched elements for selector "${selector}" are empty`);
  }
  return html;
}

/**
 * Extracts main post content and metadata from raw HTML using either a custom CSS selector
 * or Mozilla Readability.
 */
export function extractPost(
  html: string,
  sourceUrl: string,
  selector?: string,
): ExtractedPost {
  const dom = new JSDOM(html, { url: sourceUrl });
  const { document } = dom.window;

  const metaAuthor = getMetaContent(document, [
    'meta[name="author"]',
    'meta[property="article:author"]',
    'meta[name="twitter:creator"]',
  ]);
  const metaPublishedAt = getMetaContent(document, [
    'meta[property="article:published_time"]',
    'meta[name="publish-date"]',
    'meta[name="date"]',
    'time[datetime]',
  ]);

  normalizeImageAttributes(document, sourceUrl);
  normalizeAnchorUrls(document, sourceUrl);

  const fetchedAt = new Date().toISOString();

  if (selector) {
    const contentHtml = extractBySelector(document, selector);
    const title = resolveDocumentTitle(document);
    const metadata: PostMetadata = {
      title,
      sourceUrl,
      fetchedAt,
      ...(metaAuthor ? { author: metaAuthor } : {}),
      ...(metaPublishedAt ? { publishedAt: metaPublishedAt } : {}),
    };
    return { metadata, contentHtml };
  }

  const reader = new Readability(document);
  const parsed = reader.parse();
  const parsedContent = parsed?.content?.trim();
  if (!parsed || !parsedContent) {
    throw new Error(
      `Readability could not extract article content from "${sourceUrl}". Try specifying --selector <css>.`,
    );
  }

  const title = resolveDocumentTitle(document, parsed.title);
  const author = parsed.byline?.trim() || metaAuthor;
  const publishedAt = parsed.publishedTime?.trim() || metaPublishedAt;
  const excerpt = parsed.excerpt?.trim();

  const metadata: PostMetadata = {
    title,
    sourceUrl,
    fetchedAt,
    ...(author ? { author } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };

  return {
    metadata,
    contentHtml: parsedContent,
    ...(excerpt ? { excerpt } : {}),
  };
}

import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';
import type {
  BatchSummary,
  CliOptions,
  FetchOptions,
  FileConflictDecision,
  PipelineRuntimeHooks,
  PostMetadata,
  ProcessResult,
} from '../types/post.js';
import { readClipboardText, writeClipboardText } from '../utils/clipboard.js';
import {
  buildPostSlug,
  extractDomainName,
  formatFilenameTemplate,
} from '../utils/slug.js';
import { extractUrlLinesFromText } from '../utils/stdin.js';
import { parseHttpUrl } from '../utils/url.js';
import { downloadPostImages } from './assets.js';
import { extractPost } from './extractor.js';
import { DEFAULT_RETRIES, fetchHtml } from './fetcher.js';
import { convertPostToMarkdown } from './markdown.js';

export interface CollectUrlsExtraSources {
  fromClipboard?: boolean;
  readClipboard?: () => Promise<string>;
  stdinText?: string;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function isDirectoryPath(targetPath: string): Promise<boolean> {
  if (targetPath.endsWith('/') || targetPath.endsWith(path.sep)) {
    return true;
  }
  try {
    const info = await stat(targetPath);
    return info.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Collects, trims, deduplicates, and validates URLs from CLI arguments, an optional input file,
 * clipboard (`--from-clipboard`), and piped `stdin`.
 */
export async function collectInputUrls(
  positionalUrls: readonly string[],
  inputFile?: string,
  extra?: CollectUrlsExtraSources,
): Promise<string[]> {
  const rawEntries: string[] = [...positionalUrls];

  if (inputFile) {
    const fileContent = await readFile(inputFile, 'utf8');
    rawEntries.push(...extractUrlLinesFromText(fileContent));
  }

  if (extra?.fromClipboard) {
    const readClip = extra.readClipboard ?? readClipboardText;
    const clipContent = await readClip();
    rawEntries.push(...extractUrlLinesFromText(clipContent));
  }

  if (extra?.stdinText) {
    rawEntries.push(...extractUrlLinesFromText(extra.stdinText));
  }

  const seen = new Set<string>();
  const validated: string[] = [];

  for (const entry of rawEntries) {
    const parsed = parseHttpUrl(entry);
    const normalized = parsed.toString();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      validated.push(normalized);
    }
  }

  if (validated.length === 0) {
    throw new Error(
      'No URLs provided. Pass URLs as arguments, pipe via stdin, or use --input <file> / --from-clipboard.',
    );
  }

  return validated;
}

/**
 * Validates cross-option constraints before processing starts.
 */
export function validateCliOptionConflicts(options: CliOptions, urlCount: number): void {
  if (options.stdout && urlCount > 1) {
    throw new Error('--stdout can only be used with a single URL.');
  }
  if (options.stdout && options.output) {
    throw new Error('--stdout cannot be combined with --output.');
  }
  if (options.stdout && options.downloadImages) {
    throw new Error('--download-images cannot be combined with --stdout.');
  }
  if (options.copy && urlCount > 1) {
    throw new Error('--copy can only be used with a single URL.');
  }
}

function reserveUniqueInMemoryPath(basePath: string, reservedPaths: Set<string>): string {
  if (!reservedPaths.has(basePath)) {
    reservedPaths.add(basePath);
    return basePath;
  }

  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);
  let suffix = 2;

  while (true) {
    const candidate = path.join(dir, `${stem}-${suffix}${ext}`);
    if (!reservedPaths.has(candidate)) {
      reservedPaths.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

async function reserveNextNonExistingPath(
  basePath: string,
  reservedPaths: Set<string>,
): Promise<string> {
  const dir = path.dirname(basePath);
  const ext = path.extname(basePath);
  const stem = path.basename(basePath, ext);
  let suffix = 2;

  while (true) {
    const candidate = path.join(dir, `${stem}-${suffix}${ext}`);
    if (!reservedPaths.has(candidate) && !(await pathExists(candidate))) {
      reservedPaths.add(candidate);
      return candidate;
    }
    suffix += 1;
  }
}

async function resolveTargetFilePath(
  postSlug: string,
  metadata: PostMetadata,
  options: CliOptions,
  totalUrls: number,
  reservedPaths: Set<string>,
): Promise<string> {
  const template = options.filenameTemplate?.trim() || '{slug}';
  const renderedStem = formatFilenameTemplate(template, metadata, postSlug);
  const domainSubdir = options.groupByDomain ? extractDomainName(metadata.sourceUrl) : null;

  let basePath: string;

  if (!options.output) {
    const baseDir = domainSubdir
      ? path.resolve(process.cwd(), domainSubdir)
      : process.cwd();
    basePath = path.resolve(baseDir, `${renderedStem}.md`);
  } else if (
    totalUrls > 1 ||
    Boolean(options.groupByDomain) ||
    Boolean(options.filenameTemplate) ||
    (await isDirectoryPath(options.output))
  ) {
    const baseDir = domainSubdir
      ? path.resolve(options.output, domainSubdir)
      : path.resolve(options.output);
    basePath = path.resolve(baseDir, `${renderedStem}.md`);
  } else {
    basePath = path.resolve(options.output);
    return basePath;
  }

  return reserveUniqueInMemoryPath(basePath, reservedPaths);
}

interface ConflictCoordinator {
  decide(filePath: string, url: string, isBatch: boolean): Promise<'overwrite' | 'rename' | 'skip'>;
}

function createConflictCoordinator(
  resolver?: (filePath: string, url: string, isBatch: boolean) => Promise<FileConflictDecision>,
): ConflictCoordinator {
  let stickyDecision: 'overwrite' | 'skip' | null = null;
  let queue: Promise<void> = Promise.resolve();

  return {
    async decide(
      filePath: string,
      url: string,
      isBatch: boolean,
    ): Promise<'overwrite' | 'rename' | 'skip'> {
      if (!resolver) {
        return 'skip';
      }

      let result: 'overwrite' | 'rename' | 'skip' = 'skip';

      const runSerialized = async (): Promise<void> => {
        if (stickyDecision) {
          result = stickyDecision;
          return;
        }
        const decision = await resolver(filePath, url, isBatch);
        if (decision === 'overwrite_all') {
          stickyDecision = 'overwrite';
          result = 'overwrite';
        } else if (decision === 'skip_all') {
          stickyDecision = 'skip';
          result = 'skip';
        } else {
          result = decision;
        }
      };

      const next = queue.then(runSerialized, runSerialized);
      queue = next;
      await next;
      return result;
    },
  };
}

interface ProcessSingleContext {
  url: string;
  index: number;
  totalUrls: number;
  options: CliOptions;
  reservedPaths: Set<string>;
  logger: Logger;
  writeStdout: (content: string) => void;
  hooks?: PipelineRuntimeHooks;
  conflictCoordinator: ConflictCoordinator;
}

async function processSingleUrl(ctx: ProcessSingleContext): Promise<ProcessResult> {
  const {
    url,
    index,
    totalUrls,
    options,
    reservedPaths,
    logger,
    writeStdout,
    hooks,
    conflictCoordinator,
  } = ctx;

  const fetchOptions: FetchOptions = {
    timeoutMs: options.timeout,
    userAgent: options.userAgent,
    headers: options.headers,
    retries: DEFAULT_RETRIES,
  };

  try {
    hooks?.onUrlStage?.({
      url,
      index,
      total: totalUrls,
      stage: 'fetch',
    });

    const fetched = await fetchHtml(url, fetchOptions, logger);

    hooks?.onUrlStage?.({
      url,
      index,
      total: totalUrls,
      stage: 'extract',
    });

    const extracted = extractPost(fetched.html, fetched.finalUrl, options.selector);
    const postSlug = buildPostSlug(extracted.metadata.title, fetched.finalUrl);
    const writeClip = hooks?.writeClipboard ?? writeClipboardText;

    if (options.stdout) {
      hooks?.onUrlStage?.({
        url,
        index,
        total: totalUrls,
        stage: 'save',
        title: extracted.metadata.title,
      });

      const markdown = convertPostToMarkdown(extracted, {
        includeFrontmatter: options.frontmatter,
      });
      writeStdout(markdown);

      let copiedToClipboard = false;
      if (options.copy) {
        await writeClip(markdown);
        copiedToClipboard = true;
      }

      return {
        url,
        status: 'success',
        title: extracted.metadata.title,
        downloadedImages: 0,
        ...(copiedToClipboard ? { copiedToClipboard: true } : {}),
      };
    }

    let targetPath = await resolveTargetFilePath(
      postSlug,
      extracted.metadata,
      options,
      totalUrls,
      reservedPaths,
    );

    if (!options.force && (await pathExists(targetPath))) {
      const action = await conflictCoordinator.decide(targetPath, url, totalUrls > 1);
      if (action === 'skip') {
        logger.warn(
          { url, outputPath: targetPath },
          'Target file already exists (use --force to overwrite), skipping',
        );
        return {
          url,
          status: 'skipped',
          title: extracted.metadata.title,
          outputPath: targetPath,
          downloadedImages: 0,
        };
      }
      if (action === 'rename') {
        targetPath = await reserveNextNonExistingPath(targetPath, reservedPaths);
      }
    }

    let downloadedImages = 0;
    let postForMarkdown = extracted;
    const targetFileStem = path.basename(targetPath, path.extname(targetPath)) || postSlug;

    if (options.downloadImages) {
      const imageResult = await downloadPostImages(extracted.contentHtml, {
        markdownFilePath: targetPath,
        postSlug: targetFileStem,
        fetchOptions,
        concurrency: options.concurrency,
        logger,
        onProgress: (downloaded, total) => {
          hooks?.onUrlStage?.({
            url,
            index,
            total: totalUrls,
            stage: 'images',
            title: extracted.metadata.title,
            imagesDownloaded: downloaded,
            imagesTotal: total,
          });
        },
      });
      downloadedImages = imageResult.downloadedCount;
      postForMarkdown = {
        ...extracted,
        contentHtml: imageResult.contentHtml,
      };
    }

    hooks?.onUrlStage?.({
      url,
      index,
      total: totalUrls,
      stage: 'save',
      title: extracted.metadata.title,
    });

    const markdown = convertPostToMarkdown(postForMarkdown, {
      includeFrontmatter: options.frontmatter,
    });

    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, markdown, 'utf8');

    let copiedToClipboard = false;
    if (options.copy) {
      await writeClip(markdown);
      copiedToClipboard = true;
    }

    logger.info(
      { url, outputPath: targetPath, downloadedImages, copiedToClipboard },
      'Saved post as Markdown',
    );

    return {
      url,
      status: 'success',
      title: extracted.metadata.title,
      outputPath: targetPath,
      downloadedImages,
      ...(copiedToClipboard ? { copiedToClipboard: true } : {}),
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error({ url, err: errorMessage }, 'Failed to process URL');
    return {
      url,
      status: 'error',
      errorMessage,
      downloadedImages: 0,
    };
  }
}

/**
 * Runs the full fetch -> extract -> assets -> markdown pipeline for one or many URLs.
 */
export async function runPipeline(
  options: CliOptions,
  logger: Logger,
  writeStdout: (content: string) => void = (content) => {
    process.stdout.write(content);
  },
  hooks?: PipelineRuntimeHooks,
): Promise<BatchSummary> {
  const startedAt = Date.now();
  const urls = await collectInputUrls(options.urls, options.input, {
    ...(options.fromClipboard !== undefined ? { fromClipboard: options.fromClipboard } : {}),
    ...(hooks?.readClipboard ? { readClipboard: hooks.readClipboard } : {}),
    ...(hooks?.stdinText !== undefined ? { stdinText: hooks.stdinText } : {}),
  });
  validateCliOptionConflicts(options, urls.length);

  hooks?.onBatchStart?.(urls.length);

  const reservedPaths = new Set<string>();
  const results: ProcessResult[] = new Array<ProcessResult>(urls.length);
  const conflictCoordinator = createConflictCoordinator(hooks?.resolveConflict);
  let cursor = 0;
  let completedCount = 0;

  const workerCount = Math.min(options.concurrency, urls.length);

  async function worker(): Promise<void> {
    while (cursor < urls.length) {
      const index = cursor;
      cursor += 1;
      const url = urls[index];
      if (!url) {
        continue;
      }
      const result = await processSingleUrl({
        url,
        index,
        totalUrls: urls.length,
        options,
        reservedPaths,
        logger,
        writeStdout,
        ...(hooks ? { hooks } : {}),
        conflictCoordinator,
      });
      results[index] = result;
      completedCount += 1;
      hooks?.onUrlComplete?.(result, completedCount, urls.length);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (const result of results) {
    if (result.status === 'success') {
      succeeded += 1;
    } else if (result.status === 'skipped') {
      skipped += 1;
    } else {
      failed += 1;
    }
  }

  const elapsedMs = Date.now() - startedAt;

  if (!options.stdout && urls.length > 1) {
    logger.info(
      { total: urls.length, succeeded, skipped, failed, elapsedMs },
      'Batch processing completed',
    );
  }

  const summary: BatchSummary = {
    total: urls.length,
    succeeded,
    skipped,
    failed,
    elapsedMs,
    results,
  };

  hooks?.onBatchComplete?.(summary);

  return summary;
}

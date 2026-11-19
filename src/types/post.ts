import { z } from 'zod';

/**
 * Metadata extracted from a web post and persisted in YAML frontmatter.
 */
export interface PostMetadata {
  title: string;
  sourceUrl: string;
  author?: string;
  publishedAt?: string;
  fetchedAt: string;
}

/**
 * Result of extracting the main article content from an HTML document.
 */
export interface ExtractedPost {
  metadata: PostMetadata;
  contentHtml: string;
  excerpt?: string;
}

/**
 * Result of fetching an HTML page over HTTP.
 */
export interface FetchedHtml {
  html: string;
  finalUrl: string;
  contentType: string;
}

/**
 * Network configuration for HTTP requests.
 */
export interface FetchOptions {
  timeoutMs: number;
  userAgent: string;
  headers: Record<string, string>;
  retries: number;
}

/**
 * Validated CLI configuration resolved from flags and arguments.
 */
export interface CliOptions {
  urls: string[];
  input?: string;
  output?: string;
  selector?: string;
  stdout: boolean;
  frontmatter: boolean;
  downloadImages: boolean;
  force: boolean;
  headers: Record<string, string>;
  userAgent: string;
  timeout: number;
  concurrency: number;
  verbose: boolean;
  quiet: boolean;
  filenameTemplate?: string;
  groupByDomain?: boolean;
  fromClipboard?: boolean;
  copy?: boolean;
  interactive?: boolean;
  json?: boolean;
}

/**
 * Status of processing a single URL.
 */
export type ProcessStatus = 'success' | 'skipped' | 'error';

/**
 * Outcome summary for a single URL processed by the pipeline.
 */
export interface ProcessResult {
  url: string;
  status: ProcessStatus;
  title?: string;
  outputPath?: string;
  errorMessage?: string;
  downloadedImages: number;
  copiedToClipboard?: boolean;
}

/**
 * Summary counts for a batch run.
 */
export interface BatchSummary {
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
  elapsedMs?: number;
  results: ProcessResult[];
}

/**
 * User decision when an output file already exists in interactive mode.
 */
export type FileConflictDecision =
  | 'overwrite'
  | 'rename'
  | 'skip'
  | 'overwrite_all'
  | 'skip_all';

/**
 * Callback invoked when a target file already exists and `--force` is not set.
 */
export type ConflictResolver = (
  filePath: string,
  url: string,
  isBatch: boolean,
) => Promise<FileConflictDecision>;

/**
 * Stage of processing a single URL for progress reporting.
 */
export type PipelineStage = 'fetch' | 'extract' | 'images' | 'save';

/**
 * Payload emitted on each pipeline stage update.
 */
export interface UrlStageUpdate {
  url: string;
  index: number;
  total: number;
  stage: PipelineStage;
  title?: string;
  imagesDownloaded?: number;
  imagesTotal?: number;
}

/**
 * Optional hooks for visual progress and interactive conflict resolution.
 */
export interface PipelineRuntimeHooks {
  onBatchStart?: (totalUrls: number) => void;
  onUrlStage?: (update: UrlStageUpdate) => void;
  onUrlComplete?: (result: ProcessResult, completedCount: number, total: number) => void;
  onBatchComplete?: (summary: BatchSummary) => void;
  resolveConflict?: ConflictResolver;
  readClipboard?: () => Promise<string>;
  writeClipboard?: (text: string) => Promise<void>;
  stdinText?: string;
}

export const HEADER_ENTRY_SCHEMA = z
  .string()
  .refine((value) => {
    const colonIndex = value.indexOf(':');
    return colonIndex > 0 && value.slice(0, colonIndex).trim().length > 0;
  }, 'Header must be in "Name: Value" format');

export const CLI_NUMERIC_OPTIONS_SCHEMA = z.object({
  timeout: z.number().int().positive().max(300_000),
  concurrency: z.number().int().min(1).max(20),
});

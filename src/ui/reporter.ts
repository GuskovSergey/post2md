import path from 'node:path';
import {
  cancel,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  type Option,
  type SpinnerResult,
} from '@clack/prompts';
import pc from 'picocolors';
import type {
  BatchSummary,
  FileConflictDecision,
  PipelineRuntimeHooks,
  ProcessResult,
  UrlStageUpdate,
} from '../types/post.js';

export interface TuiReporterOptions {
  output?: NodeJS.WriteStream;
  showIntro?: boolean;
  interactiveConflicts?: boolean;
}

export interface TuiReporter {
  hooks: PipelineRuntimeHooks;
  reportFatalError: (message: string) => void;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, Math.max(1, maxLength - 1))}…`;
}

function formatShortUrl(rawUrl: string, maxLength: number = 48): string {
  try {
    const parsed = new URL(rawUrl);
    const cleanHost = parsed.hostname.replace(/^www\./, '');
    const pathPart = parsed.pathname === '/' ? '' : parsed.pathname;
    return truncateText(`${cleanHost}${pathPart}`, maxLength);
  } catch {
    return truncateText(rawUrl, maxLength);
  }
}

function formatRelativePath(targetPath: string): string {
  const rel = path.relative(process.cwd(), targetPath);
  if (!rel || rel.startsWith('..')) {
    return targetPath;
  }
  return `./${rel.split(path.sep).join('/')}`;
}

function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0) {
    return '0ms';
  }
  if (ms < 1000) {
    return `${ms}ms`;
  }
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderProgressBar(completed: number, total: number, width: number = 14): string {
  const safeTotal = Math.max(1, total);
  const ratio = Math.min(1, Math.max(0, completed / safeTotal));
  const filled = Math.round(ratio * width);
  const empty = Math.max(0, width - filled);
  const bar = `${pc.cyan('━'.repeat(filled))}${pc.dim('─'.repeat(empty))}`;
  const percent = `${Math.round(ratio * 100)}%`.padStart(4, ' ');
  return `${pc.bold(`[${completed}/${total}]`)} ${bar} ${pc.dim(percent)}`;
}

function formatStageLabel(update: UrlStageUpdate, completedCount: number): string {
  const prefix =
    update.total > 1
      ? `${renderProgressBar(completedCount, update.total)}  `
      : '';
  const shortUrl = formatShortUrl(update.url, 42);
  const labelTarget = update.title
    ? `"${truncateText(update.title, 38)}"`
    : shortUrl;

  switch (update.stage) {
    case 'fetch':
      return `${prefix}${pc.cyan('Fetching')} ${shortUrl}...`;
    case 'extract':
      return `${prefix}${pc.cyan('Extracting')} content from ${shortUrl}...`;
    case 'images': {
      const done = update.imagesDownloaded ?? 0;
      const total = update.imagesTotal ?? 0;
      const counter = total > 0 ? ` [${done}/${total}]` : '';
      return `${prefix}${pc.magenta(`Downloading images${counter}`)} for ${labelTarget}...`;
    }
    case 'save':
      return `${prefix}${pc.green('Saving Markdown')} for ${labelTarget}...`;
  }
}

function formatSummaryLine(item: ProcessResult): string {
  const label = item.title
    ? truncateText(item.title, 36)
    : formatShortUrl(item.url, 36);

  if (item.status === 'success') {
    const dest = item.outputPath
      ? pc.cyan(formatRelativePath(item.outputPath))
      : pc.cyan('stdout');
    const extras: string[] = [];
    if (item.downloadedImages > 0) {
      extras.push(`${item.downloadedImages} img`);
    }
    if (item.copiedToClipboard) {
      extras.push('copied');
    }
    const extraSuffix = extras.length > 0 ? pc.dim(` (${extras.join(', ')})`) : '';
    return `${pc.green('✓')} ${pc.bold(label)} ${pc.dim('→')} ${dest}${extraSuffix}`;
  }

  if (item.status === 'skipped') {
    const dest = item.outputPath ? formatRelativePath(item.outputPath) : item.url;
    return `${pc.yellow('⚠')} ${label} ${pc.dim(`(skipped: ${dest} exists)`)}`;
  }

  return `${pc.red('✗')} ${formatShortUrl(item.url, 36)} ${pc.red(`— ${item.errorMessage ?? 'Error'}`)}`;
}

/**
 * Creates an interactive stderr TUI reporter using `@clack/prompts` and `picocolors`.
 */
export function createTuiReporter(options: TuiReporterOptions = {}): TuiReporter {
  const output = options.output ?? process.stderr;
  const showIntro = options.showIntro ?? true;
  const interactiveConflicts = options.interactiveConflicts ?? true;

  let activeSpinner: SpinnerResult | null = null;
  let spinnerRunning = false;
  let completedUrls = 0;

  function ensureSpinnerStarted(initialMsg: string): void {
    if (!activeSpinner) {
      activeSpinner = spinner({ output });
    }
    if (!spinnerRunning) {
      activeSpinner.start(initialMsg);
      spinnerRunning = true;
    } else {
      activeSpinner.message(initialMsg);
    }
  }

  function clearActiveSpinner(): void {
    if (activeSpinner && spinnerRunning) {
      activeSpinner.clear();
      spinnerRunning = false;
    }
  }

  const hooks: PipelineRuntimeHooks = {
    onBatchStart(totalUrls: number): void {
      completedUrls = 0;
      if (showIntro) {
        intro(
          `${pc.bgCyan(pc.black(pc.bold(' post2md ')))} ${pc.dim('Web Post → GFM Markdown')}`,
          { output },
        );
      }
      const startMsg =
        totalUrls > 1
          ? `${renderProgressBar(0, totalUrls)}  Preparing ${totalUrls} URLs...`
          : 'Fetching post...';
      ensureSpinnerStarted(startMsg);
    },

    onUrlStage(update: UrlStageUpdate): void {
      const msg = formatStageLabel(update, completedUrls);
      ensureSpinnerStarted(msg);
    },

    async resolveConflict(
      filePath: string,
      url: string,
      isBatch: boolean,
    ): Promise<FileConflictDecision> {
      if (!interactiveConflicts) {
        return 'skip';
      }

      clearActiveSpinner();

      const relPath = formatRelativePath(filePath);
      const selectOptions: Option<FileConflictDecision>[] = [
        {
          value: 'overwrite',
          label: 'Overwrite existing file',
          hint: relPath,
        },
        {
          value: 'rename',
          label: 'Save with a new suffix',
          hint: 'e.g. -2.md',
        },
        {
          value: 'skip',
          label: 'Skip this URL',
        },
      ];

      if (isBatch) {
        selectOptions.push(
          {
            value: 'overwrite_all',
            label: 'Overwrite all conflicts in this batch',
          },
          {
            value: 'skip_all',
            label: 'Skip all conflicts in this batch',
          },
        );
      }

      const choice = await select<FileConflictDecision>({
        message: `File ${pc.cyan(relPath)} already exists (${formatShortUrl(url, 36)}). Choose action:`,
        options: selectOptions,
        initialValue: 'rename',
        output,
      });

      if (isCancel(choice)) {
        cancel('Operation cancelled by user.', { output });
        process.exit(130);
      }

      ensureSpinnerStarted('Resuming pipeline...');
      return choice;
    },

    onUrlComplete(result: ProcessResult, completedCount: number, total: number): void {
      completedUrls = completedCount;
      if (total <= 1) {
        return;
      }

      clearActiveSpinner();
      const line = `${pc.dim(`[${completedCount}/${total}]`)} ${formatSummaryLine(result)}`;

      if (result.status === 'success') {
        log.success(line, { output });
      } else if (result.status === 'skipped') {
        log.warn(line, { output });
      } else {
        log.error(line, { output });
      }

      if (completedCount < total) {
        ensureSpinnerStarted(
          `${renderProgressBar(completedCount, total)}  Processing remaining URLs...`,
        );
      }
    },

    onBatchComplete(summary: BatchSummary): void {
      clearActiveSpinner();

      if (summary.total === 1 && summary.results[0]) {
        const single = summary.results[0];
        if (single.status === 'success') {
          log.success(formatSummaryLine(single), { output });
        } else if (single.status === 'skipped') {
          log.warn(formatSummaryLine(single), { output });
        } else {
          log.error(formatSummaryLine(single), { output });
        }
      } else if (summary.total > 1) {
        const lines = summary.results.map((item) => formatSummaryLine(item));
        note(lines.join('\n'), `Batch Results (${summary.total} URLs)`, { output });
      }

      const statsBadges = [
        pc.green(`✓ ${summary.succeeded} saved`),
        ...(summary.skipped > 0 ? [pc.yellow(`⚠ ${summary.skipped} skipped`)] : []),
        ...(summary.failed > 0 ? [pc.red(`✗ ${summary.failed} failed`)] : []),
        pc.dim(`⏱ ${formatDuration(summary.elapsedMs)}`),
      ].join(pc.dim('  •  '));

      outro(statsBadges, { output });
    },
  };

  return {
    hooks,
    reportFatalError(message: string): void {
      clearActiveSpinner();
      log.error(pc.red(message), { output });
      outro(pc.red('Execution failed'), { output });
    },
  };
}


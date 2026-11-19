#!/usr/bin/env node

import { Command } from 'commander';
import pc from 'picocolors';
import { DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from './services/fetcher.js';
import { runPipeline } from './services/pipeline.js';
import {
  CLI_NUMERIC_OPTIONS_SCHEMA,
  HEADER_ENTRY_SCHEMA,
  type CliOptions,
} from './types/post.js';
import { createTuiReporter } from './ui/reporter.js';
import { runInteractiveWizard } from './ui/wizard.js';
import { createLogger, resolveLogLevel } from './utils/logger.js';
import { readStreamText } from './utils/stdin.js';

interface RawCommandOptions {
  input?: string;
  output?: string;
  selector?: string;
  stdout: boolean;
  frontmatter: boolean;
  downloadImages: boolean;
  force: boolean;
  header: string[];
  userAgent: string;
  timeout: string;
  concurrency: string;
  verbose: boolean;
  quiet: boolean;
  filenameTemplate?: string;
  groupByDomain: boolean;
  fromClipboard: boolean;
  copy: boolean;
  interactive: boolean;
  json: boolean;
}

function collectHeaderOption(value: string, previous: string[]): string[] {
  const parsed = HEADER_ENTRY_SCHEMA.parse(value);
  return [...previous, parsed];
}

function parseHeaders(rawHeaders: readonly string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const entry of rawHeaders) {
    const colonIndex = entry.indexOf(':');
    const name = entry.slice(0, colonIndex).trim();
    const value = entry.slice(colonIndex + 1).trim();
    headers[name] = value;
  }
  return headers;
}

function buildCliOptions(urls: string[], raw: RawCommandOptions): CliOptions {
  const numeric = CLI_NUMERIC_OPTIONS_SCHEMA.parse({
    timeout: Number(raw.timeout),
    concurrency: Number(raw.concurrency),
  });

  return {
    urls,
    ...(raw.input ? { input: raw.input } : {}),
    ...(raw.output ? { output: raw.output } : {}),
    ...(raw.selector ? { selector: raw.selector } : {}),
    ...(raw.filenameTemplate ? { filenameTemplate: raw.filenameTemplate } : {}),
    stdout: raw.stdout,
    frontmatter: raw.frontmatter,
    downloadImages: raw.downloadImages,
    force: raw.force,
    headers: parseHeaders(raw.header),
    userAgent: raw.userAgent,
    timeout: numeric.timeout,
    concurrency: numeric.concurrency,
    verbose: raw.verbose,
    quiet: raw.quiet,
    groupByDomain: raw.groupByDomain,
    fromClipboard: raw.fromClipboard,
    copy: raw.copy,
    interactive: raw.interactive,
    json: raw.json,
  };
}

function formatHelpExamples(): string {
  return [
    '',
    pc.bold(pc.cyan('Examples:')),
    `  ${pc.dim('# Launch interactive setup wizard (in TTY)')}`,
    `  $ post2md`,
    '',
    `  ${pc.dim('# Convert a post, download images locally, and use a date-prefixed filename')}`,
    `  $ post2md https://example.com/blog/post --download-images --filename-template "{date}-{slug}"`,
    '',
    `  ${pc.dim('# Read URL from clipboard and copy resulting Markdown back to clipboard')}`,
    `  $ post2md --from-clipboard --copy`,
    '',
    `  ${pc.dim('# Pipe URLs from stdin and organize files by domain subdirectory')}`,
    `  $ cat urls.txt | post2md -o ./articles --group-by-domain`,
  ].join('\n');
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('post2md')
    .description(
      `${pc.bold('post2md')} — Fetch web posts by URL and convert them to clean GFM Markdown`,
    )
    .version('0.1.0')
    .argument('[urls...]', 'One or more post URLs to download')
    .option('-I, --interactive', 'Launch interactive configuration wizard', false)
    .option('-i, --input <file>', 'File containing URLs (one per line)')
    .option('--from-clipboard', 'Read post URL(s) from the system clipboard', false)
    .option('-o, --output <path>', 'Output file path (single URL) or directory')
    .option(
      '--filename-template <pattern>',
      'Filename template supporting {slug}, {date}, {domain}, {author}',
    )
    .option(
      '--group-by-domain',
      'Save Markdown files under <output>/<domain>/ subdirectories',
      false,
    )
    .option('-s, --selector <css>', 'CSS selector for post container instead of Readability')
    .option('--stdout', 'Write Markdown to stdout (single URL only)', false)
    .option('--copy', 'Copy generated Markdown to the system clipboard (single URL only)', false)
    .option('--no-frontmatter', 'Omit YAML frontmatter from output')
    .option('--download-images', 'Download images locally into assets/<slug>/', false)
    .option('-f, --force', 'Overwrite existing Markdown files without prompting', false)
    .option(
      '-H, --header <header>',
      'Additional HTTP header ("Name: Value")',
      collectHeaderOption,
      [],
    )
    .option('-A, --user-agent <ua>', 'Custom User-Agent header', DEFAULT_USER_AGENT)
    .option('-t, --timeout <ms>', 'HTTP request timeout in ms', String(DEFAULT_TIMEOUT_MS))
    .option('-c, --concurrency <n>', 'Parallel downloads in batch mode', '3')
    .option('--json', 'Emit structured Pino JSON logs to stderr even in TTY', false)
    .option('-v, --verbose', 'Enable verbose debug logging to stderr', false)
    .option('-q, --quiet', 'Only log errors to stderr', false)
    .addHelpText('after', formatHelpExamples());

  program.parse(process.argv);

  const positionalUrls = program.args;
  const rawOpts = program.opts<RawCommandOptions>();

  const isStdinTty = Boolean(process.stdin.isTTY);
  const isStderrTty = Boolean(process.stderr.isTTY);

  const logLevel = resolveLogLevel(rawOpts.verbose, rawOpts.quiet, rawOpts.stdout, {
    json: rawOpts.json,
    isTty: isStderrTty,
  });
  const logger = createLogger(logLevel);

  let tuiReporter: ReturnType<typeof createTuiReporter> | null = null;

  try {
    let cliOptions = buildCliOptions(positionalUrls, rawOpts);

    let stdinText: string | undefined;
    if (
      !isStdinTty &&
      cliOptions.urls.length === 0 &&
      !cliOptions.input &&
      !cliOptions.fromClipboard
    ) {
      const piped = await readStreamText(process.stdin);
      if (piped.trim().length > 0) {
        stdinText = piped;
      }
    }

    const hasAnyInputSource =
      cliOptions.urls.length > 0 ||
      Boolean(cliOptions.input) ||
      Boolean(cliOptions.fromClipboard) ||
      Boolean(stdinText);

    const shouldLaunchWizard =
      Boolean(cliOptions.interactive) || (!hasAnyInputSource && isStdinTty && isStderrTty);

    if (shouldLaunchWizard) {
      cliOptions = await runInteractiveWizard(cliOptions, process.stderr);
    }

    const useTui =
      isStderrTty && !cliOptions.json && !cliOptions.verbose && !cliOptions.quiet;

    if (useTui) {
      tuiReporter = createTuiReporter({
        output: process.stderr,
        showIntro: !shouldLaunchWizard,
        interactiveConflicts: isStdinTty && isStderrTty,
      });
    }

    const summary = await runPipeline(
      cliOptions,
      logger,
      (content) => {
        process.stdout.write(content);
      },
      {
        ...(tuiReporter ? tuiReporter.hooks : {}),
        ...(stdinText !== undefined ? { stdinText } : {}),
      },
    );

    if (summary.failed > 0) {
      process.exitCode = 1;
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (tuiReporter) {
      tuiReporter.reportFatalError(message);
    } else if (isStderrTty && !rawOpts.json && !rawOpts.verbose) {
      const fallbackReporter = createTuiReporter({
        output: process.stderr,
        showIntro: false,
      });
      fallbackReporter.reportFatalError(message);
    } else {
      logger.error({ err: message }, 'CLI execution failed');
    }
    process.exitCode = 1;
  }
}

void main();

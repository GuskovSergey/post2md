import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runPipeline } from '../src/services/pipeline.js';
import type { CliOptions, PipelineStage } from '../src/types/post.js';
import { createLogger } from '../src/utils/logger.js';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X2Z0AAAAASUVORK5CYII=',
  'base64',
);

function buildOptions(overrides: Partial<CliOptions>): CliOptions {
  return {
    urls: [],
    stdout: false,
    frontmatter: true,
    downloadImages: false,
    force: false,
    headers: {},
    userAgent: 'post2md-test/1.0',
    timeout: 5000,
    concurrency: 2,
    verbose: false,
    quiet: true,
    ...overrides,
  };
}

describe('pipeline integration', () => {
  let baseUrl = '';
  let server: ReturnType<typeof createServer>;
  let tempDir = '';

  beforeAll(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'post2md-test-'));

    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const reqUrl = req.url ?? '/';

      if (reqUrl === '/redirect-post') {
        res.writeHead(302, { Location: '/posts/hello-world' });
        res.end();
        return;
      }

      if (reqUrl === '/posts/hello-world') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!doctype html>
          <html>
            <head>
              <title>Hello World Post</title>
              <meta name="author" content="Ada Lovelace" />
              <meta property="article:published_time" content="2026-04-10T12:00:00Z" />
            </head>
            <body>
              <article>
                <h1>Hello World Post</h1>
                <p>This is a full article body with enough words to pass readability checks cleanly.</p>
                <p>Second paragraph describing the implementation details and architecture of our CLI.</p>
                <img src="/assets/pic.png" alt="Sample Pic" />
              </article>
            </body>
          </html>
        `);
        return;
      }

      if (reqUrl === '/posts/second') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
          <!doctype html>
          <html>
            <head><title>Hello World Post</title></head>
            <body>
              <article>
                <h1>Hello World Post</h1>
                <p>Duplicate title post with enough text to test filename collision deduplication in batch runs.</p>
                <p>Another detailed paragraph so Readability recognizes this as a valid article.</p>
              </article>
            </body>
          </html>
        `);
        return;
      }

      if (reqUrl === '/assets/pic.png') {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        res.end(TINY_PNG);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    });

    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (address && typeof address === 'object') {
          baseUrl = `http://127.0.0.1:${address.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('follows redirects, downloads images locally, and writes Markdown', async () => {
    const outDir = path.join(tempDir, 'single');
    const logger = createLogger('silent');
    const stages: PipelineStage[] = [];

    const summary = await runPipeline(
      buildOptions({
        urls: [`${baseUrl}/redirect-post`],
        output: `${outDir}/`,
        downloadImages: true,
      }),
      logger,
      undefined,
      {
        onUrlStage(update) {
          stages.push(update.stage);
        },
      },
    );

    expect(summary.succeeded).toBe(1);
    expect(summary.failed).toBe(0);
    expect(stages).toEqual(['fetch', 'extract', 'images', 'images', 'save']);

    const outputPath = summary.results[0]?.outputPath;
    expect(outputPath).toBe(path.join(outDir, 'hello-world-post.md'));
    expect(summary.results[0]?.downloadedImages).toBe(1);

    const md = await readFile(outputPath!, 'utf8');
    expect(md).toContain(`source_url: ${baseUrl}/posts/hello-world`);
    expect(md).toMatch(/!\[Sample Pic\]\(\.\/assets\/hello-world-post\/01-pic-[a-f0-9]{8}\.png\)/);
  });

  it('skips existing file unless --force is passed or conflict resolver chooses rename/overwrite', async () => {
    const outFile = path.join(tempDir, 'existing.md');
    await writeFile(outFile, 'existing content', 'utf8');
    const logger = createLogger('silent');

    const skippedSummary = await runPipeline(
      buildOptions({
        urls: [`${baseUrl}/posts/hello-world`],
        output: outFile,
        force: false,
      }),
      logger,
    );
    expect(skippedSummary.skipped).toBe(1);
    expect(await readFile(outFile, 'utf8')).toBe('existing content');

    const renamedSummary = await runPipeline(
      buildOptions({
        urls: [`${baseUrl}/posts/hello-world`],
        output: outFile,
        force: false,
      }),
      logger,
      undefined,
      {
        async resolveConflict() {
          return 'rename';
        },
      },
    );
    expect(renamedSummary.succeeded).toBe(1);
    expect(renamedSummary.results[0]?.outputPath).toBe(path.join(tempDir, 'existing-2.md'));

    const forcedSummary = await runPipeline(
      buildOptions({
        urls: [`${baseUrl}/posts/hello-world`],
        output: outFile,
        force: true,
      }),
      logger,
    );
    expect(forcedSummary.succeeded).toBe(1);
    expect(await readFile(outFile, 'utf8')).toContain('# Hello World Post');
  });

  it('writes clean Markdown to stdout when --stdout is enabled', async () => {
    const logger = createLogger('silent');
    let captured = '';

    const summary = await runPipeline(
      buildOptions({
        urls: [`${baseUrl}/posts/hello-world`],
        stdout: true,
        frontmatter: false,
      }),
      logger,
      (chunk) => {
        captured += chunk;
      },
    );

    expect(summary.succeeded).toBe(1);
    expect(captured.startsWith('# Hello World Post')).toBe(true);
  });

  it('processes batch URLs from --input file, deduplicates slugs, and isolates failures', async () => {
    const batchDir = path.join(tempDir, 'batch');
    const urlsFile = path.join(tempDir, 'urls.txt');
    await writeFile(
      urlsFile,
      [
        '# comment line',
        '',
        `${baseUrl}/posts/hello-world`,
        `${baseUrl}/posts/second`,
        `${baseUrl}/missing-page`,
      ].join('\n'),
      'utf8',
    );

    const logger = createLogger('silent');
    const summary = await runPipeline(
      buildOptions({
        input: urlsFile,
        output: batchDir,
        concurrency: 2,
      }),
      logger,
    );

    expect(summary.total).toBe(3);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.results[0]?.outputPath).toBe(path.join(batchDir, 'hello-world-post.md'));
    expect(summary.results[1]?.outputPath).toBe(path.join(batchDir, 'hello-world-post-2.md'));
    expect(summary.results[2]?.status).toBe('error');
  });

  it('supports --filename-template, --group-by-domain, --from-clipboard, --copy, and stdin', async () => {
    const templatedDir = path.join(tempDir, 'templated');
    const logger = createLogger('silent');
    let clipboardOutput = '';

    const summary = await runPipeline(
      buildOptions({
        output: templatedDir,
        filenameTemplate: '{date}-{author}-{slug}',
        groupByDomain: true,
        fromClipboard: true,
        copy: true,
      }),
      logger,
      undefined,
      {
        async readClipboard() {
          return `${baseUrl}/posts/hello-world\n`;
        },
        async writeClipboard(text) {
          clipboardOutput = text;
        },
      },
    );

    expect(summary.succeeded).toBe(1);
    expect(summary.results[0]?.copiedToClipboard).toBe(true);
    expect(clipboardOutput).toContain('# Hello World Post');

    const expectedPath = path.join(
      templatedDir,
      '127.0.0.1',
      '2026-04-10-ada-lovelace-hello-world-post.md',
    );
    expect(summary.results[0]?.outputPath).toBe(expectedPath);
    expect(await readFile(expectedPath, 'utf8')).toContain('# Hello World Post');
  });
});

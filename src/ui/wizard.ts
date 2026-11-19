import {
  cancel,
  intro,
  isCancel,
  multiselect,
  select,
  text,
} from '@clack/prompts';
import pc from 'picocolors';
import type { CliOptions } from '../types/post.js';
import { extractUrlLinesFromText } from '../utils/stdin.js';
import { parseHttpUrl } from '../utils/url.js';

type OutputMode = 'file' | 'file_and_copy' | 'stdout';
type ExtraFeature = 'frontmatter' | 'downloadImages' | 'groupByDomain' | 'force';

/**
 * Runs an interactive CLI wizard on `stderr` to configure `CliOptions` when launched
 * without arguments in a TTY or with `--interactive`.
 */
export async function runInteractiveWizard(
  baseOptions: CliOptions,
  output: NodeJS.WriteStream = process.stderr,
): Promise<CliOptions> {
  intro(
    `${pc.bgCyan(pc.black(pc.bold(' post2md ')))} ${pc.cyan('Interactive Mode')}`,
    { output },
  );

  let urls = [...baseOptions.urls];

  if (urls.length === 0 && !baseOptions.input && !baseOptions.fromClipboard) {
    const rawUrlInput = await text({
      message: 'Enter one or more post URLs (separated by space or comma):',
      placeholder: 'https://example.com/blog/my-post',
      output,
      validate(value): string | undefined {
        const candidates = extractUrlLinesFromText(value ?? '');
        if (candidates.length === 0) {
          return 'Please enter at least one HTTP/HTTPS URL.';
        }
        for (const candidate of candidates) {
          try {
            parseHttpUrl(candidate);
          } catch (error: unknown) {
            return error instanceof Error ? error.message : 'Invalid URL';
          }
        }
        return undefined;
      },
    });

    if (isCancel(rawUrlInput)) {
      cancel('Interactive setup cancelled.', { output });
      process.exit(130);
    }

    urls = extractUrlLinesFromText(rawUrlInput);
  }

  const isSingleUrl = urls.length === 1 && !baseOptions.input;

  let outputMode: OutputMode = 'file';
  if (isSingleUrl) {
    const selectedMode = await select<OutputMode>({
      message: 'How should the converted Markdown be delivered?',
      options: [
        {
          value: 'file',
          label: 'Save to Markdown file',
          hint: 'recommended',
        },
        {
          value: 'file_and_copy',
          label: 'Save to file + copy to clipboard',
          hint: '--copy',
        },
        {
          value: 'stdout',
          label: 'Print directly to stdout',
          hint: '--stdout',
        },
      ],
      initialValue: baseOptions.stdout
        ? 'stdout'
        : baseOptions.copy
          ? 'file_and_copy'
          : 'file',
      output,
    });

    if (isCancel(selectedMode)) {
      cancel('Interactive setup cancelled.', { output });
      process.exit(130);
    }
    outputMode = selectedMode;
  }

  let outputDirOrFile = baseOptions.output;
  let filenameTemplate = baseOptions.filenameTemplate ?? '{slug}';

  if (outputMode !== 'stdout') {
    const targetInput = await text({
      message: 'Output directory (or file path):',
      placeholder: './',
      defaultValue: baseOptions.output ?? './',
      initialValue: baseOptions.output ?? './',
      output,
    });

    if (isCancel(targetInput)) {
      cancel('Interactive setup cancelled.', { output });
      process.exit(130);
    }

    const trimmedTarget = targetInput.trim();
    outputDirOrFile = trimmedTarget === './' || trimmedTarget === '.' ? undefined : trimmedTarget;

    const selectedTemplate = await select<string>({
      message: 'Filename naming template:',
      options: [
        {
          value: '{slug}',
          label: '{slug}.md',
          hint: 'e.g. my-article-title.md',
        },
        {
          value: '{date}-{slug}',
          label: '{date}-{slug}.md',
          hint: 'e.g. 2026-11-18-my-article-title.md',
        },
        {
          value: '{domain}-{slug}',
          label: '{domain}-{slug}.md',
          hint: 'e.g. example-com-my-article-title.md',
        },
        {
          value: '{date}-{author}-{slug}',
          label: '{date}-{author}-{slug}.md',
          hint: 'e.g. 2026-11-18-jane-doe-my-article-title.md',
        },
      ],
      initialValue: filenameTemplate,
      output,
    });

    if (isCancel(selectedTemplate)) {
      cancel('Interactive setup cancelled.', { output });
      process.exit(130);
    }

    filenameTemplate = selectedTemplate;
  }

  const initialFeatures: ExtraFeature[] = ['frontmatter'];
  if (baseOptions.downloadImages) {
    initialFeatures.push('downloadImages');
  }
  if (baseOptions.groupByDomain) {
    initialFeatures.push('groupByDomain');
  }
  if (baseOptions.force) {
    initialFeatures.push('force');
  }

  const featureOptions =
    outputMode === 'stdout'
      ? ([
          {
            value: 'frontmatter' as const,
            label: 'Include YAML frontmatter',
            hint: 'title, source_url, author, dates',
          },
        ] as const)
      : ([
          {
            value: 'frontmatter' as const,
            label: 'Include YAML frontmatter',
            hint: 'title, source_url, author, dates',
          },
          {
            value: 'downloadImages' as const,
            label: 'Download images locally',
            hint: 'saves to ./assets/<slug>/',
          },
          {
            value: 'groupByDomain' as const,
            label: 'Group files by domain subfolder',
            hint: 'saves to <output>/<domain>/',
          },
          {
            value: 'force' as const,
            label: 'Overwrite existing files without asking',
            hint: '--force',
          },
        ] as const);

  const selectedFeatures = await multiselect<ExtraFeature>({
    message: 'Select conversion options (Space to toggle, Enter to confirm):',
    options: featureOptions,
    initialValues: initialFeatures,
    required: false,
    output,
  });

  if (isCancel(selectedFeatures)) {
    cancel('Interactive setup cancelled.', { output });
    process.exit(130);
  }

  const featureSet = new Set<ExtraFeature>(selectedFeatures);

  return {
    ...baseOptions,
    urls,
    ...(outputDirOrFile ? { output: outputDirOrFile } : {}),
    stdout: outputMode === 'stdout',
    copy: outputMode === 'file_and_copy' || Boolean(baseOptions.copy),
    frontmatter: featureSet.has('frontmatter'),
    downloadImages: outputMode !== 'stdout' && featureSet.has('downloadImages'),
    groupByDomain: outputMode !== 'stdout' && featureSet.has('groupByDomain'),
    force: featureSet.has('force'),
    filenameTemplate,
  };
}


import { spawn } from 'node:child_process';

interface ClipboardCommand {
  command: string;
  args: readonly string[];
}

function getReadCommands(platform: NodeJS.Platform): readonly ClipboardCommand[] {
  if (platform === 'darwin') {
    return [{ command: 'pbpaste', args: [] }];
  }
  if (platform === 'win32') {
    return [
      {
        command: 'powershell',
        args: ['-NoProfile', '-Command', 'Get-Clipboard'],
      },
    ];
  }
  return [
    { command: 'wl-paste', args: ['--no-newline'] },
    { command: 'xclip', args: ['-selection', 'clipboard', '-o'] },
    { command: 'xsel', args: ['--clipboard', '--output'] },
  ];
}

function getWriteCommands(platform: NodeJS.Platform): readonly ClipboardCommand[] {
  if (platform === 'darwin') {
    return [{ command: 'pbcopy', args: [] }];
  }
  if (platform === 'win32') {
    return [{ command: 'clip', args: [] }];
  }
  return [
    { command: 'wl-copy', args: [] },
    { command: 'xclip', args: ['-selection', 'clipboard'] },
    { command: 'xsel', args: ['--clipboard', '--input'] },
  ];
}

function execCommand(
  cmd: ClipboardCommand,
  input?: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd.command, cmd.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(stdoutChunks).toString('utf8'));
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(new Error(stderr || `${cmd.command} exited with code ${String(code)}`));
      }
    });

    if (input !== undefined) {
      child.stdin.write(input, 'utf8');
    }
    child.stdin.end();
  });
}

/**
 * Reads UTF-8 text from the system clipboard.
 */
export async function readClipboardText(): Promise<string> {
  const candidates = getReadCommands(process.platform);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      return await execCommand(candidate);
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Unable to read from clipboard (${lastError?.message ?? 'no clipboard utility found'}). Install xclip, xsel, or wl-clipboard.`,
  );
}

/**
 * Writes UTF-8 text to the system clipboard.
 */
export async function writeClipboardText(text: string): Promise<void> {
  const candidates = getWriteCommands(process.platform);
  let lastError: Error | null = null;

  for (const candidate of candidates) {
    try {
      await execCommand(candidate, text);
      return;
    } catch (error: unknown) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw new Error(
    `Unable to copy to clipboard (${lastError?.message ?? 'no clipboard utility found'}). Install xclip, xsel, or wl-clipboard.`,
  );
}


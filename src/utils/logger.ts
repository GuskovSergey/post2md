import pino, { type Logger } from 'pino';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LogLevelContext {
  verbose: boolean;
  quiet: boolean;
  toStdout: boolean;
  json?: boolean;
  isTty?: boolean;
}

/**
 * Creates a Pino logger writing structured JSON logs to stderr (fd 2)
 * so stdout stays clean when --stdout is used.
 */
export function createLogger(level: LogLevel = 'info'): Logger {
  return pino(
    {
      name: 'post2md',
      level,
    },
    pino.destination({ fd: 2, sync: false }),
  );
}

/**
 * Maps CLI verbosity flags and terminal mode to a Pino log level.
 * When running in an interactive TTY without `--json` or `--verbose`, Pino stays `silent`
 * so the visual TUI reporter controls stderr without raw JSON lines interfering.
 */
export function resolveLogLevel(
  verbose: boolean,
  quiet: boolean,
  toStdout: boolean,
  options?: { json?: boolean; isTty?: boolean },
): LogLevel {
  const isJson = options?.json ?? false;
  const isTty = options?.isTty ?? false;

  if (isTty && !isJson && !verbose) {
    return 'silent';
  }

  if (quiet) {
    return 'error';
  }
  if (verbose) {
    return 'debug';
  }
  if (toStdout) {
    return 'warn';
  }
  return 'info';
}

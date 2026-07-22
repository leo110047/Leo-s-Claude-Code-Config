import type { StdioOptions } from 'node:child_process';

type OutputSink = {
  write(chunk: string | Uint8Array): unknown;
};

type SuperviseOptions = {
  timeoutMs: number;
  killGraceMs?: number;
  killConfirmMs?: number;
  completionPattern?: RegExp;
  completionExitGraceMs?: number;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  captureOutput?: false | {
    stdoutMaxBytes: number;
    stderrMaxBytes: number;
  };
  label?: string;
  stderr?: OutputSink;
  stdout?: OutputSink;
  stdio?: StdioOptions;
  input?: string | Buffer;
};

type CapturingOptions = SuperviseOptions & {
  captureOutput: {
    stdoutMaxBytes: number;
    stderrMaxBytes: number;
  };
};

export type SuperviseResult = {
  exitCode: number;
  reason: string;
  signal: NodeJS.Signals | null;
};

export type CapturedSuperviseResult = SuperviseResult & {
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  forceKilled: boolean;
};

export function superviseCommand(
  command: string,
  args: string[],
  options: CapturingOptions,
): Promise<CapturedSuperviseResult>;

export function superviseCommand(
  command: string,
  args: string[],
  options: SuperviseOptions,
): Promise<SuperviseResult>;

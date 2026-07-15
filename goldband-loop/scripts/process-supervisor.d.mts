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
  captureOutput?: boolean;
  label?: string;
  stderr?: OutputSink;
  stdout?: OutputSink;
  stdio?: StdioOptions;
};

type CapturingOptions = SuperviseOptions & {
  captureOutput: true;
};

export type SuperviseResult = {
  exitCode: number;
  reason: string;
  signal: NodeJS.Signals | null;
};

export type CapturedSuperviseResult = SuperviseResult & {
  stdout: string;
  stderr: string;
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

export type HostName =
  | 'claude'
  | 'codex'
  | 'cursor'
  | 'factory'
  | 'gbrain'
  | 'hermes'
  | 'kiro'
  | 'opencode'
  | 'openclaw'
  | 'slate';

export type EntrypointType = 'typed' | 'compatibility' | 'legacy-thin';
export type IntegrationStatus = 'integrated' | 'registered-only';
export type RiskLevel = 'low' | 'medium' | 'high';
export type StepKind = 'typed' | 'llm' | 'legacyPrompt';
export type StepStatus = 'ok' | 'failed' | 'skipped';

export type SchemaValidator<T = unknown> = {
  name: string;
  validate(value: unknown): T;
};

export type WorkflowContext = {
  runId: string;
  workflow: WorkflowDefinition;
  cwd: string;
  input?: unknown;
  options: WorkflowRunOptions;
  artifacts: string[];
};

export type WorkflowStep<T = unknown> = {
  name: string;
  kind: StepKind;
  produces: SchemaValidator<T>;
  run(ctx: WorkflowContext): Promise<T> | T;
};

export type WorkflowDefinition = {
  name: string;
  target: string;
  evaluationSignal: string;
  iterationCap: number;
  stopConditions: string[];
  sourceTemplate: string;
  entrypointType: EntrypointType;
  integrationStatus: IntegrationStatus;
  hostSupport: HostName[];
  riskLevel: RiskLevel;
  evidencePolicy: string;
  migrationNotes: string;
  nextStep: string;
  steps: WorkflowStep[];
};

export type WorkflowRunOptions = {
  mode?: 'mock' | 'real';
  host?: 'mock' | 'claude' | 'codex';
  base?: string;
  diffFile?: string;
  staged?: boolean;
  worktree?: boolean;
  includeUntracked?: boolean;
  inputFile?: string;
  goldbandHome?: string;
  cwd?: string;
  iteration?: number;
  repeatedBlocker?: boolean;
};

export type StepEvidenceEvent = {
  runId: string;
  workflow: string;
  step: string;
  startedAt: string;
  durationMs: number;
  status: StepStatus;
  outputDigest: string;
  artifacts: string[];
  error?: string;
};

export type DistributionManifest = {
  schemaVersion: 1;
  sourceDigest: string;
  installedDigest: string;
  artifacts: unknown[];
  sideArtifacts: unknown[];
  dispatch: Record<string, string[]>;
};

export type DistributionSideArtifact = {
  role: string;
  path: string;
  contents?: string | Uint8Array;
  mode?: number;
};

export function writeDistributionManifest(
  runtimeRoot: string,
  sourceRoot: string,
  sideArtifacts?: DistributionSideArtifact[],
): DistributionManifest;

export function workflowSourceInputManifest(sourceRoot: string, sourceInputs?: string[]): {
  schemaVersion: 1;
  owner: string;
  inputs: unknown[];
  digest: string;
};

export function inspectDistribution(
  runtimeRoot: string,
  sourceRoot: string,
  expectedSideArtifacts?: DistributionSideArtifact[],
):
  | { ok: true; status: 'ok'; sourceDigest: string; installedDigest: string; dispatch: Record<string, string[]> }
  | { ok: false; status: string; detail: string };

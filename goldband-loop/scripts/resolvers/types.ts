import { ALL_HOST_CONFIGS } from '../../hosts/index';

/**
 * Host type — derived from host configs in hosts/*.ts.
 * Adding a new host: create hosts/myhost.ts + add to hosts/index.ts.
 * Do NOT hardcode host names here.
 */
export type Host = (typeof ALL_HOST_CONFIGS)[number]['name'];

export interface HostPaths {
  skillRoot: string;
  binDir: string;
  browseDir: string;
  designDir: string;
  makePdfDir: string;
}

/**
 * HOST_PATHS — derived from host configs.
 * Every host uses the runtime variables initialized by the generated preamble.
 */
function buildHostPaths(): Record<string, HostPaths> {
  const paths: Record<string, HostPaths> = {};
  for (const config of ALL_HOST_CONFIGS) {
    paths[config.name] = {
      skillRoot: '$GOLDBAND_ROOT',
      binDir: '$GOLDBAND_BIN',
      browseDir: '$GOLDBAND_BROWSE',
      designDir: '$GOLDBAND_DESIGN',
      makePdfDir: '$GOLDBAND_MAKE_PDF',
    };
  }
  return paths;
}

export const HOST_PATHS: Record<string, HostPaths> = buildHostPaths();

import type { Model } from '../models';

export interface TemplateContext {
  skillName: string;
  tmplPath: string;
  benefitsFrom?: string[];
  host: Host;
  paths: HostPaths;
  preambleTier?: number;  // 1-4, controls which preamble sections are included
  model?: Model;  // model family for behavioral overlay. Omitted/undefined → no overlay.
  interactive?: boolean;  // true → emit plan-mode handshake in preamble. Generator-only, not written to SKILL.md.
}

/** Resolver function signature. args is populated for parameterized placeholders like {{INVOKE_SKILL:name}}. */
export type ResolverFn = (ctx: TemplateContext, args?: string[]) => string;

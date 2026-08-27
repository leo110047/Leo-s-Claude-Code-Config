import { homedir } from 'node:os';
import { join } from 'node:path';

type StateRootEnv = NodeJS.ProcessEnv & {
  GOLDBAND_HOME?: string;
  GOLDBAND_STATE_DIR?: string;
  GOLDBAND_STATE_ROOT?: string;
  CLAUDE_PLUGIN_DATA?: string;
  CLAUDE_PLUGIN_ROOT?: string;
};

/** Resolve Goldband's writable state root using the shared runtime precedence. */
export function resolveGoldbandStateRoot(
  explicitRoot?: string,
  env: StateRootEnv = process.env,
  home?: string,
): string {
  if (explicitRoot) return explicitRoot;
  if (env.GOLDBAND_HOME) return env.GOLDBAND_HOME;
  if (env.GOLDBAND_STATE_DIR) return env.GOLDBAND_STATE_DIR;
  if (env.GOLDBAND_STATE_ROOT) return env.GOLDBAND_STATE_ROOT;
  if (
    env.CLAUDE_PLUGIN_DATA &&
    env.CLAUDE_PLUGIN_ROOT?.toLowerCase().includes('goldband')
  ) {
    return env.CLAUDE_PLUGIN_DATA;
  }
  return join(home ?? env.HOME ?? homedir(), '.goldband');
}

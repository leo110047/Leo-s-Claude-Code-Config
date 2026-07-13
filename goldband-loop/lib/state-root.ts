import { homedir } from 'node:os';
import { join } from 'node:path';

type StateRootEnv = Pick<
  NodeJS.ProcessEnv,
  | 'GOLDBAND_HOME'
  | 'GOLDBAND_STATE_DIR'
  | 'GOLDBAND_STATE_ROOT'
  | 'CLAUDE_PLUGIN_DATA'
  | 'CLAUDE_PLUGIN_ROOT'
>;

/** Resolve Goldband's writable state root using the shared runtime precedence. */
export function resolveGoldbandStateRoot(
  explicitRoot?: string,
  env: StateRootEnv = process.env,
  home: string = homedir(),
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
  return join(home, '.goldband');
}

import type { HostConfig } from '../scripts/host-config';

/**
 * GBrain host config.
 * Compatible with GBrain >= v0.10.0 (doctor --fast --json, search CLI, entity enrichment).
 * When updating, check INSTALL_FOR_AGENTS.md in the GBrain repo for breaking changes.
 */
const gbrain: HostConfig = {
  name: 'gbrain',
  displayName: 'GBrain',
  cliCommand: 'gbrain',
  cliAliases: [],

  globalRoot: '.gbrain/skills/goldband',
  localSkillRoot: '.gbrain/skills/goldband',
  hostSubdir: '.gbrain',

  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  coAuthorTrailer: 'Co-Authored-By: GBrain Agent <agent@gbrain.dev>',
  learningsMode: 'basic',
};

export default gbrain;

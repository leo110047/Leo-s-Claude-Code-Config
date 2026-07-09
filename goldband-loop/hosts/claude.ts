import type { HostConfig } from '../scripts/host-config';

const claude: HostConfig = {
  name: 'claude',
  displayName: 'Claude Code',
  cliCommand: 'claude',
  cliAliases: [],

  globalRoot: '.claude/skills/goldband',
  localSkillRoot: '.claude/skills/goldband',
  hostSubdir: '.claude',
  usesEnvVars: false,

  frontmatter: {
    mode: 'denylist',
    stripFields: ['sensitive', 'voice-triggers'],
    descriptionLimit: null,
  },

  generation: {
    generateMetadata: false,
    skipSkills: ['claude'],  // Claude outside-voice skill is for non-Claude hosts
  },

  pathRewrites: [],  // Claude is the primary host — no rewrites needed
  toolRewrites: {},
  suppressedResolvers: ['GBRAIN_CONTEXT_LOAD', 'GBRAIN_SAVE_RESULTS'],

  runtimeRoot: {
    globalSymlinks: ['bin', 'browse/dist', 'browse/bin', 'goldband-upgrade', 'ETHOS.md'],
    globalFiles: {
      'review': [
        'shared-rubric.md',
        'findings-schema.md',
        'checklist.md',
        'ship-fix-first.md',
        'design-checklist.md',
        'greptile-triage.md',
        'TODOS-format.md',
      ],
    },
  },

  install: {
    prefixable: true,
    linkingStrategy: 'real-dir-symlink',
  },

  coAuthorTrailer: 'Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>',
  learningsMode: 'full',
};

export default claude;

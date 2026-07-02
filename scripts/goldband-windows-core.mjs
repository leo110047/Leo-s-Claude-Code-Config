import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_DIR = path.resolve(__dirname, '..');
const HOOKS_CONFIG_FILE = path.join(REPO_DIR, 'hooks', 'hooks.json');
const RETIRED_CLAUDE_PERMISSION_ALLOW_FILE = path.join(
  REPO_DIR,
  'hooks',
  'claude-retired-permission-allow.json',
);
const WINDOWS_STATE_VERSION = 1;

const DEFAULT_COLORS = {
  reset: '\u001b[0m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};

function colorize(enabled, color, text) {
  if (!enabled) {
    return text;
  }
  return `${DEFAULT_COLORS[color]}${text}${DEFAULT_COLORS.reset}`;
}

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positional.push(token);
      continue;
    }

    const trimmed = token.slice(2);
    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex >= 0) {
      const key = trimmed.slice(0, equalsIndex);
      const value = trimmed.slice(equalsIndex + 1);
      options[key] = value;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      options[trimmed] = next;
      index += 1;
    } else {
      options[trimmed] = true;
    }
  }

  return { positional, options };
}

function normalizePlatform(rawPlatform) {
  if (!rawPlatform) {
    return process.platform;
  }
  const normalized = String(rawPlatform).trim().toLowerCase();
  if (normalized === 'windows' || normalized === 'win') {
    return 'win32';
  }
  return normalized;
}

function createContext(rawOptions = {}) {
  const effectivePlatform = normalizePlatform(
    rawOptions.platform ??
      process.env.GOLDBAND_TEST_PLATFORM ??
      process.platform,
  );
  const realWindows =
    effectivePlatform === 'win32' && process.platform === 'win32';
  const homeDir = path.resolve(
    rawOptions.home ?? process.env.GOLDBAND_TEST_HOME ?? os.homedir(),
  );
  const repoDir = path.resolve(
    rawOptions.repo ?? process.env.GOLDBAND_SELF_UPDATE_REPO_DIR ?? REPO_DIR,
  );
  const paths = buildContextPaths(homeDir);

  return {
    platform: effectivePlatform,
    realWindows,
    homeDir,
    repoDir,
    ...buildContextOptions(rawOptions),
    paths,
  };
}

function buildContextOptions(rawOptions) {
  return {
    gitCommand: String(rawOptions.git ?? process.env.GOLDBAND_GIT ?? 'git'),
    selfUpdateTimeoutSeconds: parseTimeout(rawOptions),
    forceFileCopy:
      rawOptions['force-file-copy'] ||
      process.env.GOLDBAND_TEST_FORCE_FILE_COPY === '1',
    colorsEnabled: process.stdout.isTTY && !rawOptions['no-color'],
    skipWorkflow:
      rawOptions['skip-workflow'] || process.env.GOLDBAND_SKIP_WORKFLOW === '1',
    workflowRepoDir: rawOptions['workflow-repo']
      ? path.resolve(String(rawOptions['workflow-repo']))
      : null,
  };
}

function parseTimeout(rawOptions) {
  const value =
    rawOptions['self-update-timeout'] ??
    process.env.GOLDBAND_SELF_UPDATE_TIMEOUT ??
    '4';
  return Number.parseFloat(String(value)) || 4;
}

function buildContextPaths(homeDir) {
  const claudeDir = path.join(homeDir, '.claude');
  const codexDir = path.join(homeDir, '.codex');
  const agentsDir = path.join(homeDir, '.agents');
  return {
    claudeDir,
    skillsDir: path.join(claudeDir, 'skills'),
    skillProfileFile: path.join(claudeDir, 'skills', '.goldband-profile'),
    claudeBinDir: path.join(claudeDir, 'bin'),
    claudeShellDir: path.join(claudeDir, 'shell'),
    claudeGlobalInstructionsFile: path.join(claudeDir, 'CLAUDE.md'),
    settingsJson: path.join(claudeDir, 'settings.json'),
    windowsStateFile: path.join(claudeDir, '.goldband-windows-state.json'),
    shellUpdateBinPs1: path.join(claudeDir, 'bin', 'goldband-self-update.ps1'),
    shellLaunchersPs1: path.join(claudeDir, 'shell', 'goldband-launchers.ps1'),
    codexDir,
    codexConfigFile: path.join(codexDir, 'config.toml'),
    codexRequirementsFile: path.join(codexDir, 'requirements.toml'),
    codexAgentsFile: path.join(codexDir, 'AGENTS.md'),
    codexCustomAgentsDir: path.join(codexDir, 'agents'),
    codexHooksFile: path.join(codexDir, 'hooks.json'),
    codexHooksDir: path.join(codexDir, 'hooks'),
    codexRulesDir: path.join(codexDir, 'rules'),
    codexRuntimeSkillsDir: path.join(codexDir, 'skills'),
    codexRuntimeWorkflowDir: path.join(codexDir, 'skills', 'workflow'),
    agentsDir,
    agentsSkillsDir: path.join(agentsDir, 'skills'),
    codexSkillProfileFile: path.join(agentsDir, 'skills', '.goldband-profile'),
    workflowStateDir: path.join(homeDir, '.workflow'),
    powershellProfiles: buildPowerShellProfiles(homeDir),
  };
}

function buildPowerShellProfiles(homeDir) {
  return [
    path.join(
      homeDir,
      'Documents',
      'PowerShell',
      'Microsoft.PowerShell_profile.ps1',
    ),
    path.join(
      homeDir,
      'Documents',
      'WindowsPowerShell',
      'Microsoft.PowerShell_profile.ps1',
    ),
  ];
}

function joinCsv(values) {
  return values.join(',');
}

function defaultWindowsState() {
  return {
    version: WINDOWS_STATE_VERSION,
    claudeSkillsProfile: null,
    codexSkillsProfile: null,
    claudeComponents: {
      guidance: false,
      commands: false,
      contexts: false,
      rules: false,
      hooks: false,
      launchers: false,
    },
    codexComponents: {
      config: false,
      profiles: false,
      requirements: false,
      agents: false,
      hooks: false,
      rules: false,
    },
    workflow: {
      claude: false,
      codex: false,
    },
  };
}

function readWindowsState(context) {
  const statePath = context.paths.windowsStateFile;
  if (!fs.existsSync(statePath)) {
    return defaultWindowsState();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    const state = defaultWindowsState();
    state.version = parsed.version ?? state.version;
    state.claudeSkillsProfile = parsed.claudeSkillsProfile ?? null;
    state.codexSkillsProfile = parsed.codexSkillsProfile ?? null;
    state.claudeComponents = {
      ...state.claudeComponents,
      ...(parsed.claudeComponents ?? {}),
    };
    state.codexComponents = {
      ...state.codexComponents,
      ...(parsed.codexComponents ?? {}),
    };
    state.workflow = {
      ...state.workflow,
      ...(parsed.workflow ?? {}),
    };
    return state;
  } catch {
    return defaultWindowsState();
  }
}

function writeWindowsState(context, state) {
  ensureDir(path.dirname(context.paths.windowsStateFile));
  fs.writeFileSync(
    context.paths.windowsStateFile,
    `${JSON.stringify({ ...defaultWindowsState(), ...state }, null, 2)}\n`,
    'utf8',
  );
}

function updateWindowsState(context, updater) {
  const state = readWindowsState(context);
  updater(state);
  writeWindowsState(context, state);
  return state;
}

function skillCatalogLines(context) {
  const raw = fs.readFileSync(
    path.join(context.repoDir, 'shell', 'install', 'skill-catalog.txt'),
    'utf8',
  );
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .map((line) => {
      const [name, claudeTier = '', codexTier = ''] = line.split('|');
      return { name, claudeTier, codexTier };
    });
}

function profileRank(profile) {
  switch (profile) {
    case 'core':
      return 1;
    case 'dev':
      return 2;
    case 'full':
      return 3;
    default:
      return 0;
  }
}

function buildSkillProfileList(context, tool, profile) {
  const requestedRank = profileRank(profile);
  if (requestedRank <= 0) {
    throw new Error(`unsupported profile: ${profile}`);
  }

  const field = tool === 'claude' ? 'claudeTier' : 'codexTier';
  return skillCatalogLines(context)
    .filter(
      (entry) =>
        profileRank(entry[field]) > 0 &&
        profileRank(entry[field]) <= requestedRank,
    )
    .map((entry) => entry.name);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function removePath(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function readRetiredClaudePermissionAllow(context) {
  const sourcePath = path.join(
    context.repoDir,
    'hooks',
    'claude-retired-permission-allow.json',
  );
  const fallbackPath = isSamePath(context.repoDir, REPO_DIR)
    ? RETIRED_CLAUDE_PERMISSION_ALLOW_FILE
    : sourcePath;
  const targetPath = fs.existsSync(sourcePath) ? sourcePath : fallbackPath;
  if (!fs.existsSync(targetPath)) {
    return [];
  }
  return JSON.parse(fs.readFileSync(targetPath, 'utf8'));
}

function backupExistingPath(targetPath, context) {
  const backupPath = `${targetPath}.bak.${Date.now()}`;
  fs.renameSync(targetPath, backupPath);
  console.log(
    `  ${colorize(context.colorsEnabled, 'yellow', '[backup]')} ${targetPath} -> ${backupPath}`,
  );
}

function isSamePath(left, right) {
  return path.resolve(left) === path.resolve(right);
}

function toBashPath(targetPath) {
  if (!targetPath) {
    return targetPath;
  }
  let normalized = targetPath.replace(/\\/g, '/');
  const match = normalized.match(/^([A-Za-z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2];
    normalized = `/${drive}/${rest}`;
  }
  return normalized;
}

function ensureManagedLink(context, sourcePath, destPath, kind) {
  ensureDir(path.dirname(destPath));
  removePath(destPath);

  if (context.realWindows) {
    if (kind === 'dir') {
      fs.symlinkSync(sourcePath, destPath, 'junction');
      return;
    }
    if (context.forceFileCopy) {
      fs.copyFileSync(sourcePath, destPath);
      return;
    }
    try {
      fs.linkSync(sourcePath, destPath);
      return;
    } catch {
      fs.copyFileSync(sourcePath, destPath);
      return;
    }
  }

  fs.symlinkSync(sourcePath, destPath, kind === 'dir' ? 'dir' : 'file');
}

function lstatOrNull(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch {
    return null;
  }
}

function isRepoSymlink(targetPath, sourcePath) {
  const stat = lstatOrNull(targetPath);
  if (!stat?.isSymbolicLink()) {
    return false;
  }
  const currentTarget = path.resolve(
    path.dirname(targetPath),
    fs.readlinkSync(targetPath),
  );
  return isSamePath(currentTarget, sourcePath);
}

function fileContentsMatch(leftPath, rightPath) {
  if (!fs.existsSync(leftPath) || !fs.existsSync(rightPath)) {
    return false;
  }
  const left = fs.readFileSync(leftPath);
  const right = fs.readFileSync(rightPath);
  return left.equals(right);
}

function ensureComponent(context) {
  const { sourcePath, destPath, label, kind } =
    normalizeComponentArgs(arguments);
  if (!fs.existsSync(sourcePath)) {
    console.log(
      `  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} ${label} — source missing`,
    );
    return;
  }

  const stat = lstatOrNull(destPath);
  if (stat) {
    if (!context.realWindows && stat.isSymbolicLink()) {
      const currentTarget = fs.readlinkSync(destPath);
      if (
        isSamePath(
          path.resolve(path.dirname(destPath), currentTarget),
          sourcePath,
        )
      ) {
        console.log(
          `  ${colorize(context.colorsEnabled, 'green', '[ok]')} ${label}`,
        );
        return;
      }
      removePath(destPath);
    } else if (context.realWindows && kind === 'dir' && stat.isSymbolicLink()) {
      removePath(destPath);
    } else {
      backupExistingPath(destPath, context);
    }
  }

  ensureManagedLink(context, sourcePath, destPath, kind);
  console.log(
    `  ${colorize(context.colorsEnabled, 'green', '[install]')} ${label}`,
  );
}

function refreshManagedComponent(context) {
  const { sourcePath, destPath, label, kind } =
    normalizeComponentArgs(arguments);
  if (!fs.existsSync(sourcePath)) {
    console.log(
      `  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} ${label} — source missing`,
    );
    return;
  }

  ensureManagedLink(context, sourcePath, destPath, kind);
  console.log(
    `  ${colorize(context.colorsEnabled, 'green', '[refresh]')} ${label}`,
  );
}

function normalizeComponentArgs(args) {
  if (typeof args[1] === 'object') {
    return args[1];
  }
  return {
    sourcePath: args[1],
    destPath: args[2],
    label: args[3],
    kind: args[4],
  };
}

export {
  backupExistingPath,
  buildSkillProfileList,
  colorize,
  createContext,
  ensureComponent,
  ensureDir,
  ensureManagedLink,
  fileContentsMatch,
  HOOKS_CONFIG_FILE,
  isRepoSymlink,
  isSamePath,
  joinCsv,
  lstatOrNull,
  parseArgs,
  REPO_DIR,
  readRetiredClaudePermissionAllow,
  readWindowsState,
  refreshManagedComponent,
  removePath,
  toBashPath,
  updateWindowsState,
};

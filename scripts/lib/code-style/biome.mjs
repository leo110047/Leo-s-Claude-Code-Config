import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repoRoot, run, ToolError } from './config.mjs';
import { JS_EXTENSIONS } from './constants.mjs';
import { advisory, violation } from './issues.mjs';

export function runBiome(files, issues, mode) {
  const jsFiles = files.filter((file) => JS_EXTENSIONS.has(path.extname(file)));
  if (jsFiles.length === 0) return;

  const configPath = path.join(repoRoot, 'biome.json');
  if (!fs.existsSync(configPath)) {
    issues.push(
      advisory(
        'biome-unconfigured',
        null,
        'Biome config not found in target repo; JS/TS Biome checks were skipped, zero-dependency checks still ran',
      ),
    );
    return;
  }

  const biome = resolveBiomeBinary();
  if (!biome) {
    issues.push(
      advisory(
        'biome-unavailable',
        null,
        'Biome not found; JS/TS lint and formatter checks were skipped, zero-dependency checks still ran',
      ),
    );
    return;
  }

  const workspace =
    mode === 'staged' ? materializeStagedWorkspace(jsFiles, configPath) : null;
  try {
    const filesToCheck = workspace ? workspace.files : jsFiles;
    if (filesToCheck.length === 0) return;

    const result = run(
      biome,
      biomeArgs(filesToCheck, workspace?.configPath ?? configPath),
      {
        cwd: workspace?.root ?? repoRoot,
        maxBuffer: 20 * 1024 * 1024,
      },
    );
    if (result.status === 0) return;
    if (result.error) {
      throw new ToolError('failed to execute Biome', result.error.message);
    }
    issues.push(violation('biome', null, biomeMessage(result)));
  } finally {
    if (workspace) {
      fs.rmSync(workspace.root, { force: true, recursive: true });
    }
  }
}

function biomeArgs(files, configPath) {
  return ['check', '--config-path', configPath, ...files];
}

function materializeStagedWorkspace(files, configPath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'goldband-style-biome-'));
  const stagedFiles = [];
  const tempConfigPath = path.join(root, 'biome.json');

  fs.writeFileSync(
    tempConfigPath,
    readStagedBlob('biome.json') ?? fs.readFileSync(configPath),
  );
  for (const file of files) {
    const stagedContent = readStagedBlob(file);
    if (!stagedContent) continue;

    const destination = path.join(root, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, stagedContent);
    stagedFiles.push(file);
  }

  return { configPath: tempConfigPath, files: stagedFiles, root };
}

function readStagedBlob(file) {
  const result = spawnSync('git', ['show', `:${file}`], {
    cwd: repoRoot,
    encoding: 'buffer',
    maxBuffer: 20 * 1024 * 1024,
  });
  return result.status === 0 ? result.stdout : null;
}

function biomeMessage(result) {
  return ['Biome check failed', result.stdout.trim(), result.stderr.trim()]
    .filter(Boolean)
    .join('\n');
}

function resolveBiomeBinary() {
  const local = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'biome.cmd' : 'biome',
  );
  if (fs.existsSync(local)) return local;
  const which = run(
    process.platform === 'win32' ? 'where' : 'which',
    ['biome'],
    { cwd: repoRoot },
  );
  const candidate =
    which.status === 0 ? which.stdout.split(/\r?\n/).find(Boolean) : null;
  return candidate ? candidate.trim() : null;
}

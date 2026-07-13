import fs from 'node:fs';
import path from 'node:path';

export function discoverRuntimeBinaries(loopDir) {
  const binDir = path.join(loopDir, 'bin');
  if (!fs.existsSync(binDir)) return [];

  return fs
    .readdirSync(binDir, { withFileTypes: true })
    .filter((entry) => !entry.name.endsWith('.ts'))
    .filter((entry) => {
      if (!entry.isFile() && !entry.isSymbolicLink()) return false;
      try {
        return Boolean(fs.statSync(path.join(binDir, entry.name)).mode & 0o111);
      } catch {
        return false;
      }
    })
    .map((entry) => entry.name)
    .sort();
}

export function discoverLegacyEntrypoints(loopDir) {
  if (!fs.existsSync(loopDir)) return ['plan'];

  const skills = fs
    .readdirSync(loopDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(loopDir, entry.name, 'SKILL.md')),
    )
    .map((entry) =>
      entry.name === 'goldband-upgrade' ? entry.name : `goldband-${entry.name}`,
    );

  return [...skills, 'plan'].sort();
}

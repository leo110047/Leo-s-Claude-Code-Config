import fs from 'node:fs';
import path from 'node:path';
import {
  buildSkillProfileList,
  colorize,
  ensureDir,
  ensureManagedLink,
  joinCsv,
  removePath,
} from './goldband-windows-core.mjs';

function readProfileFile(profilePath) {
  if (!fs.existsSync(profilePath)) {
    return null;
  }

  const lines = fs.readFileSync(profilePath, 'utf8').split(/\r?\n/);
  const data = {};
  for (const line of lines) {
    const index = line.indexOf('=');
    if (index <= 0) {
      continue;
    }
    data[line.slice(0, index)] = line.slice(index + 1);
  }
  return data;
}

function writeProfileFile(profilePath, profile, skills) {
  ensureDir(path.dirname(profilePath));
  const contents = [
    `profile=${profile}`,
    `installed_at=${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}`,
    `skills=${joinCsv(skills)}`,
    '',
  ].join('\n');
  fs.writeFileSync(profilePath, contents, 'utf8');
}

function currentManagedSkillNames(targetDir, knownSkillNames) {
  if (!fs.existsSync(targetDir)) {
    return [];
  }

  return fs
    .readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.name !== '.goldband-profile')
    .map((entry) => entry.name)
    .filter((name) => knownSkillNames.has(name));
}

function inferManagedProfile(context, tool, targetDir) {
  const known = new Set(skillCatalogLines(context).map((entry) => entry.name));
  const installed = currentManagedSkillNames(targetDir, known);
  if (installed.length === 0) {
    return null;
  }

  for (const profile of ['core', 'dev', 'full']) {
    const expected = buildSkillProfileList(context, tool, profile);
    const expectedSet = new Set(expected);
    if (
      installed.length === expected.length &&
      installed.every((name) => expectedSet.has(name))
    ) {
      return profile;
    }
  }

  for (const profile of ['core', 'dev', 'full']) {
    const expected = buildSkillProfileList(context, tool, profile);
    const expectedSet = new Set(expected);
    if (installed.every((name) => expectedSet.has(name))) {
      return profile;
    }
  }

  return null;
}

function cleanupManagedEntries(targetDir, profilePath, fallbackEntries = []) {
  const profile = readProfileFile(profilePath);
  const profileSkills = profile?.skills
    ? profile.skills
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)
    : [];

  const toRemove = [...new Set([...profileSkills, ...fallbackEntries])];
  for (const name of toRemove) {
    removePath(path.join(targetDir, name));
  }
  removePath(profilePath);
}

function installManagedSkillProfile(context) {
  const { tool, profile, targetDir, profilePath, extraEntries } =
    normalizeManagedProfileArgs(arguments);
  const selectedSkills = buildSkillProfileList(context, tool, profile);
  ensureDir(targetDir);
  cleanupManagedEntries(
    targetDir,
    profilePath,
    extraEntries.map((entry) => entry.destName),
  );

  let installed = 0;
  for (const skill of selectedSkills) {
    const sourceDir = path.join(context.repoDir, 'skills', 'global', skill);
    if (!fs.existsSync(sourceDir)) {
      console.log(
        `  ${colorize(context.colorsEnabled, 'yellow', '[skip]')} missing skill: ${skill}`,
      );
      continue;
    }
    ensureManagedLink(context, sourceDir, path.join(targetDir, skill), 'dir');
    installed += 1;
  }

  for (const entry of extraEntries) {
    ensureManagedLink(
      context,
      entry.sourcePath,
      path.join(targetDir, entry.destName),
      'file',
    );
  }

  writeProfileFile(profilePath, profile, selectedSkills);
  return installed;
}

function managedProfileNeedsSync(context) {
  const { tool, profile, targetDir, profilePath, extraEntries } =
    normalizeManagedProfileArgs(arguments);
  if (!fs.existsSync(targetDir)) {
    return true;
  }

  const desiredSkills = buildSkillProfileList(context, tool, profile);
  const profileData = readProfileFile(profilePath);
  const currentCsv = profileData?.skills ?? '';
  const desiredCsv = joinCsv(desiredSkills);
  if (currentCsv !== desiredCsv) {
    return true;
  }

  for (const skill of desiredSkills) {
    if (!fs.existsSync(path.join(targetDir, skill))) {
      return true;
    }
  }

  for (const entry of extraEntries) {
    if (!fs.existsSync(path.join(targetDir, entry.destName))) {
      return true;
    }
  }

  return false;
}

function syncExistingManagedProfile(context) {
  const { tool, targetDir, profilePath, extraEntries } =
    normalizeSyncProfileArgs(arguments);
  const profileData = readProfileFile(profilePath);
  let profile = profileData?.profile ?? null;

  if (!['core', 'dev', 'full'].includes(profile)) {
    profile = inferManagedProfile(context, tool, targetDir);
  }

  if (!profile) {
    return false;
  }

  if (
    !managedProfileNeedsSync(
      context,
      tool,
      profile,
      targetDir,
      profilePath,
      extraEntries,
    )
  ) {
    return false;
  }

  installManagedSkillProfile(
    context,
    tool,
    profile,
    targetDir,
    profilePath,
    extraEntries,
  );
  return true;
}

function normalizeManagedProfileArgs(args) {
  if (typeof args[1] === 'object') {
    return {
      ...args[1],
      extraEntries: args[1].extraEntries ?? [],
    };
  }
  return {
    tool: args[1],
    profile: args[2],
    targetDir: args[3],
    profilePath: args[4],
    extraEntries: args[5] ?? [],
  };
}

function normalizeSyncProfileArgs(args) {
  if (typeof args[1] === 'object') {
    return {
      ...args[1],
      extraEntries: args[1].extraEntries ?? [],
    };
  }
  return {
    tool: args[1],
    targetDir: args[2],
    profilePath: args[3],
    extraEntries: args[4] ?? [],
  };
}

export {
  cleanupManagedEntries,
  installManagedSkillProfile,
  readProfileFile,
  syncExistingManagedProfile,
};

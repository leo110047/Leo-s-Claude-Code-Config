#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SELF = fileURLToPath(import.meta.url);
const FIXTURE_ROOTS = [];

function readState(statePath) {
  return JSON.parse(fs.readFileSync(statePath, 'utf8'));
}

function writeState(statePath, state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

function resolveImage(state, reference) {
  if (state.images[reference]) return state.images[reference];
  if (state.imageIds.includes(reference)) return reference;
  return null;
}

function fakeParentPrune(state, args) {
  if (args.includes('--no-prune')) return;
  state.imageIds = state.imageIds.filter(
    (candidate) => !state.danglingParents.includes(candidate),
  );
}

function fakeImageList(state, args) {
  const filter = args[args.indexOf('--filter') + 1];
  const labelValue = filter.split('=').slice(2).join('=');
  const taggedImageIds = new Set(Object.values(state.images));
  const imageIds = state.imageIds.filter(
    (imageId) =>
      state.labels[imageId] === labelValue &&
      (args.includes('--all') || taggedImageIds.has(imageId)),
  );
  if (imageIds.length > 0) process.stdout.write(`${imageIds.join('\n')}\n`);
  return 0;
}

function fakeImageInspect(state, args) {
  const reference = args.at(-1);
  const imageId = resolveImage(state, reference);
  if (!imageId) return 1;
  const format = args[args.indexOf('--format') + 1];
  if (format?.includes('.Config.Labels')) {
    process.stdout.write(`${state.labels[imageId] || ''}\n`);
  } else if (format) {
    process.stdout.write(`${imageId}\n`);
  }
  return 0;
}

function fakeImageRemove(statePath, state, args) {
  const reference = args.at(-1);
  const imageId = resolveImage(state, reference);
  if (!imageId) return 1;
  fakeParentPrune(state, args);
  if (state.images[reference]) {
    delete state.images[reference];
  } else {
    const matchingTags = Object.entries(state.images).filter(
      ([, candidate]) => candidate === imageId,
    );
    if (matchingTags.length > 1) return 1;
    for (const [tag] of matchingTags) delete state.images[tag];
  }
  const remainingTags = Object.values(state.images).filter(
    (candidate) => candidate === imageId,
  );
  if (remainingTags.length === 0) {
    state.imageIds = state.imageIds.filter(
      (candidate) => candidate !== imageId,
    );
    delete state.labels[imageId];
  }
  state.events.push(`image-rm:${reference}`);
  writeState(statePath, state);
  return 0;
}

function fakeImageCommand(statePath, state, args) {
  const operation = args[0];
  if (operation === 'ls') return fakeImageList(state, args);
  if (operation === 'inspect') return fakeImageInspect(state, args);
  assert.equal(
    operation,
    'rm',
    `unexpected fake image operation: ${operation}`,
  );
  return fakeImageRemove(statePath, state, args);
}

function fakeTagCommand(statePath, state, args) {
  const [source, target] = args;
  const imageId = resolveImage(state, source);
  if (!imageId) return 1;
  state.images[target] = imageId;
  state.events.push(`tag:${source}:${target}`);
  writeState(statePath, state);
  return 0;
}

function fakeBuildCommand({ statePath, state, command, args, mode }) {
  const tagIndex = args.indexOf('-t');
  const labelIndex = args.indexOf('--label');
  assert.notEqual(tagIndex, -1, 'sandbox build must provide an image tag');
  assert.notEqual(
    labelIndex,
    -1,
    'sandbox build must provide an ownership label',
  );
  const tag = args[tagIndex + 1];
  const ownershipToken = args[labelIndex + 1].split('=').slice(1).join('=');
  state.buildCount += 1;
  const imageId = `sha256:test-${state.buildCount}`;
  state.images[tag] = imageId;
  if (!state.imageIds.includes(imageId)) state.imageIds.push(imageId);
  state.labels[imageId] = ownershipToken;
  state.lastBuildTag = tag;
  state.lastBuildImageId = imageId;
  state.events.push(`${command}:${tag}`);
  writeState(statePath, state);
  if (mode === 'failure-race') {
    replaceBuildTagWithForeignImage(state);
    writeState(statePath, state);
    return 17;
  }
  if (mode === 'failure') return 17;
  if (mode === 'term') {
    process.kill(process.ppid, 'SIGTERM');
    return 143;
  }
  if (mode === 'int') {
    process.kill(process.ppid, 'SIGINT');
    return 130;
  }
  return 0;
}

function replaceBuildTagWithForeignImage(state) {
  state.images[state.lastBuildTag] = 'sha256:foreign';
  if (!state.imageIds.includes('sha256:foreign')) {
    state.imageIds.push('sha256:foreign');
  }
  state.events.push(`foreign-retag:${state.lastBuildTag}`);
}

function fakeRunCommand(statePath, state, args, mode) {
  state.runCount += 1;
  const mountIndex = args.indexOf('-v');
  assert.notEqual(mountIndex, -1, 'sandbox run must mount a project');
  const projectDir = args[mountIndex + 1].split(':')[0];
  const invocation = args.join(' ');
  if (state.runCount === 1) {
    fs.writeFileSync(path.join(projectDir, 'container-write.txt'), 'ok\n');
  }
  if (invocation.includes('launcher-ok')) {
    fs.writeFileSync(path.join(projectDir, 'launcher.txt'), 'launcher-ok');
  }
  if (invocation.includes('quoted-arg.txt')) {
    fs.writeFileSync(path.join(projectDir, 'quoted-arg.txt'), 'a b\n');
  }
  state.events.push('run');
  if (mode === 'success-race' && state.runCount === 3) {
    replaceBuildTagWithForeignImage(state);
  }
  writeState(statePath, state);
  return 0;
}

function fakeRuntime(argv) {
  const statePath = process.env.FAKE_SANDBOX_STATE;
  const mode = process.env.FAKE_SANDBOX_MODE || 'success';
  if (!statePath) throw new Error('FAKE_SANDBOX_STATE is required');
  const state = readState(statePath);
  const [command, ...args] = argv;
  if (command === 'image') return fakeImageCommand(statePath, state, args);
  if (command === 'tag') return fakeTagCommand(statePath, state, args);
  if (command === 'run') return fakeRunCommand(statePath, state, args, mode);
  if (command === 'build' || (command === 'buildx' && args[0] === 'build')) {
    return fakeBuildCommand({ statePath, state, command, args, mode });
  }
  throw new Error(`unexpected fake runtime invocation: ${argv.join(' ')}`);
}

function initialState(images = {}) {
  return {
    images,
    imageIds: [
      ...new Set([
        'sha256:unrelated',
        'sha256:unrelated-parent',
        ...Object.values(images),
      ]),
    ],
    labels: {},
    danglingParents: ['sha256:unrelated-parent'],
    containers: ['keep-container'],
    volumes: ['keep-volume'],
    buildCache: ['keep-cache'],
    buildCount: 0,
    runCount: 0,
    events: [],
  };
}

function createFixture({ images = {}, runtimeName = 'docker' } = {}) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'goldband-sandbox-lifecycle-'),
  );
  FIXTURE_ROOTS.push(root);
  const binDir = path.join(root, 'bin');
  const statePath = path.join(root, 'state.json');
  fs.mkdirSync(binDir);
  const runtimePath = path.join(binDir, runtimeName);
  fs.writeFileSync(
    runtimePath,
    `#!/bin/sh\nexec "${process.execPath}" "${SELF}" --fake-runtime "$@"\n`,
    { mode: 0o755 },
  );
  writeState(statePath, initialState(images));
  return { root, binDir, statePath, runtimeName };
}

function runSandbox(fixture, { mode = 'success', image, buildx = false } = {}) {
  const env = {
    ...process.env,
    PATH: `${fixture.binDir}:${process.env.PATH}`,
    GOLDBAND_SANDBOX_RUNTIME: fixture.runtimeName,
    GOLDBAND_SANDBOX_TMPDIR: fixture.root,
    FAKE_SANDBOX_STATE: fixture.statePath,
    FAKE_SANDBOX_MODE: mode,
  };
  if (image) env.GOLDBAND_SANDBOX_IMAGE = image;
  if (buildx) env.GOLDBAND_SANDBOX_USE_BUILDX = '1';
  return spawnSync('bash', ['scripts/test-sandbox.sh'], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function assertUnrelatedStatePreserved(state) {
  assert.equal(state.images['unrelated:keep'], 'sha256:unrelated');
  assert.ok(state.imageIds.includes('sha256:unrelated-parent'));
  assert.deepEqual(state.containers, ['keep-container']);
  assert.deepEqual(state.volumes, ['keep-volume']);
  assert.deepEqual(state.buildCache, ['keep-cache']);
  const removals = state.events.filter((event) =>
    event.startsWith('image-rm:'),
  );
  assert.ok(removals.length > 0);
  assert.ok(
    removals.every((event) => event.startsWith('image-rm:sha256:test-')),
  );
}

function runDefaultSuccessTest(runtimeName, buildx = false) {
  const fixture = createFixture({
    images: { 'unrelated:keep': 'sha256:unrelated' },
    runtimeName,
  });
  const result = runSandbox(fixture, { buildx });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = readState(fixture.statePath);
  assert.equal(
    Object.keys(state.images).some((tag) =>
      tag.startsWith('goldband-sandbox:test-'),
    ),
    false,
  );
  assert.equal(
    state.imageIds.some((id) => id.startsWith('sha256:test-')),
    false,
  );
  assertUnrelatedStatePreserved(state);
  if (buildx)
    assert.ok(state.events.some((event) => event.startsWith('buildx:')));
}

function runFailureOrSignalTest(mode, expectedStatus) {
  const fixture = createFixture({
    images: { 'unrelated:keep': 'sha256:unrelated' },
  });
  const result = runSandbox(fixture, { mode });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  const state = readState(fixture.statePath);
  assert.equal(
    state.imageIds.some((id) => id.startsWith('sha256:test-')),
    false,
  );
  assertUnrelatedStatePreserved(state);
}

function runPreexistingOverrideTest() {
  const fixture = createFixture({
    images: {
      'custom:test': 'sha256:preexisting',
      'unrelated:keep': 'sha256:unrelated',
    },
  });
  const result = runSandbox(fixture, { image: 'custom:test' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = readState(fixture.statePath);
  assert.equal(state.images['custom:test'], 'sha256:preexisting');
  assert.ok(state.imageIds.includes('sha256:preexisting'));
  assert.equal(
    state.imageIds.some((id) => id.startsWith('sha256:test-')),
    false,
  );
  assertUnrelatedStatePreserved(state);
}

function runNewOverrideTest() {
  const fixture = createFixture({
    images: { 'unrelated:keep': 'sha256:unrelated' },
  });
  const result = runSandbox(fixture, { image: 'custom:new' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const state = readState(fixture.statePath);
  assert.equal(state.images['custom:new'], undefined);
  assert.equal(
    state.imageIds.some((id) => id.startsWith('sha256:test-')),
    false,
  );
  assertUnrelatedStatePreserved(state);
}

function runConcurrentRetagTest(mode, expectedStatus) {
  const fixture = createFixture({
    images: { 'unrelated:keep': 'sha256:unrelated' },
  });
  const result = runSandbox(fixture, { mode });
  assert.equal(result.status, expectedStatus, result.stderr || result.stdout);
  const state = readState(fixture.statePath);
  assert.equal(
    state.imageIds.some((id) => id.startsWith('sha256:test-')),
    false,
  );
  assert.ok(state.imageIds.includes('sha256:foreign'));
  assert.equal(state.images[state.lastBuildTag], 'sha256:foreign');
  assertUnrelatedStatePreserved(state);
}

function main() {
  try {
    runDefaultSuccessTest('docker', true);
    runDefaultSuccessTest('podman');
    runFailureOrSignalTest('failure', 17);
    runFailureOrSignalTest('int', 130);
    runFailureOrSignalTest('term', 143);
    runPreexistingOverrideTest();
    runNewOverrideTest();
    runConcurrentRetagTest('failure-race', 17);
    runConcurrentRetagTest('success-race', 0);
    console.log('[OK] sandbox test image lifecycle verified');
  } finally {
    for (const fixtureRoot of FIXTURE_ROOTS) {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[2] === '--fake-runtime') {
  process.exitCode = fakeRuntime(process.argv.slice(3));
} else {
  main();
}

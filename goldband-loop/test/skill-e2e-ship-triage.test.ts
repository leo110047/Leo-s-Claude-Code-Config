import { afterAll, beforeAll, expect } from 'bun:test';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { runSkillTest } from './helpers/session-runner';
import {
  createEvalCollector,
  describeIfSelected,
  finalizeEvalCollector,
  logCost,
  recordE2E,
  ROOT,
  runId,
  testIfSelected,
} from './helpers/e2e-helpers';

const evalCollector = createEvalCollector('ship-triage');
let triageDir: string;

describeIfSelected('Test Failure Triage E2E', ['ship-triage'], () => {
  beforeAll(() => {
    triageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-e2e-triage-'));
    fs.cpSync(path.join(ROOT, 'ship'), path.join(triageDir, 'ship'), {
      recursive: true,
    });

    const run = (command: string, args: string[]) =>
      spawnSync(command, args, { cwd: triageDir, stdio: 'pipe', timeout: 5_000 });
    run('git', ['init', '-b', 'main']);
    run('git', ['config', 'user.email', 'test@test.com']);
    run('git', ['config', 'user.name', 'Test']);

    fs.writeFileSync(
      path.join(triageDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node test/run.js' } }),
    );
    fs.mkdirSync(path.join(triageDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(triageDir, 'test'), { recursive: true });
    fs.writeFileSync(
      path.join(triageDir, 'src/math.js'),
      'exports.divide = (a, b) => a / b;\n',
    );
    fs.writeFileSync(
      path.join(triageDir, 'test/math.test.js'),
      "const {divide}=require('../src/math'); if(divide(10,0)===Infinity){console.error('FAIL: divide');process.exit(1)}\n",
    );
    fs.writeFileSync(
      path.join(triageDir, 'test/run.js'),
      "const{spawnSync}=require('child_process');let failed=0;for(const f of ['math.test.js','string.test.js']){if(spawnSync(process.execPath,[require('path').join(__dirname,f)],{stdio:'inherit'}).status)failed++}process.exit(failed?1:0)\n",
    );
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'initial']);
    run('git', ['checkout', '-b', 'feature/string-utils']);
    fs.writeFileSync(
      path.join(triageDir, 'src/string.js'),
      'exports.truncate = (s, len) => s.substring(0, len);\n',
    );
    fs.writeFileSync(
      path.join(triageDir, 'test/string.test.js'),
      "const {truncate}=require('../src/string'); try{truncate(null,5)}catch(e){console.error('FAIL: truncate');process.exit(1)}\n",
    );
    run('git', ['add', '.']);
    run('git', ['commit', '-m', 'feat: add string utilities']);
  });

  afterAll(() => {
    fs.rmSync(triageDir, { recursive: true, force: true });
  });

  testIfSelected('ship-triage', async () => {
    const result = await runSkillTest({
      prompt: `Read ship/SKILL.md and run only its test-failure ownership triage.
Run node test/run.js. Compare main...HEAD. Classify each failure as IN-BRANCH or PRE-EXISTING and name the failing function. Do not fix files or ship.`,
      workingDirectory: triageDir,
      maxTurns: 20,
      allowedTools: ['Bash', 'Read', 'Glob', 'Grep'],
      timeout: 180_000,
      testName: 'ship-triage',
      runId,
    });

    logCost('/ship triage', result);
    const output = result.output.toLowerCase();
    const passed =
      result.exitReason === 'success' &&
      /in.?branch|introduced/.test(output) &&
      /pre.?existing|existed before/.test(output) &&
      output.includes('truncate') &&
      output.includes('divide');
    recordE2E(evalCollector, '/ship triage', 'Test Failure Triage E2E', result, {
      passed,
    });
    expect(passed).toBe(true);
  }, 240_000);
});

afterAll(async () => {
  await finalizeEvalCollector(evalCollector);
});

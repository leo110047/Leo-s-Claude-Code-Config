#!/usr/bin/env bun
import { chromium } from 'playwright';
import { superviseCommand } from './process-supervisor.mjs';

const DEFAULT_TIMEOUT_MS = 30_000;

type ProbeOptions = {
  timeoutMs: number;
  simulateHang: boolean;
  worker: boolean;
};

async function runWorker(simulateHang: boolean): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  if (simulateHang) {
    browser.removeAllListeners('disconnected');
    process.stdout.write('[browser-close-probe] simulated close hang started\n');
    await new Promise(() => {});
  }
  await browser.close();
  process.stdout.write('[browser-close-probe] browser close confirmed\n');
}

async function main(): Promise<number> {
  const options = parseOptions(process.argv.slice(2));
  if (options.worker) {
    await runWorker(options.simulateHang);
    return 0;
  }

  const result = await superviseCommand(process.execPath, [
    'run',
    import.meta.path,
    '--worker',
    ...(options.simulateHang ? ['--simulate-hang'] : []),
  ], {
    timeoutMs: options.timeoutMs,
    label: 'browser close probe',
  });
  return result.exitCode;
}

function parseOptions(args: string[]): ProbeOptions {
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  let simulateHang = false;
  let worker = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--simulate-hang') {
      simulateHang = true;
      continue;
    }
    if (arg === '--worker') {
      worker = true;
      continue;
    }
    if (arg === '--timeout-ms') {
      const value = Number.parseInt(args[index + 1] || '', 10);
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error('--timeout-ms requires a positive integer');
      }
      timeoutMs = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown browser close probe argument: ${arg}`);
  }
  return { timeoutMs, simulateHang, worker };
}

if (import.meta.main) {
  process.exitCode = await main();
}

import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_KILL_GRACE_MS = 2_000;
const DEFAULT_KILL_CONFIRM_MS = 2_000;
const KILL_CONFIRM_POLL_MS = 10;

export function superviseCommand(command, args, options = {}) {
  return new ProcessSupervisor(command, args, normalizeOptions(options)).run();
}

class ProcessSupervisor {
  constructor(command, args, options) {
    this.command = command;
    this.args = args;
    this.options = options;
    this.completed = false;
    this.shutdownReason = null;
    this.shutdownExitCode = null;
    this.forceKillSent = false;
    this.outputTail = '';
    this.capturedStdout = options.captureOutput
      ? new BoundedOutputTail(options.captureOutput.stdoutMaxBytes)
      : null;
    this.capturedStderr = options.captureOutput
      ? new BoundedOutputTail(options.captureOutput.stderrMaxBytes)
      : null;
    this.useProcessGroup = process.platform !== 'win32';
    this.onSigint = () => this.terminate('signal', 130, 'received SIGINT');
    this.onSigterm = () => this.terminate('signal', 143, 'received SIGTERM');
    this.onSighup = () => this.terminate('signal', 129, 'received SIGHUP');
  }

  run() {
    return new Promise((resolve) => {
      this.resolve = resolve;
      this.installSignalHandlers();
      if (!this.spawnChild()) return;
      this.attachChildHandlers();
      this.writeInput();
      this.timeoutTimer = setTimeout(
        () =>
          this.terminate(
            'timeout',
            124,
            `wall-clock timeout exceeded (${this.options.timeoutMs}ms)`,
          ),
        this.options.timeoutMs,
      );
    });
  }

  spawnChild() {
    try {
      this.child = spawn(this.command, this.args, {
        cwd: this.options.cwd,
        env: this.options.env,
        stdio: this.options.stdio,
        detached: this.useProcessGroup,
      });
      return true;
    } catch (error) {
      this.writeStderr(
        `[${this.options.label}] failed to start ${this.command}: ${error.message}\n`,
      );
      this.finish(1, 'spawn-error');
      return false;
    }
  }

  attachChildHandlers() {
    this.child.once('error', (error) => {
      this.writeStderr(
        `[${this.options.label}] failed to run ${this.command}: ${error.message}\n`,
      );
      this.finish(1, 'spawn-error');
    });
    this.forwardAndInspect(this.child.stdout, this.options.stdout, 'stdout');
    this.forwardAndInspect(this.child.stderr, this.options.stderr, 'stderr');
    this.child.once('exit', (_code, signal) => {
      this.childExitSignal = signal;
    });
    this.child.once('close', (code, signal) =>
      this.handleChildClose(code, signal),
    );
  }

  writeInput() {
    if (this.options.input === undefined) return;
    if (!this.child.stdin) {
      this.writeStderr(
        `[${this.options.label}] stdin transport was requested but the child has no writable stdin\n`,
      );
      this.terminate('spawn-error', 1, 'stdin transport unavailable');
      return;
    }
    this.child.stdin.on('error', (error) => {
      if (error?.code !== 'EPIPE') {
        this.writeStderr(
          `[${this.options.label}] failed to write child stdin: ${error.message}\n`,
        );
      }
    });
    this.child.stdin.end(this.options.input);
  }

  forwardAndInspect(stream, destination, channel) {
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      destination.write(chunk);
      if (this.options.captureOutput) {
        if (channel === 'stdout') this.capturedStdout.append(chunk);
        else this.capturedStderr.append(chunk);
      }
      if (!this.shouldInspectCompletion()) return;
      this.outputTail = `${this.outputTail}${chunk}`.slice(-16_384);
      this.options.completionPattern.lastIndex = 0;
      if (!this.options.completionPattern.test(this.outputTail)) return;
      this.completionTimer = setTimeout(
        () => this.terminateCompletionStall(),
        this.options.completionExitGraceMs,
      );
    });
  }

  shouldInspectCompletion() {
    return Boolean(
      this.options.completionPattern &&
        !this.completionTimer &&
        !this.shutdownReason,
    );
  }

  terminateCompletionStall() {
    this.terminate(
      'completion-stall',
      126,
      `test summary was emitted but the process did not exit within ${this.options.completionExitGraceMs}ms`,
    );
  }

  terminate(reason, exitCode, message) {
    if (this.completed || this.shutdownReason) return;
    this.shutdownReason = reason;
    this.shutdownExitCode = exitCode;
    this.writeStderr(
      `[${this.options.label}] ${message}; stopping the complete process tree\n`,
    );
    signalTree(this.child, 'SIGTERM', this.useProcessGroup);
    this.killTimer = setTimeout(
      () => this.forceKillRemainingTree(),
      this.options.killGraceMs,
    );
  }

  handleChildClose(code, signal) {
    if (!this.shutdownReason) {
      const exitCode = code ?? signalExitCode(signal);
      if (processTreeExists(this.child, this.useProcessGroup)) {
        this.terminate(
          'exit',
          exitCode,
          'root process exited while descendants were still running',
        );
        return;
      }
      this.finish(exitCode, 'exit', signal);
      return;
    }
    this.childExitSignal = signal;
    if (
      processTreeExists(this.child, this.useProcessGroup)
    ) {
      if (this.forceKillSent) this.waitForForcedCleanup();
      return;
    }
    this.finishShutdown(signal);
  }

  forceKillRemainingTree() {
    if (this.completed) return;
    this.forceKillSent = true;
    if (processTreeExists(this.child, this.useProcessGroup)) {
      this.writeStderr(
        `[${this.options.label}] process tree did not exit within ${this.options.killGraceMs}ms; sending SIGKILL\n`,
      );
      signalTree(this.child, 'SIGKILL', this.useProcessGroup);
    }
    this.waitForForcedCleanup();
  }

  waitForForcedCleanup() {
    if (this.completed || this.cleanupTimer) return;
    if (!processTreeExists(this.child, this.useProcessGroup)) {
      this.finishShutdown();
      return;
    }

    this.cleanupDeadline ??= Date.now() + this.options.killConfirmMs;
    if (Date.now() >= this.cleanupDeadline) {
      this.writeStderr(
        `[${this.options.label}] process tree still exists ${this.options.killConfirmMs}ms after SIGKILL; cleanup could not be confirmed\n`,
      );
      this.finish(
        125,
        'cleanup-failed',
        this.childExitSignal ?? this.child.signalCode,
      );
      return;
    }

    this.cleanupTimer = setTimeout(() => {
      this.cleanupTimer = null;
      this.waitForForcedCleanup();
    }, Math.min(KILL_CONFIRM_POLL_MS, this.cleanupDeadline - Date.now()));
  }

  finishShutdown(signal = this.childExitSignal ?? this.child.signalCode) {
    this.finish(this.shutdownExitCode, this.shutdownReason, signal);
  }

  installSignalHandlers() {
    process.on('SIGINT', this.onSigint);
    process.on('SIGTERM', this.onSigterm);
    process.on('SIGHUP', this.onSighup);
  }

  finish(exitCode, reason, signal = null) {
    if (this.completed) return;
    this.completed = true;
    this.cleanup();
    const result = { exitCode, reason, signal };
    if (this.options.captureOutput) {
      result.stdout = this.capturedStdout.text();
      result.stderr = this.capturedStderr.text();
      result.stdoutTruncated = this.capturedStdout.truncated;
      result.stderrTruncated = this.capturedStderr.truncated;
      result.forceKilled = this.forceKillSent;
    }
    this.resolve(result);
  }

  writeStderr(message) {
    this.options.stderr.write(message);
    if (this.options.captureOutput) this.capturedStderr.append(message);
  }

  cleanup() {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.completionTimer) clearTimeout(this.completionTimer);
    if (this.killTimer) clearTimeout(this.killTimer);
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    process.off('SIGINT', this.onSigint);
    process.off('SIGTERM', this.onSigterm);
    process.off('SIGHUP', this.onSighup);
  }
}

function normalizeOptions(options) {
  const completionPattern = options.completionPattern ?? null;
  const input = options.input;
  if (input !== undefined && typeof input !== 'string' && !Buffer.isBuffer(input)) {
    throw new Error('input must be a string or Buffer');
  }
  return {
    timeoutMs: positiveInteger(options.timeoutMs, 'timeoutMs'),
    killGraceMs: nonNegativeInteger(
      options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      'killGraceMs',
    ),
    killConfirmMs: nonNegativeInteger(
      options.killConfirmMs ?? DEFAULT_KILL_CONFIRM_MS,
      'killConfirmMs',
    ),
    completionPattern,
    completionExitGraceMs: nonNegativeInteger(
      options.completionExitGraceMs ?? 5_000,
      'completionExitGraceMs',
    ),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    captureOutput: normalizeCaptureOutput(options.captureOutput),
    label: options.label ?? 'goldband eval',
    stderr: options.stderr ?? process.stderr,
    stdout: options.stdout ?? process.stdout,
    input,
    stdio:
      options.stdio ??
      (completionPattern || options.captureOutput
        ? [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe']
        : input === undefined
          ? 'inherit'
          : ['pipe', 'inherit', 'inherit']),
  };
}

class BoundedOutputTail {
  constructor(maxBytes) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
    this.truncated = false;
  }

  append(chunk) {
    const incoming = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (incoming.length >= this.maxBytes) {
      const discardedExistingOutput = this.buffer.length > 0;
      this.buffer = Buffer.from(incoming.subarray(incoming.length - this.maxBytes));
      this.truncated = this.truncated || discardedExistingOutput ||
        incoming.length > this.maxBytes;
      return;
    }

    const combinedBytes = this.buffer.length + incoming.length;
    if (combinedBytes > this.maxBytes) {
      const retainedBytes = this.maxBytes - incoming.length;
      this.buffer = Buffer.concat([
        this.buffer.subarray(this.buffer.length - retainedBytes),
        incoming,
      ], this.maxBytes);
      this.truncated = true;
      return;
    }

    this.buffer = Buffer.concat([this.buffer, incoming], combinedBytes);
  }

  text() {
    let start = 0;
    while (
      start < this.buffer.length &&
      (this.buffer[start] & 0xc0) === 0x80
    ) {
      start += 1;
    }
    return this.buffer.subarray(start).toString('utf8');
  }
}

function normalizeCaptureOutput(value) {
  if (value === undefined || value === false) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      'captureOutput requires explicit stdoutMaxBytes and stderrMaxBytes limits',
    );
  }
  return {
    stdoutMaxBytes: positiveInteger(
      value.stdoutMaxBytes,
      'captureOutput.stdoutMaxBytes',
    ),
    stderrMaxBytes: positiveInteger(
      value.stderrMaxBytes,
      'captureOutput.stderrMaxBytes',
    ),
  };
}

function signalTree(child, signal, useProcessGroup) {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', [
      '/PID',
      String(child.pid),
      '/T',
      ...(signal === 'SIGKILL' ? ['/F'] : []),
    ]);
    return;
  }
  try {
    process.kill(useProcessGroup ? -child.pid : child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function processTreeExists(child, useProcessGroup) {
  if (!child?.pid) return false;
  if (process.platform === 'win32') {
    return child.exitCode === null && child.signalCode === null;
  }
  try {
    process.kill(useProcessGroup ? -child.pid : child.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === 'ESRCH') return false;
    return true;
  }
}

function signalExitCode(signal) {
  if (signal === 'SIGINT') return 130;
  if (signal === 'SIGHUP') return 129;
  if (signal === 'SIGTERM') return 143;
  if (signal === 'SIGKILL') return 137;
  return 1;
}

function positiveInteger(value, name) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function nonNegativeInteger(value, name) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

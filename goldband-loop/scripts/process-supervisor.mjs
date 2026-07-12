import { spawn, spawnSync } from 'node:child_process';

const DEFAULT_KILL_GRACE_MS = 2_000;

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
    this.capturedStdout = '';
    this.capturedStderr = '';
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

  forwardAndInspect(stream, destination, channel) {
    if (!stream) return;
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      destination.write(chunk);
      if (this.options.captureOutput) {
        if (channel === 'stdout') this.capturedStdout += chunk;
        else this.capturedStderr += chunk;
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
      !this.forceKillSent &&
      processTreeExists(this.child, this.useProcessGroup)
    ) {
      return;
    }
    this.finish(this.shutdownExitCode, this.shutdownReason, signal);
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
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      this.finish(
        this.shutdownExitCode,
        this.shutdownReason,
        this.childExitSignal ?? this.child.signalCode,
      );
    }
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
      result.stdout = this.capturedStdout;
      result.stderr = this.capturedStderr;
      result.forceKilled = this.forceKillSent;
    }
    this.resolve(result);
  }

  writeStderr(message) {
    this.options.stderr.write(message);
    if (this.options.captureOutput) this.capturedStderr += message;
  }

  cleanup() {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    if (this.completionTimer) clearTimeout(this.completionTimer);
    if (this.killTimer) clearTimeout(this.killTimer);
    process.off('SIGINT', this.onSigint);
    process.off('SIGTERM', this.onSigterm);
    process.off('SIGHUP', this.onSighup);
  }
}

function normalizeOptions(options) {
  const completionPattern = options.completionPattern ?? null;
  return {
    timeoutMs: positiveInteger(options.timeoutMs, 'timeoutMs'),
    killGraceMs: nonNegativeInteger(
      options.killGraceMs ?? DEFAULT_KILL_GRACE_MS,
      'killGraceMs',
    ),
    completionPattern,
    completionExitGraceMs: nonNegativeInteger(
      options.completionExitGraceMs ?? 5_000,
      'completionExitGraceMs',
    ),
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    captureOutput: Boolean(options.captureOutput),
    label: options.label ?? 'goldband eval',
    stderr: options.stderr ?? process.stderr,
    stdout: options.stdout ?? process.stdout,
    stdio:
      options.stdio ??
      (completionPattern || options.captureOutput
        ? ['ignore', 'pipe', 'pipe']
        : 'inherit'),
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

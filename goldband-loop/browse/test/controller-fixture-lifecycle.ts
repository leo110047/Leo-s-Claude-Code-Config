import * as net from 'node:net';
import {
  readControllerStateResult,
  type ControllerState,
} from '../src/controller-state';
import {
  probeProcessLiveness,
  readProcessStartTime,
} from '../src/error-handling';

const TERM_GRACE_MS = 500;
const KILL_CONFIRM_MS = 2_000;
const POLL_MS = 20;

export async function cleanupControllerFixture(
  stateFile: string,
  allowedServerPaths: ReadonlySet<string>,
): Promise<ControllerState | null> {
  const result = readControllerStateResult(stateFile);
  if (result.status === 'missing') return null;
  if (result.status !== 'valid') {
    throw new Error(`controller fixture state is ${result.status}: ${stateFile}`);
  }

  const state = result.state;
  if (!allowedServerPaths.has(state.serverPath)) return null;
  if (!state.processStartTime) {
    throw new Error(`controller fixture ${state.pid} has no stable process identity`);
  }

  const initial = controllerIdentity(state);
  if (initial === 'mismatch' || initial === 'unknown') {
    throw new Error(`controller fixture ${state.pid} identity is ${initial}; refusing to signal`);
  }
  if (initial === 'match') {
    signalOwnedProcess(state, 'SIGTERM');
  }

  if (await waitForControllerAbsence(state, TERM_GRACE_MS)) return state;
  if (controllerIdentity(state) !== 'match') {
    throw new Error(`controller fixture ${state.pid} identity changed before SIGKILL`);
  }
  signalOwnedProcess(state, 'SIGKILL');

  if (!await waitForControllerAbsence(state, KILL_CONFIRM_MS)) {
    throw new Error(
      `controller fixture cleanup could not confirm PID ${state.pid} and port ${state.port} are absent`,
    );
  }
  return state;
}

export async function waitForControllerAbsence(
  state: Pick<ControllerState, 'pid' | 'port'>,
  timeoutMs = KILL_CONFIRM_MS,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  do {
    const pidAbsent = probeProcessLiveness(state.pid) === 'dead';
    const portAbsent = !await isPortListening(state.port);
    if (pidAbsent && portAbsent) return true;
    if (Date.now() >= deadline) return false;
    await Bun.sleep(Math.min(POLL_MS, deadline - Date.now()));
  } while (true);
}

function controllerIdentity(state: ControllerState): 'match' | 'mismatch' | 'dead' | 'unknown' {
  const liveness = probeProcessLiveness(state.pid);
  if (liveness === 'dead') return 'dead';
  if (liveness === 'unknown') return 'unknown';
  const currentStartTime = readProcessStartTime(state.pid);
  if (!currentStartTime) return 'unknown';
  return currentStartTime === state.processStartTime ? 'match' : 'mismatch';
}

function signalOwnedProcess(state: ControllerState, signal: NodeJS.Signals): void {
  try {
    process.kill(state.pid, signal);
  } catch (error: any) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (listening: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(listening);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(100, () => finish(false));
  });
}

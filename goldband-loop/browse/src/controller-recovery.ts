import * as fs from 'fs';
import { cleanSingletonLocks, resolveChromiumProfile } from './config';
import {
  decideControllerTransition,
  inspectControllerState,
  readControllerState,
  type ControllerInspection,
  type ControllerState,
} from './controller-state';
import { cleanupXvfbStrict } from './xvfb';

export function unavailableControllerError(inspection: ControllerInspection): Error {
  return new Error(
    `Existing controller ownership is ${inspection.status} `
    + `(health=${inspection.health}, pid=${inspection.liveness}). State preserved. `
    + 'Retry from a host lane with localhost and process-control access.',
  );
}

export async function prepareControllerReplacementResources(
  state: ControllerState,
  chromiumProfile = resolveChromiumProfile(),
): Promise<void> {
  const hasXvfbRecord = state.xvfbPid !== undefined
    || state.xvfbStartTime !== undefined
    || state.xvfbDisplay !== undefined;
  if (hasXvfbRecord) {
    if (!state.xvfbPid || !state.xvfbStartTime) {
      throw new Error('Recorded Xvfb identity is incomplete; state preserved before replacement.');
    }
    await cleanupXvfbStrict({
      pid: state.xvfbPid,
      startTime: state.xvfbStartTime,
      display: state.xvfbDisplay || ':99',
    });
  }
  if (state.mode === 'headed') cleanSingletonLocks(chromiumProfile);
}

/** Must be called while the canonical controller startup lock is held. */
export async function prepareControllerStateForClaim(
  stateFile: string,
  chromiumProfile = resolveChromiumProfile(),
): Promise<void> {
  const current = readControllerState(stateFile);
  if (!current) {
    if (fs.existsSync(stateFile)) {
      throw new Error('Existing browse.json is malformed; state preserved for manual inspection.');
    }
    return;
  }
  const inspection = await inspectControllerState(current);
  if (decideControllerTransition(inspection) !== 'replace') {
    throw unavailableControllerError(inspection);
  }
  await prepareControllerReplacementResources(current, chromiumProfile);
}

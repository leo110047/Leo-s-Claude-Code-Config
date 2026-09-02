import {
  claimControllerState,
  controllerOwner,
  removeOwnedControllerState,
  updateOwnedControllerState,
  type ControllerState,
} from '../../src/controller-state';
import { readProcessStartTime } from '../../src/error-handling';

const stateFile = process.env.BROWSE_STATE_FILE;
const instanceId = process.env.BROWSE_INSTANCE_ID;
if (!stateFile || !instanceId) throw new Error('fixture requires BROWSE_STATE_FILE and BROWSE_INSTANCE_ID');

const listener = Bun.serve({
  port: 0,
  hostname: '127.0.0.1',
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return Response.json({ status: 'healthy', instanceId });
    }
    if (url.pathname === '/command') {
      request.json().then((body: any) => {
        if (body?.command === 'stop' || body?.command === 'disconnect') {
          setTimeout(shutdown, 10);
        }
      }).catch(() => {});
      return Response.json({ instanceId, pid: process.pid, port: listener.port });
    }
    return new Response('not found', { status: 404 });
  },
});

const startingState: ControllerState = {
  pid: process.pid,
  port: listener.port,
  token: `fixture-token-${instanceId}`,
  startedAt: new Date().toISOString(),
  serverPath: import.meta.path,
  instanceId,
  processStartTime: readProcessStartTime(process.pid),
  phase: 'starting',
  mode: process.env.BROWSE_HEADED === '1' ? 'headed' : 'launched',
};

const claim = await claimControllerState(stateFile, startingState);
if (claim.outcome !== 'claimed') {
  listener.stop(true);
  throw new Error(`fixture claim refused: ${claim.reason}`);
}
const owner = controllerOwner(startingState);
if (!updateOwnedControllerState(stateFile, owner, (current) => ({ ...current, phase: 'ready' }))) {
  listener.stop(true);
  throw new Error('fixture lost ownership before ready');
}

function shutdown(): void {
  listener.stop(true);
  removeOwnedControllerState(stateFile, owner);
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
setInterval(() => {}, 60_000);

const OPERATION_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;
const MODE_PATTERN = /^[a-z][a-z0-9-]*$/;
const ENFORCEMENTS = new Set(['blocked-before-runtime', 'runtime-owner']);
const AUTHORIZATIONS = new Set([
  'native-host-approval',
  'not-required-read-only',
]);

export function collectSafetyGates(capabilities) {
  return capabilities.flatMap((capability) =>
    capability.actions.flatMap((action) =>
      (action.safetyGates ?? []).map((gate) => ({
        ...gate,
        action: `${capability.id}/${action.id}`,
        owner: gate.owner ?? null,
      })),
    ),
  );
}

export function validateSafetyGates(capabilities) {
  const activeActions = new Set(
    actionRecords(capabilities).map(({ actionName }) => actionName),
  );
  const seenOperations = new Set();
  for (const { actionName, action } of actionRecords(capabilities)) {
    validateActionSafetyGates(
      actionName,
      action,
      activeActions,
      seenOperations,
    );
  }
}

function actionRecords(capabilities) {
  return capabilities.flatMap((capability) =>
    capability.actions.map((action) => ({
      actionName: `${capability.id}/${action.id}`,
      action,
    })),
  );
}

function validateActionSafetyGates(
  actionName,
  action,
  activeActions,
  seenOperations,
) {
  const gates = action.safetyGates ?? [];
  if (!Array.isArray(gates)) {
    throw new Error(`${actionName}: safetyGates must be an array`);
  }
  if (
    action.risk === 'high' &&
    !gates.some((gate) => gate.operation === actionName)
  ) {
    throw new Error(
      `${actionName}: high-risk actions require a primary safety gate`,
    );
  }
  for (const gate of gates) {
    validateSafetyGate(actionName, action, gate);
    validateOperationIdentity(
      actionName,
      gate.operation,
      activeActions,
      seenOperations,
    );
  }
}

function validateOperationIdentity(
  actionName,
  operation,
  activeActions,
  seenOperations,
) {
  if (seenOperations.has(operation)) {
    throw new Error(`duplicate safety operation: ${operation}`);
  }
  seenOperations.add(operation);
  if (operation !== actionName && activeActions.has(operation)) {
    throw new Error(
      `${actionName}: nested safety operation ${operation} collides with an active action`,
    );
  }
}

function validateSafetyGate(actionName, action, gate) {
  if (!gate || typeof gate !== 'object') {
    throw new Error(`${actionName}: safety gate must be an object`);
  }
  validateGateIdentity(actionName, gate);
  validateGateEvidence(gate);
  validateGateOwnership(actionName, action, gate);
}

function validateGateIdentity(actionName, gate) {
  if (!OPERATION_PATTERN.test(gate.operation ?? '')) {
    throw new Error(`${actionName}: invalid safety operation`);
  }
  if (!MODE_PATTERN.test(gate.mode ?? '')) {
    throw new Error(`${gate.operation}: invalid safety gate mode`);
  }
  if (!ENFORCEMENTS.has(gate.enforcement)) {
    throw new Error(`${gate.operation}: invalid safety gate enforcement`);
  }
  if (!AUTHORIZATIONS.has(gate.authorization)) {
    throw new Error(`${gate.operation}: invalid safety gate authorization`);
  }
}

function validateGateEvidence(gate) {
  for (const field of ['preconditions', 'readback']) {
    if (!isNonEmptyStringArray(gate[field])) {
      throw new Error(
        `${gate.operation}: safety gate ${field} must be non-empty`,
      );
    }
  }
  if (!isStringArray(gate.sideEffects)) {
    throw new Error(
      `${gate.operation}: safety gate sideEffects must be an array`,
    );
  }
  if (
    gate.authorization === 'not-required-read-only' &&
    gate.sideEffects.length > 0
  ) {
    throw new Error(
      `${gate.operation}: read-only authorization cannot declare side effects`,
    );
  }
}

function validateGateOwnership(actionName, action, gate) {
  if (gate.enforcement === 'blocked-before-runtime') {
    if (gate.owner !== undefined && gate.owner !== null) {
      throw new Error(
        `${gate.operation}: blocked safety gates cannot claim an owner`,
      );
    }
    return;
  }
  if (action.runtime === 'registered-only') {
    throw new Error(
      `${gate.operation}: registered-only actions must remain blocked before runtime`,
    );
  }
  if (!action.runtimeContract) {
    throw new Error(
      `${gate.operation}: runtime safety gates require a runtimeContract`,
    );
  }
  if (!gate.owner || gate.owner !== action.owner) {
    throw new Error(
      `${gate.operation}: runtime safety gate owner must match ${actionName} runtime owner`,
    );
  }
}

function isStringArray(value) {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNonEmptyStringArray(value) {
  return isStringArray(value) && value.length > 0 && value.every(Boolean);
}

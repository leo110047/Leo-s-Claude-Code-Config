export function violation(rule, file, message, line = null) {
  return { kind: 'violation', severity: 'error', rule, file, line, message };
}

export function advisory(rule, file, message, line = null) {
  return { kind: 'advisory', severity: 'warning', rule, file, line, message };
}

export function summarizeHooks(hooks) {
  return Object.fromEntries(
    Object.entries(hooks).map(([event, entries]) => [
      event,
      {
        entries: Array.isArray(entries) ? entries.length : 0,
        commandHooks: countHookType(entries, 'command'),
        promptHooks: countHookType(entries, 'prompt'),
      },
    ]),
  );
}

function countHookType(node, type) {
  if (Array.isArray(node)) {
    return node.reduce((sum, item) => sum + countHookType(item, type), 0);
  }
  if (!node || typeof node !== 'object') {
    return 0;
  }
  const self = node.type === type ? 1 : 0;
  return (
    self +
    Object.values(node).reduce(
      (sum, value) => sum + countHookType(value, type),
      0,
    )
  );
}

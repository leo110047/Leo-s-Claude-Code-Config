const fs = require('fs');
const os = require('os');
const path = require('path');

function resolveHistoryDir() {
  const pluginDataDir =
    typeof process.env.CLAUDE_PLUGIN_DATA === 'string'
      ? process.env.CLAUDE_PLUGIN_DATA.trim()
      : '';

  if (pluginDataDir.length > 0) {
    return {
      source: 'CLAUDE_PLUGIN_DATA',
      dir: path.join(pluginDataDir, 'claude-config-verification'),
    };
  }

  return {
    source: 'temp-fallback',
    dir: path.join(os.tmpdir(), 'claude-config-verification'),
  };
}

function appendHistory(summary) {
  try {
    const resolved = resolveHistoryDir();
    fs.mkdirSync(resolved.dir, { recursive: true });
    const historyFile = path.join(resolved.dir, 'history.jsonl');
    const entry = {
      ...summary,
      historySource: resolved.source,
      recordedAt: new Date().toISOString(),
    };
    fs.appendFileSync(historyFile, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Best-effort only.
  }
}

module.exports = { appendHistory };

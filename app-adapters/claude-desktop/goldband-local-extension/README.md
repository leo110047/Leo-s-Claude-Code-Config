# Goldband Local MCP Claude Desktop Extension

This is the Claude Desktop app adapter for goldband's first-party MCP server.
It is not a Claude Code settings or hooks package.

Install the generated `.mcpb` file from Claude Desktop:

1. Open Settings > Extensions.
2. Open Advanced settings.
3. Choose Install Extension.
4. Select the generated `goldband-local-extension.mcpb`.
5. Set the Goldband checkout directory to the repo containing `mcp/server/dist/index.js`.

Build the MCP server before using the extension:

```bash
npm --prefix mcp/server run build
```

# goldband

> Claude Code / Codex 的本機工程守則、安裝器與 workflow runtime 配套。

[English](README.en.md) | 中文（目前主入口）

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 這是什麼

goldband 是給 Claude Code 和 Codex 用的本機工程配套。它把 shared policy、
hooks、rules、commands、portable skills、Codex config，以及可選的
Goldband Loop workflow runtime 裝到同一個 checkout 管理。

這個 repo 分兩層：

- root `goldband`：安裝器、Claude/Codex adapters、shared policy、hooks、
  rules、commands、portable skills、plugin/app distribution。
- `goldband-loop/`：first-party workflow runtime，提供 review、investigate、
  QA、release、browser、planning 等 capability actions。

更細的 ownership 和 runtime contract 看 [ARCHITECTURE.md](ARCHITECTURE.md)。

## 安裝路徑

| 需求 | 建議路徑 |
| --- | --- |
| Claude Code core guardrails | Claude plugin：`goldband@goldband` |
| Codex full setup | `./install.sh codex-full` |
| Claude Code + Codex | `./install.sh all-tools` |
| Claude Code + Codex + Goldband Loop | `./install.sh all-with-workflow` |
| Codex portable plugin subset | repo marketplace：`.agents/plugins/marketplace.json` |
| Claude Desktop app subset | `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb` |
| Claude web/mobile app subset | `app-adapters/claude-remote/goldband-connector.template.json` |

Claude plugin 是 Claude Code core guardrails 的主路徑；它不包含
Goldband Loop、Playwright/browser/iOS tooling、或 Codex full setup。需要
workflow runtime 時，使用 installer。

## Quickstart

Claude Code plugin：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
./install.sh status
```

Codex 或雙工具安裝：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
./install.sh all-tools
./install.sh status
```

需要 Goldband Loop workflow runtime：

```bash
./install.sh all-with-workflow
```

Windows 不維護 native PowerShell installer。請用 Git Bash 或 WSL 從完整
git checkout 執行同一組 POSIX 指令。

## 常用命令

```bash
./install.sh status            # 檢查安裝狀態
./install.sh pack-quality      # Claude Code core quality pack，不含 workflow runtime
./install.sh codex-full        # Codex full setup
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + Goldband Loop
./install.sh uninstall         # 移除 installer-managed assets
```

Plugin 移除：

```bash
claude plugin uninstall goldband@goldband
```

更新：

```bash
git pull --ff-only
./install.sh status
```

更新後重跑原本的安裝組合，例如 `pack-quality`、`all-tools` 或
`all-with-workflow`。

## 重要邊界

- 請使用完整 git checkout；不要只複製 `install.sh`。
- Claude plugin、Codex plugin、Claude app adapters、installer full setup 是不同
  distribution surface，不要互相宣稱替代。
- `./install.sh status` 會 read back 安裝狀態；若 plugin 和 installer-managed
  Claude assets 同時存在，它會回報 duplicate asset。
- hooks、rules、cross-review gate、sandbox 是防誤操作與 evidence gate，不是
  抵抗同權限惡意操作者的安全邊界。
- `all-with-workflow` 會安裝並驗證 Goldband Loop browser runtime；離線或 CI
  可用 `GOLDBAND_SKIP_PLAYWRIGHT=1` 明確跳過 browser workflows。

## Workflow 入口

安裝 Goldband Loop 後：

- Claude Code：`/goldband <capability> <action>`
- Codex：`$goldband <capability> <action>`

目前支援的 capability/action 清單以
[docs/generated/capabilities.md](docs/generated/capabilities.md) 為準。

## 開發

Repo root 的預設聚合測試入口是：

```bash
npm test
# or
bun run test
```

它等同 `npm run test:repo`，會跑一組明確列出的 package-owned suites，並在
最後輸出 per-suite summary。查看清單：

```bash
npm run test:repo:list
```

不要把 repo root 裸跑 `bun test` 當作 repo 驗證；那會繞過子專案自己的測試
合約，改成讓 Bun 遞迴掃檔，輸出也沒有 per-package summary。

常用 targeted gates：

```bash
npm run test:plugin-distribution
npm run test:app-support
npm run test:hook-router
npm run test:cross-review
npm run lint:style
```

改到會餵進 Claude plugin 的來源後：

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

改到 Codex plugin 或 Claude app adapter 來源後：

```bash
npm run sync:app-support
npm run test:app-support
```

更多貢獻流程看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 文件地圖

- [ARCHITECTURE.md](ARCHITECTURE.md)：root goldband、Claude/Codex surfaces、
  Goldband Loop 的 ownership 和 runtime contract。
- [OPERATIONS.md](OPERATIONS.md)：安裝維運、Codex overlay、style gate、MCP、
  telemetry。
- [CONTRIBUTING.md](CONTRIBUTING.md)：開發流程與 plugin distribution checks。
- [docs/generated/capabilities.md](docs/generated/capabilities.md)：Goldband Loop
  capability/action catalog。
- [goldband-loop/README.md](goldband-loop/README.md)：workflow runtime 入口。
- [mcp/README.md](mcp/README.md)：MCP templates 和 first-party
  `goldband-mcp`。
- [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md)：container sandbox 的保護
  範圍與不保護項目。
- [docs/knowledge-system.md](docs/knowledge-system.md)：local knowledge layer。
- [docs/DECISIONS.md](docs/DECISIONS.md)：重要決策紀錄。

## License

MIT License.

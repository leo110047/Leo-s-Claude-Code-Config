# goldband

> Claude Code / Codex 的本機工程守則、安裝器與 workflow runtime 配套。

[English](README.en.md) | 中文（目前主入口）

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## 這是什麼

goldband 把 Claude Code 和 Codex 的常用工程守則裝到本機環境：portable
skills、commands、rules、hooks、Codex config，以及可選的 Goldband Loop
workflow runtime。

它的目標很窄：

- 讓 Claude Code 和 Codex 盡量使用同一套 shared policy。
- 用 hooks、rules、requirements 和 permissions 降低誤操作風險。
- 透過 `goldband-*` workflow 入口提供 review、debug、QA、planning 等重流程。

## 安裝路徑

| 需求 | 建議路徑 |
| --- | --- |
| 只要 Claude Code core guardrails | Claude plugin：`goldband@goldband` |
| Codex full setup | installer：`./install.sh codex-full` |
| Claude Code + Codex | installer：`./install.sh all-tools` |
| Claude Code + Codex + Goldband Loop workflow runtime | installer：`./install.sh all-with-workflow` |
| 開發者 repo-linked setup | installer |
| 只看 workflow runtime | [goldband-loop/README.md](goldband-loop/README.md) |

Claude plugin 是 Claude core 的主路徑。Codex 也有 plugin 生態，但 goldband
目前的 Codex full setup 仍由 installer 管理，因為它包含 `config.toml`、
`requirements.toml`、rules、hooks、profiles、permission profiles、custom
agents 和 workflow runtime assets。不要把目前的 Claude plugin 說成
Claude/Codex plugin parity。

## Quickstart

Claude Code 使用者：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
claude plugin marketplace add ./
claude plugin install goldband@goldband --scope user
./install.sh status
```

Codex 或開發者完整安裝：

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

Windows 不維護 native PowerShell installer。請用 Git Bash 或 WSL 從完整 git
checkout 執行同一組 POSIX 指令。

## 常用指令

```bash
./install.sh status            # 檢查 Claude plugin、Claude/Codex install、style gate、workflow runtime
./install.sh pack-quality      # Claude Code 基礎品質包，不含 workflow runtime
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

## 裝了什麼

- Claude plugin：commands、portable skills、generated `goldband-rules` skill、
  hook router。
- Claude installer assets：global `CLAUDE.md`、commands、rules、hooks、
  portable skills。
- Codex installer assets：`AGENTS.md`、config、requirements、rules、hooks、
  profiles、permission profiles、custom agents、portable skills。
- Goldband Loop runtime：Claude/Codex 的 `goldband-*` workflow entrypoints。
- Optional assets：global git style gate、MCP templates、container-first
  sandbox。

`./install.sh status` 會檢查安裝狀態。若同時裝了 Claude plugin 和
installer-managed Claude core assets，它會回報 duplicate asset，並以非 0 exit
code 表示狀態不是全綠。

## 依賴與邊界

- 需要完整 git checkout；不要只複製 `install.sh`。
- hooks 設定檢查需要 `jq`。
- `codex-requirements` 預設寫到 `/etc/codex/requirements.toml`，可能需要權限。
- `all-with-workflow` 會安裝並驗證 Goldband Loop browser runtime；離線或 CI 可用
  `GOLDBAND_SKIP_PLAYWRIGHT=1` 明確跳過 browser workflows。
- hooks、rules、cross-review gate 和 sandbox 都是防誤操作與 evidence gate，不是
  惡意同權限操作者的安全邊界。

## 文件地圖

- [ARCHITECTURE.md](ARCHITECTURE.md)：goldband、Claude plugin、Codex installer、
  Goldband Loop 的 ownership 和邊界。
- [docs/DECISIONS.md](docs/DECISIONS.md)：重要決策紀錄。
- [docs/reports/plugin-distribution-verification.md](docs/reports/plugin-distribution-verification.md)：Claude plugin scope、驗證與 Codex plugin 邊界。
- [CONTRIBUTING.md](CONTRIBUTING.md)：開發流程與 plugin sync/check。
- [OPERATIONS.md](OPERATIONS.md)：安裝、Codex overlay、style gate、MCP token、
  telemetry 等操作細節。
- [mcp/README.md](mcp/README.md)：MCP templates 和 first-party `goldband-mcp`。
- [sandbox/THREAT-MODEL.md](sandbox/THREAT-MODEL.md)：container sandbox 的保護範圍與不保護項目。
- [goldband-loop/README.md](goldband-loop/README.md)：Goldband Loop workflow runtime。
- [docs/reports/cross-review-phase-0.md](docs/reports/cross-review-phase-0.md)：cross-review gate 的驗證結果與限制。

## 開發

改到會餵進 Claude plugin 的來源後，必須重產 plugin package：

```bash
node scripts/sync-plugin-assets.mjs
npm run test:plugin-distribution
```

常用驗證：

```bash
npm run test:hook-router
npm run test:cross-review
node scripts/check-code-style.mjs
python3 scripts/check-json-toml-syntax.py
```

更多貢獻流程看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## License

MIT License.

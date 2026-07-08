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

方向建議時會要求交代假設、失敗模式、替代方案與待驗證未知數；方向判斷預設優先健康且可維護的路徑。

goldband 是設定與安裝層；`goldband-loop/` 是 first-party workflow runtime。
Claude plugin 不包含 Goldband Loop。需要 `goldband-*` review、QA、debug、
planning workflow 時，請走 `./install.sh all-with-workflow`。完整 ownership 看
[ARCHITECTURE.md](ARCHITECTURE.md)。

## 安裝路徑

| 需求 | 建議路徑 |
| --- | --- |
| 只要 Claude Code core guardrails | Claude plugin：`goldband@goldband` |
| Codex full setup | installer：`./install.sh codex-full` |
| Codex app shared config | installer：`./install.sh codex-full` |
| Codex plugin portable subset | repo marketplace：`.agents/plugins/marketplace.json` |
| Claude Desktop app portable subset | `app-adapters/claude-desktop/dist/goldband-local-extension.mcpb` |
| Claude web/mobile app portable subset | remote MCP connector template：`app-adapters/claude-remote/goldband-connector.template.json` |
| Claude Code + Codex | installer：`./install.sh all-tools` |
| Claude Code + Codex + Goldband Loop workflow runtime | installer：`./install.sh all-with-workflow` |
| 開發者 repo-linked setup | installer |
| 只看 workflow runtime | [goldband-loop/README.md](goldband-loop/README.md) |

Claude plugin 是 Claude Code core 的主路徑。Codex app 和 Codex CLI 共用
Codex 設定層，所以 app shared-config support 走 `codex-full`。Codex plugin
則是 portable subset：skills 加 opt-in MCP wrapper，不取代 `codex-full`。
Claude Desktop / Claude app support 走獨立 app adapter：local `.mcpb`
extension 或 remote MCP connector，不是 Claude Code 的 `~/.claude/settings.json`
或 hooks runtime。

## 支援矩陣

| Surface | 支援狀態 | 安裝方式 | 備註 |
| --- | --- | --- | --- |
| Claude Code CLI | supported | `goldband@goldband` plugin or installer | Claude Code hooks/settings 只適用這裡 |
| Claude Desktop app | supported (portable subset) | local `.mcpb` extension | 連到 first-party `goldband-mcp`；不是 `~/.claude/settings.json` |
| Claude web/mobile app | supported (portable subset) | remote MCP connector | 需部署 remote MCP endpoint 並在 Claude connector 設定註冊 |
| Codex CLI | supported | `./install.sh codex-full` | shared Codex config |
| Codex app | supported via shared config | `./install.sh codex-full` | `./install.sh status` 會 read back shared config surfaces |
| Codex plugin | supported (portable subset) | Codex repo marketplace package | skills + opt-in MCP wrapper；不取代 full setup |

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
./install.sh status            # 檢查 Claude plugin、Claude/Codex install、app surface、style gate、workflow runtime
./install.sh pack-quality      # Claude Code 基礎品質包，不含 workflow runtime
./install.sh codex-full        # Codex full setup
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + Goldband Loop
./install.sh uninstall         # 移除 installer-managed assets
```

本機知識庫：

```bash
goldband-knowledge search --domain qa --query "fixture regression"
goldband-knowledge capture-candidate --source-type workflow-evidence --source-evidence "workflow-runs/qa.jsonl#event" --title "One-line title" --type practice --domains qa --summary "One-line recall summary" --body-file entry.md
goldband-knowledge-review list
goldband-knowledge-review promote --id "workflow-evidence-20260708-ab12cd34" --reviewed-by user
goldband-knowledge graduate --id "short-kebab-slug" --to "skills/global/example/SKILL.md"
```

`knowledge/` 不 commit 進 repo。它和 auto-memory 分工不同：auto-memory 記人和偏好；
knowledge 記「這類問題怎麼解、哪些做法驗證過」。高頻條目應畢業成
skill/rule，避免知識庫變成第二套真理來源。自動來源只寫 `candidate`，
default recall 只查 `active`；candidate 需要 review/promote 後才會變成可信召回。
完整 lifecycle 與 host exposure 表見 `docs/knowledge-system.md`。

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
- Codex plugin：portable skills、repo marketplace entry、opt-in MCP wrapper。
- Claude app adapters：Claude Desktop `.mcpb` local extension package、remote
  MCP connector registration template。
- Claude installer assets：global `CLAUDE.md`、commands、rules、hooks、
  portable skills。
- Codex installer assets：`AGENTS.md`、config、requirements、prompts、rules、
  hooks、profiles、permission profiles、custom agents、portable skills。
- Goldband Loop runtime：Claude 用 `/goldband`，Codex 用 `$goldband <workflow>`
  列出並執行已安裝 workflow。
- Local knowledge layer：`${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/`，
  儲存已整理、可召回、未來可能畢業成 skill/rule 的 knowledge 條目。
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
- [docs/reports/app-support-verification.md](docs/reports/app-support-verification.md)：Codex app/plugin 與 Claude app adapter 驗證。
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

改到 Codex plugin 或 Claude app adapter 來源後，也要重產 app support assets：

```bash
npm run sync:app-support
npm run test:app-support
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

# goldband

> Shared engineering guardrails for Claude Code and Codex.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

goldband 是一套給 **Claude Code** 和 **Codex** 共用的工程 guardrails。它提供：

- Claude commands / hooks / contexts / rules
- Codex config / AGENTS / rules / portable skills
- 可選的內建 `workflow` runtime 與 `goldband-*` 高階流程 wrappers

## 快速開始

一定要用 **`git clone`** 安裝完整 repo：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。
goldband 現在是 **repo-linked install**，而且 `claude` / `codex` 的啟動前自動更新會依賴 git metadata；沒有完整 clone，就沒辦法安全更新。

### 推薦安裝

```bash
./install.sh pack-quality      # Claude Code 日常推薦
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + 內建 workflow
```

如果你只想補裝特定部分：

```bash
./install.sh codex-full
./install.sh workflow
./install.sh workflow-codex
./install.sh launchers
./install.sh status
./install.sh uninstall
```

> hooks 合併需要 `jq`。macOS 可用 `brew install jq`。

## 更新方式

更新的正確方式是：

```bash
cd /path/to/goldband
git pull --ff-only
./install.sh all-tools
```

如果你平常從 terminal 直接輸入 `claude` 或 `codex`，goldband 也會在啟動前做一次安全的 self-update 檢查，但只會在以下條件成立時自動 fast-forward：

- goldband repo 是乾淨工作樹
- branch 是 `main`
- tracking `origin/main`
- 可安全 `git pull --ff-only`

不符合條件時會直接跳過，不阻塞啟動。

## 語言設定

goldband workflow wrappers 的提問與說明語言可切換，支援：

- `zh-TW`：預設
- `en`

### Claude Code

在 Claude CLI 裡直接輸入：

```text
/goldband-language
```

它會先問你要切到哪個語言。
如果你已經知道目標，也可以直接：

```text
/goldband-language zh-TW
/goldband-language en
```

### 直接設定

```bash
~/.codex/skills/workflow/bin/workflow-config get goldband_language
~/.codex/skills/workflow/bin/workflow-config set goldband_language zh-TW
~/.codex/skills/workflow/bin/workflow-config set goldband_language en
```

切換後若目前 session 還沒吃到新設定，重開 Claude Code / Codex 一次即可。

## 常用入口

- 功能規劃：`/plan`
- 完整驗證：`/verify`
- bug / failing test：`/goldband-investigate`
- diff / PR 審查：`/goldband-review`
- 瀏覽器 QA：`/goldband-qa`
- 高風險操作保護：`careful-mode`
- 唯讀調查：`freeze-mode`

如果你有裝 workflow，日常高階流程直接用 `goldband-*` wrappers 就好。

## workflow

goldband 內建 vendored `workflow` runtime，不需要另外保留外部 workflow repo。

常見安裝組合：

```bash
./install.sh workflow
./install.sh workflow-codex
./install.sh all-with-workflow
```

安裝後的 canonical surfaces 是：

- Claude runtime: `~/.claude/skills/workflow`
- Codex runtime: `~/.codex/skills/workflow`
- Shared state: `~/.workflow/`
- 對外入口: `goldband-*`

如果你要測試別的 runtime checkout，才需要覆寫：

```bash
WORKFLOW_REPO_DIR=/path/to/runtime ./install.sh all-with-workflow
```

## Unity 專案

```bash
cd /path/to/your-unity-project
/path/to/goldband/install.sh unity
```

## 疑難排解

| 問題 | 解法 |
|------|------|
| Hook 沒有執行 | `./install.sh hooks`，並確認 `jq` 已安裝 |
| 安裝看起來不完整 | `./install.sh status` |
| `/verify-config` 報錯 | 重跑 `./install.sh all-tools` 或 `./install.sh all-with-workflow` |
| 語言切換後說明沒變 | 重開 Claude Code / Codex |
| 啟動時沒有自動更新 | 確認是 `git clone` 的 repo，且 repo 在 `main`、乾淨、tracking `origin/main` |

## License

MIT License.

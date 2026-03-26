# goldband

> Shared engineering guardrails for Claude Code and Codex.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

goldband 提供 Claude Code 和 Codex 共用的工程 guardrails。

## 快速開始

一定要用 **`git clone`**：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

不要只複製 `install.sh`，也不要用沒有 `.git` 的下載方式。

goldband 是 `repo-linked install`，啟動前自動更新也依賴 git metadata；沒有完整 clone 就不能安全更新。

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

`hooks` 合併需要 `jq`。macOS 可用 `brew install jq`。

## 更新方式

```bash
cd /path/to/goldband
git pull --ff-only
./install.sh all-tools
```

如果你平常直接輸入 `claude` 或 `codex`，goldband 也會先做一次安全的 self-update 檢查。

只有在下列條件成立時才會自動 fast-forward：

- goldband repo 是乾淨工作樹
- branch 是 `main`
- tracking `origin/main`
- 可安全 `git pull --ff-only`

不符合條件時會直接跳過，不阻塞啟動。

## 語言設定

支援 `zh-TW` 和 `en`，預設 `zh-TW`。

### Claude Code

```text
/goldband-language
```

它會先問你要切到哪個語言。

也可以直接指定：

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

如果你有裝 workflow，日常高階流程直接用 `goldband-*` wrappers。

## workflow

goldband 內建 vendored `workflow` runtime，不需要另外保留外部 workflow repo。

常見安裝：

```bash
./install.sh workflow
./install.sh workflow-codex
./install.sh all-with-workflow
```

安裝後的 canonical surfaces：

- Claude runtime: `~/.claude/skills/workflow`
- Codex runtime: `~/.codex/skills/workflow`
- Shared state: `~/.workflow/`
- 對外入口: `goldband-*`

只有在你要測試別的 runtime checkout 時，才需要覆寫：

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

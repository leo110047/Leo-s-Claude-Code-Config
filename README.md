# goldband

> Shared engineering guardrails for Claude Code and Codex.

[English](README.en.md) | 中文

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## goldband 是什麼

goldband 是一套 Claude Code / Codex 本機設定包。它把常用工作守則、hooks、
commands、rules、portable skills 和 workflow runtime 接到你的本機環境。

它主要解三件事：

- 讓 Claude 和 Codex 使用同一套基本工程守則。
- 把高風險操作交給 hooks / permissions / rules 控制。
- 提供 `goldband-*` workflow 入口做 review、debug、QA、planning 等重流程。

方向建議時會要求交代假設、失敗模式、替代方案與待驗證未知數；方向判斷預設優先健康且可維護的路徑。

## goldband 與 Goldband Loop 的邊界

- goldband 管 shared policy、installer、Claude/Codex adapters、global guidance、hooks、commands、rules 和 portable skills。
- `goldband-loop/` 是 first-party workflow runtime,不是 vendored upstream。
- 安裝時 goldband 會直接安裝 Goldband Loop,暴露 `goldband-*` 入口。

維護細節看 [ARCHITECTURE.md](ARCHITECTURE.md)。
Goldband Loop 自己的說明看 [goldband-loop/README.md](goldband-loop/README.md)。

## 安裝

請用完整 git checkout，不要只複製 `install.sh`：

```bash
git clone https://github.com/leo110047/goldband.git
cd goldband
```

macOS / POSIX：

```bash
./install.sh pack-quality      # Claude Code 基礎品質包（不含 workflow）
./install.sh all-tools         # Claude Code + Codex
./install.sh all-with-workflow # Claude Code + Codex + 內建 workflow（review/QA 推薦）
./install.sh status            # 檢查狀態
```

Windows：

goldband 不再維護 native PowerShell installer。Windows 請用 Git Bash 或 WSL，
從完整 git checkout 執行同一組 POSIX 指令：

```bash
./install.sh all-tools
./install.sh all-with-workflow
./install.sh status
```

補裝特定項目：

```bash
./install.sh claude-guidance    # Claude 全域 CLAUDE.md
./install.sh codex-full         # Codex 全量設定
./install.sh codex-agents       # Codex AGENTS.md + custom agents
./install.sh codex-hooks        # Codex hooks
./install.sh codex-requirements # Codex managed requirements
./install.sh style-gate         # 全域 git style gate
./install.sh workflow           # Claude 端 workflow
./install.sh workflow-codex     # Codex 端 workflow
./install.sh launchers          # shell 啟動整合
./install.sh uninstall          # 移除安裝
```

依賴：

- hooks 合併需要 `jq`。
- Windows workflow 需要可用的 `bash`，建議 Git for Windows。
- `all-with-workflow` 會安裝並驗證 Goldband Loop 的 Playwright Chromium
  browser runtime；下載或啟動失敗會中止安裝。離線/CI 可明確設定
  `GOLDBAND_SKIP_PLAYWRIGHT=1` 跳過 browser workflows，或用
  `GOLDBAND_CHROMIUM_PATH` 指向相容 Chromium。

## 裝了什麼

- Claude 全域守則：`claude/CLAUDE.md` -> `~/.claude/CLAUDE.md`
- Codex 全域守則：`codex/AGENTS.md` -> `~/.codex/AGENTS.md`
- Claude assets：`commands/`、`rules/`、`hooks/`、portable skills
- Codex assets：config、profiles、rules、hooks、custom agents、portable skills
- Git style gate（選配）：`git-hooks/` -> global `core.hooksPath`
- Goldband Loop runtime：Claude 在 `~/.claude/skills/goldband`，Codex 在 `~/.codex/skills/goldband`

全域守則只放日常回覆、查證口徑和工作邊界。review、debug、security、planning、QA 這類重流程走 `goldband-*` workflow、commands、skills、hooks 和 rules。

## 權限邊界

Claude `hooks/hooks.json` 使用 `defaultMode: acceptEdits`，定位是信任本機開發環境的便利 profile，不是 sandbox。它會用 hooks、permissions 和 deny list 降低誤操作風險，但不能把惡意或任意 shell 視為已隔離。`node`、`python`、`xargs`、`find` 和 `sed` 這類可包裝或批次執行其他動作的 broad allow pattern 不應放回 source auto-allow；需要時應由使用者針對具體命令確認，或在本機 overlay 裡明確承擔信任邊界。

## Codex 補充

Codex tracked config/rules 只放 portable baseline。本機路徑、trusted projects、plugin state 和一次性 approvals 放在 ignored overlay：

- `codex/local/config.toml`
- `codex/local/rules/*.rules`

如果舊 checkout 曾把 approvals 寫進 `codex/rules/default.rules`：

```bash
./install.sh repair-codex-rules
```

`codex-requirements` 會安裝 Codex managed requirements。POSIX 預設寫到
`/etc/codex/requirements.toml`。native Windows 的官方 system path 是
`%ProgramData%\OpenAI\Codex\requirements.toml`；goldband 的 Git Bash / WSL
安裝流程不會 staging `~/.codex/requirements.toml`，也不宣稱會強制載入
Windows managed requirements。

MCP template 與 token-backed 啟用流程看 [mcp/README.md](mcp/README.md)。

## Git style gate

`./install.sh style-gate` 會嘗試把 global `core.hooksPath` 設到 repo-linked
`git-hooks/`。預設安裝包不會改動這個機器全域 git 設定。明確安裝後會啟用：

- `pre-commit`：只檢查 staged 檔，呼叫 `node scripts/check-code-style.mjs --staged`
- `commit-msg`：只有 repo 放 `.goldband-git-workflow.json` 或設定
  `GOLDBAND_GIT_WORKFLOW_GATE=1` 時，才檢查
  `<type>[optional scope][!]: <description>`；type 依 `rules/git-workflow.md`

如果 global `core.hooksPath` 已有非 goldband 值，installer 只警告不覆蓋。Husky
或其他專案設定 local `core.hooksPath` 時，local 會覆蓋 global；這些 repo 不受
goldband style gate 影響，這是預期行為。

JS/TS Biome checks 只在 target repo 有 `biome.json` 時執行；沒有 config 的 repo
會降級為 advisory，零依賴 staged 檢查仍照跑。

Opt-out：

- repo 根目錄放 `.goldband-no-style-gate`
- 單次使用 `GOLDBAND_STYLE_GATE=0 git commit`，hook 會印警告並寫本機 bypass log

手動檢查：

```bash
node scripts/check-code-style.mjs
node scripts/check-code-style.mjs --staged
```

## 常用入口

以下 workflow 入口需要先安裝 `workflow`、`workflow-codex` 或 `all-with-workflow`：

- `/plan`
- `/verify`
- `/goldband-review`
- `/goldband-investigate`
- `/goldband-cso`
- `/goldband-design-review`
- `/goldband-qa`
- `/goldband-benchmark`
- `/goldband-skillify`

完整 review 只走 `/goldband-review` workflow；只裝 `pack-quality` 時不會暴露 review 入口。

## 更新

```bash
git pull --ff-only
./install.sh status
```

更新後重跑原本的安裝組合即可，例如 `pack-quality`、`all-tools` 或 `all-with-workflow`。

如果你透過 goldband launcher 啟動 `claude` 或 `codex`，它會在 repo 乾淨、位於 `main`、tracking `origin/main` 且可 fast-forward 時自動更新。

## 語言

```text
/goldband-language zh-TW
/goldband-language en
```

也可以直接設定：

```bash
~/.codex/skills/goldband/bin/goldband-config set goldband_language zh-TW
~/.codex/skills/goldband/bin/goldband-config set goldband_language en
```

切換後若目前 session 沒吃到設定，重開 Claude Code 或 Codex。

## 什麼情況下不適合用

- 你不用 Claude Code 或 Codex。
- 你只想要普通專案模板。
- 你不想要 hooks、permissions、repo-linked install 或啟動前 self-update。
- 你只想要 Goldband Loop runtime 本身。

只需要 runtime 時，直接看 [goldband-loop/README.md](goldband-loop/README.md)。

## 疑難排解

| 問題 | 解法 |
|------|------|
| 安裝看起來不完整 | 跑 `./install.sh status` |
| hooks 沒有執行 | 跑 `./install.sh hooks`，並確認 `jq` 已安裝 |
| `/verify-config` 報錯 | 重跑 `./install.sh all-tools` 或 `./install.sh all-with-workflow` |
| 語言切換後說明沒變 | 重開 Claude Code 或 Codex |
| 啟動時沒有自動更新 | 確認 repo 是 git clone、在 `main`、工作樹乾淨、tracking `origin/main` |
| Codex approvals 寫進 tracked rules | 跑 `./install.sh repair-codex-rules` |

## 授權

MIT License.
Goldband Loop 的原上游 attribution 保留在 [goldband-loop/UPSTREAM_ATTRIBUTION.md](goldband-loop/UPSTREAM_ATTRIBUTION.md)。

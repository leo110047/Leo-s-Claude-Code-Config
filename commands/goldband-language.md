---
description: 切換或查詢 goldband workflow wrappers 的提問與說明語言。
---

# Goldband Language

切換 `goldband-*` workflow wrappers 對使用者顯示的提問、建議、選項、摘要與指令說明語言。

## Arguments

`$ARGUMENTS` 可以是：
- 空白：先顯示目前設定，然後直接詢問要切到哪個語言
- `zh-TW`、`zh`、`tw`、`中文`、`繁中`：切到繁體中文
- `en`、`english`、`英文`：切到英文

## Process

1. 找 `workflow-config`，依序檢查：
   - `~/.codex/skills/workflow/bin/workflow-config`
   - `~/.claude/skills/workflow/bin/workflow-config`
   - `vendor/workflow/bin/workflow-config`（只有在 repo 內且前兩者不存在時）

2. 如果找不到 `workflow-config`：
   - 明確說 workflow runtime 尚未安裝
   - 提示使用者先跑 `./install.sh workflow-auto` 或 `./install.sh all-with-workflow`
   - 停止，不要假裝切換成功

3. 解析 `$ARGUMENTS`：
   - `zh-TW` / `zh` / `tw` / `中文` / `繁中` → 正規化成 `zh-TW`
   - `en` / `english` / `英文` → 正規化成 `en`
   - 其他值 → 回覆支援的選項，停止

4. 如果沒有參數：
   - 執行 `~/.claude/commands/scripts/set-goldband-language.sh get`
   - 根據目前語言回報目前值
   - 直接問使用者要切到哪個語言，只給兩個選項：
     - `zh-TW`
     - `en`
   - 等使用者回答後，再執行設定與驗證

5. 如果有合法參數：
   - 執行 `~/.claude/commands/scripts/set-goldband-language.sh set <normalized>`
   - 這一步會同時更新：
     - `goldband_language` config
     - `~/.claude/commands/*.md` 的 frontmatter description
     - `~/.claude/skills/goldband-*` 與 `~/.codex/skills/goldband-*` 的 skill description
   - 再執行一次 `~/.claude/commands/scripts/set-goldband-language.sh get` 驗證
   - 根據新語言回報切換結果
   - 補一句：若當前 session 還在吃舊 wrapper 狀態，重開 Claude Code / Codex 一次

## Output Style

- 若這次有合法參數，直接用正規化後的新語言回覆
- 若這次沒有參數，先讀目前 `goldband_language`，並用目前語言回覆與提問
- `zh-TW` 模式使用繁體中文；`en` 模式使用英文
- 要明確顯示「目前值 / 新值」
- code、identifiers、commands、paths、env vars 保持英文
- 不要輸出多餘背景說明
- 若使用者是空白呼叫 `/goldband-language`，不要只貼使用說明；要直接進入選語言流程

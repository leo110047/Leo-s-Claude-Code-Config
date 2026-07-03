# Phase 0 實作交辦:telemetry 補洞

計畫背景與本 Phase 的定位:`docs/ARCHITECTURE_REVIEW_2026_07.md` 第三部分
Phase 0,那份文件是 source of truth,先讀它再動手。

## 任務目標

修好 goldband 的使用量測,讓之後的裁剪決策(Phase 2)有數據可依。完成後
必須能回答:「過去 N 週實際用過哪些 workflow 入口、各幾次;hook 擋了什麼」。

## 現況與已知缺口(已驗證)

- usage telemetry 只記 hook 事件,不記 workflow skill / `goldband-*` 入口的
  實際呼叫。寫入點在 `hooks/scripts/lib/hook-router/usage-telemetry.js`,
  事件來源是 `hooks/scripts/hooks/hook-router.js` 的各 policy 模組。
- 「persistent」路徑不 persistent:`hooks/scripts/lib/utils.js` 的
  `getPersistentDataDir()` 在 `CLAUDE_PLUGIN_DATA` 不存在時 fallback 到系統
  temp 目錄,資料會隨重開機消失。
- `hooks/scripts/lib/hook-router/metrics.js` 的 `metricsEnabled()` 預設關閉
  (`HOOK_ROUTER_METRICS_ENABLED` 預設 `'0'`)。
- 唯一的 telemetry 消費者是一次性的
  `hooks/scripts/tools/report-usage-summary.js`。

## 實作範圍

0. 開始改 code 前先做 discovery:
   - 列出 Claude hook / Codex hook 目前實際能看到的 `hook_event_name`、
     `tool_name`、與可用 payload 欄位。
   - 用現有 fixture 或新增最小 fixture 證明是否能觀測 Skill / workflow
     入口呼叫。
   - 先決定每種事件是 `confirmed` 還是 `inferred`。`confirmed` 代表 runtime
     明確告訴你該入口被呼叫;`inferred` 只能用於 prompt-trigger、wrapper
     command、或其他間接訊號。不要把 inferred usage 當成 confirmed invocation。
1. workflow skill / `goldband-*` 入口的呼叫事件寫進 usage log。實作方式由你
   設計(候選:PreToolUse 對 Skill tool 的事件、wrapper 內埋點),但要
   Claude 與 Codex 兩側都有覆蓋,或明確記錄哪一側做不到與原因。不要為了
   追求「兩側都有」而記錄不可驗證的假事件。
2. persistent data 路徑搬到真正持久的位置(例如 `~/.claude` 下的 goldband
   資料目錄或 XDG data dir),temp 只留最後 fallback。既有 temp 內資料不需
   遷移,但路徑變更要寫進 `OPERATIONS.md`。
3. `metrics.jsonl` 改為預設開啟,保留現有 env var 關閉手段。
4. 把 `report-usage-summary.js` 升級為可重複執行的週期報表:輸出各入口呼叫
   次數、hook deny/advisory 次數、時間窗;文件說明怎麼跑。

## Telemetry schema 與隱私

- usage event schema 要最小化。每個新事件至少包含:`category`、`name`、
  `action`、`source`、`sessionId`、`recordedAt`;workflow 入口事件另加
  `confidence`(`confirmed` 或 `inferred`)與 `host`(`claude` 或 `codex`)。
- 不記完整 prompt、完整 shell command、檔案內容、或 credential-shaped
  values。若需要 debug context,只保留短 preview 或分類後的 metadata。
- usage log 與 metrics 都必須留在本機。不要新增外部服務、網路上傳、或
  背景同步。
- 報表要把 `confirmed` 與 `inferred` 分開列,避免之後 Phase 2 把間接訊號
  誤當成真實呼叫次數。

## 數據要在哪裡看

- `OPERATIONS.md` 必須新增「Goldband Telemetry」段落,說明:
  - usage log 的實際路徑與 fallback 規則。
  - metrics log 的實際路徑與 fallback 規則。
  - 如何用 `node hooks/scripts/tools/report-usage-summary.js --days N`
    看入口使用量、hook deny/advisory 次數、與資料時間窗。
  - 如何用 `--json` 取得機器可讀輸出。
- `report-usage-summary.js` 的 human output 第一屏要直接回答:
  「過去 N 天有哪些 workflow 入口被用、各幾次;hook 擋了什麼」。

## 邊界

- 不動 `vendor/workflow/` 內任何檔案。
- 不新增外部服務或網路上傳;telemetry 一律留在本機檔案。
- 不改 hook 的 allow/deny 行為本身,本 Phase 只做量測。

## 驗證(完成宣稱必須附本次執行的證據)

- 既有測試全綠:`node scripts/test-codex-hook-router.mjs`、
  `npm run test:style-gate`、`bash scripts/test-workflow-integration.sh`。
- 為新事件與新路徑補測試(跟隨 repo 既有測試風格)。
- 手動證據:實際呼叫一個 `goldband-*` 入口後,usage log 出現對應事件;
  重開 shell 後資料仍在;報表工具輸出包含該事件。
- 改了 hooks/installer 相關檔案,就跑 `claude-config-verification` skill 的
  健康檢查流程。至少執行:
  `node skills/global/claude-config-verification/scripts/verify-claude-config.js --router-replay`。

## 交付

一個 PR(依 repo 的 conventional commits 與 PR 慣例)。PR 描述附:驗證命令
輸出摘要、discovery 結果、新事件 schema 說明、路徑變更前後對照、以及
「在哪裡看數據」的操作說明。同時把
`docs/ARCHITECTURE_REVIEW_2026_07.md` Phase 0 的 checkbox 勾上(只勾已完成
且有證據的項目)。

## 阻塞時

Claude 或 Codex 的 hook 介面拿不到 Skill 呼叫資訊、或找不到可靠埋點時,
停下來回報:嘗試過的方案、各自失敗的證據、你建議的替代設計。不要用猜的
schema 硬做。若只能做 `inferred` telemetry,回報它對 Phase 2 裁剪決策的
限制,並提出還需要哪個 runtime 事件或 wrapper 埋點才能變成 `confirmed`。

## 建議使用的 skills

`evidence-based-coding`、`file-search`、`testing-strategy`、
`claude-config-verification`;提 PR 前跑 `/goldband-review`。

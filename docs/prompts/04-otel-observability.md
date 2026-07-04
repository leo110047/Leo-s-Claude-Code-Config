# 實作 Prompt 4:讓 telemetry 接上業界標準監控(OpenTelemetry)

> 使用方式:把本檔全文貼給一個乾淨的 Claude Code 或 Codex session,工作目錄為 goldband repo 根目錄。

---

## 背景

goldband 的觀測資料目前是自創 JSONL:hook router 把 usage 事件寫到 persistent
data path 下的 `hook-router/usage-events.jsonl`(寫入邏輯在
`hooks/scripts/lib/hook-router/usage-telemetry.js`,含 rotation 與 retention),
另有 `workflow-telemetry.js`。讀取端只有自家工具
`hooks/scripts/tools/report-usage-summary.js`。

問題有兩層:

1. **格式孤島**:JSONL schema 是自創的,接不上任何標準 tracing/監控工具
   (Grafana、Jaeger、Honeycomb、Datadog 等都吃 OTLP)。
2. **缺 run-level 關聯**:現有 telemetry 有部分 `sessionId` 訊號,但沒有一個
   跨 Claude/Codex 一致、可轉成 trace 的 `run_id` contract,能把「一次 agent
   run 裡的 skill 呼叫、hook 事件、產出的 diff、review findings」串成一條
   trace。這是 PLANE.md 點名的最大觀測缺口。

## 目標

以「JSONL 為 source of truth,OTel 為匯出層」的架構補上這兩層。
**不要**把 hook 熱路徑改成同步打網路——hook 必須維持快、離線可用、零依賴。

交付四件東西:

1. **Schema 正式化**:`docs/telemetry-schema.md` + 對應的 zod/JSON Schema 檔,
   把現有 usage-events 與 workflow-telemetry 的欄位定成 v1 schema。實作前先
   決定 schema 程式碼與 JSON Schema 的固定落點(例如 `scripts/lib/telemetry-schema.mjs`
   與 `schemas/telemetry.v1.schema.json`;若 repo 已有更合適慣例,遵守現有慣例),
   不要把 schema 驗證散在 exporter/test 裡。若 repo 尚未使用 zod,不要為 hook
   熱路徑新增 zod runtime dependency;可用純 JS validator + JSON Schema,或把 zod
   限定在 dev/test/exporter 層並寫明理由。v1 schema 必須新增兩個關聯欄位:
   - `run_id`:一次 agent session/run 的識別。實作前先查證(外部事實,要查
     最新文件):Claude Code hook 的輸入 JSON 目前提供哪個 session 識別欄位、
     Codex 對應機制是什麼;有現成的就映射。舊欄位 `sessionId` / `session_id`
     要納入 migration/backward compatibility:讀舊 JSONL 時能映射成 `run_id`,
     寫新事件時保留或文件化是否仍輸出 legacy 欄位。若 host 沒提供穩定識別,
     優先使用可持久讀寫的 per-session marker 檔產生 UUID;不要預設 per-process
     UUID,避免同一個 run 被切成多條 trace。把 host 欄位優先順序與 fallback
     規則寫進 decision 記錄。
   - `event_id` + `parent_event_id`(可選):允許事件之間建立父子關係,對應
     OTel span 樹。
   欄位命名先對照 OpenTelemetry 的 GenAI/agent semantic conventions(這是
   還在演進的規範,必須查當下版本並在文件中註明對照的 convention 版本,
   不可憑記憶)。
2. **寫入端最小改動**:Claude 與 Codex 兩條 telemetry adapter 都要盤點與更新:
   `hooks/scripts/lib/hook-router/usage-telemetry.js`、
   `hooks/scripts/lib/hook-router/workflow-telemetry.js`、`codex/hooks/telemetry.js`。
   在每筆事件加上 `run_id`、`event_id`、`schema_version`。改動後跑
   `scripts/test-telemetry.mjs` 與 hook router golden replay
   (`hooks/scripts/tools/replay-hook-router.js`),兩者都必須綠。
   舊 JSONL(無新欄位)要能被讀取端容忍——匯出器遇到缺欄位就標
   `run_id=unknown`,不 crash。
3. **離線匯出器**:`scripts/export-telemetry-otlp.mjs`:
   - 讀 JSONL → 轉成 OTLP(traces 為主:一個 `run_id` 一條 trace,每個事件一個
     span 或 span event;舊資料缺 `run_id` 時映射為 `unknown`)→ 經 OTLP/HTTP
     送到 `--endpoint`(預設 `http://localhost:4318`)。
   - 支援 `--dry-run` 印出轉換後的 payload 不發送、`--since` 時間過濾、
     以及游標檔(記住上次匯出位置,重跑不重複發送)。
   - 依賴選擇:優先用 `@opentelemetry/*` 官方 JS 套件;若引入的依賴樹過重
     (安裝後 `node_modules` 明顯膨脹),退而求其次手工組 OTLP/HTTP JSON
     payload(protobuf-free 的 JSON encoding 是否仍受支援屬外部事實,查證
     後再決定)。把選擇理由寫進 decision 記錄。
4. **5 分鐘可驗證的 demo**:`docs/observability.md`:
   - 一條 `docker run` 起本機 collector + UI(例如 Jaeger all-in-one 或
     `otel/opentelemetry-collector` + 任一 viewer,選最少步驟的組合,實際跑過
     再寫)。
   - 觸發一次 hook 攔截 → 跑匯出器 → 在 UI 看到那條 trace 的截圖說明。
   - 明確標注:匯出是 opt-in 手動/排程動作,goldband 預設不外送任何資料
     (隱私立場要寫清楚)。

## 硬性限制

- hook 熱路徑不得新增網路 I/O、不得新增必裝依賴;`run_id` 產生要 O(1) 且
  失敗時 fallback 到 `unknown`,不能讓 hook 因 telemetry 失敗而擋不了命令
  或誤擋命令。
- JSONL 仍是 source of truth;OTLP 是衍生視圖。retention/rotation 行為不變。
- 遵守 coding style gate,提交前 `node scripts/check-code-style.mjs`。
- 匯出器是獨立 script,不進 installer 的預設安裝面(避免擴大維護面積);
  在 `OPERATIONS.md` 記錄使用方式即可。

## 實作步驟

1. 讀 `usage-telemetry.js`、`workflow-telemetry.js`、`codex/hooks/telemetry.js`、
   `report-usage-summary.js`、`scripts/test-telemetry.mjs`,盤點現有欄位,
   寫出 v1 schema 草稿。盤點時要明確列出 Claude 與 Codex 目前各自輸出的
   欄位差異,尤其是 `sessionId`、`source`、`host`、`detail`。
2. 查證三個外部事實並記下來源:(a) Claude Code hook input 的 session 識別
   欄位;(b) Codex 端對應機制;(c) OTel GenAI/agent semantic conventions
   目前版本與建議屬性名。
3. TDD:先擴充 `scripts/test-telemetry.mjs`(斷言新欄位存在、schema 驗證、
   舊格式容忍),再改寫入端。至少新增 fixture 覆蓋:
   - 舊格式 JSONL(只有 `sessionId`,沒有 `run_id` / `schema_version`)。
   - Claude `workflow-entry`。
   - Codex `workflow-entry`。
   - `hook-decision` deny event。
   - 缺 `run_id` 的 exporter fallback。
4. TDD:匯出器測試(fixture JSONL → 斷言 OTLP JSON 結構、游標行為、
   `--dry-run`),再實作匯出器。先讓 fixture exporter test 穩定通過,再處理
   docker collector demo;不要先把時間花在 UI 工具整合。
5. 本機起 collector,真跑一輪 demo,把步驟固化進 `docs/observability.md`。
6. CI:telemetry 測試與匯出器測試進現有 test job(全離線,不需要 collector;
   collector demo 不進 CI)。
7. 更新 `OPERATIONS.md` 與 `ARCHITECTURE.md`(observability 架構圖:
   hooks → JSONL → exporter → OTLP)。

## 完成定義(全部要有本次執行的證據)

- [ ] `scripts/test-telemetry.mjs` 與新增匯出器測試通過(貼輸出)。
- [ ] `report-usage-summary.js` 對新格式與舊 JSONL fixture 都可讀,不因缺
      `run_id` / `schema_version` crash。
- [ ] hook router golden replay 通過(證明熱路徑行為不變)。
- [ ] 本機 demo 完成:在 tracing UI 裡看得到一次 hook 攔截事件(描述所見)。
- [ ] `docs/telemetry-schema.md`、`docs/observability.md`、`OPERATIONS.md`、
      `ARCHITECTURE.md` 已更新,外部事實附來源與查證日期。
- [ ] `node scripts/check-code-style.mjs` 乾淨。
- [ ] Conventional commit(`feat: ...` 或拆成 `feat` + `docs`)。

## 明確不做

- 不做 metrics/logs pipeline(只做 traces,第一版)。
- 不做常駐 exporter daemon、不做自動上傳。
- 不改 telemetry 的 retention/rotation 策略。
- 不把第三方 SaaS(Datadog 等)的設定寫成預設——demo 只用本機 collector。

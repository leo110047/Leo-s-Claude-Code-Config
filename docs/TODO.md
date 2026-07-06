# TODO

## P0 - 補完 workflow convergence loop runtime

目前狀態：workflow convergence loop 的實作只完成了一部分。後續要補齊 runtime
自主多輪執行、stop condition predicate、逐輪 evidence、real-mode 驗證、以及文件同步。
目標是讓 loop 真的由 `goldband-loop/workflows/` runtime 擁有，而不是靠 markdown
指示或模型自律來完成「跑一輪、檢查、再跑下一輪」。

### 待辦

- [ ] 重新做 gap audit：對照目前 `goldband-loop/workflows/` 的實作狀態，
  標出 convergence loop 哪些已完成、部分完成、未完成、未驗證。

- [ ] 確認 loop controller 真正由 runtime 自主驅動，不靠 caller 手動塞
  `iteration` 或 `repeatedBlocker` 來假裝多輪。

- [ ] 補齊 stop predicate 的可執行測試：
  `target-met`、`iteration-cap`、`same-blocker-repeated`、`no-improvement`。

- [ ] 補齊 `goldband-review` 多輪語意：
  第一輪 findings 要能進入第二輪 context，第二輪要能判斷既有 findings 是否解掉、
  是否出現新問題，最後輸出 machine-readable loop summary。

- [ ] 補齊 `goldband-qa` 最小 typed adapter：
  固定 mock check list、schema 驗證 pass/fail、第二輪只 rerun failed checks。
  真 browser QA 不要硬搬進這次範圍；若未支援，要明確記 blocked / out of scope。

- [ ] 補齊 CLI 行為驗證：
  `--loop` 不破壞預設 single-pass，`--max-iterations` 在 real mode 只能調小、
  不能超過 registry cap。

- [ ] 補齊 evidence readback：
  每輪 JSONL event 要有 `iteration`、`signalSnapshot`；結束時要有
  `loop-summary`，能重建 signal trail 與 stop reason。

- [ ] 補跑或補建測試：
  loop controller unit tests、`goldband-review` mock 多輪整合測試、
  `goldband-qa` mock 多輪整合測試、iteration cap 限制測試。

- [ ] 補做 `goldband-review` real LLM e2e。
  若 host、授權、網路、或 budget gate 無法執行，不可用 mock 冒充；要在結果中
  明確標為 blocked / not verified。

- [ ] 同步文件：
  `ARCHITECTURE.md` 不可再宣稱 runner 只有 single-pass；
  `goldband-loop/workflows/README.md` 要描述實際 loop 行為；
  `goldband-loop/workflows/COVERAGE.md` 只在 runtime 狀態真的改變時同步。

- [ ] 補完整驗證紀錄：
  至少包含 focused runtime tests、`node scripts/check-code-style.mjs`、
  必要時 `cd goldband-loop && bun run gen:skill-docs` 與 dry-run freshness check。

### 驗收標準

- [ ] runtime 能在無 caller 介入下自主多輪執行並停在正確 stop condition。
- [ ] `goldband-review` 與 `goldband-qa` 的 mock 多輪整合測試都有逐輪 evidence。
- [ ] real-mode 驗證結果被誠實標記為 pass、blocked、或 not verified。
- [ ] 文件描述、registry 狀態、runtime 行為三者一致。
- [ ] 沒有直接編輯 generated `SKILL.md`。

## P1 - Workflow runtime migration

把目前仍是 `registered-only` / `legacy-thin` 的 workflow 逐步接進
`goldband-loop/workflows/` runtime。

### 背景

`goldband-loop/workflows/COVERAGE.md` 是 runtime 覆蓋清單，不是一般 TODO 檔。
後續真正要做的是依照 registry 的分級，把這些 workflow 從「只登記、仍靠
markdown prompt」推進到 `compatibility` 或 `typed` runtime。

### 優先順序

1. 先處理 browser / QA 類，讓檢查與 screenshot artifact 變成 typed evidence。
2. 再處理 `plan-*` review 類，保留 HITL 邊界，但把可程式化檢查 typed 化。
3. 高風險 deploy / setup / sync 類要先補 safety gate，再接 runtime。
4. 其餘 low-risk workflow 等 core runtime 穩定後再排。

### 驗收標準

- [ ] `goldband-loop/workflows/registry.ts` 的 `integrationStatus` 與 runtime 實作一致。
- [ ] 新接上的 workflow 能透過 `bun run workflows/run.ts <workflow>` 產生 JSONL evidence。
- [ ] 若還不能 real mode 執行，必須 fail closed，不可假裝已支援。
- [ ] `goldband-loop/workflows/COVERAGE.md` 只在 migration 狀態真的改變時同步更新。

## P1 - 補完 agent observability 消費端與 session trace

目前狀態：goldband 已有 local-first telemetry producer，也有 opt-in OTLP
exporter，但 observability 還是半套。Hook 會把事件寫成 JSONL，
`scripts/export-telemetry-otlp.mjs` 能把 JSONL 轉成 OTLP trace 送到
collector；`report-usage-summary.js`、`goldband_telemetry_query`、以及
`scripts/mine-telemetry.mjs` 能讀本機 JSONL 做統計或離線 mining。這代表
「發送端、schema、基本查詢」是有的。

缺口是：repo 沒有內建、常駐、可日常使用的消費端 UI 或 dashboard；Jaeger
只是一個手動外接 demo，不是 goldband 產品的一部分。更大的缺口是目前資料是
hook event 級別，例如 workflow entry、hook advisory、hook deny，而不是完整
agent session trace。它不能事後完整回放一輪對話中 agent 讀了哪些檔、呼叫了
哪些工具、tool input/output 是什麼、模型如何從多個事件走到最後結論。換句話說，
現在是「關卡打點」，不是 LangSmith / Braintrust 那類完整 session replay。

### 已確認的現有能力

- JSONL producer：Claude/Codex hooks 會寫 `schema_version`、`run_id`、
  `event_id`、`category`、`name`、`action`、`source`、`host`、`detail`、
  `recordedAt` 等欄位。
- OTLP exporter：`scripts/export-telemetry-otlp.mjs` 會把一個 `run_id`
  映射成一條 trace，把每個 JSONL event 映射成一個 span；export 是手動執行，
  不是 hook、daemon、或 installer default。
- 輕量 consumer：`hooks/scripts/tools/report-usage-summary.js`、
  MCP 的 `goldband_telemetry_query`、以及 `scripts/mine-telemetry.mjs`
  能做 aggregate query、failure taxonomy、replay fixture candidate、
  eval candidate、knowledge candidate。
- 外接 UI demo：`docs/observability.md` 記錄了用 Jaeger all-in-one
  收 OTLP 並查看 trace 的流程。
- 目前驗證：2026-07-06 跑過 `npm run test:telemetry`，schema、hook
  telemetry、OTLP exporter、telemetry miner 測試通過。

### 待辦

- [ ] 先寫清楚產品邊界：
  `docs/observability.md` / `ARCHITECTURE.md` 要明確區分
  `hook telemetry`、`OTLP export`、`offline mining`、`dashboard/UI`、
  `full session replay`，不可把 trace exporter 包裝成完整 agent
  observability。

- [ ] 補一個內建 consumption surface 的設計：
  最小版可以是 CLI/TUI/static HTML report，不一定一開始就做 web app；
  但要能從本機 JSONL 依 `run_id` 展開一個 session 的事件時間線、deny/advisory、
  workflow entry、cross-review events、以及相關 metadata。

- [ ] 定義 session trace schema v2：
  在現有 `goldband.telemetry.v1` 旁邊補一個明確的 session-level event
  contract，至少包含 `turn_id`、`tool_call_id`、`tool_name`、
  sanitized `tool_input` summary、sanitized `tool_output` summary、
  file/path references、exit status、duration、error shape、parent/child
  linkage、redaction status。

- [ ] 補 transcript / tool trace ingestion 邊界：
  Claude 若提供 `transcript_path`，只讀取必要 metadata 或 sanitized excerpts；
  Codex 若沒有穩定 transcript hook input，要明確記為 unsupported/unknown，
  不能假裝能完整回放。必要時支援 explicit import，例如從 host session
  JSONL 或 user-provided transcript 檔匯入。

- [ ] 補 redaction policy：
  session trace 會碰到 prompt、tool input/output、file paths、env、error logs；
  必須預設 local-only、fail closed、可 dry-run，並重用既有
  `secret-patterns.js` / sanitizer。未標記 `redaction_status: clean` 的內容
  不可 export 到 OTLP 或寫入 fixture/eval candidate。

- [ ] 補 OTLP mapping 升級：
  現在每個 hook event 是一個 span；新設計要能表達 turn span、tool span、
  hook decision span、workflow span 的 parent-child 關係。若資料不足，只能輸出
  partial trace，並標記 `trace_completeness: partial`。

- [ ] 補本機 dashboard/report：
  至少支援依時間、`run_id`、rule、workflow、host 篩選；能回答
  「這輪為什麼被 deny / blocked」、「哪個 workflow 被 inferred vs confirmed」、
  「有沒有 missing workflow evidence」、「哪些 session trace 不完整」。

- [ ] 補測試與 fixtures：
  加 session trace parser/redactor tests、JSONL backward compatibility tests、
  OTLP parent-child mapping tests、dashboard/report snapshot tests、以及缺資料時的
  partial/unsupported 狀態測試。

- [ ] 補 operational docs：
  說明資料在哪裡、如何匯出、如何清除、如何啟動 local UI/report、如何確認沒有
  network upload、如何判斷資料只是 hook-level 而不是 full replay。

### 驗收標準

- [ ] 使用者能從一個 `run_id` 重建至少 hook/workflow/tool summary 時間線。
- [ ] UI/report 明確標示每個 session 的 completeness：`hook-only`、
  `partial-session-trace`、或 `full-session-trace`。
- [ ] OTLP export 對完整 trace 與 partial trace 有不同標記，不誤導 collector/UI。
- [ ] 所有 prompt/tool/output 相關資料都有 redaction status；未清理資料不會外送。
- [ ] 文件不再把 Jaeger demo 或 OTLP exporter 說成內建 observability dashboard。
- [ ] `npm run test:telemetry` 通過，並補上 session trace / report 相關新測試。

### Non-goals

- 不在 hook path 做 network I/O。
- 不預設上傳 telemetry 到第三方服務。
- 不把模型 reasoning 當成 goldband 一定可取得的資料；host 沒提供就標記 unavailable。
- 不把 inferred workflow signal 當成 confirmed workflow completion。

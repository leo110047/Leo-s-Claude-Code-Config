# 實作 Prompt 12：整合 review 內容、read-only `/review`、平行 specialist review

> 使用方式：把本檔全文貼給一個乾淨的 Claude Code 或 Codex session，工作目錄為
> goldband repo 根目錄。這是 workflow contract 變更，不是單純文件改字。

---

## 你要使用的 skills

開始前先讀並遵守這些 skills。若 host 沒有某個 skill，記為 `not available`，
再用同等原則手動執行，不可假裝已使用。

- `goldband:evidence-based-coding`：所有 repo 狀態、API、測試、hook 行為都必須
  用當前檔案或指令驗證後再宣稱。
- `goldband:file-search`：用 `rg` / `rg --files` 先找真實檔案與引用，不靠記憶。
- `goldband:implementation-contracts`：改 workflow contract、權限、host adapter、
  review artifact、gate 語意時，必須明確 fail-closed 行為。
- `goldband:testing-strategy`：review 行為、cross-review gate、parallel specialist
  dispatch、read-only 權限都必須有測試或 golden assertion 覆蓋。
- `goldband:systematic-debugging`：測試或 generated skill 漂移時先追 root cause，
  不可刪測試、弱化 assertion、或只改 generated file 來過關。
- `goldband:prompt-hygiene`：改 reviewer prompt、specialist prompt、cross-review
  prompt 時，保留 outcome、verification、constraints、blocked behavior。

---

## 背景

goldband 目前有兩條 review 路徑：

1. 一般 `goldband review` / `/review`：偏工作流 code review。
2. `goldband cross-review`：目前 session 的簽核閘門，要求不同 model family 的
   reviewer 對 bounded bundle 做審查，通過後才解除 gate。

這次要做的不是刪掉其中一邊，而是把「review 內容」整合成一份共同 review engine，
同時保留兩邊不同的執行語意：

- 一般 `/review`：只讀、不改檔、不簽核。
- `cross-review`：只讀、使用同一套 review rules，但保留自己的 contract、
  artifact、verdict marker、reviewed-sha、Stop gate。

硬結論：

- 這是 workflow/runtime migration，不是 prompt wording change。
- Claude 端可以用 `Agent` / subagent 平行 review，但 read-only 必須靠
  allowed tools、permissions、hooks 或等價邊界 enforce。
- Codex 端用 `codex exec --sandbox read-only --output-schema ...`；平行 specialist
  要由 goldband TypeScript runtime 自己調度，不假設 Codex 有 Claude `Agent`
  等價能力。
- 第一版不要引入 Rust runner。瓶頸在 CLI/model latency，不在 TypeScript
  `Promise.all` orchestration。只有實測 TypeScript runtime 成為瓶頸時才重提。

---

## 先驗證，不要假設為真

動手前先跑這些檢查，並把結果摘要寫進實作紀錄。若某條命令不存在或輸出不同，
以當前 repo 為準修正本 prompt 的假設，不要硬套。

```bash
git status --short
rg -n "Fix-First|AUTO-FIX|Review Army|allowed-tools|Edit|Write|read-only" goldband-loop/review goldband-loop/test
rg -n "cross-review|reviewer-prompt|GOLDBAND-CROSS-REVIEW-VERDICT|reviewed-sha|Stop gate|Do not route" goldband-loop/cross-review commands goldband-loop/test
rg -n "reviewSteps|runReview|adapterFor|CodexHostAdapter|ClaudeHostAdapter|runJson|findingsSchema" goldband-loop/workflows goldband-loop/test
sed -n '1,140p' goldband-loop/workflows/review.ts
sed -n '1,130p' goldband-loop/workflows/host-adapter.ts
sed -n '1,140p' goldband-loop/cross-review/reviewer-prompt.md
sed -n '1,120p' codex/agents/reviewer.toml
```

目前預期會看到這些訊號，但仍要以當前檔案驗證為準：

- `goldband-loop/review/SKILL.md.tmpl` 和生成後的 `SKILL.md` 目前含有
  `Fix-First`、`AUTO-FIX`、`Edit` / `Write` 權限。
- `goldband-loop/review/SKILL.md` 已有 `Review Army` specialist dispatch 區塊，
  這是 Claude 端平行 subagent review 的既有基礎。
- `goldband-loop/workflows/review.ts` 目前會收集 diff、跑一次 review、驗證
  findings、輸出 report artifact。
- `goldband-loop/workflows/host-adapter.ts` 目前用 `--sandbox read-only` 執行
  Codex。
- `goldband-loop/cross-review/reviewer-prompt.md` 目前已要求 reviewer 只能看
  supplied bounded bundle，而且不能改檔。
- 現有測試刻意防止 `$goldband cross-review` 被直接 route 到 `/review`；除非你
  明確更新 contract 並說明理由，否則要保留這個 command boundary。

---

## 完工目標

完工狀態要同時滿足三件事：

1. **review 內容共用。** 一般 `/review` 與 `cross-review` 使用同一套核心
   review taxonomy、severity rule、specialist coverage、finding shape、dedupe /
   merge rules。不要維護兩份會漂移的 review checklist。
2. **一般 `/review` 是 read-only。** 一般 `/review` 不得 edit source files、
   不做 `AUTO-FIX`、不問使用者要不要現場修。它只產出 findings、證據、建議修法、
   建議驗證。若需要 artifact，只能寫入 Goldband workflow state/artifact 位置，
   不得修改 workspace source files。這必須有 host/runtime/hook enforcement，
   不能只靠 prompt 文字。
3. **review 要平行且分工明確。** 一般 `/review` 應能在 Claude 與 Codex host
   上把 review 拆成多個 specialist pass 平行執行，讓每個 agent 只審自己的責任
   範圍，再聚合成一份 findings report。

`cross-review` 的額外完工目標：

- 它可以呼叫 shared read-only review engine，或 consume shared review assets。
- 它仍然保留 `cross-review` contract、rounds、implementer responses、verdict
  marker、review artifact、reviewed-sha、human escalation、override / done flow。
- 它不能降級成普通 `/review`，也不能讓普通 `/review` 需要簽核。

---

## 不做什麼

- 不做 auto-fix。修復應交給 `/ship`、另一個 explicit repair workflow，或使用者
  另開實作任務。
- 不把 `$goldband cross-review` 直接 alias 到 `/review`。
- 不為了過測試刪掉 gate、刪掉 severity rule、刪掉 read-only assertion。
- 不讓 specialist agent 自己改檔、commit、push、開 PR、或呼叫 repair workflow。
- 不引入外部 paid/cloud review 作為唯一必要路徑。若整合 Claude `ultrareview`
  或其他外部 reviewer，只能是 optional second pass，且要有 timeout、auth、
  unavailable fallback 的明確 contract。

---

## 架構要求

### 0. Host capability contract

先把 host 能力寫進 code/test，不要藏在 prompt 裡：

- Claude path：`Agent` subagents 可以平行；每個 specialist 必須 read-only。
- Codex path：runtime 用 bounded concurrency 啟動多個
  `codex exec --sandbox read-only --output-schema ...`。
- 若某 host 不能 enforce read-only 或不能平行 dispatch，report 要列 skipped /
  degraded reason，不可假裝完成。
- `/review` 的 `Bash` 若仍可用，必須透過 read-only Bash policy 或等價 hook 擋住
  source mutation；只移除 `Edit` / `Write` 不算完成。

### 1. 共用 review engine

建立或整理一個 shared review engine layer，讓一般 `/review` 與 `cross-review`
共用 review 內容，但各自保留自己的 orchestration。

可接受的實作形狀：

- shared markdown assets：例如 `goldband-loop/review/checklist.md`、新增
  `goldband-loop/review/rubric.md`、`goldband-loop/review/specialists.md`、
  `goldband-loop/review/findings-schema.md`。
- shared TypeScript module：例如在 `goldband-loop/workflows/` 下提供
  build prompts、select specialists、merge findings、dedupe findings、
  severity normalization 的可測函式。
- shared prompt fragments：由 template / runtime / cross-review prompt 引用，
  不複製整段規則。

選一個最符合現有 repo 生成流程的方案。不要為了抽象而抽象；若只是文件共用，
就用 shared markdown；若 runtime 也需要平行化和 schema merge，就把可測邏輯放進
TypeScript module。

shared finding schema 至少要能表達：

- `severity`、`file`、`line`、`rule/category`、`failureScenario`、`evidence`
- `recommendation`、`suggestedVerification`
- `blocking` / `advisory`
- `specialist` / `contributingSpecialists`

`cross-review` 可用 adapter 映射到自己的 `ruleId`、`status`、verdict marker；
不要讓普通 `/review` 輸出 cross-review marker。

### 2. 一般 `/review` 的 read-only contract

更新 `goldband-loop/review/SKILL.md.tmpl`，然後用現有生成流程產生 `SKILL.md`。
不要只改 generated `SKILL.md`。

必須改掉：

- frontmatter `allowed-tools` 裡的一般 `Edit` / `Write` 權限。
- `Fix-First Review` 作為一般 review 的主流程。
- `AUTO-FIX`、`ASK to fix now`、`[AUTO-FIXED]` 等語意。
- 任何暗示一般 `/review` 會修改 source files 的文字。

替換為：

- `Read-Only Findings Review` 或等價命名。
- 每個 finding 都輸出：severity、file/line、failure scenario、evidence、
  recommendation、suggested verification。
- findings 可以標 `blocking` / `advisory`，但一般 `/review` 不做簽核。
- 若建議 patch，只能以文字形式描述，不可套用 patch。

`goldband-loop/review/checklist.md` 也要同步移除或改寫 `Fix-First Heuristic`。
若 `/ship` 仍需要 fix-first，請把 fix-first 移到 ship 專用 checklist 或命名為
ship-only，避免一般 `/review` 重新引用。

這不是可選整理：若 `/ship` 仍依賴 `review/checklist.md` 的 Fix-First 語意，
必須先拆出 ship-only source，否則會破壞 `/ship`。

### 3. 平行 specialist review

保留並強化現有 `Review Army` 思路，但把它變成一般 `/review` 的核心能力，不是
只存在 Claude template 的文字。

Specialist 建議至少包含：

- `correctness-contract`：功能正確性、狀態轉換、錯誤處理、資料一致性。
- `testing`：測試缺口、回歸測試、fixture、測試是否真的覆蓋風險。
- `security`：auth/authz、secret、injection、unsafe IO、供應鏈與權限。
- `performance`：N+1、hot path、bundle/query/memory、明顯擴展性問題。
- `migration-data`：schema、migration、backward compatibility、rollout safety。
- `api-host-parity`：CLI/API contract、Claude/Codex host parity、installer/runtime
  consistency。
- `maintainability`：重複、過度抽象、module boundary、長期維護風險。

選 specialist 時要依 diff scope 決定，不必每次全部跑。至少保留：

- 小 diff 可以只跑 core pass + testing / maintainability。
- security-sensitive diff 必跑 security。
- DB / migration diff 必跑 migration-data。
- host adapter / workflow / prompt diff 必跑 api-host-parity。
- 大 diff 或高風險 diff 可以加 red-team / adversarial pass。

Claude host：

- 若在 Claude Code skill 內可用 `Agent` tool，必須一次 launch 所有選中的
  specialist，讓它們平行執行。
- 每個 specialist prompt 明確 read-only，不得 edit/write。

Codex host：

- 優先使用 Codex 的 read-only execution boundary，例如 `codex exec --sandbox
  read-only` 或 repo 內已設定的 read-only reviewer agent。
- 在 TypeScript runtime 實作，使用 `Promise.allSettled` / bounded concurrency 跑
  多個 specialist prompts，並聚合成同一個 findings schema。
- 每個 Codex specialist 必須拿到 bounded input：diff、必要 repo context、
  specialist responsibility、shared finding schema。不要讓 specialist 自行猜
  要看哪份 prompt 或任意改檔。
- 不要為了第一版引入 Rust。先量測 CLI startup、model latency、parse/merge 時間；
  只有 TypeScript orchestration 真的成為瓶頸時再設計 runner/daemon。

### 4. Findings 聚合

新增或整理可測的 aggregation 行為：

- Normalize severity：`critical` / `high` / `medium` / `low` / `info`。
- Deduplicate by stable key：file、line、rule/category、failure scenario。
- Merge specialists：同一 finding 被多個 specialist 找到時保留最具體 evidence，
  並記錄 contributing specialists。
- Downgrade unsupported high/critical findings：沒有具體 evidence 的 blocker 不得
  保持 blocking severity。
- Output deterministic ordering：severity desc，再 file，再 line，再 rule/category。

一般 `/review` 的 final report：

- Findings first, ordered by severity。
- 每個 finding 要有 evidence 和 suggested verification。
- 明確說 `Read-only review: no files were modified`。
- 若有 skipped specialist，列出原因，例如 small diff、scope not relevant、
  host capability unavailable。

### 5. Cross-review 整合

`cross-review` 要改成 consume shared review content，而不是維護一套獨立 review
rubric。

保留：

- `goldband-loop/cross-review/core.cjs` 的 contract lifecycle。
- `GOLDBAND-CROSS-REVIEW-VERDICT` marker。
- `GOLDBAND-CROSS-REVIEW-FINDINGS` JSON line。
- reviewed-sha matching gate。
- max rounds、implementer response、human escalation、override、done。

整合方式：

- `cross-review/reviewer-prompt.md` 引用 shared review rules / rubric / finding
  taxonomy。
- `runReviewRound` 可以在 prompt bundle 中加入 shared review asset text，或呼叫
  shared prompt builder。
- Cross-review 的 verdict mapping 是 gate-specific：
  - no open valid blocking findings -> `APPROVED`
  - open valid `CRITICAL` / `HIGH` findings under blocking rules -> `CHANGES_REQUESTED`
  - insufficient evidence / human judgment required -> `ESCALATE`
- 一般 `/review` 不輸出 cross-review verdict marker，也不更新 gate marker。

---

## 可能涉及的檔案

先用 `rg` 驗證實際路徑；以下是目前預期主要範圍：

- `goldband-loop/review/SKILL.md.tmpl`
- `goldband-loop/review/SKILL.md`
- `goldband-loop/review/checklist.md`
- `goldband-loop/review/design-checklist.md`
- `goldband-loop/review/greptile-triage.md`
- `goldband-loop/workflows/review.ts`
- `goldband-loop/workflows/host-adapter.ts`
- `goldband-loop/workflows/schema.ts`
- `goldband-loop/workflows/types.ts`
- `goldband-loop/cross-review/reviewer-prompt.md`
- `goldband-loop/cross-review/rubric.md`
- `goldband-loop/cross-review/core.cjs`
- `commands/goldband-cross-review.md`
- `codex/agents/reviewer.toml`
- `codex/config.toml`
- `hooks/scripts/lib/hook-router/freeze-mode-rules.js`
- `hooks/scripts/lib/hook-router/pretool-policy.js`
- `codex/hooks/high-risk-policy.js`
- `goldband-loop/test/gen-skill-docs.test.ts`
- `goldband-loop/test/skill-validation.test.ts`
- `goldband-loop/test/workflows-runtime.test.ts`
- `goldband-loop/test/review-specialist-dispatch.test.ts`
- any workflow runtime tests that cover `reviewSteps`, host adapters, or
  cross-review parsing。

不要碰 unrelated dirty files。若 `git status --short` 顯示既有使用者變更，
要繞開它們並在 final report 分開說明。

---

## 實作計畫

### Phase 1 — 現況稽核

在 final response 裡提供簡短 audit note，不一定要 committed doc，涵蓋：

- 一般 review 目前哪裡允許 write 或 auto-fix。
- 平行 `Review Army` 目前在哪裡存在。
- programmatic `goldband-review` 哪些地方已經是 read-only 或 artifact-only。
- cross-review gate 在哪裡實作，哪些東西不能移除。
- 哪些測試目前鎖住舊語意。
- 目前有沒有可重用的 read-only Bash / freeze-mode hook policy。

只有在 repo 狀態和核心需求互相矛盾，或另一個 agent 已經改到同一批檔案導致
安全編輯不明確時，才停下來問。

### Phase 2 — 共用 review 內容

建立或重構 shared review assets，讓一般 review 和 cross-review 可以 consume
同一套 review taxonomy 與 specialist responsibilities。

預期結果：

- 有一份 canonical review checklist/rubric，涵蓋 correctness、tests、security、
  performance、migration/data、API/host parity、maintainability，以及適用時的
  UX/design。
- Cross-review prompt references 或 includes canonical content。
- General review prompt references 或 includes canonical content。
- 既有 duplicated cross-review-only rubric text 要被移除、縮小成 gate-specific
  verdict mapping，或明確從 shared content 產生。

驗證：

```bash
rg -n "Fix-First|AUTO-FIX|Read-Only Findings|Review Army|GOLDBAND-CROSS-REVIEW-VERDICT|shared review" goldband-loop/review goldband-loop/cross-review goldband-loop/test
```

### Phase 3 — 一般 review read-only

把一般 review 改成不能修改 source files。

預期結果：

- `goldband-loop/review/SKILL.md.tmpl` 不再授予 `/review` 一般 `Edit` / `Write`
  權限。
- 生成後的 `goldband-loop/review/SKILL.md` 與 template 同步。
- `Fix-First` 不再屬於普通 `/review`。
- 任何剩餘 fix-first 文字都清楚限定在 `/ship` 或另一個 explicit repair flow。
- Greptile/design/adversarial findings 進入 read-only findings output，不進
  auto-fix。
- 若保留 `Bash`，必須接上 read-only Bash enforcement 或明確改成只允許 safe
  inspection commands。
- `/ship` 需要的 Fix-First 語意必須搬到 ship-only source，不可留在普通
  `/review` checklist 裡。

驗證：

```bash
bun run gen:skill-docs
rg -n "allowed-tools:|Edit|Write|Fix-First|AUTO-FIX|Read-only review|Read-Only Findings" goldband-loop/review/SKILL.md.tmpl goldband-loop/review/SKILL.md goldband-loop/review/checklist.md
rg -n "read-only-bash-only|no-file-edits|freeze-mode" hooks goldband-loop/test codex
```

### Phase 4 — 平行 specialist runtime

實作或強化 parallel specialist review，讓 Claude-facing skill flow 與
Codex/programmatic workflow flow 都有對應策略。

預期結果：

- Specialist selection 由 diff scope deterministic 決定。
- Specialist prompts 是 bounded 且 read-only。
- host/runtime 支援時，多個 selected specialists 會 concurrent 執行。
- Aggregation 處理 dedupe、severity normalization、evidence requirements、以及
  deterministic ordering。
- Host capability gap 要明確出現在 report，不得靜默假裝已經 parallel review。
- Codex path 用 TypeScript runtime 平行啟動 `codex exec`，不要新增 Rust。

驗證：

```bash
rg -n "specialist|Review Army|Promise.all|concurrency|read-only|dedupe|severity" goldband-loop/workflows goldband-loop/review goldband-loop/test
```

新增或更新測試，讓這些情況會失敗：

- runtime 預期 parallel dispatch，但 specialist review 退回 serial。
- specialist prompt 可以 write files。
- unsupported high/critical findings 沒有 evidence 卻仍保持 blocking。
- aggregation output order 不 deterministic。

### Phase 5 — Cross-review 使用 shared review engine，但保留 gate

更新 `cross-review`，讓它使用 shared review content，同時保留 gate semantics。

預期結果：

- `cross-review/reviewer-prompt.md` 不再持有一套會漂移的獨立 review standard；
  它 references 或 embeds shared review rules。
- Cross-review 仍輸出 parseable `GOLDBAND-CROSS-REVIEW-VERDICT` 與
  `GOLDBAND-CROSS-REVIEW-FINDINGS`。
- Stop gate 仍會在 artifact missing、invalid、not approved、escalated、或
  reviewed-sha mismatch 時 block。
- `$goldband cross-review` 仍是獨立 command，不 route 到普通 `/review`。

驗證：

```bash
rg -n "Do not route `\\$goldband cross-review` to `/review`|GOLDBAND-CROSS-REVIEW-VERDICT|reviewed-sha|shared review|APPROVED|CHANGES_REQUESTED|ESCALATE" commands goldband-loop/cross-review goldband-loop/test
```

### Phase 6 — 測試與 generated artifacts

更新測試以反映新的 contract。

必要測試變更：

- 把一般 `/review` 舊的 `Fix-First + Review Army` expectation 改成
  `Read-only + Review Army`。
- 加 assertion：普通 `/review` generated skill 不包含一般 `Edit` / `Write`
  permission。
- 加 assertion：普通 `/review` 不包含 `AUTO-FIX` 或要求使用者套用修復的 prompt。
- 加 assertion：普通 `/review` 的 read-only contract 不是只靠文字；source file
  mutation 會被 host/runtime/hook 邊界擋住，或 command set 不包含 mutation path。
- 加 runtime tests：Codex specialists 使用 bounded concurrency，且每個 invocation
  帶 `--sandbox read-only` 和 schema。
- 保留 assertion：`Review Army` / specialist dispatch 存在。
- 保留 assertion：`$goldband cross-review` 不會直接 route 到 `/review`。
- 新增或更新 cross-review tests，證明 shared review integration 後 gate marker 與
  reviewed-sha semantics 仍然存在。

先跑最小相關測試，再跑較廣檢查：

```bash
bun test goldband-loop/test/gen-skill-docs.test.ts
bun test goldband-loop/test/skill-validation.test.ts
bun test goldband-loop/test/workflows-runtime.test.ts
bun test goldband-loop/test/review-specialist-dispatch.test.ts
```

若 repo 有標準 inventory/golden check，final 前要跑：

```bash
bun run gen:skill-docs
```

只有在 local repo instructions 或 changed files 要求時，才跑更大的 suite。
如果 command 因為既有 dirty file 或環境問題失敗，要記下 exact failure，不要用
文字帶過。

---

## 驗收條件

只有同時符合以下條件，才算完成：

- 一般 `/review` 在 prompt、allowed tools、runtime behavior 上都是 read-only。
- read-only 是 enforceable boundary，不只是 prompt instruction。
- 一般 `/review` 保留或強化 parallel specialist review。
- Codex path 有 TypeScript runtime 的 read-only parallel specialist 策略，不只是
  Claude `Agent` 文字。
- `cross-review` 使用 shared review standard，但保留自己的 gate。
- Findings schema 與 aggregation 足夠共用，避免普通 review 和 cross-review 的
  review 內容再次漂移。
- `/ship` 的 Fix-First 行為若保留，已移到 ship-only source，沒有反向污染
  read-only `/review`。
- 測試會在舊 contract 下失敗，在新 contract 下通過。
- Final report 清楚列出 modified files、verification commands、以及 skipped checks。

---

## Blocked behavior

遇到以下情況要停下回報，不要猜：

- Claude 或 Codex host capability 不可用，而且沒有安全 read-only fallback。
- 既有使用者變更和你需要修改的 review / cross-review 檔案衝突。
- 測試顯示 `/ship` 或其他 workflow 仍依賴 `review/checklist.md` 裡的 fix-first
  semantics。這時要先拆 checklist，不可弱化 read-only `/review` contract。
- Cross-review parser 或 Stop gate 需要被弱化才吃得下 shared review output。
  不可弱化 gate；要把 shared output adapter 成現有 verdict contract。

Blocked 時回報：

- 已驗證什麼。
- 哪個檔案或 command 擋住進度。
- 最安全的下一步。
- 你刻意沒有改什麼。

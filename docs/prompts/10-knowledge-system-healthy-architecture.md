# 實作 Prompt 10：Goldband 長期健康知識系統架構

> 使用方式：把本檔全文貼給一個乾淨的 Claude Code 或 Codex session，工作目錄為
> goldband repo 根目錄。接續 `docs/prompts/09-knowledge-base.md`；目標不是重做
> 第一版知識庫，而是把它補成長期可維護、可驗證、可信任的系統。

---

## 你要使用的 skills

開始前先讀並遵守這些 skills。若 host 沒有某個 skill，記為 `not available`，
再用同等原則手動執行，不可假裝已使用。

- `goldband:evidence-based-coding`：所有 repo 狀態、API、測試、hook 行為都必須
  用當前檔案或指令驗證後再宣稱。
- `goldband:file-search`：用 `rg` / `rg --files` 先找真實檔案與引用，不靠記憶。
- `goldband:implementation-contracts`：改 schema、hook、CLI、resolver、MCP 或
  持久化狀態時，必須明確 contract 與 fail-closed 行為。
- `goldband:testing-strategy`：新增或改變 recall、capture、promotion、
  sanitizer 時，必須補對應測試。
- `goldband:systematic-debugging`：測試或 runtime 行為失敗時先追 root cause，
  不可跳過測試、弱化驗證、刪規則來過關。
- `goldband:decision-log`：若做出長期影響資料分層、信任模型、跨 host 行為或
  同步策略的決定，補 decision record。

---

## 現況（先驗證，不要假設為真）

- `goldband-loop/lib/knowledge.ts`：curated knowledge 的 schema、markdown
  entry、`index.json`、`add/capture/search/graduate/retire/validate/reindex`。
- `goldband-loop/bin/goldband-knowledge.ts`：對應 CLI；今天 `add` 的 `--id`
  是人工輸入的 slug，沒有自動來源的 id 產生規則。
- `goldband-loop/bin/goldband-learnings-log`：append-only project learnings。
- `goldband-loop/scripts/resolvers/{learnings,knowledge}.ts`：learnings
  search/capture 提示，以及彙整 learnings + curated knowledge + optional
  GBrain 的 `{{PRIOR_KNOWLEDGE}}`。
- `mcp/server/src/knowledge-query.ts` / `server.ts`：MCP `knowledge-query`。
- `scripts/mine-telemetry.mjs extract-knowledge`：從 local telemetry 產生
  `status: candidate` 的 sanitized candidate。
- `codex/hooks/hook-router.js` / `telemetry.js`：記錄 hook decision /
  advisory / workflow entry telemetry；不假設它們會自動寫入 curated
  knowledge。
- `docs/observability.md`：telemetry 是 local JSONL first，OTLP export 手動
  opt-in，telemetry miner 是 read-only consumer。

## 問題

不是「沒有知識庫」，而是「知識生命週期還不夠完整」：

1. Agent 查得到 prior knowledge，但不一定在重要發現後自動留下候選紀錄。
2. `learnings.jsonl`、curated `knowledge/`、telemetry candidates、MCP
   query、workflow resolver、Codex/Claude hooks 之間責任邊界不夠明確。
3. 自動捕捉若直接變成 active knowledge，會把未驗證、過期、prompt-injection、
   host-specific noise 帶進未來 session。
4. 高價值條目若不畢業成 skill/rule/hook/doc/decision record，`knowledge/`
   會變成第二套真理來源，長期腐爛。
5. Codex 與 Claude 的曝光面不應長期不對等；某 adapter 只能 advisory 時，
   文件與 status 必須誠實顯示這個落差。

## Outcome

完工狀態是一個知識生命週期：raw evidence -> candidate -> active ->
graduated/retired，滿足：

- 自動只留「候選」，不自動升格為「可信規則」。
- 召回只注入路徑、摘要、confidence、last_verified，不把全文倒進 context。
- 每條知識都能追出來源、信任等級、驗證日期、狀態、畢業去向。
- 高信心、跨 session 證實的知識能畢業到 skill/rule/hook/doc/decision
  record。
- 任何自動寫入都 local-first、可 dry-run、可關閉、可審查、有測試覆蓋。
- Claude、Codex、MCP、workflow template、telemetry miner 對同一份資料
  contract 的排序、status default、filter 語意一致。

---

## 架構與規則（唯一權威版本；後面的交付清單只引用章節號，不重述規則）

### 1. Raw evidence layer

來源：hook telemetry、workflow evidence、session-level report、manual
input。

- 永遠 append-only 或 read-only mining；不在 hook path 做 network I/O。
- 不把 raw prompt、tool output、secret、完整 transcript 寫入 knowledge
  entry。
- 原始資料與 curated knowledge 分開存放；telemetry JSONL 不是知識庫。

### 2. Candidate capture layer

允許來源：`manual`（使用者要求，或 workflow 收尾時 agent 主動提出且使用者
同意）、`workflow-evidence`（workflow 產生的 verified evidence）、
`telemetry-miner`（offline miner 從 sanitized telemetry 產生）、
`hook-advisory`（hook 只能提出 capture advisory；沒有明確 opt-in config 就
不能靜默寫入 curated knowledge）。

硬規則：

- 自動產生的一律 `status: candidate`；不得被 default recall 當可信答案，
  只在明確 `--status candidate` 或 review workflow 裡可見。
- 必須有 source evidence pointer，pointer 不能含敏感原文。
- Candidate id 必須 deterministic，避免同一事件反覆製造垃圾條目。規則：
  `id = <source_type>-<YYYYMMDD>-<hash8>`，`hash8` 是對
  `source_type + normalized source pointer + sanitized summary` 做 sha256
  後取前 8 碼 hex。capture 前先查 `index.json` 是否已有相同 id：存在就視為
  重複並 skip（不覆寫已被人工編輯過的 candidate），不存在才寫新檔。

### 3. Candidate 存留與清理

Candidate 是暫存區，必須有存活期，否則無限堆積。

- 超過設定天數（預設 30 天，可 config 覆寫）未被 review/promote/retire，
  `goldband-knowledge-review list` 標成 `overdue` 並排最前面。這只是
  review list 顯示標籤，刻意不叫 `stale`，避免跟第 4 節 `staleness`（判斷
  active/graduated 條目引用檔案是否還存在）混淆——兩者是不同層級的過期
  判斷，不要合併成同一欄位。
- `overdue` 不觸發自動刪除或自動 retire；那一樣要走人工或 workflow 明確
  動作，這條規則只影響顯示順序與標記。
- 判斷 overdue 用既有欄位就夠：candidate 建立時間或 `last_verified`（null
  時用檔案 mtime／frontmatter 建立時間）與目前日期比較，不需要新增獨立的
  `expires_at` 欄位。

### 4. Curated knowledge layer

沿用 `goldband-loop/lib/knowledge.ts` 的 markdown + frontmatter +
`index.json`，不引入向量資料庫或第二套 store。保留現有 type
(`problem-solution`/`decision`/`practice`) 與 status
(`candidate`/`active`/`graduated`/`retired`)。

新增 metadata 一律 backward-compatible extension，不破壞既有 entries；
`validate` 對舊 entry 不應突然 fail 除非有 migration；
`renderKnowledgeEntry` 與 frontmatter parser 要 roundtrip；`index.json`
要含 recall 需要的最小欄位。建議新增或確認以下欄位是否已足夠，若決定不
新增，要在報告中說明現有欄位如何滿足同等需求：

- `source_evidence`：sanitized evidence id / report path / workflow run
  id。
- `trust_level`：`user-stated`/`verified`/`observed`/`inferred`/
  `telemetry-derived`。
- `reviewed_by`：`user`/`workflow`/`agent`/空字串。
- `staleness`：`fresh`/`needs-review`/`stale`，或用既有 `last_verified` 加
  resolver 判斷。

### 5. Recall layer

沿用並強化 `{{PRIOR_KNOWLEDGE}}`，不在各 template 堆疊相似查詢。

- Workflow 開始前查一個 consolidated recall surface；default 只查
  `active`，除非 workflow 明確要審查 candidates。
- 輸出「路徑 + 一行摘要 + confidence + updated/last_verified」，不注入
  全文；命中時 agent 先引用路徑與摘要，再決定是否讀全文。沒命中時明確說
  `知識庫無相關條目`。
- 條目引用的檔案不存在，或 `last_verified` 太舊，resolver 標記
  `needs-review`，不可默默當高信心答案。
- CLI、resolver、MCP 的 status default 與排序（confidence 優先，再
  updated/last_verified）要一致。

### 6. Promotion and graduation layer

- `candidate -> active` 需要人工確認，或 workflow 產生足夠 evidence 並
  明確標示 `reviewed_by`。
- `active -> graduated` 必須填 `graduated_to`，指向 skill、rule、hook、
  doc、decision record 或 test。
- 已畢業條目仍保留，但 recall 預設不當成第二份規則，應提示使用者去讀
  `graduated_to`；與 skill/rule/doc 衝突時以已畢業正式 artifact 為準，
  knowledge 條目要更新或 retired。

### 7. Safety and trust layer

知識庫是會被 prompt-injection 汙染的本機資料：

- 重用既有 sanitizer / secret pattern，或把 shared sanitizer 抽到可重用
  位置；`goldband-learnings-log` 已有的 instruction-like content 防護，
  knowledge capture、telemetry candidate、MCP output 要有同等或共用防護。
- 禁止把 instruction-like content 當可執行指令注入 context；recall
  output 把 knowledge 當資料，不當 system instruction。
- 自動 capture 必須有 dry-run 與 opt-out。
- 不把真實 knowledge entries、telemetry、session trace commit 進 repo；
  測試 fixture 必須 synthetic 或 sanitized，涵蓋 secret-shaped text、
  role-label injection、ignore-instructions 類內容。

### 8. Host adapter layer

Claude、Codex、MCP 可以有不同 adapter，但資料 contract 要一致：

- CLI 與 resolver 不可硬綁 `~/.claude`；Codex 生成物用 `$GOLDBAND_BIN` 或
  實際 install path。
- `install.sh status` 或等價 surface 要能看出 `goldband-knowledge` CLI、
  candidate review、`{{PRIOR_KNOWLEDGE}}` 生成、MCP `knowledge-query` 是否
  在 Claude 與 Codex 各自暴露。
- Codex hook 若只能 advisory，文件不可宣稱它會自動寫入 knowledge。
- MCP `knowledge-query` 與 CLI `goldband-knowledge search` 的排序、status
  default、filter 語意不一致時，補測試並修正。

---

## 交付清單

不必按順序做完才算數，但建議次序是：先查現況落差，再動 schema/sanitizer，
再動 capture pipeline，再動 review/promotion workflow，再動
recall/staleness，再修 host 曝光落差，最後補測試——因為後面幾項的正確性
依賴前面查清楚的落差表。每項都引用上面的章節號，不重述規則。

**現況落差稽核**（先做，其他交付都依賴這張表）

```bash
git status --short
rg -n "goldband-knowledge|PRIOR_KNOWLEDGE|LEARNINGS_SEARCH|extract-knowledge|knowledge-query|goldband-learnings-log" .
sed -n '1,260p' docs/prompts/09-knowledge-base.md
sed -n '1,260p' goldband-loop/lib/knowledge.ts
sed -n '1,220p' goldband-loop/bin/goldband-knowledge.ts
sed -n '1,220p' goldband-loop/scripts/resolvers/knowledge.ts
sed -n '1,220p' goldband-loop/scripts/resolvers/learnings.ts
sed -n '1,180p' mcp/server/src/knowledge-query.ts
sed -n '1,220p' codex/hooks/hook-router.js
sed -n '1,220p' codex/hooks/telemetry.js
rg -n "knowledge|learn" shell/install/skill-catalog.txt
./install.sh status
```

整理成一張表：capability × Claude 曝光 × Codex 曝光 × 是否有測試。這張表
直接驅動「host 曝光落差」交付項，不要之後重新稽核一次。

**文件**（§1 lifecycle、§7 safety boundary、§8 host boundary）：更新或新增
架構文件，涵蓋 lifecycle、trust model、default recall policy（active
only）、candidate review policy、host adapter boundary、privacy boundary。
放 `ARCHITECTURE.md`（若適合）、`docs/observability.md`（只補
telemetry/mining 與 candidate 邊界）、`docs/prompts/09-knowledge-base.md`
（只補摘要，不重複整份 prompt）；長期決定另補
`docs/DECISIONS.md`。

**Schema 與 sanitizer**（§2、§4、§7）：核對 schema 是否足以表達 source
evidence、trust、review、staleness；按 §4 規則決定是否新增欄位；補齊
§7 的 sanitizer 測試。

**Candidate capture pipeline**（§2、§3）：`goldband-knowledge
capture-candidate` 或既有 `capture --status candidate` 的 documented
wrapper；workflow 收尾 resolver 在發現 non-obvious verified insight 時
輸出 candidate capture command 或 dry-run artifact；telemetry miner 保持
read-only input，只有指定 `--knowledge-home` 才寫本機 knowledge root；
Codex Stop hook 可以 advisory 提示 capture command，沒有明確 opt-in
config 不直接寫檔。驗收例子：「Codex sandbox 內的 macOS keychain /
codesign / spctl trust 評估不等同 host 真實 trust 狀態」這類調查結果應能
產生 `candidate` 條目，且 default recall 不會當成 active rule，直到人工
promote。

**Review / promotion workflow**（§3、§6）：擴充 `goldband-learn` 或新增
`goldband-knowledge-review` workflow，支援 list candidates（`overdue`
排最前）、show entry、promote to active、edit summary/body、retire
duplicate/stale entry、graduate active entry to skill/rule/doc；每次
promote 寫入 review metadata 或更新 `last_verified`；host 沒有
`AskUserQuestion` 時 workflow 要 report blocked 或改用明確
non-interactive command，不可自行替使用者決定 promote。

**Recall 與 staleness**（§5）：CLI、resolver、MCP default 都是
`status=active`；candidate 只在 candidate review 或明確 `--status
candidate` 顯示；查詢排序一致；recall 顯示 last verified/updated/
confidence；對 path-based evidence 做 staleness detection，檔案不存在時
標 `needs-review`；逐步盤點仍用 `{{LEARNINGS_SEARCH}}` 的 workflow，先改
最能驗證 contract 的 2-3 個，不要一次大改。

**Host 曝光修正**（§8）：依現況落差稽核那張表修正 `install.sh status`
（顯示 CLI installed、candidate review 在 Claude/Codex 是否 exposed、
`{{PRIOR_KNOWLEDGE}}` 生成情況、MCP 可用性）；Codex profile 若沒有 exposed
skills/workflow，修 installer 或文件，不能只說「CLI 存在」；補
distribution/inventory tests 避免 generated skill/plugin/app-support
asset 漏包。

**測試**：Knowledge CLI（add/capture candidate、validate backward
compatibility、promote/retire/graduate、sanitizer rejection、index
rebuild 不丟既有 entries）；Recall resolver（default active only、
candidate explicit only、Codex 路徑用 `$GOLDBAND_BIN`、Claude 路徑用
installed bin dir、GBrain suppressed 時不破壞 recall）；MCP
(`knowledge-query` 與 CLI filter/sort/status 語意一致)；Telemetry
miner（read-only inputs、sanitized candidate output、`--knowledge-home`
才寫本機 root、不寫 raw secrets/敏感絕對路徑）；Hooks（advisory 不阻擋、
no auto active write、dedupe/rate limit、telemetry 記錄不影響 hook
成敗）；Installer/generated docs（`goldband-loop` inventory、generated
`SKILL.md` freshness、Codex/Claude exposure status）。

---

## 驗證指令

依實際改動選擇，至少跑 focused tests。指令不存在就找 repo 現行等價指令，
不要硬編。

```bash
cd goldband-loop && bun test test/goldband-knowledge.test.ts test/learnings-injection.test.ts test/gen-skill-docs.test.ts
bun test test/skill-e2e-learnings.test.ts test/goldband-memory-helpers.test.ts test/goldband-memory-ingest.test.ts
cd .. && node scripts/test-telemetry-miner.mjs
node scripts/check-goldband-loop-inventory.mjs
./install.sh status
git diff --check
```

改 MCP：`cd mcp/server && npm test`

改 hook：`npm run test:hook-router && npm run test:telemetry`

改 generated workflow docs：`cd goldband-loop && bun run gen:skill-docs && cd .. && git diff -- goldband-loop`

---

## 不做什麼

- 不做向量資料庫、embedding、GUI 或 cloud sync，除非使用者另外要求。
- 不把 telemetry export 或 OTLP 當知識同步機制。
- 不把 candidate 當 active knowledge；不讓 hook 在未 opt-in 時寫 active
  knowledge。
- 不把真實 user conversation、secret、raw transcript、完整 tool output
  寫進 repo。
- 不為了通過測試刪 sanitizer、降低 hook gate、或弱化 schema validation。
- 不直接編輯 generated `SKILL.md` 後就結束；要改 template/generator/
  inventory 對應來源。

---

## Blocked handling

遇到以下情況要停止並回報，不要自行假裝完成：

- 需要使用者決定是否 promote candidate，但目前 host 沒有互動提問能力。
- 需要 network、外部服務、付費 LLM 或 host-specific session transcript，
  但環境不可用。
- 現有 tests 與文件宣稱互相矛盾，且無法在兩次修正內解開。
- 發現自動 capture 可能寫入敏感資料，但 sanitizer 還不能證明安全。
- Installer status 顯示某 host 未曝光功能，但你無法判定安裝模型。

```text
BLOCKED:
- Blocker:
- Evidence:
- Tried:
- Safe next step:
```

---

## 最終回報格式

完成後用中文回報：

- 改了哪些檔案。
- 現在 knowledge lifecycle 的資料流是什麼。
- 哪些行為是自動 candidate，哪些需要人工 promote。
- Claude / Codex / MCP 各自支援到哪裡。
- 跑了哪些驗證，結果是 pass / fail / not run。
- 還有哪些 known limitations。

不要只說「已完成」。每個結論都要能對到檔案、測試或指令輸出。

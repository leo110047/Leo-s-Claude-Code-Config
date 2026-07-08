# 實作 Prompt 9：跨領域知識庫與 agent 導引機制

> 使用方式：把本檔全文貼給一個乾淨的 Claude Code 或 Codex session，工作目錄為 goldband repo 根目錄。

---

## 背景

goldband 是 Claude Code 與 Codex 的雙 host 工作流配置系統。工作流不只工程：
`goldband-loop/` 底下涵蓋 review、qa、cso（安全）、design-review、autoplan、
docs、browse、benchmark、ios-* 等領域，每個工作流有自己的 `SKILL.md`（由
`SKILL.md.tmpl` 生成）。

系統已經有半套知識庫與召回機制，但彼此不相通，導引也不一致：

- workflow runtime 的執行 evidence 落在
  `${GOLDBAND_HOME:-$HOME/.goldband}/workflow-runs/<workflow>.jsonl`
  （`goldband-loop/workflows/evidence.ts` 的 `evidencePath()` 與 `stateRoot()`）。
- learnings 已有 append-only JSONL 與召回 macro：
  `goldband-loop/scripts/resolvers/learnings.ts` 註解的 schema 是
  `ts, skill, type, key, insight, confidence, source, branch, commit, files[]`；
  多個 workflow template 已透過 `{{LEARNINGS_SEARCH}}` 查詢既有 learnings。
- GBrain 已有 optional brain lookup：
  `goldband-loop/scripts/resolvers/gbrain.ts` 會產生 `{{GBRAIN_CONTEXT_LOAD}}`，
  但它是可選 mod；不支援的 host 會透過 `suppressedResolvers` 消成空字串。
- hook telemetry 走 `goldband.telemetry.v1` schema
  （`scripts/lib/telemetry-schema.cjs`），telemetry miner 已能從中產出
  failure taxonomy（`docs/failure-taxonomy.md`）。
- 決策記錄有 `skills/global/decision-log` 技能，但產出散在各專案。
- 第一方 MCP server 在 `mcp/server/src/`，目前註冊三個工具
  （見 `mcp/server/src/server.ts` 的 `registerTool` 呼叫，含 telemetry-query）。
- Claude hook 端有 `hooks/scripts/hooks/hook-router.js` 與
  `hooks/scripts/hooks/skill-activation-suggestions.js`，回歸防護靠
  `hooks/fixtures/router/replay-fixtures.json` replay。

缺的是一個統一的**知識整理與導引層**：跨領域、結構化、可累積、可檢索，
而且——最關鍵的——goldband 要能在對的時刻**主動把 agent 導去看**，
不能靠 agent 自己想到要查。

## 目標

在 `${GOLDBAND_HOME:-$HOME/.goldband}/knowledge/` 建立本機 curated
knowledge layer，並接上三個召回掛載點。`knowledge/` 不取代
`learnings.jsonl`、GBrain、context-save/context-restore；它只存已整理、
可被 workflow 主動引用、未來可能畢業成 skill/rule 的高價值條目。

知識庫收三種條目形狀，跨所有工作流領域：

1. **problem-solution**：踩過的坑與解法（工程、QA 環境、瀏覽器測試、iOS 建置都算）。
2. **decision**：重要決定與理由（架構、設計、流程、工具選型）。
3. **practice**：驗證過好用的做法（之後可畢業成正式 skill 或 rule）。

## 核心原則

- **召回優先於寫入**：只進不出的知識庫等於失敗。三個掛載點裡，workflow
  內建的「先查再做」步驟是保底，必須先做通。
- **塞指引不塞全文**：hook 與 workflow 步驟只注入條目路徑加一行摘要，
  agent 需要才去讀全文，不把知識庫倒進 context。
- **知識庫是孵化器，不是第二套真理來源**：高頻、已驗證的條目要畢業成
  skill 或 rule；與現行 skill/rule 衝突時以 skill/rule 為準。
- **底層儲存分離，召回呈現統一**：learnings 永遠可用，GBrain 是 optional
  mod，knowledge 是 curated layer。不要把三者合併成單一 storage；要做的是
  一個統一 resolver 輸出一個清楚區塊，內部依 host 能力查不同 backend。
- **雙 host 對等**：Claude 與 Codex 讀同一份知識庫。host 專屬的只有掛載
  adapter，不是資料本身。
- **知識庫是本機狀態，不進 repo**：條目可能含專案資訊，一律留在
  `~/.goldband`，不 commit 進 goldband repo。repo 只收 schema、工具、
  測試 fixture（fixture 必須是消毒過的合成資料）。
- **只讀不搬**：從 telemetry 與 evidence 產生候選條目時，對原始 JSONL
  唯讀，不清理、不改寫、不搬移。
- **實作前驗證路徑**：本文件引用的路徑以當下 repo 為準；動手前先讀
  `goldband-loop/workflows/evidence.ts`、`mcp/server/src/server.ts` 等
  原始檔確認，不可硬寫本文件可能過期的假設。
- **改 tmpl 不改生成物**：工作流的 `SKILL.md` 由 `SKILL.md.tmpl` 生成
  （生成腳本見 `goldband-loop/scripts/gen-skill-docs.ts` 一帶，動手前確認
  實際生成流程），直接改 `SKILL.md` 會被下次生成蓋掉。

## 條目 schema

markdown + frontmatter，一條一檔：

```markdown
---
id: <short-kebab-slug>
title: <一行標題>
type: problem-solution | decision | practice
domains: [qa, review, security, design, planning, docs, ios, browser, general]
scope: global | project
project_slug: <bin/goldband-slug 產生的 slug，scope=project 時必填>
canonical_remote: <canonicalizeRemote() 產生的 remote key，可空>
status: candidate | active | graduated | retired
confidence: 1-10
created: YYYY-MM-DD
updated: YYYY-MM-DD
source: manual | telemetry-miner | workflow-evidence
last_verified: YYYY-MM-DD | null
graduated_to: <skill/rule path 或空字串>
links: [<相關條目 id>, ...]
---

<內文。problem-solution 要有「情境／症狀／根因／解法／驗證方式」；
decision 要有「決定／理由／捨棄的替代方案」；practice 要有
「做法／適用情境／驗證證據」。>
```

`confidence` 沿用 learnings 的既有語意，不重新發明一套分數規則。實作前讀
`goldband-loop/scripts/resolvers/learnings.ts` 的 schema 註解與 review/qa
模板裡的 `Prior learning applied: [key] (confidence N)` 用法；learning 升格成
knowledge 條目時，confidence 必須能原樣保留。

project key 也不要製造第三套制度。主 key 沿用 `bin/goldband-slug` 的 slug，
因為 learnings 已用它定位 project，且它對無 remote 的本機專案有 basename
fallback。`canonicalizeRemote()`（`goldband-loop/lib/goldband-memory-helpers.ts`）
只存成 metadata，方便和 GBrain / remote-aware pipeline 對齊；不要用 canonical
remote 取代 slug 當 knowledge 的主 scope key。

另維護一個索引檔（`knowledge/INDEX.md` 或 `index.json`，實作時二選一並
說明理由）：一條目一行（id、type、domains、scope、一行摘要），供掛載點
低成本比對，不必掃全部檔案。

## 要做什麼

### Phase 1 — 本體與 CLI

- 建立 knowledge 目錄結構、schema 驗證、索引維護。
- 提供 capture 與查詢入口（跟隨現有 `goldband-loop/bin/goldband-*` 二進位
  慣例，或 workflow 子命令；先讀現有 bin 的模式再決定）：
  - `add`：互動或參數式新增條目，寫檔並更新索引。
  - `search`：依 domain、type、scope、關鍵字過濾，輸出「路徑＋一行摘要」。
  - `graduate` / `retire`：狀態轉換並記錄去向（畢業成哪個 skill/rule）。

### Phase 2 — 掛載點 a：workflow「先查再做」（保底，最優先）

- 這是對已上線 template 的 refactor，不是綠地。先盤點現有
  `{{LEARNINGS_SEARCH}}` 與 `{{GBRAIN_CONTEXT_LOAD}}` 在各 workflow template
  的位置，避免在 workflow 開頭疊出第三套相似查詢。
- 新增或改造一個統一 knowledge recall resolver：輸出單一「Prior Knowledge」
  區塊，內部依 host 能力與安裝狀態查 backend：
  - `learnings`：永遠可用，查 `goldband-learnings-search`。
  - `knowledge/`：本機 curated layer，查索引檔。
  - `GBrain`：optional mod；host/template 若 suppressed 就略過，不可讓
    knowledge layer 依賴 GBrain 存在。
- resolver 依當前 workflow domain 與 `bin/goldband-slug` project slug 查索引，
  命中就列出「路徑＋摘要」讓 agent 決定要不要細讀；未命中就明說
  「知識庫無相關條目」。
- 先接兩個代表性工作流驗證設計（建議 `qa` 與 `review`），確認生成物
  同步後再談推廣，不要一次改全部 tmpl。

### Phase 3 — 掛載點 b：hook 即時提示

- 在 Claude hook 端（`skill-activation-suggestions.js` 或 hook-router 的
  對應階段）比對使用者輸入與索引的 domain/keyword，命中時注入一行
  advisory：「知識庫有 N 條相關記錄：<路徑清單>」。
- advisory 性質，不阻擋任何操作；要有頻率控制避免每個 prompt 都吵。
- Codex 端若有對等機制就同步，沒有就在文件明說這個掛載點是 Claude-only
  adapter，不假裝雙 host 對等。

### Phase 4 — 掛載點 c：MCP 查詢工具

- 在 `mcp/server/src/` 照 telemetry-query 的模式加一個 `knowledge-query`
  工具：輸入 domain/type/keyword，回傳條目路徑與摘要。
- 這讓兩個 host 在任何時刻都能主動查，不限 workflow 內。

### Phase 5 — 寫入自動化與畢業流程

- telemetry miner 增加一個輸出：從 failure taxonomy 產生 `status: candidate`
  的候選條目（進 knowledge 目錄，不進 repo）。
- 提供輕量 capture 入口（如 `/goldband-learn` 或既有 workflow 收尾步驟的
  提示），讓「做完順手記」成為預設動線。
- 畢業流程：`graduate` 時要求填寫去向（skill/rule 路徑），條目保留但標記
  graduated，避免知識庫與 skill 長期雙份維護。

### Prompt 10 lifecycle refinement

Prompt 10 tightens this first version into a lifecycle system:

- Automatic sources write deterministic `candidate` entries only; they do not
  become default recall until reviewed and promoted.
- Recall defaults to `active` and prints path, summary, confidence,
  updated/last_verified, and staleness rather than full entry text.
- Entries carry `source_evidence`, `trust_level`, `reviewed_by`, `staleness`,
  and `graduated_to` metadata so CLI, workflow resolver, and MCP expose the same
  trust contract.
- `goldband-knowledge-review` owns candidate list/show/promote/edit/retire and
  graduation review flow; overdue candidates are sorted first for review but are
  not auto-deleted or auto-retired.

## 不做什麼

- 不做泛用筆記軟體：不收讀書筆記、生活記錄、自由發想；只收上述三種形狀。
- 不做向量檢索、embedding、GUI；`rg` ＋ frontmatter ＋索引檔就是第一版。
- 不與 Claude auto-memory 搶位：auto-memory 記「使用者是誰、偏好什麼」，
  知識庫記「這類問題怎麼解、哪些做法驗證過」，文件要寫清楚這條分工。
- 不把真實 telemetry 或條目內容 commit 進 repo。

## 驗收條件

- schema 驗證與 add/search roundtrip 有自動化測試（合成 fixture）。
- `qa` 與 `review` 兩個工作流的 tmpl 使用統一 knowledge recall resolver，
  不再疊出 `learnings` / `GBrain` / `knowledge` 三段相似查詢；生成的
  `SKILL.md` 與 tmpl 同步、inventory gate 通過
  （`scripts/check-goldband-loop-inventory.mjs`）。
- hook 注入行為有 replay fixture 並通過 `npm run test:hook-router`。
- MCP `knowledge-query` 有測試，`mcp/server` 建置通過。
- 跑過 Claude config 驗證流程（claude-config-verification 技能）確認
  hook/installer 變更安全。
- `ARCHITECTURE.md` 補知識庫層的職責邊界；`README.md` 補使用說明；
  與 auto-memory 的分工寫進文件。
- 全程遵守 repo 現行 coding style gate（檔長、函式長度、complexity）。

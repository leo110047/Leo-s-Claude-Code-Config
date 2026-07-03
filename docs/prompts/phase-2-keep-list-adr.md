# Phase 2 實作交辦:gstack 元件保留清單(ADR)

你是在 goldband repo 工作的分析 agent。本 Phase 產出**決策文件,不改程式碼**。
計畫背景:`docs/ARCHITECTURE_REVIEW_2026_07.md`(source of truth,先讀第二、
三部分)與 `docs/DECISIONS.md` ADR-002。

## 前置條件(不滿足就停止並回報)

- Phase 0 已合入,且 usage 報表至少涵蓋 2 週的真實使用數據。
- 跑 Phase 0 的報表工具,拿到各 workflow 入口的實際呼叫次數。
  拿不到數據就停,回報缺口,不要憑目測補數字。

## 任務目標

對 `vendor/workflow/` 每一個 top-level 元件做出 keep / freeze / delete 歸類,
寫成 ADR-003 合入 `docs/DECISIONS.md`,作為 Phase 3 合併重構的執行依據。

## 判準(依 ADR-002 的核心原則)

> 只保留「實際會用、而且能測」的元件。

- **keep**:usage 數據顯示有使用,或維護者明確要;且有可低成本執行的測試,
  或本 ADR 承諾補上。
- **freeze**:保留原始碼但不安裝、不維護、不接測試;要寫明凍結原因與解凍
  條件。
- **delete**:連同其測試一起列入 Phase 3 刪除清單。
- 計畫文件已列的候選刪除(`ios-qa`、`setup-gbrain`/`sync-gbrain`、
  `openclaw`、`supabase`、`office-hours`、`pair-agent`、`landing-report`、
  `benchmark-models`)是假設,不是結論——仍要用數據核對。
- `browse/` 單獨成節:它是最貴的維護件(Chrome 改版就壞)。若判 keep,
  ADR 要寫明維護承諾(定期 smoke test)與替代方案評估(host 原生瀏覽器
  工具能否取代部分用途)。

## 實作步驟

1. 列出 `vendor/workflow/` 全部 top-level 元件(目錄與獨立 skill),
   含每個的檔案數與依賴關係(誰依賴誰,例如哪些 skill 依賴 browse daemon)。
2. 對照 usage 數據與維護者需求,逐一歸類;每個歸類一句理由。
3. 檢查依賴一致性:keep 的元件不得依賴 delete 的元件;有衝突就升級或標記
   為需維護者裁決。
4. 寫 ADR-003,依 `docs/DECISIONS.md` 既有格式(背景/決策/假設/後果/替代
   方案/失敗訊號/重新檢視條件),用繁體中文,核心是完整的歸類表。
5. **歸類表完成後、合入前,把整張表連同理由呈給維護者確認**。這是本 Phase
   唯一必須人工拍板的點。

## 邊界

- 不改 `vendor/workflow/` 與任何程式碼;交付物只有 ADR-003(以及若發現
  計畫文件事實錯誤,附帶修正 `docs/ARCHITECTURE_REVIEW_2026_07.md`)。

## 驗證

- 完整性:`vendor/workflow/` 每個 top-level 元件都出現在歸類表,用 `ls`
  輸出逐項核對,不接受「其餘皆刪除」這種概括。
- 一致性:keep 元件的依賴閉包內沒有 delete 元件(附檢查方式與結果)。
- `node scripts/check-code-style.mjs --files docs/DECISIONS.md` 綠。

## 交付

一個 PR,內容為 ADR-003 與計畫文件 checkbox 更新。PR 描述附:usage 數據
摘要、歸類統計(keep/freeze/delete 各幾個)、維護者已確認的紀錄。

## 阻塞時

usage 數據太稀疏無法支持判斷、或依賴衝突無法自行解決時,停下來回報選項與
你的建議,等維護者決定。

## 建議使用的 skills

`decision-log`(ADR 格式)、`evidence-based-coding`、`file-search`。

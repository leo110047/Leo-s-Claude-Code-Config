# Phase 4 實作交辦:eval 與 failure taxonomy 接 CI

你是在 goldband repo 工作的實作 agent。Source of truth:
`docs/ARCHITECTURE_REVIEW_2026_07.md` Phase 4 與 ADR-002。

## 前置條件(不滿足就停止並回報)

- Phase 3 已合入:Goldband Loop 已成為 first-party workflow runtime,
  Goldband Loop inventory 確定。

## 任務目標

讓「改 hook policy 或 workflow skill 時,CI 能擋住已知退化」成立,並讓
guardrail 的品質可以被陳述(誤殺/漏擋狀況)。三個交付物:接上 CI 的
eval、hook policy 的 golden dataset 回歸、failure taxonomy 與 regression
流程。

## 現況(已驗證)

- 繼承自原 runtime 的 eval harness 在原 `package.json` scripts:`test:evals`、
  `test:e2e`、`test:gate`、`test:periodic` 等(LLM eval、routing e2e、
  codex/gemini e2e),需要 API 金鑰與費用。
- `hooks/scripts/tools/replay-hook-router.js` 已存在,可重放 hook 輸入,
  但沒有 golden dataset。
- hook policy 模組在 `hooks/scripts/lib/hook-router/`(pretool/posttool/
  stop/lifecycle/secret-patterns)。

## 實作範圍

1. **eval 接 CI**:
   - 把 eval 指向改名後的 Goldband Loop runtime;若某些 eval
     需要外部服務、API 金鑰或高成本環境,明確標成 gated/optional,不要假裝 CI 已覆蓋。
   - 設計 CI 觸發策略(考量費用:例如 PR 上跑 gate 子集、排程跑完整集),
     寫進 workflow 檔並在文件說明。
   - **金鑰與預算是維護者決策**:先盤點需要哪些金鑰、估每次執行費用,
     呈報後等確認再啟用;金鑰一律走 GitHub Actions secrets,不落 repo。
2. **golden dataset 回歸**:
   - 建 hook 輸入/預期決策的案例庫(該擋:secrets、危險命令;不該擋:
     正常開發操作的代表樣本),格式自訂但要可讀可增補。
   - 讓 `replay-hook-router.js`(或其擴充)吃案例庫、比對實際決策、
     不符即非零 exit;接進 `.github/workflows/validate.yml`(這部分不需
     API 金鑰,每個 PR 都跑)。
   - 初版案例庫至少涵蓋:`secret-patterns` 的每類 pattern 正反例、
     pretool-policy 每條 deny 規則正反例、careful/freeze 模式各一組。
3. **failure taxonomy**:
   - 建一份持續維護的分類文件(hook 誤擋/漏擋、skill 誤觸發、installer
     壞損、upstream drift),每類至少回填一筆歷史案例(從 git log 的 fix
     commits 找)。
   - 寫明流程:每次事故 → taxonomy 記一筆 → golden dataset 或測試補一個
     regression case。放進 `OPERATIONS.md` 或獨立 doc。

## 邊界

- 不改 hook policy 的行為;發現 policy 本身的 bug 就記進 taxonomy 並回報,
  修復留給獨立 PR。
- 未經維護者確認,不啟用任何會產生 API 費用的 CI job(先以 opt-in/排程
  停用狀態合入)。

## 驗證(完成宣稱必須附本次執行的證據)

- golden dataset 回歸在本機與 CI 都跑過且綠;故意改壞一條 policy 能讓它
  紅(附這個 red/green 證據)。
- 縮範圍後的 eval 在本機至少完整跑過一次,附通過率與費用實測。
- 既有 CI 全綠。

## 交付

一個 PR(若 eval 與 golden dataset 規模大,可拆兩個 PR,先 golden dataset
後 eval)。描述附:案例庫覆蓋清單、CI 觸發策略與費用估算、taxonomy 初版
連結、red/green 證據。勾計畫文件 Phase 4 checkbox。

## 阻塞時

eval 跑不起來(依賴 bun 版本、金鑰缺失、上游服務變動)超過兩次嘗試,
停下來回報錯誤輸出與你的判斷,不要為了綠燈而縮小斷言或加 retry 掩蓋。

## 建議使用的 skills

`testing-strategy`、`evidence-based-coding`、`ci-cd-integration`、
`file-search`;提 PR 前跑 `/goldband-review`。

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

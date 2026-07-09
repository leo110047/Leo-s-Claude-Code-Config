# 實作 Prompt 11：Knowledge capture 移出 Codex Stop hook，改成 workflow 收尾 contract

> 使用方式：把本檔全文貼給一個乾淨的 Claude Code 或 Codex session，工作目錄為
> goldband repo 根目錄。接續 `docs/prompts/10-knowledge-system-healthy-architecture.md`。
> 這份 prompt 的目標不是重做知識庫，而是修正 capture 提醒的觸發位置與判斷責任。

---

## 你要使用的 skills

開始前先讀並遵守這些 skills。若 host 沒有某個 skill，記為 `not available`，
再用同等原則手動執行，不可假裝已使用。

- `goldband:evidence-based-coding`：所有 hook、workflow、generated docs、
  installer、測試與本機設定宣稱，都要從當前檔案或指令驗證。
- `goldband:file-search`：用 `rg` / `rg --files` 找 Stop hook、workflow
  templates、generated `SKILL.md`、knowledge capture 指令、測試覆蓋。
- `goldband:implementation-contracts`：這次改的是 shared workflow 收尾
  contract 和 Codex host adapter 邊界；不可用 best-effort 或隱含 fallback。
- `goldband:prompt-hygiene`：修改 agent-facing workflow prompt 時，保留
  outcome、verification、constraints、blocked handling，不寫空泛提醒。
- `goldband:testing-strategy`：改 hook / generated workflow docs / installer
  readback 時，補最小但能防回歸的測試。
- `goldband:systematic-debugging`：若重現 `Stop hook failed`、invalid JSON、
  generated-doc freshness 或 installer readback failure，先追 root cause，
  不可刪測試或弱化規則。

---

## 現況與問題（先驗證，不要假設）

先用 current repo 驗證這些點：

```bash
git status --short
rg -n "knowledge-capture-advisory|capture-candidate|looksReusableInsight|hasEvidence|hookSpecificOutput|Stop" codex hooks goldband-loop scripts docs
sed -n '330,380p' codex/hooks/hook-router.js
sed -n '490,525p' codex/hooks/hook-router.js
sed -n '28,42p' docs/reports/cross-review-phase-0.md
rg -n "Completion Status Protocol|Operational Self-Improvement|goldband-knowledge|capture-candidate|Knowledge candidate|Telemetry \\(run last\\)|Capture Learnings|Prior Learnings|generateLearningsLog|capture a curated candidate" goldband-loop */SKILL.md */*.tmpl goldband-loop/scripts 2>/dev/null
sed -n '1,160p' goldband-loop/scripts/resolvers/learnings.ts
rg -n "Prompt 10|prompt-10|knowledge-system-healthy-architecture" docs/DECISIONS.md docs/reports 2>/dev/null
```

已知要驗證的問題形狀：

1. Codex `Stop` hook 不適合塞 knowledge capture advisory。過去 live probe
   已記錄：Codex Stop 的 JSON advisory / decision 行為不穩，部分格式只會顯示
   `Stop Failed` 或 invalid output。
2. 用 `last_assistant_message` 的 keyword / regex 推測「這輪是否值得記知識」
   是錯誤責任分配。程式可以看時間、tool 數、錯誤字串、重試次數這些低階 signal，
   但不能可靠判斷「是否明確可重用、是否省 5 分鐘、是否是 project rule」。
3. Workflow 收尾才有足夠上下文讓 agent 判斷是否提出 candidate。一般對話
   沒有 workflow contract，不應由 hook 自動插話。
4. `goldband-loop/scripts/resolvers/learnings.ts` 的 `generateLearningsLog()`
   已經被灌到所有 workflow `SKILL.md` 收尾（例如 `goldband-loop/ship/SKILL.md`、
   `goldband-loop/qa/SKILL.md`），而且判斷方式已經是「agent 語意判斷」而非
   keyword matching，也已經提供 `capture-candidate` 指令。Contract §2 的實際
   工作很可能是「把這份既有 footer 收斂成強制結構化 `Knowledge candidate:
   none/<list>` 欄位」，不是從零新增一份平行 footer。Audit 時必須先讀這個
   resolver，確認是延伸它還是另開 section，並寫下理由。
5. 本 prompt 假設 `docs/prompts/10-knowledge-system-healthy-architecture.md`
   的結論已經落地。開始前用 `git log` / `docs/DECISIONS.md` 確認 10 是否真的
   執行完成；如果沒有，先停下來跟使用者確認，不要假設 10 已完成就接著做 11。

---

## Outcome

完工狀態要滿足：

- Codex `Stop` hook 不再根據 `last_assistant_message`、keyword、regex 產生
  knowledge capture advisory。
- Goldband workflow 收尾有明確 `Knowledge Capture Check`，每個 workflow
  完成報告都要輸出 `Knowledge candidate: none` 或候選清單。
- Workflow 收尾由 agent 依上下文做語意判斷；程式不得用 keyword/regex
  自動判定可重用知識。
- 一般對話不實作自動提醒，不在 `Stop` hook 插訊息。若要留下未來設計，只能
  記成文件化 proposal，不改 runtime 行為。
- Candidate 仍只寫 `status: candidate`，不自動 promote 成 active knowledge。
- Claude/Codex generated workflow docs、installer/readback、tests 對這個新
  contract 一致。

---

## Contract

### 1. Codex Stop hook boundary

Codex `Stop` hook 只允許做 deterministic lifecycle checks，不允許做 knowledge
capture prompting。

必做：

- 移除或停用 `buildKnowledgeCaptureAdvisory()` 在 Codex `Stop` 的呼叫路徑。
- 移除 `looksReusableInsight()` 這類只為 Stop capture advisory 存在的 keyword
  classifier，除非它還有其他已驗證用途。
- 保留 `hasEvidence()`：它同時被 `evaluateStopResult()` 與
  `evaluateSubagentStopResult()` 的 completion-without-evidence 判斷使用，
  不得因為移除 knowledge capture path 而一併刪除。
- 保留真正需要的 Stop checks，例如 cross-review gate 或 completion-without-evidence
  advisory，但不要擴張本次範圍。
- 補測試保證：有 `Verified`、`Root cause`、`reusable`、中文 `根因` / `下次`
  的 final message，也不會讓 Codex Stop hook 回傳 knowledge capture advisory。

### 2. Workflow footer boundary

每個 Goldband workflow 收尾都要有同一份 `Knowledge Capture Check` contract。

建議輸出格式：

```text
Knowledge candidate: none
```

或：

```text
Knowledge candidate:
- summary: <one-line reusable lesson>
  type: problem-solution | decision | practice
  scope: global | project | machine
  evidence: <file/command/report path or workflow evidence id>
  why reusable: <one sentence>
  capture: <goldband-knowledge capture-candidate command or dry-run command>
```

硬規則：

- 這是 agent 的語意判斷，不是 runtime keyword matching。
- 沒有候選時必須明說 `Knowledge candidate: none`，避免每次都塞空泛提醒。
- 有候選時只提出 `candidate` capture command 或 dry-run artifact；不得自動
  promote、不得寫 active knowledge。
- Candidate summary 不得包含 secret、完整 transcript、未消毒 customer data。
- 如果 workflow 沒有足夠 evidence，輸出 `Knowledge candidate: none` 或
  `not captured: insufficient evidence`，不要猜。

### 3. General conversation boundary

本 prompt 不實作一般對話的自動提醒。

如果要留下未來設計文件，可以寫成「proposal」，但 runtime 不可啟用：

- 程式只能提供低階 cost signal，例如 elapsed time、tool call count、
  repeated failure signature、context growth、sandbox/permission/hook 類事件。
- 程式不能把低階 signal 直接轉成「這是可重用知識」。
- 若未來要做，應該是 candidate review queue 或 explicit workflow，而不是
  `Stop` hook 直接插 user-visible reminder。

---

## Implementation Plan

1. **Audit current surfaces**
   - 找出 Codex Stop knowledge advisory 的完整 call path。
   - 找出 workflow `SKILL.md` 的 template / generator / resolver 來源，不直接
     手改 generated file 除非 repo 已用 generated file 當 source。
   - 找出 existing completion footer、telemetry footer、operational learning
     footer 的共同 template。
   - 讀 `goldband-loop/scripts/resolvers/learnings.ts` 的 `generateLearningsLog()`；
     這是目前唯一已經用 agent 語意判斷（非 keyword）產生 capture-candidate
     建議的既有 footer。決定是延伸它成強制結構化 `Knowledge candidate:
     none/<list>` 輸出，還是另開新 section，並在 final report 說明理由。

2. **Remove Codex Stop keyword advisory**
   - 從 Codex hook router 移除 Stop knowledge capture path。
   - 刪除只服務這個 path 的 regex classifier。
   - 更新 `scripts/test-codex-hook-router.mjs` 或等價測試，覆蓋「final answer
     有 reusable/root cause 字樣仍 noop」。

3. **Add workflow Knowledge Capture Check**
   - 在 `generateLearningsLog()`（或其後繼者）產生的 shared workflow footer
     加上強制的 `Knowledge Capture Check` 結構化欄位，取代目前「有發現才寫」
     的建議式文字；不要另外新增一份平行 footer。
   - 讓 generated Claude/Codex workflow docs 都出現同一個 contract。
   - 若 workflow runtime 有 structured evidence output，優先引用 evidence id；
     沒有就要求 final report 使用檔案/命令證據。

4. **Document general conversation non-goal**
   - 在 architecture / knowledge system doc / prompt summary 補一句：一般對話
     不由 hook 自動判定 knowledge capture；未來只能用 explicit workflow 或
     candidate review queue。

5. **Regenerate and verify**
   - 跑 generator dry-run 或正式生成，依 repo 慣例處理 generated files。
   - 驗證 hook tests、generated-doc freshness、inventory/status tests。

---

## Tests / Verification

至少跑：

```bash
node scripts/test-codex-hook-router.mjs
bun test goldband-loop/test/gen-skill-docs.test.ts
node scripts/check-goldband-loop-inventory.mjs
git diff --check
```

若修改 installer/status/readback，也跑：

```bash
./install.sh status
```

若修改 workflow runtime tests 或 shared resolver，也跑相關 focused shard。不要用
全量測試替代更精準的 failing signal；先跑 focused tests，再視風險加廣。

---

## Final Report Requirements

最後用中文回報：

- Codex `Stop` hook 現在是否已不會產生 knowledge capture advisory。
- `Knowledge Capture Check` 實際加在哪個 template/source，哪些 generated
  workflow docs 受到影響。
- 一般對話自動提醒是否保持未實作，以及文件在哪裡說明。
- 跑過哪些驗證，結果是 pass / fail。
- 還有什麼沒有驗證或需要後續決策。

不要宣稱「每個 workflow 都已套用」除非你已驗證 generator/source 能覆蓋所有
workflow，且 inventory/golden/readback 都通過。

# 實作 Prompt 4:Claude ↔ Codex 交互審查閘門(cross-review gate)

> 使用方式:把本檔全文貼給一個乾淨的 Claude Code 或 Codex session,工作目錄為
> goldband repo 根目錄。本檔是「實作規格 + 計畫」,不是最小可行版本;請按階段實作,
> 每個階段都要有測試與證據才算完成。

---

## 背景

goldband 是 Claude Code + Codex 的 guardrail control plane。目前兩個 host 各有
Stop hook(`hooks/hooks.json`、`codex/hooks.json`)與各自 router。Claude 側走
`hooks/scripts/hooks/hook-router.js` 與
`hooks/scripts/lib/hook-router/stop-policy.js` 的 `evaluateStop(input)`;
要擋下收工可回 `decision:'block'`,router 會 `exit(2)` 把理由回注給實作方。
Codex 側走 `codex/hooks/hook-router.js`,目前 Stop surface 主要是 advisory/system
message;**實作前必須先驗證 Codex Stop hook 的 blocking 語意與輸出格式**,不得假設
與 Claude 完全相同。已有 `goldband-loop/codex`(codex review/challenge/consult,
目前以文字 marker 判定 pass/fail gate)與 `goldband-loop/review`。

目前缺的是:讓「實作方」與「審查方」由**不同模型**擔任,並用 Stop hook **強制**
「未通過交互審查不得收工」。這正好呼應本 repo 的立身目標:Claude/Codex 雙工具對等。

## 目標

一個由不同模型交互審查、且**可驗證**(不是靠信任)的收工閘門:

1. 其中一個工具(Claude 或 Codex)實作,**另一個**工具審查。
2. 實作方想收工時,Stop hook 觸發,檢查 plan 檔是否有**有效**的審核通過 marker。
3. marker 無效或不存在 → 擋下收工,指示去跑交互審查 orchestrator。
4. orchestrator 驅動審查方 CLI review 實作方的 diff,雙方有界地來回,直到審查方
   明確通過。
5. 通過後由審查流程寫入 marker;marker **同時綁定 reviewer artifact 與被審查內容雜湊**,
   下次 Stop hook 重算比對一致才放行。
6. 全程只在**被明確 arm 的 session**生效,不污染其他對話。

### 非目標(本版不做)
- 不做三方以上審查;先把 Claude↔Codex 兩方跑順。
- 不做 GitHub PR 上的雲端審查(那是 `/code-review ultra` 的範疇)。
- 不在 Stop hook 內部直接 spawn 審查方 CLI(見「架構原則」)。

---

## 架構原則(先讀,違反就是設計錯)

1. **Hook 要薄、要 deterministic、不呼叫 LLM。** Stop gate 只做「驗 marker/artifact
   有效性」這件純檢查(讀檔、驗欄位、算 hash、比對),絕不在 hook 裡跑 `codex` /
   `claude` 子行程。真正的審查迴圈放在 `/goldband-cross-review run` 背後的
   程式化 orchestrator。
2. **hash 只防 drift,不防同權限偽造。** 實作方對 plan 檔有寫入權,所以 plan marker
   光有文字與 `reviewed-sha` 不足以證明另一個模型真的審過。`reviewed-sha` 只能防
   「approve 後又改碼」或「審查 scope 與現況不一致」。要防假 approval,還必須保存
   reviewer artifact(審查方原始輸出、verdict JSON、transcript 摘要、CLI exit/status)
   到 `${GOLDBAND_HOME}` 下由 orchestrator 寫入的 artifact 檔,marker 只引用該 artifact。
3. **審查方必須是另一個模型。** 價值來自跨模型;orchestrator 與 gate 契約都要強制
   `reviewer != implementer`。
4. **不是叫 AI 自己去讀 review skill。** 實作方不需要讀 `goldband-loop/review`;
   審查方也不需要自行 discover/invoke review skill。orchestrator 會程式化讀取
   `goldband-loop/cross-review/reviewer-prompt.md` 與 `rubric.md`,再把 diff、plan、
   上輪 findings、實作方回應一起餵給審查方 CLI。
5. **討論可以自由,結論要固定格式。** 每輪允許審查方提出 blocker、實作方修正或反駁、
   審查方接受/拒絕反駁;但每輪最後必須輸出可 parse verdict,讓 gate 能判定。
6. **收斂要有界。** 用嚴重度閘、回合上限、rubric 綁定、移動門柱禁令四道機制,避免
   審查方無限挑毛病;到達回合上限則升級給人類仲裁,不得無限迴圈。
7. **人類永遠有逃生門。** 任何時候可用 override 指令解除閘門,避免把使用者鎖死在
   一個無法收斂的 session。
8. **雙 host 對等。** Claude 與 Codex 兩側 hook、installer、README、inventory 一起
   更新;未同步前不得宣稱 dual-tool parity(見 repo `CLAUDE.md`)。

---

## 觸發設計(重點:不是整個對話都開)

核心機制:**gate 契約檔以 session_id 為 key**。Stop hook input 帶 `session_id`;
沒有對應契約檔 = 這個 session 沒被 arm = gate 完全不介入。三種 arm 途徑,由弱到強:

### A. 顯式指令 arm(預設、最推薦)
使用者明確宣告「這件工作要交互審查」:

```
/goldband-cross-review start --plan docs/plans/feature-x.md --reviewer codex
```

寫出契約檔(見下)。工作跑完、marker 驗證通過後自動 disarm;或手動
`/goldband-cross-review done`。

### B. 單則訊息內的指令詞 arm(回答你「某次訊息需要」)
新增一個 `UserPromptSubmit` step:Claude 側目前是 skill suggestion hook;Codex 側是
`codex/hooks/hook-router.js`。實作時要先確認兩側實際 hook surface,再接入同一套 arm
邏輯。當該則使用者訊息含指令詞
(例如 `[[cross-review]]` 或中文「開啟交互審查」),就地 arm 當前 session,並嘗試
從訊息推斷 plan 檔;推斷不到就在契約檔標 `planFile: null`,Stop 時提示補綁。
這讓「只有這次訊息需要」成立:不下指令詞的訊息完全不受影響。

### C. plan 檔宣告(選配、與 A/B 疊加)
plan 檔 front-matter 或檔頭放 `cross-review: required`。arm 時 orchestrator 讀到
就沿用該設定。這只是「宣告來源」,實際開關仍是 session 契約檔的存在與否。

> 設計取捨:arm 一旦成立會**持續**到通過審查或 disarm,無法對「已送出的過去訊息」
> 追溯開啟。這是刻意的——閘門要在工作開始時宣告,語意才乾淨。

### gate 契約檔 schema
路徑:`${GOLDBAND_HOME:-$HOME/.goldband}/cross-review/<session_id>.json`
(放持久資料路徑而非 repo,避免把 session 狀態 commit 進版控)。

```json
{
  "schemaVersion": 1,
  "sessionId": "…",
  "host": "claude",
  "implementer": "claude",
  "reviewer": "codex",
  "planFile": "docs/plans/feature-x.md",
  "baseCommit": "<arm 時的 git HEAD sha>",
  "reviewScope": "tracked-and-untracked-vs-base",
  "maxRounds": 3,
  "roundsUsed": 0,
  "status": "active",
  "armedAt": "2026-07-05T…Z",
  "expiresAt": "2026-07-06T…Z"
}
```

- `expiresAt`:TTL(預設 24h),過期契約 Stop hook 視為未 arm,避免殭屍閘門。
- `status`:`active | passed | overridden | expired`。

---

## marker / verdict 協定(可驗證的核心)

### 審查方輸出的結構化 verdict(不要 parse 自然語言)
審查方每回合須輸出一行機器可讀 verdict,並保存完整 artifact:

```
GOLDBAND-CROSS-REVIEW-VERDICT: <APPROVED|CHANGES_REQUESTED|ESCALATE>
  reviewer=<codex|claude> reviewed-sha=<sha256> round=<n>
  blocking=<count> advisory=<count> artifact=<artifact-id>
```

外加結構化 findings(JSON),每筆:`{severity, ruleId, file, line, failureScenario,
status: open|resolved|rebutted-accepted|rebutted-rejected}`。

artifact 存在 `${GOLDBAND_HOME:-$HOME/.goldband}/cross-review/artifacts/`,至少包含:
`sessionId`,`reviewer`,`implementer`,`baseCommit`,`reviewedSha`,`round`,
`verdict`,`findings`,`reviewerCommand`,`reviewerExitCode`,`rawOutputPath`,
`createdAt`。Stop gate 不相信 plan marker 本身;它要能讀到 marker 指向的 artifact,
確認 artifact 的 `reviewedSha`、`reviewer`、`implementer`、`sessionId` 與契約一致。

### 寫進 plan 檔尾的 marker(人類可見 + 機器可驗)
審查通過後,orchestrator(代表審查方)在 plan 檔尾追加:

```
<!-- GOLDBAND-CROSS-REVIEW: APPROVED reviewer=codex implementer=claude
     reviewed-sha=<sha256-of-review-scope-diff> rounds=2
     artifact=<artifact-id> at=2026-07-05T…Z session=<session_id> -->
```

### reviewed-sha 的定義(必須明確且 deterministic)
`review scope` 必須包含 tracked 與 untracked 工作內容,否則新增但未 staged 的檔案會
逃過審查。實作時二選一,並在 Phase 0 固定:

- **建議方案**:`review scope` = canonical bundle,由下列內容組成:
  1. `git -c core.autocrlf=false diff --no-ext-diff --binary <baseCommit>`
  2. `git ls-files --others --exclude-standard -z` 排序後,逐檔寫入
     `UNTRACKED <path>\0<sha256(file-bytes)>\0<file-bytes>`。
- **簡化方案**:強制 orchestrator review 前先要求所有被審查檔案 staged,並用
  `git diff --cached --binary <baseCommit>`;若有 untracked 或 unstaged tracked 變更,
  orchestrator 與 Stop gate 都必須 block。

`reviewed-sha` = canonical bundle bytes 的 sha256。Stop hook 放行前用同一份
`baseCommit` 與同一個 canonicalizer 重算,一致才放行。

### Stop hook gate 判定流程(純檢查,無 LLM)
於 `evaluateStop` 內新增 `evaluateCrossReviewGate(input)`:

1. 讀 `session_id` → 找契約檔。無 / 過期 / `status != active` → **allow**(不介入)。
2. 契約 `planFile == null` → **block**,提示先綁 plan 檔。
3. 讀 plan 檔尾 marker。無 marker → **block**,注入:「本工作在交互審查閘門下,
   請執行 `/goldband-cross-review run`,由 {reviewer} 審查後才能收工。」
4. 有 marker → 讀 marker 指向的 artifact,驗證 artifact 存在且 `reviewer != implementer`,
   `reviewer`/`implementer`/`sessionId`/`baseCommit` 與契約一致,且 verdict 為
   `APPROVED`。再用契約 `baseCommit` 重算現況 `reviewed-sha`:
   - 一致 → **allow**;把契約標 `status: passed`(自動 disarm)。這只結束本次已 arm
     工作,不代表同一 session 後續新工作自動通過。
   - 不一致 → **block**:「程式碼在通過後又變動(approved-sha ≠ now-sha),需重審。」
5. **防迴圈**:契約 `status == overridden` → allow;`roundsUsed >= maxRounds` 且仍無
   有效 marker → **block** 但改注入「升級人類仲裁」訊息(附雙方立場摘要路徑),
   不再叫它自己重跑。搭配 Stop input 的 `stop_hook_active` 避免 hook 自我觸發風暴。

---

## 交互審查 orchestrator(驅動迴圈的程式入口)

新增 `/goldband-cross-review run` 指令,由程式化 orchestrator 驅動。
`goldband-loop/cross-review/` 是內部 runtime asset,**不暴露成一般對話入口 skill**,
不需要 trigger/preamble,也不讓使用者或 reviewer 直接 invoke。使用者面只暴露
`/goldband-cross-review start|run|done|override`;審查方 CLI 只收到 orchestrator 組好的
bounded prompt。

orchestrator 的責任:

1. 讀契約檔、專用 reviewer prompt、專用 rubric。
2. 算 canonical review scope 與 `reviewed-sha`。
3. spawn 另一個模型 CLI。
4. 把 diff、plan、rubric、上一輪 findings、實作方回應/修正摘要一起傳給審查方。
5. 解析審查方 verdict/findings,保存 artifact。
6. 在通過時寫 marker;未通過時把下一輪需要的 blocker 與實作方待回應事項寫入狀態。

原有 `goldband-loop/review` / `goldband-loop/codex` 只能作為 review 原則與既有 CLI
呼叫方式的參考來源;不得在 runtime 要求實作方或審查方「去讀那個 skill 再自己決定」。
新的 cross-review 內容若放在 `goldband-loop/cross-review/`,也應被安裝成 command
可讀取的資料/程式,不是一般對話可主動選用的 skill。

### 單回合流程
1. 讀契約 → 算 review scope diff + `reviewed-sha`。
2. 組 reviewer prompt:專用 prompt + rubric + diff + plan 檔 + 上一回合 findings +
   實作方上一回合修正/反駁。
3. 呼叫審查方 CLI(見「跨工具呼叫」),審查方可以用自然語言分析與回應反駁,但最後
   必須輸出結構化 verdict + findings。
4. 解析審查方的結構化 verdict + findings,保存完整 artifact 與 raw output。
5. 分流:
   - `APPROVED` → 寫 artifact → 寫 marker(綁 `reviewed-sha` 與 artifact id)→ 契約
     `status: passed` → 結束。
   - `CHANGES_REQUESTED` → 對每筆 **CRITICAL/HIGH** open finding,實作方擇一:
     (a) 修正(改碼);(b) 反駁(附理由與證據);(c) 請人類裁決。MEDIUM/LOW 記為
     plan 內 follow-up,不擋收工。orchestrator 記錄實作方回應,`roundsUsed++`,
     回到步驟 1(diff 或回應變了 → 需重審)。
   - `ESCALATE` 或 `roundsUsed >= maxRounds` → 產出雙方立場摘要檔,契約保持 active,
     Stop hook 會以「人類仲裁」訊息擋收工,等使用者裁決或 override。

### 實作方辯解/修正協定

實作方每輪對 blocking findings 的回應要被 orchestrator 記錄成結構化資料,而不是只
留在聊天紀錄裡:

```json
{
  "findingId": "CR-001",
  "response": "fixed | rebutted | ask-human",
  "summary": "已補 canonical bundle 覆蓋 untracked files",
  "evidence": ["tests/cross-review-hash.test.js", "node scripts/test-cross-review.mjs"]
}
```

下一輪 reviewer prompt 必須包含這些回應。審查方可以接受反駁
(`rebutted-accepted`)、拒絕反駁(`rebutted-rejected`)、或確認修正已解
(`resolved`)。這就是有界討論:可以辯解,但每輪都要落回 findings 狀態與 verdict。

### 防「無限挑毛病」四道機制(全部要實作)
1. **嚴重度閘**:只有 CRITICAL/HIGH 能擋 marker;MEDIUM/LOW 一律 advisory。
2. **回合上限**:`maxRounds`(預設 3),超過即升級人類,不再自動續跑。
3. **rubric 綁定**:每筆 blocking finding 必須帶 `ruleId`(對到共享 rubric)與具體
   `failureScenario`。缺任一 → 自動降級為 advisory(不得擋人)。
4. **移動門柱禁令**:第 2 回合起,審查方只能 (a) 判定既有 blocker 已解/未解,或
   (b) 提出**新的 CRITICAL 且是實作方本回修正引入的 regression**。不得對無關新點
   重開戰場。已被接受的反駁(`rebutted-accepted`)之後不得再提。

### 共享 rubric
`goldband-loop/cross-review/rubric.md`:分級列出 blocking 類別(正確性、安全、資料
遺失、契約破壞、明確 regression)與 advisory 類別(風格、命名、微效能、可讀性)。
審查方 prompt 必須引用它,把「可否擋人」變成規則而非品味。

---

## 跨工具呼叫(reviewer adapter)

- **Claude 實作 → Codex 審查**:adapter 以 `codex exec` 或可驗證的 `codex review`
  模式呼叫 Codex,但 prompt 由 cross-review orchestrator 產生。現有
  `goldband-loop/codex` 的 `[P1]`/`[P2]` gate 只能當參考,不能直接當本 gate 的機器契約。
- **Codex 實作 → Claude 審查**:adapter 以 `claude -p`(headless)呼叫 Claude,同樣餵
  cross-review 專用 prompt/rubric,不得要求 Claude 自己讀 `goldband-loop/review` skill。
- 兩個 adapter 共用同一 verdict/findings schema 與 rubric,讓方向對稱、可互換。
- adapter 必須斷言 `reviewer` 模型家族 ≠ `implementer`,否則拒跑(避免自審)。
- adapter 的輸入必須是 bounded bundle(diff、plan、rubric、finding history、
  implementer responses),不要把整包原有 review skill 當 prompt 塞給 reviewer。

---

## 元件清單與落點

| 元件 | 路徑 | 說明 |
|---|---|---|
| Stop gate(純檢查) | `hooks/scripts/lib/hook-router/cross-review-gate.js` | `evaluateStop` 內呼叫 |
| Codex 對稱 gate | `codex/hooks/…`(對應 router) | 同邏輯、共享 lib 為佳 |
| arm/disarm 指令 | `commands/…` + `goldband-loop/cross-review` | A 途徑 |
| UserPromptSubmit arm step | router lifecycle | B 途徑(指令詞) |
| orchestrator command | `goldband-loop/cross-review/` | 內部 runtime asset,不暴露成對話入口 skill |
| reviewer prompt | `goldband-loop/cross-review/reviewer-prompt.md` | 審查方固定任務與輸出格式 |
| rubric | `goldband-loop/cross-review/rubric.md` | 可否擋人的規則 |
| implementer response log | `${GOLDBAND_HOME}/cross-review/responses/` | 修正/反駁/人類裁決紀錄 |
| reviewer adapters | `codex`/`claude -p` adapter | 雙向對稱 |
| verdict/marker schema | `schemas/cross-review-*.json` | 共享契約 |
| reviewer artifact store | `${GOLDBAND_HOME}/cross-review/artifacts/` | verdict/raw output/metadata |
| 契約檔 | `${GOLDBAND_HOME}/cross-review/<session>.json` | 執行期狀態 |
| override 指令 | `/goldband-cross-review override` | 人類逃生門 |
| telemetry | 沿用 `usage-telemetry.js` | 記回合/verdict/升級 |

---

## Decision Check
- **建議方向**:session_id 綁定的 gate 契約 + reviewer artifact + 內容雜湊綁定的
  marker + 薄 Stop hook + 獨立 orchestrator 迴圈。
- **為何現在合適**:精準解決「不要整場對話都開」與「approve 後內容漂移」兩個核心風險,
  且可複用既有 router / stop-policy / CLI 呼叫經驗。注意:現有 review skill 不是
  本 gate 所需的機器契約,只能作為 rubric/prompt 設計參考。
- **必須成立的假設**:Claude Code 與 Codex 的 Stop hook input 都提供穩定的
  `session_id` 與 `stop_hook_active`;Codex Stop hook 有可驗證的 blocking 方式;headless
  `claude -p` 與 `codex` 都能非互動輸出結構化文字。**Phase 0 必須先實測這些假設**。
- **次佳方案**:若 session_id 不穩定,退回「plan 檔內 front-matter 開關 + 檔案雜湊」
  純檔案驅動閘門(丟失 session 粒度,但仍可運作)。當「B 途徑指令詞 arm」無法可靠
  拿到 session_id 時切換。

## Pre-Mortem
- **失敗模式**:Stop hook 把不該擋的一般 session 擋住(誤傷)。**早期訊號**:未 arm
  的 session 出現 gate 訊息。**退路**:gate 第一步「無契約即 allow」要有單元測試與
  replay fixture 守護,預設完全不介入。
- **失敗模式**:reviewed-sha 因 diff 不 deterministic(檔案順序、CRLF)而時好時壞。
  **早期訊號**:同一份碼重算 hash 不一致。**退路**:固定 `git -c core.autocrlf=false
  diff` 參數並排序 pathspec,對 hash 輸入做正規化,並寫 golden 測試。
- **失敗模式**:審查方仍變相無限挑毛病(靠升 severity 繞過閘)。**早期訊號**:回合數
  逼近上限、blocking findings 每回換題目。**退路**:移動門柱禁令 + rubric 降級 +
  回合上限升級人類。
- **失敗模式**:實作方的反駁留在聊天裡,下一輪 reviewer 看不到。**早期訊號**:同一個
  finding 反覆重講、審查方沒有處理 rebuttal。**退路**:orchestrator 必須保存
  implementer response log,下一輪 prompt 必須引用。
- **失敗模式**:新增但未 staged 的檔案未被 hash/review 包住。**早期訊號**:review 通過
  但 `git status --short` 還有 `??` 或 unstaged entries。**退路**:canonical bundle
  包 untracked,或採 staged-only 並硬擋 dirty scope。
- **失敗模式**:marker 被同權限實作方偽造。**早期訊號**:plan marker 存在但沒有對應
  reviewer artifact / raw output。**退路**:Stop gate 要求 artifact 存在且欄位一致;
  文件不得宣稱這能抵抗有意偽造,只能抵抗 drift 與缺證據。
- **未知待驗證**:(1) 兩 host 的 Stop input 欄位實測;(2) Codex Stop hook blocking
  語意;(3) `claude -p` 對長 diff 的穩定輸出;(4) override 指令如何在被 Stop hook 擋住的
  session 內仍能執行(可能需 PreToolUse allow-list 讓 override 指令永遠可跑)。

## Implementation Phases

### Phase 0:協定與驗證 spike(先做,別跳)
- 定 verdict/findings/marker/artifact/implementer-response JSON schema 於 `schemas/`。
- 寫 replay/fixture 小腳本實測 Claude 與 Codex 的 Stop hook input,確認 `session_id`/
  `stop_hook_active` 欄位存在且穩定。
- 實測 Claude Stop blocking 與 Codex Stop blocking:要能證明「block 會阻止收工」,
  並記錄各自需要的輸出格式 / exit code / hookSpecificOutput。
- 決定 reviewed-sha canonical bundle 規則,必須明確處理 tracked、staged、unstaged、
  untracked、新增 binary、CRLF。寫 golden 測試。
- 實測 `claude -p` 與 `codex` 能在非互動模式輸出可 parse verdict;不能穩定輸出時,
  先停在 mock reviewer,不要接真 CLI。
- Phase 0 結尾要輸出一份 `docs/reports/cross-review-phase-0.md`,列出 confirmed /
  rejected / fallback decisions。未完成這份報告不得進 Phase 1。

### Phase 1:Stop gate(純檢查,單 host 先行)
- 實作 `cross-review-gate.js`:契約查找、marker 解析、artifact 驗證、hash 比對、
  四種 block 訊息。
- 接進 `evaluateStop`;預設「無契約即 allow」。
- replay fixtures(比照 `hooks/fixtures/router/replay-fixtures.json`):未 arm/無
  marker/marker 無 artifact/marker 有效/sha 不符/回合耗盡/override 六種情境。

### Phase 2:arm/disarm + orchestrator 骨架
- `/goldband-cross-review start|done|override` 指令與契約檔讀寫。
- orchestrator command 骨架:算 canonical bundle、算 sha、寫 implementer response log、
  artifact + marker(先用 **mock reviewer** 驗迴圈與收斂邏輯,不接真 CLI)。
- 嚴重度閘、回合上限、rubric 降級、移動門柱禁令的單元測試(用 mock findings)。
- 實作方回應流程測試:fixed / rebutted / ask-human 都要能進下一輪 reviewer prompt。

### Phase 3:接真 reviewer(Claude→Codex 方向)
- 把 `goldband-loop/codex` review 輸出升級成結構化 verdict + findings。
- 併入 rubric;端到端跑一次真實 Claude 實作 → Codex 審查。

### Phase 4:反向對稱(Codex→Claude)+ 雙 host 對等
- `claude -p` reviewer adapter;Codex 側 Stop gate。
- 更新 installer、README、inventory 文件;跑 repo 的
  `/claude-config-verification` 與 `codex execpolicy check`。

### Phase 5:B 途徑(指令詞 arm)+ telemetry + 收尾
- UserPromptSubmit arm step 與指令詞解析。
- telemetry:記 rounds / verdict / 升級 / override。
- override 可執行性驗證(被擋 session 內仍能跑)。

## Dependencies
- 既有:`hook-router.js`、`stop-policy.js`、`goldband-loop/codex`、
  `goldband-loop/review`、`usage-telemetry.js`、`utils.js` 的 git helpers。
- 外部:`codex` CLI、`claude` CLI(headless `-p`)、`git`、Node、sha256(內建 crypto)。

## Risks
- **HIGH**:假 enforcement(marker 可被實作方偽造)。緩解:不要宣稱 hash 防偽;Stop gate
  要求 reviewer artifact、raw output、契約欄位一致,並在文件中明確說這是 evidence gate,
  不是抵抗同權限惡意偽造的安全邊界。
- **HIGH**:review scope 漏掉 untracked/unstaged 新檔。緩解:canonical bundle 納入
  untracked,或採 staged-only 並硬擋 dirty scope。
- **HIGH**:誤傷未 arm 的一般 session。緩解:預設不介入 + fixtures 守護。
- **MEDIUM**:審查方無限挑毛病。緩解:四道收斂機制 + 人類升級。
- **MEDIUM**:reviewed-sha 非 deterministic。緩解:輸入正規化 + golden 測試。
- **MEDIUM**:雙 host 不對等(只做了 Claude)。緩解:Phase 4 強制同步 + 驗證工作流。
- **LOW**:契約殭屍檔。緩解:TTL `expiresAt` + 過期即視為未 arm。

## Estimated Complexity: HIGH
(跨 host、涉及 hook 阻擋語意、跨模型子行程、可驗證協定;但每個 phase 可獨立測試。)

---

## 完成準則(Definition of Done)
- 未 arm 的 session 行為零改變(有測試證明)。
- arm 後:無 marker 擋收工、marker 無 artifact 擋收工、artifact 欄位不一致擋收工、
  sha 不符擋收工、真通過放行,皆有端到端證據。
- `reviewed-sha` 測試覆蓋 tracked、staged、unstaged、untracked、新增 binary、CRLF。
- Claude 與 Codex Stop blocking 語意都用 fixture 或實測證明;未證明前不得宣稱雙向
  enforced gate。
- 至少一次真實 Claude↔Codex 雙向交互審查跑通,含一次「審查方擋、實作方修正後通過」
  與一次「反駁被接受」的紀錄,且反駁必須來自 implementer response log 而非聊天記憶。
- 回合上限觸發時升級人類、override 可解閘,皆有證據。
- installer / README / inventory / Codex 側同步,`/claude-config-verification` 通過。

> 開始前請先用 `/goldband-plan-eng-review` 對本計畫做工程審查(本 repo 慣例:複雜、
> 跨模組的計畫先審再做),再進 Phase 0。

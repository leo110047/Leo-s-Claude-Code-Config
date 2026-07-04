# Coding-Style Gate 設計規格

把 `rules/coding-style.md` 從「AI 自律的文字」升級成「機器可執行、違規擋 commit 的 gate」。

## 1. 目標與範圍

- **安裝點**：明確執行 `./install.sh style-gate` 才安裝機器全域 pre-commit hook（`git config --global core.hooksPath`）。預設 pack 不改動機器全域 git 設定。
- **早期提示**：Claude / Codex 的 PostToolUse hook 讓 AI 改完檔就看到警告（advisory，不阻擋）。
- **單一邏輯來源**：一支 `scripts/check-code-style.mjs`，pre-commit 與兩個 host hook 都呼叫它，不重複實作。

## 2. 已確認的決策

| 項目 | 決定 |
|---|---|
| 檢查引擎 | JS/MJS 用本地 **Biome**（見 §5）；所有語言做檔案行數；shell/python 加輕量函式行數啟發式 |
| 套用範圍 | 明確 opt-in 後才是機器全域（`core.hooksPath`），需 per-repo opt-out |
| 存量違規 | 先拆 3 個大檔到綠，再啟用硬擋（不採 baseline 豁免） |

## 3. 全域 hook 的三個 caveat（務必實作）

1. **per-repo opt-out**：repo 根目錄存在 `.goldband-no-style-gate`，或環境變數 `GOLDBAND_STYLE_GATE=0` 時，hook 直接放行。避免 clone 外部 repo 被卡死。
2. **husky 相容**：husky 設 local `core.hooksPath`，local 覆蓋 global，那些專案自動不受本 gate 影響——這是預期行為，不需特別處理，但要在 README 寫明。
3. **只擋 staged 檔**：hook 只檢查本次 `git diff --cached --name-only` 的檔，不掃整個 repo，避免被他人存量違規卡住。
4. **fail-soft fallback**：repo-linked goldband script 或 `node` 不存在時，hook 印警告並放行。CI 才是強制邊界，本機全域 hook 不應因 goldband checkout 損壞而卡死每個 repo。

## 4. 檢查腳本規格 `scripts/check-code-style.mjs`

### 介面

```
node scripts/check-code-style.mjs [--staged] [--files <a> <b> ...] [--format json|text]
```

- `--staged`：只檢查 git staged 檔（pre-commit 用）。
- `--files`：檢查指定檔（host hook 改完單檔時用）。
- 無參數：掃全 repo 第一方碼（CI / 手動用）。
- 退出碼：`0` 全綠、`1` 有違規、`2` 工具/設定錯誤。

### 各語言規則

| 副檔名 | 檔案行數 | 函式行數 | 巢狀 | 其他 |
|---|---|---|---|---|
| `.js .mjs .cjs .jsx .ts .tsx` | ✅ 600 | ✅ Biome `noExcessiveLinesPerFunction` 50 | ⚠️ 用認知複雜度替代（Biome 無 max-depth） | Biome `useMaxParams` 4、`noExcessiveCognitiveComplexity` 12、`noUnusedImports`/`noUnusedVariables` |
| `.sh .bash` | ✅ 600 | ⚠️ 啟發式 50 | ✖️ 不做 | 巢狀對 shell 誤判高，放棄 |
| `.py` | ✅ 600 | ⚠️ 縮排啟發式 50 | ✖️ 不做 | 只 2 檔，輕量即可 |
| `.ps1` | ✅ 600 | ✖️ | ✖️ | 1 檔，只做行數 |

### 門檻（env 可覆蓋，附預設）

| 環境變數 | 預設 | 意義 |
|---|---|---|
| `GOLDBAND_MAX_FILE_LINES` | 600 | 檔案最大行數 |
| `GOLDBAND_MAX_FN_LINES` | 50 | 函式最大行數 |
| `GOLDBAND_MAX_PARAMS` | 4 | 函式最大參數數（Biome `useMaxParams`） |
| `GOLDBAND_MAX_COMPLEXITY` | 12 | 認知複雜度（Biome `noExcessiveCognitiveComplexity`） |

> 純巢狀深度（max-depth）Biome 無對應規則，由認知複雜度涵蓋；若日後仍要獨立門檻再補 AST checker。

### 容錯策略

- **Biome 不可用時**（無 node_modules/@biomejs/biome）：JS/TS Biome 檢查降級為 advisory 並印提示，**仍執行檔案行數等零依賴硬擋**；不因缺工具而 fail-open 到完全不檢查，也不因缺工具而阻斷 commit。
- **Target repo 沒有 `biome.json` 時**：JS/TS Biome 檢查降級為 advisory。全域 hook 不把 goldband 自己的格式政策套到未 opt-in 的外部 repo；零依賴硬擋仍執行。
- **工具偵測必須顯式解析 binary，不靠事後解析 exit code/stderr**（實作硬規格）：
  - `check-code-style.mjs` 先解析 Biome 執行檔（查 `node_modules/.bin/biome` →（選配）全域 → 否則 `null`），**不**用 `npx --no-install biome` 再猜錯誤字串。
  - 解析不到 → 該區塊視為 **skip（非 error）**，印 advisory，零依賴硬擋照跑。
  - 解析得到 → 直接執行該 binary，此時它的非零 exit code **乾淨地只代表 lint violation**，不再與「工具不存在」混淆。
  - 理由：`npx --no-install` 缺件與 Biome 有 violation 都是 exit 1，事後解析 stderr 脆弱且易把「沒裝 Biome」誤判成工具錯誤或 commit failure。先解析 binary 從源頭消除歧義。
- 讀不到檔、非文字檔：略過。
- 所有例外走既有 repo 慣例：主流程不因輔助功能崩潰。

## 5. Lint 引擎：Biome 為主（查證後定案）

查證結果（2026-07，來源見文末）：

- Biome **有** `noExcessiveLinesPerFunction`（函式行數，可設略過空行、不計 IIFE）與 `noExcessiveCognitiveComplexity`（認知複雜度，預設 15）。
- Biome **有** `useMaxParams`（函式最大參數數，`max` 預設 4）——但屬非推薦規則、預設 severity 為 warning，需在設定裡明確啟用並改成 error。
- Biome **沒有** `max-depth`（純巢狀深度）對應規則。認知複雜度是更好的「過度複雜」代理指標，用它取代原始巢狀深度。
- Biome 亦提供 `noUnusedImports` / `noUnusedVariables`（檔案內死碼）、format、lint、抑制註解禁令，Rust 實作比 ESLint+prettier 快很多。

**定案**：Tier A 的 lint 引擎用 **Biome 單一化，不引入第二套 linter**（format + lint + 函式行數 + 認知複雜度 + max-params + unused import + `biome-ignore` 禁令全部由 Biome 涵蓋）。

- 設定檔：`biome.json`，只開可量化/確定性規則，不開風格偏好類。
  - `noExcessiveLinesPerFunction`: 50（略過空行）
  - `noExcessiveCognitiveComplexity`: 12
  - `useMaxParams`: `max` 4，severity 明確設 error（預設是 warning）
  - `noUnusedImports` / `noUnusedVariables`: error
  - formatter：error（未格式化擋 commit）
- 新增 `package.json`（repo 目前無），放 `@biomejs/biome` 為 devDependency + `scripts.lint:style`。`node_modules/` 已在 `.gitignore`，首次需 `npm install`。
- pre-commit 執行**顯式解析到的 Biome binary**（見 §4 容錯），對 materialized staged content 跑 `biome check`；不透過 `npx --no-install`，以免缺件與 violation 的 exit code 混淆。
- **`noExplicitAny`（explicit `any`）與「無說明 `@ts-expect-error`」先設 warning（advisory / opt-in），不預設硬擋**。這類語意判斷用 Biome AST 規則、不用 grep；等實測誤判率低再升 error。
- 唯一 Biome 未覆蓋的是純 `max-depth`；目前由認知複雜度涵蓋，若日後確定要獨立門檻，再單獨補一支輕量 AST checker，仍不引入完整 ESLint。

## 6. `rules/coding-style.md` 內容升級

分成兩區，讓 gate 只認「可強制」區：

**可強制（進 gate，機器判定）**

- 檔案 ≤ 600 行
- 函式 ≤ 50 行（JS 由 Biome `noExcessiveLinesPerFunction`，shell/py 啟發式）
- 認知複雜度 ≤ 12（JS，Biome）；純巢狀深度由此涵蓋
- 函式參數 ≤ 4（JS，Biome `useMaxParams`）
- 禁 `console.log`、`debugger`（沿用現有 console 檢查）
- 逃生艙禁令（**硬擋**，字面指令、近乎零誤判，grep 只掃 staged 新增行）：`@ts-ignore`、`@ts-nocheck`、`as unknown as`、`biome-ignore`、整檔 `eslint-disable`
- 逃生艙禁令（**先 advisory / opt-in**，需 AST 判斷、grep 易誤傷）：explicit `any`（Biome `noExplicitAny`）、無說明的 `@ts-expect-error`
- 禁完整 merge conflict block、禁 focused/skipped 測試（`.only` / `.skip` 分別回報）

**建議性（留文字，AI + host advisory）**

- Immutability（不可變更新）
- 命名可讀性
- 錯誤處理完整性、邊界輸入驗證
- 無魔術數字、用常數/設定
- 高內聚低耦合、依 feature/domain 分檔

文件內每條可強制規則，標註對應的 env 門檻與檢查工具，讓讀者知道「這條是真的會擋」。

## 7. 存量違規（Phase 2 拆檔清單）

啟用硬擋前必須處理（用新量尺確認的當前 > 600 行檔）：

| 檔案 | 現行行數 | 拆分方向建議 |
|---|---|---|
| `shell/install/common.sh` | 913 | 依職責拆：skill-profile 管理 / codex rules / 通用 link 工具 分檔 |
| `skills/global/claude-config-verification/scripts/verify-claude-config.js` | 787 | 依檢查類別拆：各 verify 區塊獨立模組 |

> 函式行數/巢狀檢查一開，違規清單可能再增加，拆檔時一併處理。

## 8. 落地順序

1. **Phase 1**：規則文件改寫 + `check-code-style.mjs` + `biome.json` + `package.json`。純新增，不動全域設定、不擋 commit。先產出量尺。
2. **Phase 2**：用量尺掃出完整違規，拆大檔到全綠。
3. **Phase 3**：`install.sh` 新增明確的全域 pre-commit 安裝指令（含 opt-out）+ uninstall 對應移除；接上 Claude/Codex PostToolUse advisory；更新 `.github/workflows/validate.yml` 加一條 style gate、更新 README/OPERATIONS。

## 9. 檢查分層模型（核心原則）

全域 pre-commit hook 會在**這台機器每一個 repo 的每一次 commit** 觸發，因此它必須「快 + 幾乎零誤判 + 語言/框架無關」。所有候選檢查依「確定性 × 成本 × 通用性」分三層，放到不同執行點。

### Tier A — 機器全域 gate，永遠開（快、確定、通用）

| 檢查 | 做法 |
|---|---|
| secret scan（內容） | 沿用 hook-router 既有 `secret-patterns` |
| 敏感/垃圾檔（按路徑） | 擋 stage `.env`、`*.pem`、`id_rsa`、`*.key`、`.DS_Store`、build 產物、`node_modules`——補內容掃描抓不到的情況 |
| 超大檔 / 大二進位 | byte 級門檻，防大 binary 進 git 史（與行數檢查不同） |
| 檔案大小 / 行數 | 純行數，語言無關 |
| merge conflict 標記 | 只認同檔新增行中完整 `<<<<<<<` / `=======` / `>>>>>>>` block；單獨 `=======` 可是 Markdown setext 標題，不硬擋 |
| focused/skipped 測試 | `.only` / `fdescribe` 回 `focused-test`；`.skip` / `xdescribe` / `xit` 回 `skipped-test`；僅測試檔新增行 |
| 逃生艙禁令（硬擋） | `@ts-ignore`、`@ts-nocheck`、`as unknown as`、`biome-ignore`、整檔 `eslint-disable`；字面指令、grep **只掃 staged 新增行**，TS 類限 `.ts/.tsx` |
| formatter / lint | Biome（見 §5），含函式行數、認知複雜度、max-params、檔案內 unused |

> explicit `any`（Biome `noExplicitAny`）與無說明 `@ts-expect-error` 需 AST 判斷、grep 易誤傷，**先 advisory / opt-in**（見 §5），實測誤判率低再升 error 或移入硬擋。

fail-fast 排序：secret → 敏感檔 → size → merge 標記 → 逃生艙/`.only` → Biome。最貴的絕不放阻擋路徑。

### commit-msg hook（獨立於 pre-commit，repo opt-in）

- **Conventional Commits 格式檢查**：只有 repo 放 `.goldband-git-workflow.json` 或設定 `GOLDBAND_GIT_WORKFLOW_GATE=1` 時，才擋不符 `<type>[optional scope][!]: <desc>` 與 type 白名單的訊息。`rules/git-workflow.md` 已規定此格式，但 global hook 不預設把 git workflow policy 套到所有外部 repo。

### Tier B — 專案條件式（該專案宣告用該機制才觸發）

需 per-project 設定驅動，否則在沒有該 stack 的 repo 會誤噴：

- raw SQL guard（僅 ORM-only 專案）
- migration 擋純 DML（僅有 migrations 目錄 + 政策）
- Prisma generate check（僅有 `schema.prisma`）
- route check / i18n check（僅偵測到框架 + 有該機制）
- frontend native element check（僅有 design-system 政策）
- **分層 / import 邊界 / DDD 結構**（見 §11）
- **檔案內死碼以外的快速 import smoke test**（若該專案跑得夠快）
- **manifest ↔ lockfile 漂移**：改了 `package.json` 但沒更新 lockfile（或反之）就擋（限有 lockfile 的專案）
- **generated artifact 過期**：把「Prisma generate 過期」一般化——同機制涵蓋 GraphQL codegen、OpenAPI、protobuf 等，只在該專案有對應設定時觸發

### Tier C — 語意 / 昂貴 / 高誤判 → 不進 pre-commit，改 CI 或 advisory

- 專案級死碼（未用 export / 孤兒檔，見 §10）
- type boundary check、test quality check
- 慢的 import smoke test、循環依賴全圖掃描
- DDD 語意合規（是否真為 aggregate root、不變式）→ 只能 review agent / advisory

## 10. 死碼檢測（可測，但分兩種）

| 類型 | 工具 | 可測性 | 歸屬 |
|---|---|---|---|
| 檔案內未用 import / 變數 / 參數 | Biome `noUnusedImports` / `noUnusedVariables` | 便宜、可靠、file-local | Tier A |
| 專案級未用 export / 從未被 import 的檔 | **Knip**（ts-prune 已維護模式，不推） | 需建整個 module graph | **Tier C / CI** |

關鍵：專案級死碼**不能靠 staged-only pre-commit**——在 A 檔刪掉最後一處引用，會讓 B 檔的 export 變死碼，但 B 沒 staged，pre-commit 掃不到。因此 Knip 只掛 CI（掃全 repo），不進全域 gate。

## 11. 分層 / DDD 結構檢測（結構可測、語意不可測）

**可機械強制（Tier B，per-project 架構設定驅動）**

- import 邊界 / 分層方向：`eslint-plugin-boundaries` 可宣告 domain / application / infrastructure 各層允許 import 的方向（例：domain 不得 import 任何其他層；application 只能 import domain；infrastructure 可 import domain + application）。
- 跨模組依賴、循環依賴、孤兒模組：`dependency-cruiser`（可宣告 forbidden 規則）。
- 兩者互補：eslint-plugin-boundaries 有即時編輯器紅線，dependency-cruiser 適合全圖規則與 CI。

**不可機械判定（advisory / review agent only）**

- 「這個 class 是不是真的 aggregate root」「不變式有沒有守」「限界上下文切得對不對」等語意合規——留給 `/goldband-review` 或 host advisory，不進 gate。

因此分層/DDD 的**結構部分**進 Tier B（需該專案提供 `.dependency-cruiser` / boundaries 設定，或 goldband 提供 DDD 預設模板），**語意部分**留 Tier C。

## 12. 設計原則（比任何單項檢查更重要）

1. **CI 必須鏡像這套 gate，否則等於裝飾**。client-side hook 隨時能 `--no-verify` 繞過，它是「早點看到錯」的便利，**不是強制邊界**。真正的強制點在 CI（server-side）。全域 pre-commit 與 CI 呼叫**同一支** `check-code-style`，兩邊一致才擋得住。→ Phase 3 必須含 CI 鏡像。
2. **給「有記錄的合法繞過」，不要逼人習慣性 `--no-verify`**。一旦養成每次 `--no-verify`，你**所有** git hook（含 secret scan）一起失效。作法：`GOLDBAND_STYLE_GATE=0` 放行但印明顯警告並記 log，比裸 `--no-verify` 安全可稽核。
3. **速度預算是生死線**。全域 hook 每次 commit 都跑，Tier A 目標 **p95 < ~2 秒**；超過就會被繞過。設計時就定預算並量測，最貴的檢查一律不放阻擋路徑。

## 13. 決策（依健康架構準則定案）

指導準則：**明確優於隱含、只有近乎零誤判的檢查才可硬擋、單一實作多入口、CI 才是權威**。

1. **opt-out 機制 → 兩者並存，角色分開**
   - 檔案標記 `.goldband-no-style-gate`：永久性 per-repo 豁免，進版控，團隊可見可審查。
   - 環境變數 `GOLDBAND_STYLE_GATE=0`：一次性逃生艙，放行但**印警告 + 記 log**。
   - 理由：兩者語意不同不重複；永久走版控、臨時走可稽核 log，都不靜默。裸 `--no-verify` 之所以危險就是靜默且關掉所有 hook。

2. **shell 函式行數 → advisory，不硬擋**
   - 只有「檔案行數」對 shell 硬擋（零誤判）；函式行數靠啟發式，當 advisory。
   - 理由：誤判是 gate 的頭號殺手，一次冤枉就會養成習慣性繞過，連 secret scan 一起失效。只有近乎零誤判的檢查才進硬擋路徑。

3. **Tier B 設定格式 → 宣告式 `.goldband-style.json` 為唯一真相；自動偵測只「建議」不「硬擋」**
   - 硬擋條件一律來自 repo 內宣告式設定（可版控、可 review、可預測）。
   - 自動偵測（有 `schema.prisma` / i18n 目錄）只印提示建議啟用，永不因偵測結果直接擋 commit。
   - 理由：機器全域 hook 一旦自作聰明「偵測到就擋」，偵測錯會在不相干 repo 爆掉。明確優於隱含。

4. **CI 鏡像範圍 → CI 是 pre-commit 的超集：Tier A（同一支腳本）+ Tier C（CI 專屬）**
   - pre-commit 與 CI 的 Tier A 呼叫**同一支 `check-code-style`**，零邏輯漂移。
   - Tier C（Knip 死 export、dependency-cruiser 循環依賴、完整 type-check）本質上只能 CI 全掃，非「要不要加」而是「本來就只能在這」。
   - Tier B 在 CI 只對有宣告的 repo 跑。
   - 理由：CI 才是強制邊界，pre-commit 只是便利；CI 絕不比本地寬。

## 14. 架構不變式（實作時的護欄）

一支 `check-code-style`，三個入口、零重複邏輯：

| 入口 | 呼叫方式 | 範圍 | 行為 |
|---|---|---|---|
| pre-commit | `--staged` | Tier A | 硬擋（快） |
| host hook（Claude/Codex） | `--files <單檔>` | Tier A 子集 | advisory（不擋） |
| CI | 全掃 | Tier A + Tier C（+ 宣告的 Tier B） | 硬擋（權威） |

- 三個入口共用同一份門檻與同一份違規判定邏輯，差別只在「掃哪些檔」與「擋還是提示」。
- 任何檢查要進「硬擋」層，先問：誤判率是否近乎零？否則只能 advisory。
- 任何專案條件式檢查要生效，先問：是否有 repo 內宣告？否則只能建議。

## 附錄：查證來源

- Biome `noExcessiveLinesPerFunction`：<https://biomejs.dev/linter/rules/no-excessive-lines-per-function/>
- Biome `noExcessiveCognitiveComplexity`：<https://biomejs.dev/linter/rules/no-excessive-cognitive-complexity/>
- Biome `useMaxParams`（v2.2.0 起，非推薦、預設 warning）：<https://biomejs.dev/linter/rules/use-max-params/>
- Biome JavaScript 規則清單：<https://biomejs.dev/linter/javascript/rules/>
- Biome 與 ESLint 規則落差討論：<https://github.com/biomejs/biome/discussions/5557>、<https://github.com/biomejs/biome/issues/5740>
- Knip（死碼偵測，取代 ts-prune）：<https://knip.dev/>、<https://effectivetypescript.com/2023/07/29/knip/>
- ts-prune 現況：<https://github.com/nadeesha/ts-prune>
- `eslint-plugin-boundaries`：<https://github.com/javierbrea/eslint-plugin-boundaries>
- `dependency-cruiser`：<https://xebia.com/blog/taking-frontend-architecture-serious-with-dependency-cruiser/>

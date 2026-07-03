# 2026-07 架構審查全文與 gstack 整合計畫

日期:2026-07-03
狀態:審查已完成;方向已由維護者拍板;各 Phase 待執行
相關決策:[ADR-002](DECISIONS.md)

本文件三個部分:

1. **架構審查全文**——以 2026 年 AI coding agent tooling 標準對 goldband 做的產品/架構審查,原文保留。
2. **方向決策**——審查後維護者拍板的 fork-and-prune 決定,以及支持它的補充事實。
3. **執行 TODO**——分 Phase 的行動清單。

注意:審查全文寫於決策之前,其中部分建議(如「讓 gstack-* 真正隱藏」「切掉 gstack 綁售」)已被第二部分的決策**取代**,取代關係在決策章節註明。

---

## 第一部分:架構審查全文

審查當時的證據基準:repo 檔案、`.github/workflows/validate.yml`、本機安裝結果、
本機 usage telemetry、git log(HEAD = `105e699`)。

### 1. 方向判斷

方向基本正確,而且解的是真問題:2026 年多 agent 並用(Claude Code + Codex)已是常態,「同一套工程守則跨 host 一致 + 高風險操作交給 enforcement 而不是 prompt」是真需求。證據上它也確實不只是 dotfiles:

- 統一 hook router 覆蓋全部 11 個 lifecycle events,PreToolUse 有真的 deny 邏輯(secret patterns、高風險 bash),不是 prose(`hooks/scripts/lib/hook-router/`,1,589 行 policy 模組)。
- CI 有 12 個驗證步驟,包含 hook reference 驗證、Codex portability、installer 整合測試、Windows 平台測試(`.github/workflows/validate.yml`)。
- 有 ADR、vendoring runbook、明確的責任邊界文件。

**它是什麼**:guardrail + policy distribution layer(或「本機 agent control plane」)。它不是 harness——loop 的所有權在 Claude Code/Codex 手上;不是 workflow runtime——那是 vendored gstack 的;「agent OS」是它應該避免的說法。準確的一句話:「把跨 host 的工程政策編譯成各 host 的 enforcement 機制,並負責安裝與同步的那一層」。

但要誠實指出:repo 的體積結構暴露了真相——第一方 tracked 檔案 233 個,vendored gstack 924 個檔案、1.1 GB。goldband 自己的獨特貢獻是 policy 層 + adapter 層 + installer,workflow 價值大半是轉售 gstack 的。

### 2. Harness / Loop 成熟度

**實的 loop**(action → check → evidence → 阻擋或修正):

- PreToolUse deny:secret/危險命令即時阻擋 → 這是最實的一條。
- Post-edit worker:debounced format/typecheck,非阻塞 → 實,但只到「跑了」,結果沒有回饋迴路。
- Style gate:pre-commit 阻擋 + Stop hook advisory(`stop-policy.js` 會對 modified files 跑 `check-code-style.mjs`)→ 實。
- CI 對 config repo 自身的驗證 → 實。

**只是文件或 prompt 的 loop**:

- `rules/claim-verification.md`、`loop-engineering.md`、絕大多數 portable skills——這些是「希望 model 遵守」,沒有任何機制驗證它有沒有遵守。
- `goldband-review`/`goldband-investigate`/`goldband-qa` 等重流程 loop 是實的,但那是 gstack 的 loop,goldband 只貢獻了名字和語言包裝。

**缺的東西,而且缺得關鍵**:

- **沒有 eval**。goldband 對自己的 policy 層零 evals——「claim-verification hook 有沒有真的降低虛假完成宣稱?」「deny 規則的誤殺率多少?」完全沒量測。諷刺的是 vendored gstack 自己有 `test:evals`(LLM eval、routing e2e),goldband 這個 meta 層反而沒有。
- **Telemetry 寫了沒人讀**。`metrics.jsonl` 預設關閉,`usage-events.jsonl` 預設開但只有一個一次性的 `report-usage-summary.js` 消費它。有 log 沒有 loop。
- **沒有 failure taxonomy**:hook 誤擋、skill 誤觸發、installer 壞掉,這些都散在 git log 的 fix commits 裡,沒有結構化累積。
- 有一個被低估的資產:`replay-hook-router.js` 已經存在——這是 eval harness 的種子,但沒有 golden dataset 餵它。

### 3. 與 2026 工具趨勢對齊

**已對齊**:hooks(全事件覆蓋)、skills(portable + host adapter 分層,這個分層思路比多數人清楚)、guardrails(deny list + secret patterns)、human-in-the-loop(careful/guard/freeze 模式、Codex approval policies)、MCP(templates + token status 工具)、permission profiles(Codex 端已 staged,保守不搶跑 beta——這個判斷是對的)。對「acceptEdits 不是 sandbox」的誠實聲明也是加分項,多數同類 repo 會謊稱自己是隔離。

**落後**:

- **Evals / observability**:這是和業界差距最大的一塊。2026 年的標準是 agent 行為可回放、可量測、policy 變更有回歸測試;goldband 停在 jsonl 計數。Codex 端 `[otel] exporter = "none"` 是明確選擇隱私,但代價是全盲。
- **分發模式**:業界主流已經是 plugin/marketplace 分發;goldband 有 `.claude-plugin/plugin.json`(裡面 packs/release channels 定義得很像樣),但實際分發仍是 `git clone + install.sh` + symlink。plugin.json 目前更像願望清單。
- **Sandbox agents**:沒有隔離執行的故事,整個安全模型建立在「信任本機」上。
- **Team story**:零。沒有 org baseline + personal overlay 的分層,沒有 policy 版本化發佈。

### 4. 架構健康度

**邊界文件是模範生,實際安裝結果打了自己的臉。** ARCHITECTURE.md、ADR-001、WORKFLOW_VENDORING.md 把 shared policy / adapter / vendored runtime 的邊界講得很清楚,`workflow_wrapper_manifest()` 單一事實來源也是對的設計。但——

**最嚴重的實際問題:entrypoint 大爆炸。** 實際 session 的 skill 清單裡同時出現:`gstack-*` 約 45 個、`goldband-*` 約 48 個、portable skills 約 25 個、legacy commands(`code-review`、`checkpoint`、`map-codebase`)約 10 個。WORKFLOW_VENDORING.md 明文要求「gstack-* 不得成為主要入口」,但 `hide_workflow_root_skills` 沒有擋住它們出現在 session 裡。後果是三重的:每個 session 燒掉大量 context tokens 在 skill descriptions 上、model 面對六個 review 入口(`gstack-review`/`goldband-review`/`code-review`/`code-review-skill`/`review` 等)會選錯、curation 的價值主張直接失效。**這是目前單一最高優先的 bug 級架構問題。**

**Installer 是三倍實作**:326 行 `install.sh` + 2,779 行 `shell/install/*.sh` + 9 個 `goldband-windows-*.mjs` + `install.ps1`。uninstall、self-update、status 都有,誠意像 production tooling,但看最近 15 個 commits 有 10 個是 installer/Windows/hook 的 fix——**這是維護跑步機的典型心電圖**。

**upstream 脆弱點**(按風險排序):

1. `vendor/workflow`(gstack)更新:1.1 GB snapshot + patch 重放 + wrapper 重生成,每次 upstream 大改都是一次手術。
2. Claude Code settings/hooks schema:`hooks.json` 直接綁 schema,上游改欄位就斷。
3. Codex beta permission profiles:已明文 deferred,方向對,但意味著遲早要做一次遷移。
4. `fd9d6b3 fix(codex): remove unsupported compact hooks` 證明 upstream drift 已經實際咬過維護者了。

### 5. 下一步優先級(審查當時的排序,部分已被決策修訂)

按 ROI 排:

1. **收斂入口面**(最高優先):讓 `gstack-*` 真正隱藏、刪 legacy commands、砍重複 review 入口到一個。先量測:一個乾淨 session 的 skill 清單 token 成本,before/after。
2. **把 telemetry 變成 loop**:metrics 預設開,寫一個週期性 report(deny 次數、advisory 命中、誤擋 override),用它建 failure taxonomy。有了 taxonomy,fix commits 才會變成 regression cases 而不是消失在 git log。
3. **最小 eval harness**:擴充 `replay-hook-router.js` + golden decision dataset,每次 hook policy 改動跑回歸。這是「guardrail layer」從宣稱變成可證明的分水嶺。
4. **砍 installer 面積**:二選一——Claude 端改走 plugin 分發(讓 plugin.json 成真),或把 Windows 支援收斂到「Git Bash only」刪掉平行的 mjs 套件。不要三套都養。
5. **決定產品身份**(見第 6 節)。

### 6. 最尖銳批評

**最可能的死法:不是被取代,是被上游拖死。** 三個移動中的 upstream(Claude Code、Codex、gstack)乘上三套 installer 實作,維護成本是乘法不是加法。commit history 已經顯示時間花在讓東西不壞,而不是花在只有 goldband 能提供的價值(可驗證的 policy)上。一年後最可能的狀態是:adapter 們勉強活著,eval 和 telemetry loop 永遠停在「有種子沒長大」。

**Buzzword / 該質疑的功能**:

- `codex/plugin-marketplace/` 和 plugin.json 的 release channels(biweekly、stable/rc)——目前是空承諾,沒有任何發佈流程支撐。要嘛做真,要嘛刪掉,放著是對自己說謊。
- `api-design`、`backend-patterns`、`database-patterns`、`commit-conventions` 這類通用知識 skills——2026 年的 model 不需要被教這些,它們是 prompt-pack 填充物,每個都在燒 context。留下的 skill 應該只有兩種:綁 enforcement 的(careful/freeze)和個人/組織特有的 policy。
- `contexts/` 五個檔案——查一下使用紀錄,大概率是死資產。
- Windows managed requirements「staged 但不強制」——文件誠實,但功能上等於沒有,是面積不是價值。

**該刪或收斂**:通用知識 skills(砍一半以上)、legacy commands、gstack wrappers 裡從沒用過的類別(ios-*、landing-report 那些可以做成 opt-in profile 而不是全裝)、三套 installer 收成兩套。

**補上什麼會從個人工具變成別人願意採用的產品**——四件事,缺一不可:

1. **可證明的 guardrails**:replay corpus + eval,能對外說「這套 deny 規則精確率/召回率是多少」。這是市場上幾乎沒人做到的差異化。
2. **plugin 級分發**:別人不會 clone repo 跑 326 行 bash;`/plugin install goldband` 才是採用的起點。
3. **policy 分層**:org baseline + team overlay + personal overlay,版本化發佈。這是「一個人的設定」和「產品」的本質區別。
4. **切掉 gstack 綁售**:vendored 1.1 GB runtime 是採用的最大阻力——別人要 guardrails,不一定要整套 workflow。讓 workflow 變成 optional dependency 而不是同一個包。

最後一個判斷:如果未來 12 個月只有「維護 adapters」和「做 eval loop」二選一的時間,選後者——adapter 壞了會痛但修得快,而沒有 eval 的 guardrail layer,永遠只是寫得很好的 dotfiles。

---

## 第二部分:方向決策(2026-07-03 拍板)

### 決策:fork-and-prune,自己當 gstack 上游

審查後,維護者決定**不再追 gstack 上游**,把 `vendor/workflow/` 完全整合進
goldband、自己當上游。正式決策記錄見 [ADR-002](DECISIONS.md)。

這個決策**取代**審查中的兩條建議:

- 第 5 節優先級 1 的「讓 gstack-* 真正隱藏」→ 改為**原始碼層級改名**
  `gstack-*` → `goldband-*`,從根源解決,不再靠藏。
- 第 6 節的「切掉 gstack 綁售、讓 workflow 變 optional dependency」→ 改為
  **吸收 + 裁剪**:保留清單內的元件成為第一方程式碼,其餘刪除。

### 支持決策的補充事實(決策當天驗證)

- gstack 的重量集中在少數元件:tracked 924 檔中 `test/` 佔 226、`browse/`
  佔 207(147 MB);磁碟 1.1 GB 中約 704 MB 是 node_modules(本來就不進
  git)。skill 目錄多數是 markdown,維護成本低;**browse 引擎是最容易腐爛、
  維護最貴的零件**(Chrome 改版、反爬蟲變動都會弄壞它)。
- 本機 30 天 usage telemetry(134 筆、13 sessions)幾乎全是 verify-config
  與 skill 建議事件,**沒有任何 gstack workflow 的實際呼叫紀錄**。但
  telemetry 目前只記 hook 事件、不記 workflow skill 呼叫,「沒紀錄」不等於
  「沒用」——這是要先修的量測盲點。
- telemetry 的「persistent」路徑在 `CLAUDE_PLUGIN_DATA` 不存在時 fallback
  到系統 temp 目錄,資料可能隨重開機消失。

### 換到什麼

- 整套 vendoring 機器可刪:`WORKFLOW_VENDORING.md`、`patches/workflow/`、
  rsync 更新手術、`workflow_wrapper_manifest()` 別名產生、
  `hide_workflow_root_skills` 藏名邏輯。這是維護跑步機裡最大的一台。
- 命名問題從根源解決,入口爆炸一次修掉。
- 繼承 gstack 現成的 eval harness(`test:evals`、routing e2e)——正好補上
  審查點名的最大缺口。
- 專案身份變清楚:goldband 就是產品本身,不再是「別人產品的包裝層」。

### 付出什麼

- gstack 上游未來的修復和新功能與本 repo 無關;browse 引擎壞了要自己修。
- bun 建置鏈、Chrome extension、iOS bridge 變成第一方責任。
- eval 要跑要花 API 錢。

### 核心原則

> 只能擁有「實際會用、而且能測」的東西。刪掉的功能連同它的測試一起刪。
> 擁有權的價值在於「有權刪除」,不在於「有義務全部維護」。

### 授權

gstack 為 MIT。整合後保留原 LICENSE 聲明與出處(attribution)。

---

## 第三部分:執行 TODO

沿用既有節奏:一個 Phase 一個 PR;破壞性大的 Phase 先過 ADR。
每個 Phase 都有可直接交辦給實作 agent 的自足提示詞,見
[docs/prompts/](prompts/README.md)。
Phase 0/1 對應審查優先級 1、2;Phase 2/3 實作 fork-and-prune 決策;
Phase 4 對應審查優先級 3;Phase 5 對應審查優先級 4 與 buzzword 清理。

### Phase 0 — telemetry 補洞(先做,決定後面砍什麼)

- [x] 讓 workflow skill / `goldband-*` 入口的實際呼叫寫進 usage log(目前只有 hook 事件)。
- [x] 把 persistent data 路徑搬離系統 temp,落在真正持久的位置。
- [x] `metrics.jsonl` 預設開啟。
- [x] 寫週期性 usage/deny 報表(消費 telemetry,而不是只寫)。
- [ ] 收 2–3 週真實使用數據。

完成條件:能回答「過去 N 週實際用過哪些 workflow 入口、各幾次;hook 擋了什麼」。

### Phase 1 — 入口與 skill 瘦身(便宜、與整合無關,可並行)

- [x] 刪 legacy commands(`code-review`、`checkpoint`、`map-codebase` 等已標 legacy 者)。
- [x] review 入口收斂到一個。
- [x] 通用知識 skills 裁剪:`api-design`、`backend-patterns`、`database-patterns`、`commit-conventions` 等候選刪除;只留「綁 enforcement 的」(careful/freeze)與「個人/組織特有 policy」。
- [x] 檢查 `contexts/` 五個檔案的實際使用,死資產刪除。
- [x] 量測 before/after:乾淨 session 的 skill 清單 token 成本。

完成條件:session 可見入口數與 token 成本顯著下降,且無重複入口。

### Phase 2 — 保留清單決策(ADR)

- [ ] 以 Phase 0 數據為準,對每個 gstack 元件標 keep / freeze / delete。
- [ ] 候選刪除(假設,待數據與維護者確認):`ios-qa`、`setup-gbrain`/`sync-gbrain`、`openclaw`、`supabase`、`office-hours`、`pair-agent`、`landing-report`、`benchmark-models`。
- [ ] `browse/` 單獨決策:它是最貴的維護件;若保留,明確承擔 Chrome 改版的維護責任,並評估能否部分改用 host 原生瀏覽器工具。
- [ ] 寫 ADR 記錄保留清單與理由。

完成條件:每個元件都有明確歸類與理由,ADR 合入。

### Phase 3 — 合併重構(破壞性最大)

- [ ] `vendor/workflow/` 保留清單內的元件升格為第一方目錄。
- [ ] 原始碼層級改名 `gstack-*` → `goldband-*`。
- [ ] 刪除:`WORKFLOW_VENDORING.md`、`patches/workflow/`、`workflow_wrapper_manifest()` 與 wrapper 產生器、`hide_workflow_root_skills`、`shell/install/workflow-wrapper-aliases.sh`。
- [ ] 刪除 delete 清單元件及其測試。
- [ ] 重寫 `ARCHITECTURE.md`(vendor 邊界章節作廢)、更新 README 兩份、`AGENTS.md` preferred 清單。
- [ ] 保留 gstack MIT LICENSE 聲明與 attribution。
- [ ] 建「安裝後 inventory 實測」腳本並跑過:在乾淨環境(temp `HOME`)跑 installer,列出安裝結果實際暴露的全部入口(skills、commands、wrappers),與預期清單逐項比對。

完成條件(全部要有本次執行的實測證據,不接受「應該沒問題」):

1. CI 綠。
2. **安裝後 inventory 實測通過**:乾淨環境安裝後,實際 session 可見的入口清單中——
   - 零個 `gstack-*` 入口(含 skill 名、wrapper、`_gstack-command` 這類底層入口);
   - 零個 legacy commands 殘留(`code-review`、`checkpoint`、`map-codebase` 等 Phase 1 已刪項目不得因 installer 路徑或快取復活);
   - 每個出現的入口都能對應到保留清單,沒有清單外的意外項。
3. **文件與現實一致性核對**:README.md、README.en.md、ARCHITECTURE.md、ADR、installer 的 help/status 輸出、skill catalog(`shell/install/skill-catalog.txt`)五處交叉比對,講的是同一套入口清單與同一個架構描述;任何一處提到已刪除的元件、vendor 邊界或 wrapper 機制即算不通過。
4. inventory 實測與一致性核對的結果(命令輸出或報告)附在 PR 內,作為驗收證據。

### Phase 4 — eval 與 failure taxonomy 接 CI

- [ ] 繼承的 gstack eval harness 縮到保留清單範圍,接上 CI(含預算與金鑰安排)。
- [ ] 擴充 `hooks/scripts/tools/replay-hook-router.js`:建 golden decision dataset(該擋/不該擋案例),hook policy 每次改動跑回歸。
- [ ] 建 failure taxonomy:hook 誤擋、漏擋、skill 誤觸發、installer 壞損,結構化累積;每次事故補一筆 regression case。

完成條件:改 hook policy 或 workflow skill 時,CI 能擋住已知退化;能陳述 deny 規則的誤殺/漏擋狀況。

### Phase 5 — installer 瘦身、分發與空承諾清理

- [ ] 三套 installer 收斂:Claude 端評估改走 plugin 分發(讓 `.claude-plugin/plugin.json` 成真),或把 Windows 支援收斂到 Git Bash only 以刪除平行的 `goldband-windows-*.mjs` 套件——擇一,不三套都養。
- [ ] `plugin.json` 的 release channels 與 `codex/plugin-marketplace/`:做真或刪掉,不留空承諾。
- [ ] Windows managed requirements「staged 但不強制」:確認 runtime 載入路徑後轉正,或明確降級為文件說明。

完成條件:installer 實作數量減少;所有對外宣稱與現實一致。

### 遠期(若要從個人工具變成別人願意採用的產品)

依審查第 6 節,缺一不可的四件事:可證明的 guardrails(Phase 4 產出)、
plugin 級分發(Phase 5 產出)、policy 分層(org/team/personal overlay,
未排 Phase)、workflow 與 policy 的解耦(fork-and-prune 後以保留清單體現)。

---

## 風險與失敗訊號

- **browse 引擎腐爛**:Chrome 改版後 browse/QA 類 workflow 全掛。緩解:Phase 2 認真評估是否保留;保留就排定期 smoke test。
- **砍錯東西**:telemetry 視窗太短誤刪有用元件。緩解:Phase 0 先補量測;git 歷史永遠可復原。
- **合併後測試債**:繼承的 test/ 有 226 檔,若不隨保留清單裁剪會拖垮 CI。緩解:Phase 3 明確「刪功能連測試一起刪」。
- **失敗訊號**(對照 `rules/loop-engineering.md`):fix commits 佔比在整合後不降反升;eval 一直停留在「有種子沒接 CI」;入口數量回升。

## 整合後作廢/改寫的文件

| 文件 | 處置 |
|---|---|
| `WORKFLOW_VENDORING.md` | 刪除 |
| `patches/workflow/` | 刪除 |
| `ARCHITECTURE.md` vendor 邊界章節 | 重寫 |
| `docs/DECISIONS.md` ADR-001 的「vendor/workflow 獨立生命週期」假設 | 由 ADR-002 取代該假設,ADR-001 其餘(thin skills)仍有效 |
| README.md / README.en.md 的 vendoring 描述 | 改寫 |

## 備註

- 既有現代化報告:`/Users/leo/goldband-modernization-2026-07.md`(方向翻轉後,其中 vendor 邊界相關前提需重讀)。
- 若未來 12 個月只能在「維持相容性」與「證明規則有效(eval loop)」之間選一,選後者。

# Phase 5 實作交辦:installer 瘦身、分發與空承諾清理

你是在 goldband repo 工作的實作 agent。Source of truth:
`docs/ARCHITECTURE_REVIEW_2026_07.md` Phase 5。

## 前置條件

- Phase 3 已合入(installer 已改為安裝第一方元件,inventory 檢查已在 CI)。

## 任務目標

installer 從三套實作收斂,並讓所有對外宣稱與現實一致:`plugin.json` 的
承諾做真或刪掉,Windows managed requirements 的狀態明確化。

## 現況基線(先重算,不要沿用舊快照)

- 三套 installer 實作:POSIX 入口 `install.sh`、POSIX 模組
  `shell/install/*.sh`、Windows `scripts/goldband-windows*.mjs` 與
  `install.ps1`。開始前先重算檔案數與行數,並在決策分析中列出本次
  證據;不要把架構審查時的行數快照當成現況。
- `.claude-plugin/plugin.json` 宣稱 packs、semver、biweekly cadence、
  stable/rc channels,但沒有發佈流程支撐。
- `codex/plugin-marketplace/` 是 placeholder。
- Windows managed requirements 只 staged 到 `~/.codex/requirements.toml`,
  不宣稱 runtime 已強制載入(README「Codex 補充」一節)。

## 實作步驟

1. **決策分析(先做,產出後停下來等維護者拍板)**:比較兩個收斂方案——
   - 方案 A:Claude 端改走 plugin 分發(讓 `.claude-plugin/plugin.json`
     成真),POSIX installer 降為 Codex 與 style-gate 用;
   - 方案 B:保留現行 installer,Windows 支援收斂到 Git Bash only,刪除
     平行的 `goldband-windows-*.mjs` 套件與(或含)`install.ps1`。

   分析要含:
   - 各方案刪掉多少行/多少檔,以本次重算結果為準;
   - 對現有使用者的遷移步驟;
   - 方案 B 的 blast radius:README/README.en、Windows integration test、
     Windows fixture、`commands/verify-config.md`、PowerShell launcher 與
     self-update 檢查、CI workflow 需要刪除或改寫哪些內容;
   - Claude Code plugin 機制的現況查證(用當前官方文件,附來源)。
   呈報後**等維護者選定再實作**。
2. 實作選定方案,含 `install.sh status`/`uninstall` 的對應調整與文件更新。
3. **空承諾清理**(不論選哪個方案都做):
   - `plugin.json` 的 release channels/cadence:有發佈流程就補流程,
     沒有就刪掉這些欄位,只留事實性 metadata。
   - `codex/plugin-marketplace/`:做真或刪除。
   - Windows managed requirements:查證 Windows Codex 的
     managed-requirements 載入路徑;可行就轉正並補驗證,不可行就把安裝
     行為降級為明確的文件說明(不再 staged 一個沒人載入的檔案)。
4. 更新 `README.md`、`README.en.md`、`OPERATIONS.md`、
   `docs/CODEX_MODERNIZATION.md` 中受影響的描述;不要引用不存在的文件
   路徑。

## 邊界

- 不改已在 Phase 3 定案的入口與目錄結構。
- 刪除 installer 路徑前,確認 `shell/goldband-self-update.sh` 與
  launchers 沒有殘留引用。
- 方案 B 若刪除 Windows mjs installer 或 `install.ps1`,必須同步處理
  `scripts/test-windows-platform-integration.mjs`、Windows fixtures、README
  安裝指令、`commands/verify-config.md`、PowerShell launcher/self-update
  狀態檢查與 CI 入口;不能只刪 installer 檔案。
- 對外部機制(Claude plugin、Codex requirements)的現況陳述必須引官方
  文件或實測,不引用記憶。
- 未完成 Claude Code plugin 官方文件查證前,不得選定方案 A 或宣稱
  `.claude-plugin/plugin.json` 的 packs/release channels 已可運作。未完成
  Windows Codex requirements 載入路徑官方查證或實測前,不得宣稱 managed
  requirements 已轉正。

## 驗證(完成宣稱必須附本次執行的證據)

- temp `HOME` 全流程實測:install → status → uninstall,POSIX 必測;
  Windows 路徑若保留,跑 `node scripts/test-windows-platform-integration.mjs`
  或說明其替代驗證。
- Phase 3 的 inventory 檢查在新 installer 形態下仍綠。
- 既有 CI 全綠;被刪的 installer 檔案全 repo 零引用(grep 證據)。
- 文件一致性:README/OPERATIONS/plugin.json 對安裝方式的描述與實測行為
  一致,逐項核對。

## 交付

兩段:先一個決策分析(issue 或 PR 討論皆可,等拍板),再一個實作 PR。
實作 PR 描述附:刪除統計、遷移說明、全部驗證輸出摘要。勾計畫文件
Phase 5 checkbox。

## 阻塞時

官方文件與實測不一致(例如 plugin 機制行為與文件描述不符)時,以實測為準
並在回報中標明差異;兩者都拿不到就停,回報缺什麼。

## 建議使用的 skills

`evidence-based-coding`(外部事實查證)、`ci-cd-integration`、
`file-search`;提 PR 前跑 `/goldband-review`。

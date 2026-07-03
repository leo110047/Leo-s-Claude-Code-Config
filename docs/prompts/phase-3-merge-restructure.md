# Phase 3 實作交辦:gstack 合併重構(fork-and-prune 落地)

你是在 goldband repo 工作的實作 agent。這是整個計畫破壞性最大的 Phase。
Source of truth:`docs/ARCHITECTURE_REVIEW_2026_07.md`(尤其第二部分決策與
Phase 3 的硬性完成條件)、`docs/DECISIONS.md` ADR-002 與 ADR-003。

## 前置條件(不滿足就停止並回報)

- ADR-003(gstack 元件 keep/freeze/delete 歸類表)已合入。沒有它就沒有
  執行依據,不要自行決定保留清單。
- Phase 1(入口瘦身)已合入。

## 任務目標

`vendor/workflow/` 不再是 vendor:保留清單內的元件成為 goldband 第一方
程式碼並改名為 `goldband-*`,delete 清單元件連同測試移除,整套 vendoring
機器刪除,所有文件講同一套現實。

## 實作步驟(順序有意義)

1. **升格**:依 ADR-003,把 keep 元件從 `vendor/workflow/` 移到第一方目錄
   (目錄結構由你依 repo 慣例設計,在 PR 描述說明);freeze 元件依 ADR-003
   指定的方式處置;delete 元件連同其測試刪除。
2. **改名**:原始碼層級把 `gstack-*` 入口、命令、設定鍵改為 `goldband-*`,
   含 `bin/gstack-config` 等底層工具與 `_gstack-command` 這類入口。改名是
   全面的:安裝結果任何使用者可見表面不得再出現 gstack 字樣(LICENSE/
   attribution 除外)。
3. **拆機器**:刪除 `WORKFLOW_VENDORING.md`、`patches/workflow/`、
   `shell/install/workflow-wrapper-aliases.sh`、`workflow.sh` 內的
   `workflow_wrapper_manifest()` wrapper 產生與 `hide_workflow_root_skills`
   藏名邏輯;installer 改為直接安裝第一方元件。
4. **文件重寫**:`ARCHITECTURE.md`(vendor 邊界章節作廢,描述新結構)、
   `README.md`、`README.en.md`、`AGENTS.md` 與 `codex/AGENTS.md` 的
   preferred 清單、`shell/install/skill-catalog.txt`。
5. **授權**:保留 gstack 的 MIT LICENSE 全文與出處聲明(位置與格式由你
   依慣例決定,PR 說明)。
6. **建 inventory 實測腳本**:新腳本在乾淨環境(temp `HOME`)跑 installer,
   列出安裝結果實際暴露的全部入口(skills、commands、wrappers),與預期
   清單(由 ADR-003 keep 清單推導)逐項比對,任何多出或缺少都以非零 exit
   失敗。把它接進 CI(`.github/workflows/validate.yml`)。

## 邊界

- 保留清單以 ADR-003 為準;實作中發現想調整歸類,停下來回報,不要邊做邊改。
- Claude 與 Codex 兩側安裝路徑都要處理(`~/.claude/skills/workflow` 與
  `~/.codex/skills/workflow` 的新形態)。
- 大量刪除只用 git rm;不做「先註解掉」的半吊子刪除。

## 硬性完成條件(全部要有本次執行的實測證據,不接受「應該沒問題」)

1. CI 全綠(含新加入的 inventory 檢查)。
2. **inventory 實測通過**:乾淨環境安裝後,實際 session 可見入口清單中——
   零個 `gstack-*` 入口(含底層入口);零個 Phase 1 已刪 legacy commands
   殘留(不得因 installer 路徑或快取復活);每個出現的入口都對應到 ADR-003
   keep 清單,沒有清單外意外項。
3. **五處文件與現實交叉比對**:README.md、README.en.md、ARCHITECTURE.md、
   ADR、installer help/status 輸出、skill catalog 講同一套入口清單與架構;
   任何一處還提到已刪元件、vendor 邊界或 wrapper 機制即不通過。
4. inventory 實測與一致性核對的命令輸出附在 PR 內作為驗收證據。

## 驗證命令(至少)

`bash scripts/test-workflow-integration.sh`、
`node scripts/test-windows-platform-integration.mjs`、
`bash scripts/check-skills.sh`、`bash scripts/check-codex-portability.sh`、
`python3 scripts/verify-hook-script-references.py`、
`node scripts/check-code-style.mjs`、新的 inventory 腳本、
以及全 repo grep `gstack`(白名單:LICENSE/attribution、git 歷史、本計畫
文件)。

## 交付

一個 PR。描述附:新目錄結構說明、改名對照表、刪除統計、全部驗證輸出摘要、
硬性完成條件逐條的證據連結。勾計畫文件 Phase 3 checkbox。

## 阻塞時

改名或升格過程發現隱藏依賴(例如 runtime 內部 hardcode `gstack` 路徑、
bun 建置產物內嵌名稱)導致某條完成條件做不到時,停下來回報:依賴位置、
影響範圍、可行選項。寧可回報也不要留一個「幾乎改完」的狀態。

## 建議使用的 skills

`file-search`(全面找引用與名稱殘留)、`implementation-contracts`、
`claude-config-verification`、`testing-strategy`;提 PR 前跑
`/goldband-review`,並考慮 `/goldband-codex` 拿第二意見。

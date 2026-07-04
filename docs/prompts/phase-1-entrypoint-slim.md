# Phase 1 實作交辦:入口與 skill 瘦身

你是在 goldband repo 工作的實作 agent。計畫背景:
`docs/ARCHITECTURE_REVIEW_2026_07.md` 第三部分 Phase 1(source of truth,
先讀)。本 Phase 與後續 Goldband Loop 整合無關,可獨立進行。

## 任務目標

降低每個 session 暴露的入口數與 context token 成本:刪 legacy commands、
review 入口收斂到一個、裁剪通用知識 skills、清 `contexts/` 死資產。
完成後,session 可見入口沒有重複功能,且有 before/after 的量測數據。

## 現況(已驗證)

- 實際 session 同時暴露六個 review 入口:舊 runtime review 入口、
  `goldband-review`、`code-review`(legacy command)、
  `code-review-skill`(portable skill)、`review`、加上 wrapper。舊 runtime
  前綴的露出問題屬於 Phase 3,本 Phase 不處理。
- legacy commands 在 `commands/`:`code-review.md`、`checkpoint.md`、
  `map-codebase.md` 自己標注為 legacy。
- 通用知識 skills 在 `skills/global/`。
- `contexts/` 有五個檔案:debug、dev、loop、research、review。

## 實作範圍

1. **量測 baseline(先做)**:記錄乾淨 session 的 skill/command 清單與其
   description 總 token(或字元)成本,存進 PR 描述用。
2. 刪 legacy commands:`commands/code-review.md`、`commands/checkpoint.md`、
   `commands/map-codebase.md`。
3. review 入口收斂:portable 的 `code-review-skill` 依 ADR-001 精神縮成
   thin policy/defer 入口或併入,使用者面向的 review 入口只留
   `/goldband-review`(workflow)一個。
4. 通用知識 skills 裁剪:刪除 `api-design`、`backend-patterns`、
   `database-patterns`、`commit-conventions`。保留:綁 enforcement 的
   (`careful-mode`、`freeze-mode`)、repo 維運必需的
   (`claude-config-verification`)、與個人/組織 policy 性質的
   (`evidence-based-coding` 等)。若你認為某個候選不該刪,停下來附理由問,
   不要自行擴大或縮小刪除清單。
5. `contexts/` 五檔逐一查引用(installer、hooks、docs、skill-rules),
   無引用者刪除。
6. **同步所有引用點**:`shell/install/skill-catalog.txt`、installer profiles
   (`shell/install/profiles.sh`、`managed-profiles.sh`)、
   `skills/global/skill-rules.json`、`hooks/` 的 skill 建議、根 `CLAUDE.md`、
   `AGENTS.md`、`codex/AGENTS.md` 的 preferred 清單、README 兩份、
   `.claude-plugin/plugin.json` 的 packs。Claude 與 Codex 兩側要同步改。
7. 量測 after,算出下降幅度。

## 邊界

- 不動後續 Phase 3 會吸收的 workflow runtime 原始碼。
- 不改 hook 的 allow/deny 行為。
- 刪除只用 git rm,不留改名殘骸。

## 驗證(完成宣稱必須附本次執行的證據)

- `bash scripts/check-skills.sh`、`bash scripts/check-codex-portability.sh`、
  `python3 scripts/verify-hook-script-references.py`、
  `node scripts/check-code-style.mjs` 全綠。
- 全 repo grep 每個被刪項目的名字,除了 git 歷史與本計畫文件外零殘留。
- temp `HOME` 跑一次 installer,確認 status 輸出與安裝結果不含已刪項目。
- before/after token 量測數據。

## 交付

一個 PR。描述附:刪除清單與各自理由、引用點同步清單、量測 before/after、
驗證輸出摘要。勾 `docs/ARCHITECTURE_REVIEW_2026_07.md` Phase 1 對應項目。

## 阻塞時

發現某入口有計畫文件沒提到的活躍使用者路徑(hooks 建議它、其他 skill 依賴
它),停下來回報依賴鏈,等決定,不要連鎖刪除。

## 建議使用的 skills

`file-search`(找引用)、`evidence-based-coding`、
`claude-config-verification`;提 PR 前跑 `/goldband-review`。

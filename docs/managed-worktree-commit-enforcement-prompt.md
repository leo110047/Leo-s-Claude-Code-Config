# Managed Worktree Commit Enforcement Prompt

請研究並實作「Goldband 管理的 agent worktree 禁止自行 commit」機制。

## 目標

Goldband 只提供兩個主要指令：

- `goldband worktree create <name>`
- `goldband worktree finish <name> -m "<commit message>"`

`create` 建立 detached worktree，不建立任務分支。Agent 可以改檔、跑測試、查看 diff，但不能自行 stage、commit 或修改 Git refs。只有 Goldband 的 `finish` 能取得 Git 寫入權限，將修改安全整合回建立 worktree 時記錄的原分支，最後的 durable commit 必須存在於原分支。

先研究目前 Claude、Codex、Git hooks、sandbox、installer 與測試架構，再決定實作層。不要只修改文件或 prompt。

## 硬性 Contract

1. 只封鎖 Goldband 建立並登記的 managed worktree，不得誤傷使用者自行建立的其他 worktree。
2. `pre-commit`／PreToolUse hook 只能作為提示與第一層攔截，不能是唯一防線，因為 `git commit --no-verify`、間接 shell script 或低階 Git 指令可能繞過。
3. 強制層應讓 agent 對 Git metadata 只有讀取權限，對工作檔仍有寫入權限。Agent 必須仍能正常執行 `git status`、`git diff` 和測試。
4. 不得使用 agent 可自行設定的 environment variable 作為權限繞過開關。
5. Goldband `finish` 必須由可信任的 broker／host process 取得 Git 寫入權限；若目前 host 無法建立這種權限邊界，必須明確回報限制，不得宣稱已有 hard enforcement。
6. `finish` 前確認：
   - managed worktree 記錄有效；
   - 原工作樹與原分支狀態安全；
   - 原分支是否已移動；
   - tracked、untracked 與 ignored 檔案不會被意外遺漏或刪除。
7. 整合或 commit 失敗時保留 worktree，不得刪除修改。
8. 成功整合、驗證且 commit 已存在於原分支後，才能移除 worktree。
9. 不建立新的正常 Git branch。若內部需要 temporary detached commit，必須說明用途，且不能留下額外 branch 或未整合 commit。
10. Lease／manifest／evidence state 必須有明確位置與權限 contract，不得散落在未宣告的 HOME 路徑。
11. 暫不實作不可靠的「活躍 agent 偵測」；由使用者明確執行 `finish` 啟動收尾流程。

## 驗證要求

至少加入隔離 fixture 測試，證明 managed worktree 中以下行為無法改變 Git metadata：

- `git commit`
- `git commit --no-verify`
- `/usr/bin/git commit`
- shell script 間接呼叫 Git
- `git commit-tree`
- `git update-ref`
- `git add` 或其他 index 寫入

同時證明：

- 工作檔仍可修改；
- read-only Git 查詢與測試仍可執行；
- 非 managed worktree 不受影響；
- `finish` 能在原分支產生正確 commit；
- 原分支移動、dirty、衝突或整合失敗時會停止並保留 worktree；
- Claude 與 Codex 的 installer/runtime surface 保持一致。

## 交付要求

先回報實際可用的 enforcement boundary，以及哪些只是 soft guard。完成後提供：

- 架構與權限資料流；
- 修改檔案；
- 執行的測試與結果；
- 尚未驗證的 host 行為；
- 是否真正能阻止繞過，而不只是攔到普通 `git commit`。

遇到 host 無法提供必要權限隔離、原分支狀態不安全，或必須擴大公開指令介面才能完成時，停止實作並回報證據與建議，不要自行弱化 contract。

不要自行 commit，除非我另外明確要求。

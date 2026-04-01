# Global Skills Validation

這份文件只放驗證與測試觀點，不放一般導覽。

## 驗證重點

### skill 結構健康

```bash
bash scripts/check-skills.sh
```

用途：
- 驗證 `SKILL.md` frontmatter
- 檢查 skill 檔案是否存在
- 提醒過長文件

### prompt-trigger / conflict 行為

建議至少用這些場景做人工 spot check：

```text
這個 API 查詢很慢，幫我優化
→ 應偏向 performance-optimization

設計一個 API 架構來處理大量請求
→ 應偏向 backend-patterns

Review 這個 PR
→ 應偏向 code-review-skill

Review 這個 PR，測試一直失敗
→ 應先偏向 systematic-debugging
```

### anti-hallucination 行為

```text
getUserById 函數在哪裡？
→ 應先查找實際代碼，不應猜測

這個函數做什麼？
→ 應先讀檔，再依實際實作回答

修復這個 bug
→ 應改完後跑驗證，而不是只說應該修好了
```

## 什麼算異常

- 明顯該進 debug 卻被帶去 review
- recommendation 沒有 assumptions / failure modes / alternatives
- mode state 說法與 `status` 不一致
- 直接對 repo 內容做未驗證 claim

## 文件與 inventory 檢查

當 skill catalog、操作方式或 mode 腳本路徑變更時，至少同步檢查：

- `skills/global/README.md`
- `skills/global/OPERATIONS.md`
- `skills/global/LEARNING_PATH.md`
- 對應 skill 的 `SKILL.md`

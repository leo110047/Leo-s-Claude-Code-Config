# 實作交辦提示詞索引

對應 `docs/ARCHITECTURE_REVIEW_2026_07.md` 第三部分的六個 Phase。每份提示詞
自足,可直接整份貼給實作 agent;agent 只需要 goldband repo checkout,不需要
本索引以外的對話脈絡。

## 使用方式

- 一次交辦一個 Phase,一個 Phase 一個 PR。
- 先確認該 Phase 的前置條件(下表)已滿足,再交辦。
- 提示詞內的「阻塞時」規則要求 agent 停下回報而不是硬做;收到回報後由
  維護者決定,再讓 agent 繼續。

## 順序與依賴

| Phase | 檔案 | 前置條件 | 人工拍板點 |
|---|---|---|---|
| 0 telemetry 補洞 | [phase-0-telemetry.md](phase-0-telemetry.md) | 無 | 無 |
| 1 入口與 skill 瘦身 | [phase-1-entrypoint-slim.md](phase-1-entrypoint-slim.md) | 無(與 Phase 0 可並行) | 刪除清單異議時 |
| 2 保留清單 ADR | [phase-2-keep-list-adr.md](phase-2-keep-list-adr.md) | Phase 0 合入 + 2 週數據 | 歸類表確認(必經) |
| 3 合併重構 | [phase-3-merge-restructure.md](phase-3-merge-restructure.md) | ADR-003 + Phase 1 合入 | 歸類調整時 |
| 4 eval 接 CI | [phase-4-eval-ci.md](phase-4-eval-ci.md) | Phase 3 合入 | API 金鑰與費用(必經) |
| 5 installer 瘦身 | [phase-5-installer-distribution.md](phase-5-installer-distribution.md) | Phase 3 合入 | 收斂方案 A/B(必經) |

## 維護

計畫或完成條件改了,先改 `docs/ARCHITECTURE_REVIEW_2026_07.md`,再同步對應
提示詞;兩邊不一致時以計畫文件為準。

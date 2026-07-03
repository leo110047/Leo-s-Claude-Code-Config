# Architecture Decision Records

This document captures significant architectural decisions made during
development.

Format: [ADR (Architecture Decision Record)](https://adr.github.io/)

---

## ADR-001: Keep Portable Skills Thin and Defer Full Workflows to workflow

**Date:** 2026-07-02
**Status:** Accepted

### Context

goldband installs policy and workflow assets for both Claude Code and Codex. The
repo already has a clear responsibility boundary: Claude hooks and Codex rules
are host adapters, while portable skills are shared policy. The vendored
`workflow` runtime owns higher-level review, debugging, planning, design, CSO,
QA, benchmark, and skillify workflows.

Several global skills had grown into duplicate workflow manuals or bundled
scaffold/reference packs. That made the same behavior exist in two places and
increased the chance that Claude and Codex drift apart.

### Decision

Keep global portable skills focused on one of these jobs:

- shared policy that should apply across both hosts;
- domain knowledge that workflow does not own;
- thin handoff entrypoints that say when to defer to workflow.

Full workflow playbooks for review, investigation, planning, security review,
frontend design review, QA, benchmarking, and skill creation belong to workflow
entrypoints such as `/goldband-review`, `/goldband-investigate`, `/plan`,
`/goldband-cso`, `/goldband-design-review`, `/goldband-qa`,
`/goldband-benchmark`, and `/goldband-skillify`.

### Assumptions

- `vendor/workflow/` remains the bundled source for high-level workflows and has
  its own independent lifecycle.
- Claude and Codex continue to install the same portable skill inventory where a
  skill is marked as dual-host in `shell/install/skill-catalog.txt`.
- Thin skills are still useful because they provide trigger boundaries and
  shared policy even when workflow is not installed.
- Host-specific enforcement remains in adapters: Claude hooks and Codex
  execpolicy/config.

### Consequences

**Positive:**

- Reduces duplicate long-form process docs in global skills.
- Makes skill activation cheaper and clearer.
- Keeps review/debug/plan/security/design workflow evolution in one runtime.
- Makes Claude/Codex parity easier to audit because portable skills carry policy
  rather than large host-specific playbooks.

**Negative:**

- Users without workflow installed get thinner guidance than before.
- Some historical language-specific review references are removed from the
  portable skill tree.
- Existing docs and hook suggestions must stay aligned with the smaller skill
  inventory.

**Neutral:**

- Remaining policy skills such as `testing-strategy` and
  `performance-optimization` can still keep focused references when workflow
  does not provide equivalent domain material.

### Alternatives Considered

| Alternative | Why Rejected |
|-------------|--------------|
| Keep the thick skills and update both copies | Preserves duplicate workflow ownership and makes drift likely. |
| Delete C-category skills completely | Removes useful trigger boundaries and policy for installs that do not include workflow. |
| Move all workflow logic into portable skills | Violates the repo boundary and makes host parity harder because workflow already owns orchestration. |

### Failure Signals

- Users repeatedly need old reference material that workflow does not cover.
- `/goldband-*` workflow entrypoints diverge from portable skill policy.
- Installer profiles or docs mention skills that no longer exist.
- Codex and Claude inventories no longer install equivalent shared policy.

### Revisit Triggers / Exit Criteria

- Revisit if workflow stops being bundled by default.
- Revisit if OpenAI or Anthropic changes skills to support richer native workflow
  composition that replaces the current workflow runtime boundary.
- Revisit if user feedback shows thin skills are too sparse for non-workflow
  installs.
- Roll back by restoring a specific removed reference pack only after deciding
  that workflow should not own that domain.

---

## ADR-002: 吸收 vendored gstack runtime、自己當上游(fork-and-prune)

**日期:** 2026-07-03
**狀態:** Accepted

### 背景(Context)

goldband 目前把 gstack workflow runtime(1.45.0.0)vendor 在
`vendor/workflow/`,並視為獨立上游:更新走 WORKFLOW_VENDORING.md runbook
(rsync snapshot、patch 重放、wrapper 重生成、root skill 藏名)。
2026-07-03 的架構審查發現:

- 維護成本被三個移動中的上游(Claude Code、Codex、gstack)吃掉;近期
  commit 歷史以相容性 fix 為主。
- wrapper/藏名層在實務上失效:`gstack-*`、`goldband-*`、portable skills、
  legacy commands 同時出現在同一個 session,造成重複入口與 context token
  浪費。
- goldband 自己的 policy 層沒有任何 eval,而 vendored gstack 卻自帶一套
  可運作的 eval harness,goldband 沒有受益。
- 本機使用 telemetry 顯示多數 gstack 元件沒有被使用(已知量測盲點:
  workflow skill 的呼叫目前還沒有被記錄)。

維護者決定不再追 gstack 上游,改為自己擁有這個 runtime。

### 決策(Decision)

把 `vendor/workflow/` 吸收進 goldband 成為第一方程式碼、自己當上游,
並遵守 fork-and-prune 原則:只保留實際會用、而且能測的元件;其餘連同
測試一起刪除。在原始碼層級把 `gstack-*` 入口改名為 `goldband-*`,並刪除
整套 vendoring 機器(runbook、patches、wrapper manifest、藏名邏輯)。

擁有權的價值在於「有權刪除」,不在於「有義務全部維護」。執行計畫與
分 Phase 的 TODO 見 [ARCHITECTURE_REVIEW_2026_07.md](ARCHITECTURE_REVIEW_2026_07.md)。

### 假設(Assumptions)

- gstack 採 MIT 授權;保留 attribution 與 license 聲明。
- keep / freeze / delete 清單由先行收集的使用 telemetry(Phase 0)決定,
  不憑直覺。
- 繼承的 eval harness 可以縮到保留清單範圍,並在可接受的 API 預算內
  跑在 CI 上。

### 後果(Consequences)

**正面:**

- 整套 vendor 同步手術與 wrapper/藏名層直接刪除。
- 重複入口爆炸從根源修掉(改名,不是藏)。
- goldband 繼承一套可運作的 eval harness,補上最大的缺口。
- 產品身份變清楚:goldband 就是產品本身,不再是轉售層。

**負面:**

- 不再獲得 gstack 上游的修復與新功能;若保留 browse 引擎(最容易腐爛的
  元件),它成為第一方負債。
- 建置鏈(bun、extension、binaries)變成第一方責任。
- 在 CI 跑 eval 要花錢,且需要金鑰管理。

**中性:**

- ADR-001 的 thin-skills 政策仍然有效;只有其中「`vendor/workflow/` 有
  獨立生命週期」的假設被本 ADR 取代。

### 曾考慮的替代方案(Alternatives Considered)

| 替代方案 | 否決理由 |
|-------------|--------------|
| 繼續 vendoring、追上游 | 維護跑步機被相容性 fix 佔滿;wrapper/藏名層已被證明失效。 |
| 完全放棄 gstack,只留 policy 層 | 失去維護者實際想要的 workflow 價值,也失去可繼承的 eval harness。 |
| 全部 fork、不裁剪 | 一個人無法維護約 924 個檔案,含瀏覽器引擎、iOS bridge、PDF pipeline;沒用到的表面積會腐爛。 |

### 失敗訊號(Failure Signals)

- 吸收之後相容性 fix 的 commit 佔比不降反升。
- 繼承的 eval harness 一直沒有接上 CI。
- 入口數量回升到吸收前的水準。
- 保留的元件壞了卻一直沒修,因為缺少便宜可跑的測試。

### 重新檢視觸發條件 / 退出條件(Revisit Triggers / Exit Criteria)

- 若上游 gstack 發展出值得重新 vendor 的功能,重新檢視。
- 若 browse 引擎的維護成本超過其使用價值,重新檢視(屆時改用 host
  原生瀏覽器工具取代)。
- 回滾方式:從 git 歷史還原 vendor snapshot;vendoring runbook 即使刪除
  後也可從歷史找回。

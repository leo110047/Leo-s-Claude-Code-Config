# Work Map Phase 1：Foundation

**Status:** Proposed
**Depends on:** 現有 capability manifest、workflow runtime、context checkpoint store
**Blocks:** Phase 2 Evidence Binding、Phase 3 Collaboration Adapters

本計畫列出的不存在路徑為新增檔案；已存在路徑為修改檔案。

## 1. 目標

建立一個由 Goldband runtime 擁有、可驗證、可跨 session 恢復的 Work Map，
用來保存一件工作的目的、範圍、決策、未知問題、tickets、依賴與目前 frontier。

Phase 1 完成後：

- `$goldband plan create` 能產生 versioned Work Map。
- Work Map 是 active work state 的唯一 authority。
- Runtime 依 ticket dependencies 計算 frontier，不接受模型自行宣稱。
- `$goldband context save` 保存 Work Map reference，不複製 Work Map。
- `$goldband context restore` 會檢查 git 與 Work Map freshness，回傳下一個可執行 ticket。
- Claude 與 Codex 使用相同 Work Map schema、state owner 與 generated contract。

## 2. 限制

- 不執行 production code implementation。
- 不建立 GitHub、GitLab、Linear issues。
- 不綁定 managed worktree。
- 不保存 RED/GREEN 或 review evidence。
- 不新增 `grill-me`、`to-spec`、`to-tickets`、`wayfinder` 等公開 skills。
- 不新增新的 top-level visible skill。
- 不自動把每個小工作升級成 Work Map。

## 3. 使用條件

只有符合任一條件才建立 Work Map：

- 工作預期跨 session。
- 工作需要兩張以上有依賴關係的 ticket。
- 工作需要平行 agent。
- 工作包含尚未能精確表述的 in-scope unknowns。
- 使用者要求可追蹤的 plan、roadmap 或 handoff。

單一 session、低風險、無依賴的小修改保持 ordinary agent loop。

## 4. Authority 與資料位置

### 4.1 Authority

| 資訊 | Authority |
| --- | --- |
| Work Map schema、validation、transition | `goldband-loop/workflows/work-map.ts` |
| Work Map persistence、revision、atomic write | `goldband-loop/workflows/work-map-store.ts` |
| Capability/action、runtime owner、prompt contract | `goldband.manifest.json` |
| Generated capability registry | `goldband-loop/workflows/capability-registry.generated.ts` |
| Current code、tests、git state | Target repository |
| 長期架構決策 | Target repository 的 decision log / ADR |
| Session checkpoint | Existing `context-checkpoint-store` |

Markdown projection、checkpoint、generated docs 都不能成為 Work Map authority。

### 4.2 State layout

```text
${GOLDBAND_HOME:-$HOME/.goldband}/projects/<repository-id>/work/
├── active.json
└── <work-id>/
    ├── map.json
    ├── map.md
    └── events.jsonl
```

- `map.json`：authoritative state。
- `map.md`：由 `map.json` deterministic 產生的人類可讀 projection。
- `events.jsonl`：append-only transition evidence。
- `active.json`：目前 repository/worktree/branch 對應的 active Work Map pointer。

所有路徑先 canonicalize。不得 follow symbolic link 寫入 state。

## 5. Work Map contract

### 5.1 Root schema

```ts
type WorkMapV1 = {
  schemaVersion: 1;
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  repository: {
    identity: string;
    cwd: string;
    branch: string;
    baseCommit: string;
  };
  mode: "bounded" | "wayfinding";
  status:
    | "shaping"
    | "mapped"
    | "executing"
    | "verifying"
    | "completed"
    | "blocked"
    | "cancelled";
  destination: string;
  scope: {
    included: string[];
    excluded: string[];
  };
  decisions: DecisionReference[];
  fog: OpenQuestion[];
  tickets: WorkTicket[];
  frontier: string[];
  blockers: WorkBlocker[];
};
```

### 5.2 Decision reference

```ts
type DecisionReference = {
  id: string;
  summary: string;
  source?: string;
  sourceDigest?: string;
};
```

`source` 只能 reference repo decision record、issue、approved plan 或 prototype artifact。
Work Map 不複製完整 ADR。

### 5.3 Fog

```ts
type OpenQuestion = {
  id: string;
  question: string;
  blockedBy: string[];
  status: "unresolved" | "graduated" | "excluded";
  graduatedTicketIds: string[];
};
```

- 能精確表述並有完成條件的問題必須成為 ticket。
- 尚不能精確表述的 in-scope unknown 才能留在 `fog`。
- Out-of-scope 內容只能進入 `scope.excluded`，不能留在 `fog`。

### 5.4 Ticket

```ts
type WorkTicket = {
  id: string;
  title: string;
  delivers: string;
  blockedBy: string[];
  acceptanceCriteria: string[];
  verificationMode:
    | "tdd"
    | "existing-tests"
    | "manual"
    | "analysis-only";
  testSeams: string[];
  status:
    | "draft"
    | "ready"
    | "claimed"
    | "implemented"
    | "verified"
    | "blocked"
    | "cancelled";
};
```

Phase 1 只能建立 `draft`、`ready`、`blocked`、`cancelled`。
`claimed` 之後的 transition 由 Phase 2 實作。

## 6. Runtime invariants

1. `destination` 不得為空或只包含 generic outcome。
2. `scope.included` 與 `scope.excluded` 不得重疊。
3. Decision、fog、ticket IDs 在同一 map 內唯一。
4. `blockedBy` 只能引用存在且未 cancelled 的 ticket。
5. Ticket dependency graph 不得有 cycle。
6. `frontier` 必須由 runtime 計算：
   - status 為 `ready`；
   - 所有 blockers 已 `verified`；
   - ticket 尚未被 claim。
7. `frontier` input 如與計算結果不同，runtime 拒絕。
8. `bounded` map 不得保存 unresolved fog。
9. `wayfinding` map 可以保存 fog，但不得把 fog 當 ready ticket。
10. `completed` 只能在所有未取消 tickets 為 `verified` 且 fog 為空時成立。
11. Repository identity、branch、base commit 必須由 runtime 讀取，不接受模型提供。
12. 每次 mutation 必須遞增 `revision`、atomic write `map.json`、重建 `map.md`、append event。
13. Stale revision update 必須失敗，不得 last-write-wins。

## 7. 實作工作

### Task 1：記錄架構決策

**Files**

- `docs/DECISIONS.md`

**Action**

- 新增 Work Map authority 決策。
- 記錄不新增多個公開 planning skills、local runtime state 為 Phase 1 authority、
  issue tracker 延後到 Phase 3。
- 列出 failure signals 與 revisit triggers。

**Output**

- 一筆 accepted decision。

**Verification**

```bash
bash scripts/verify-decision-guidance.sh
```

### Task 2：定義 Work Map schema 與 validator

**Files**

- `goldband-loop/workflows/work-map.ts`
- `goldband-loop/test/work-map.test.ts`

**Action**

- 定義 `WorkMapV1`、ticket、fog、decision、blocker types。
- 實作 strict parser，不接受 unknown enum、missing required field、duplicate ID。
- 實作 dependency cycle detection。
- 實作 deterministic frontier calculation。
- 實作 allowed transition table。

**Output**

- 單一 Work Map domain owner。

**Verification**

```bash
cd goldband-loop
bun test test/work-map.test.ts
bun run typecheck
```

Required negative tests：

- Empty destination。
- Duplicate ID。
- Missing blocker。
- Cyclic graph。
- User-supplied frontier mismatch。
- Bounded map contains unresolved fog。
- Invalid status transition。
- Unknown schema version。

### Task 3：實作 atomic Work Map store

**Files**

- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/test/work-map-store.test.ts`
- `goldband-loop/lib/state-root.ts`，僅在需要 shared helper 時修改

**Action**

- 由 canonical repository identity、worktree、branch 解析 state path。
- 實作 create、read、update、set-active、read-active。
- 使用 temp file + rename 實作 atomic JSON write。
- `revision` 使用 compare-and-swap。
- `map.md` 每次由 `map.json` deterministic 重建。
- `events.jsonl` 保存 actor、operation、before/after revision、digest、timestamp。
- 拒絕 symlink、path traversal、repository identity mismatch。

**Output**

- 可重啟、可檢查 revision、可讀回的 local state store。

**Verification**

```bash
cd goldband-loop
bun test test/work-map-store.test.ts
```

Required tests：

- Create/read round trip。
- Atomic update。
- Concurrent stale revision rejection。
- Symlink rejection。
- Branch isolation。
- Worktree identity isolation。
- Markdown projection matches JSON。
- Failed write leaves previous valid state。

### Task 4：把 `plan/create` 提升為 typed owner

**Files**

- `goldband.manifest.json`
- `goldband-loop/workflows/owned-runtime.ts`
- `goldband-loop/workflows/work-map-runtime.ts`
- `goldband-loop/workflows/registry.ts`
- `goldband-loop/workflows/types.ts`
- `goldband-loop/test/workflows-runtime.test.ts`
- `goldband-loop/test/workflows-registry.test.ts`

**Action**

- 保留公開 action `$goldband plan create`。
- 將 runtime 改為 `typed`。
- Runtime owner 改為 `work-map-store`。
- 移除 Claude-only restriction；支援 Claude 與 Codex parent agent。
- Real input 必須包含 `mode`、`destination`、`scope`、`decisions`、`fog`、`tickets`。
- Model 負責 interview 與內容產生；runtime 只 validation、transition、persistence、readback。
- Mock mode 使用 deterministic fixture，不寫 passing fake evidence。
- Registry target、evaluation signal、next step 改為 Work Map completion。

**Output**

- `plan/create` 在 real mode 可保存 Work Map。

**Verification**

```bash
npm run generate:manifest
npm run check:manifest
npm run test:workflow-contracts
cd goldband-loop
bun test test/workflows-registry.test.ts test/workflows-runtime.test.ts
```

### Task 5：加入 installed CLI dispatch

**Files**

- `goldband-loop/bin/goldband.ts`
- `goldband-loop/test/goldband-plan-cli.test.ts`
- `shell/install/workflow.sh`
- `scripts/test-workflow-integration.sh`

**Action**

- 加入 `goldband plan create --input <file>`。
- CLI 解析 installed runtime，不直接 import writable workspace runtime。
- Input 必須是 stable regular file，設定 size limit，讀取時不 follow symlink。
- CLI 不執行 nested model；只呼叫 typed Work Map owner。
- Codex 仍走 native approval；Phase 1 不新增廣泛 execpolicy allow rule。
- Installer 必須驗證 Work Map runtime files 已安裝。

**Output**

- Claude/Codex 都可呼叫相同 installed owner。

**Verification**

```bash
cd goldband-loop
bun test test/goldband-plan-cli.test.ts
cd ..
bash scripts/test-workflow-integration.sh
```

### Task 6：整合 context checkpoint

**Files**

- `goldband-loop/workflows/owned-runtime.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/test/workflows-runtime.test.ts`

**Action**

- `context/save` 在有 active Work Map 時保存：
  - `activeWorkId`
  - `workMapRevision`
  - `workMapDigest`
  - `activeTicketId`，Phase 1 可為 null
- 不複製 destination、tickets、fog。
- `context/restore` 讀取 active map，重新計算 frontier。
- 比較 saved revision、current map revision、saved git、current git。
- 回傳 `stale` reasons 與唯一 next action。
- 無 active map 時保持現有 checkpoint behavior。

**Output**

- Context checkpoint 與 Work Map reference 可 round trip。

**Verification**

```bash
cd goldband-loop
bun test test/workflows-runtime.test.ts
```

Required tests：

- No active map backward compatibility。
- Matching checkpoint/map/git。
- Git changed。
- Map revision changed。
- Missing map。
- Cancelled/completed map。
- Multiple frontier tickets時回報完整 frontier，不任意挑選。

### Task 7：生成與文件同步

**Files**

- `goldband-loop/generated/workflow-contracts/plan/create.workflow.md`
- `goldband-loop/generated/host-skills/*.SKILL.md`
- `docs/generated/capabilities.md`
- `goldband-loop/workflows/README.md`
- `ARCHITECTURE.md`

**Action**

- 只從 manifest 與模板生成 projections。
- 文件寫清楚 Work Map authority、state layout、small-task bypass。
- 不新增手寫 routing table。

**Output**

- Source、generated contract、installed surface 一致。

**Verification**

```bash
npm run generate:manifest
npm run check:manifest
npm run test:capability-invocations
npm run test:workflow-contracts
cd goldband-loop
bun run check:surfaces
```

## 8. Phase 1 完成條件

- `plan/create` 是 typed、public、Claude/Codex 共用的 `work-map-store` owner。
- Work Map invalid state 無法寫入。
- Frontier 只能由 runtime 計算。
- Work Map write 有 revision CAS、atomic persistence、event evidence。
- Context save/restore 只保存與驗證 Work Map reference。
- Small task 不需要 Work Map。
- Clean-home installer 可安裝並執行 Work Map owner。
- Generated surfaces 無 drift。
- Targeted tests、typecheck、style、repo aggregate tests 全部通過。

Final gate：

```bash
npm run check:manifest
npm run test:workflow-contracts
npm run test:capability-invocations
bash scripts/test-workflow-integration.sh
cd goldband-loop
bun run check:source
bun run test:workflows
cd ..
npm run lint:style
git diff --check
npm test
```

## 9. 主要失敗模式

| Failure | Required response |
| --- | --- |
| Work Map 只是 Markdown prompt | 停止；runtime JSON 必須是 authority |
| `frontier` 由模型填入 | 停止；改由 dependency graph 計算 |
| Context checkpoint 複製整張 map | 刪除 duplication，只保存 reference/digest |
| `plan/create` 仍是 mock-only compatibility | Phase 1 未完成 |
| Small task 被強迫建 map | 修正 activation threshold |
| Claude/Codex 產生不同 schema | 修正 generated surface，不加 host-specific fork |
| State write 可被 symlink/path traversal 影響 | Fail closed，補 adversarial test |

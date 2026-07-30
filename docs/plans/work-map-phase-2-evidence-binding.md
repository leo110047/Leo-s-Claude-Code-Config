# Work Map Phase 2：Evidence Binding

**Status:** Proposed
**Depends on:** Phase 1 Work Map Foundation 完成
**Blocks:** Phase 3 Collaboration Adapters

本計畫列出的不存在路徑為新增檔案；已存在路徑為修改檔案。

## 1. 目標

把 Work Map ticket、managed worktree、verification command、review artifact
與最終 integrated commit 綁成同一條可讀回 evidence chain。

Phase 2 完成後：

- Ticket claim 與 managed worktree lease 一對一。
- Ticket 指定的 verification mode 有對應 receipt。
- `tdd` ticket 必須有同一 seam 的真實 RED 與 GREEN。
- `$goldband review code` 可驗證 ticket acceptance、scope 與 verification receipt。
- `goldband worktree finish` 只整合綁定相同 ticket、lease、head、receipt、review 的候選樹。
- Ticket 只能由 runtime 從 `ready` 推進到 `verified`。

## 2. 非目標

- 不自動修改 production code。
- 不要求所有 ticket 使用 TDD。
- 不把 test output 全文永久保存。
- 不讓 agent 自行寫 JSON receipt。
- 不讓 prompt 自我宣稱 review pass。
- 不新增 parallel review specialists。
- 不建立外部 issue tracker。
- 不把 evidence gate 宣稱為對抗同權限使用者的 security boundary。

## 3. Evidence chain

```text
Work Map revision
  └─ Ticket claim
      └─ Managed worktree lease
          ├─ RED/GREEN or other verification receipt
          ├─ Candidate tree/head digest
          └─ review/code artifact
              └─ finish readback
                  └─ Integrated commit
```

每一層必須引用上一層的 stable ID 與 digest。缺一層時 ticket 保持
`implemented`、`blocked` 或 `ready`，不得跳到 `verified`。

## 4. Ticket transition contract

| From | To | Required evidence |
| --- | --- | --- |
| `ready` | `claimed` | Active map revision、ticket unblocked、claim owner、lease binding |
| `claimed` | `implemented` | Candidate tree digest、required verification receipt |
| `implemented` | `verified` | Review artifact、receipt readback、no blocking contract mismatch |
| `claimed` | `blocked` | Blocker reason、attempt evidence、preserved worktree |
| `implemented` | `claimed` | Review requested changes；revision increment |
| Any non-terminal | `cancelled` | Explicit user authorization、reason |

禁止：

- `ready` 直接到 `verified`。
- `blocked` 自動變 `ready`，除非 blocker 狀態已改變並重新計算 frontier。
- 不同 Work Map、ticket、lease、head 的 evidence 互相借用。

## 5. Verification receipt contract

```ts
type VerificationReceiptV1 = {
  schemaVersion: 1;
  id: string;
  workId: string;
  workRevision: number;
  ticketId: string;
  leaseId: string;
  repositoryIdentity: string;
  worktreePath: string;
  baseCommit: string;
  mode: "tdd" | "existing-tests" | "manual" | "analysis-only";
  records: VerificationRecord[];
  candidate: {
    changedPathsDigest: string;
    treeDigest: string;
  };
  createdAt: string;
};
```

```ts
type VerificationRecord = {
  stage: "red" | "green" | "check" | "manual";
  command: string[];
  cwd: string;
  startedAt: string;
  durationMs: number;
  exitCode: number;
  outputDigest: string;
  outputSummary: string;
  seam?: string;
  expectedSignal?: string;
};
```

### 5.1 TDD rules

- RED 必須 `exitCode !== 0`。
- GREEN 必須 `exitCode === 0`。
- RED 與 GREEN 必須使用同一 declared seam。
- RED 必須包含預期 failure signal，不能只證明 unrelated test failure。
- GREEN 必須發生在 RED 之後。
- RED/GREEN 必須屬於同一 work ID、ticket、lease。
- Candidate tree 改變後，舊 GREEN 失效，必須重跑。

### 5.2 Other modes

- `existing-tests`：至少一筆成功 `check`，命令由 ticket planning contract 指定。
- `manual`：保存具體步驟、observable result、artifact reference；不能只寫「人工測過」。
- `analysis-only`：不得產生 code candidate；完成證據是 named report/artifact。

## 6. 實作工作

### Task 1：擴充 Work Map transition

**Files**

- `goldband-loop/workflows/work-map.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/test/work-map.test.ts`
- `goldband-loop/test/work-map-store.test.ts`

**Action**

- 實作 claim、mark-implemented、request-changes、verify、block、cancel operations。
- 每個 operation 驗證 expected revision。
- Claim 只接受 runtime 計算出的 frontier ticket。
- 保存 claim owner、claimedAt、lease ID、evidence references。
- Transition event 寫入 `events.jsonl`。

**Output**

- Ticket lifecycle 由單一 runtime owner 管理。

**Verification**

```bash
cd goldband-loop
bun test test/work-map.test.ts test/work-map-store.test.ts
```

### Task 2：把 ticket 綁定 managed worktree lease

**Files**

- `goldband-loop/lib/managed-worktree.ts`
- `goldband-loop/lib/managed-worktree-boundary.ts`
- `goldband-loop/bin/goldband.ts`
- `goldband-loop/test/managed-worktree.test.ts`
- `goldband-loop/test/managed-worktree-boundary.test.ts`

**Action**

- Managed worktree create 接受一個明確 ticket ID。
- Runtime 從 active Work Map 解析 ticket；不得用 title fuzzy match。
- Ticket 必須位於 frontier 且未被 claim。
- Lease 新增 `workId`、`workRevision`、`ticketId`、`ticketContractDigest`。
- Create 成功後才將 ticket transition 到 `claimed`。
- Create 失敗不得留下 claimed ticket。
- Legacy standalone worktree create 保持可用，但不能產生 Work Map verification。
- Managed shell 設定 read-only binding environment，讓 recorder 能找到 lease，
  但不得相信 environment value，必須回讀 broker-owned lease。

**Output**

- Work Map ticket 與 lease 一對一。

**Verification**

```bash
cd goldband-loop
bun test test/managed-worktree.test.ts test/managed-worktree-boundary.test.ts
```

Required tests：

- Non-frontier ticket rejected。
- Already claimed ticket rejected。
- Create failure rolls back claim。
- Lease/map mismatch rejected。
- Standalone create remains compatible。
- Agent cannot rewrite lease binding。

### Task 3：實作 verification recorder

**Files**

- `goldband-loop/lib/verification-receipt.ts`
- `goldband-loop/bin/goldband-work-verify`
- `goldband-loop/bin/goldband-work-verify.ts`
- `goldband-loop/test/verification-receipt.test.ts`
- `goldband-loop/inventory.json`
- Installer inventory checks

**Action**

- 建立 internal runtime tool：

```bash
goldband-work-verify red --seam <name> --expect <signal> -- <command> [args...]
goldband-work-verify green --seam <name> -- <command> [args...]
goldband-work-verify check -- <command> [args...]
```

- Tool 只能在有效 managed worktree lease 內執行。
- 使用 argument array，不經 shell interpolation。
- 保存 bounded stdout/stderr summary 與完整 output digest。
- Secret-like output 不持久化；summary 先 redaction。
- Evidence 寫到 broker-owned state root，不寫進 agent-writable checkout。
- 每次 record 讀回 worktree、lease、map、ticket、tree state。
- Output 超限、timeout、signal mismatch 均明確失敗。
- Tool 不取得 managed shell 以外的額外權限。

**Output**

- Agent 無法只靠手寫檔案宣稱 RED/GREEN。

**Verification**

```bash
cd goldband-loop
bun test test/verification-receipt.test.ts
```

Required adversarial tests：

- Fake receipt in checkout rejected。
- Environment lease spoof rejected。
- RED command returns zero。
- RED missing expected signal。
- GREEN before RED。
- Different seam。
- Candidate changes after GREEN。
- Secret-like output redaction。
- Timeout and output cap。
- Command array preserves spaces and metacharacters。

### Task 4：把 receipt 綁進 Work Map

**Files**

- `goldband-loop/workflows/work-map.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/lib/verification-receipt.ts`
- `goldband-loop/test/work-map-evidence.test.ts`

**Action**

- Ticket `claimed → implemented` 時依 `verificationMode` 驗證 receipt。
- 驗證 receipt provenance、work ID、ticket ID、lease、base commit、tree digest。
- `tdd`、`existing-tests`、`manual`、`analysis-only` 使用不同 verifier。
- Receipt 失效時保存原因，不改成 verified。

**Output**

- Implementation state 有可讀回 verification proof。

**Verification**

```bash
cd goldband-loop
bun test test/work-map-evidence.test.ts
```

### Task 5：讓 `review/code` 接受 Work Map scope

**Files**

- `goldband-loop/bin/goldband.ts`
- `goldband-loop/lib/review-runtime-contract.ts`
- `goldband-loop/workflows/types.ts`
- `goldband-loop/workflows/review.ts`
- `goldband-loop/workflows/review-engine.ts`
- `goldband-loop/review/findings-schema.md`
- `goldband-loop/test/goldband-review-cli.test.ts`
- `goldband-loop/test/workflows-runtime.test.ts`

**Action**

- 新增：

```text
goldband review code --work-id <id> --ticket-id <id>
```

- 兩個 flag 必須一起出現。
- Runtime 讀取 authoritative Work Map，不接受任意 spec path 取代。
- Review prompt 加入 bounded intent bundle：
  - destination
  - ticket delivers
  - acceptance criteria
  - scope
  - test seams
  - verification receipt summary/digest
- Work Map 文字視為 untrusted content，與 system/rules instructions 明確分隔。
- Findings category 增加：
  - `code-risk`
  - `contract-mismatch`
  - `scope-creep`
  - `verification-gap`
- 保持一個 independent core reviewer；不新增 parallel specialists。
- Review artifact 保存 work ID、ticket ID、map revision、ticket digest、
  receipt digest、reviewed diff digest。

**Output**

- Review 能判斷「做得安全」與「做的是不是原本要求」。

**Verification**

```bash
cd goldband-loop
bun test test/goldband-review-cli.test.ts test/workflows-runtime.test.ts
```

Required tests：

- Missing pair flag。
- Map/ticket missing。
- Stale revision。
- Receipt mismatch。
- Prompt-injection-like ticket text stays data。
- Scope creep finding schema。
- Review artifact provenance fields。

### Task 6：Review verdict 推進 ticket

**Files**

- `goldband-loop/workflows/review.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/test/work-map-review.test.ts`

**Action**

- Review 完成後由 Work Map owner 讀回 review artifact。
- 有 blocking `contract-mismatch`、`scope-creep`、`verification-gap` 時：
  - ticket 回到 `claimed`；
  - 保存 requested changes reference；
  - 舊 receipt 因 candidate 改變而失效。
- 無 blocking finding 且 receipt/current tree 一致時：
  - ticket 進入 `verified`；
  - 保存 review artifact reference。
- Reviewer child process不得直接修改 map。

**Output**

- `verified` 是 runtime readback，不是 prompt verdict。

**Verification**

```bash
cd goldband-loop
bun test test/work-map-review.test.ts
```

### Task 7：把 evidence gate 接到 worktree finish

**Files**

- `goldband-loop/lib/managed-worktree.ts`
- `goldband-loop/bin/goldband.ts`
- `goldband-loop/test/managed-worktree.test.ts`
- `ARCHITECTURE.md`

**Action**

- Bound worktree finish 前讀回：
  - lease
  - active map
  - ticket
  - receipt
  - review artifact
  - candidate tree
- 全部 digest 相符且 ticket 為 `verified` 才能 integration。
- Integration commit 成功後：
  - 寫入 commit/tree/readback evidence；
  - ticket 保存 integrated commit；
  - 重新計算 frontier；
  - map 若所有 tickets 完成且無 fog，進入 `completed`。
- 任何 pre-integration failure 保留 worktree。
- Standalone worktree 保持現有 finish contract，不偽造 Work Map evidence。

**Output**

- Idea-to-commit evidence chain 完整閉合。

**Verification**

```bash
cd goldband-loop
bun test test/managed-worktree.test.ts
```

Required tests：

- Verified ticket integrates。
- Unreviewed ticket blocked。
- Stale review blocked。
- Tree changed after review blocked。
- Source branch moved。
- Failed integration preserves checkout and map state。
- Successful integration advances frontier。

### Task 8：Installed runtime、rules 與 generated surfaces

**Files**

- `goldband.manifest.json`
- `goldband-loop/generated/workflow-contracts/review/code.workflow.md`
- `goldband-loop/inventory.json`
- `shell/install/workflow.sh`
- `scripts/test-workflow-integration.sh`
- `scripts/test-codex-portability.mjs`
- `ARCHITECTURE.md`
- `docs/DECISIONS.md`

**Action**

- Manifest 宣告 review Work Map binding 與 verification。
- Installer 帶入 verification recorder 與 Work Map modules。
- Codex/Claude installed runtime 使用同一 evidence contract。
- 更新 architecture decision：verification recorder 是 evidence gate，
  不是 same-user security boundary。

**Output**

- Source 與 installed runtime parity。

**Verification**

```bash
npm run generate:manifest
npm run check:manifest
npm run test:workflow-contracts
bash scripts/test-workflow-integration.sh
npm run test:codex-portability
```

## 7. Phase 2 完成條件

- Ticket claim、lease、receipt、review、commit 能沿 stable IDs/digests 追溯。
- `tdd` ticket 無有效 RED/GREEN 不得 verified。
- Reviewer 不能直接修改 Work Map。
- Worktree finish 不能整合 stale/unreviewed candidate。
- Candidate 改變會使舊 GREEN 與 review 失效。
- Standalone worktree 保持原行為。
- Claude/Codex installed runtime 使用相同 contract。
- 所有 negative/adversarial tests 通過。

Final gate：

```bash
npm run check:manifest
npm run test:workflow-contracts
npm run test:cross-review
npm run test:hook-router
bash scripts/test-workflow-integration.sh
cd goldband-loop
bun run check:source
bun run test:workflows
bun test test/work-map.test.ts \
  test/work-map-store.test.ts \
  test/work-map-evidence.test.ts \
  test/work-map-review.test.ts \
  test/verification-receipt.test.ts \
  test/managed-worktree.test.ts
cd ..
npm run lint:style
git diff --check
npm test
```

## 8. 主要失敗模式

| Failure | Required response |
| --- | --- |
| Agent 手寫 receipt | 拒絕；只接受 recorder state root artifact |
| RED 是 unrelated failure | 要求 expected signal 與 seam match |
| Review 與 candidate tree 不同 | Review 失效，重新執行 |
| Reviewer 直接 transition ticket | 移除寫權，改由 Work Map owner readback |
| Finish 只看 ticket status | 加入 lease、receipt、review、tree digest 驗證 |
| 所有工作被迫 TDD | 依 planning-time verification mode 分流 |
| Evidence 保存 secrets/full logs | Redact、bound summary、只存 digest |
| Evidence gate 被稱為 security boundary | 修正文案與 threat model |

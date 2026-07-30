# Work Map Phase 3：Collaboration Adapters

**Status:** Proposed
**Depends on:** Phase 1 Foundation、Phase 2 Evidence Binding 完成

本計畫列出的不存在路徑為新增檔案；已存在路徑為修改檔案。

## 1. 目標

讓 Work Map 可選擇投影到 GitHub Issues 或 GitLab Issues，供團隊查看、
分派、評論與追蹤，同時維持 Goldband Work Map operations 為唯一 domain owner，
並對外部變更執行 explicit import、conflict detection 與 readback。

Phase 3 完成後：

- Local-only Work Map 保持預設。
- 使用者可明確設定 GitHub 或 GitLab adapter。
- Map、tickets、blocking edges、status 可 deterministic projection。
- 每個外部 artifact 帶有 work ID、ticket ID、revision、digest。
- 外部變更不會靜默覆蓋 local Work Map。
- Sync 支援 resume checkpoint、idempotency、partial failure readback。
- Outward writes 必須經 native host approval。

## 2. 非目標

- 不支援 Linear、Jira 或任意 generic tracker。
- 不自動啟用 remote sync。
- 不在 prompt 中保存 access token。
- 不把 issue body 當成可執行 instruction。
- 不承諾 GitHub/GitLab API 提供 atomic distributed lock。
- 不用 labels 模擬 security boundary。
- 不同步完整 source、test output、secret-like evidence。
- 不讓 issue tracker 成為第二份未受控 authority。

## 3. Ownership model

Domain authority 是 `WorkMapStore` operations，不是某個檔案格式。

Phase 3 提供兩種 backend：

```ts
interface WorkMapStore {
  create(input: CreateWorkMap): Promise<WorkMapV1>;
  read(id: string): Promise<WorkMapV1>;
  update(id: string, expectedRevision: number, change: WorkMapChange):
    Promise<WorkMapV1>;
  appendEvent(event: WorkMapEvent): Promise<void>;
}
```

- `LocalWorkMapStore`：Phase 1 JSON state。
- `TrackerProjectionAdapter`：外部 projection/readback，不直接實作 domain transition。

Phase 3 不以 issue tracker 取代 local store。外部 changes 先轉成
`ExternalChangeCandidate`，經 validation、conflict check、使用者確認後，才由
`WorkMapStore.update()` 套用。

這個模型避免 provider API 直接繞過 ticket transition invariants。

## 4. Provider-neutral adapter contract

```ts
type TrackerProvider = "github" | "gitlab";

interface TrackerProjectionAdapter {
  provider: TrackerProvider;
  inspectConfiguration(): Promise<TrackerConfigurationReadback>;
  previewProjection(map: WorkMapV1): Promise<ProjectionPlan>;
  publish(plan: ProjectionPlan): Promise<ProjectionResult>;
  inspectRemote(workId: string): Promise<RemoteProjectionState>;
  diff(local: WorkMapV1, remote: RemoteProjectionState):
    ExternalChangeCandidate[];
  applyApprovedChanges(
    map: WorkMapV1,
    approved: ApprovedExternalChange[],
  ): Promise<WorkMapV1>;
}
```

Provider wire types 必須留在：

```text
goldband-loop/workflows/tracker-adapters/github.ts
goldband-loop/workflows/tracker-adapters/gitlab.ts
```

Shared Work Map types 不得 import GitHub/GitLab SDK 或 wire types。

## 5. Projection contract

### 5.1 Map issue

一個 Work Map 對應一個 map issue：

```markdown
## Destination

<destination>

## Scope

### Included
- ...

### Excluded
- ...

## Decisions

- <reference + one-line summary>

## Fog

- <unresolved question>

## Progress

- Ready: N
- Claimed: N
- Implemented: N
- Verified: N
- Blocked: N
```

Body 尾端包含 machine marker：

```html
<!-- goldband-work-map
schema=1
work-id=<id>
revision=<n>
digest=<sha256>
-->
```

### 5.2 Ticket issue

```markdown
## Delivers

<user-visible or verifiable outcome>

## Acceptance criteria

- [ ] ...

## Verification

- Mode: <mode>
- Seams: <seams>

## Blocked by

- <ticket link>
```

Marker：

```html
<!-- goldband-work-ticket
schema=1
work-id=<id>
ticket-id=<id>
work-revision=<n>
ticket-digest=<sha256>
-->
```

### 5.3 Projection restrictions

- 不投影 full verification logs。
- 不投影 private local paths。
- 不投影 secrets、credentials、environment values。
- Evidence 只投影 verdict、digest、允許公開的 artifact link。
- Issue comments、body、labels 視為 untrusted external input。

## 6. Sync state

```ts
type TrackerSyncStateV1 = {
  schemaVersion: 1;
  provider: "github" | "gitlab";
  repository: string;
  workId: string;
  mapRemoteId: string;
  ticketRemoteIds: Record<string, string>;
  lastLocalRevision: number;
  lastRemoteDigest: string;
  checkpoint: {
    operationId: string;
    completedSteps: string[];
    pendingSteps: string[];
  };
  lastReadbackAt: string;
};
```

Sync state 放在 Goldband state root，不寫 credentials。

## 7. Conflict policy

### 7.1 Allowed external changes

只有以下變更可成為 import candidate：

- Issue assignee change，轉成 claim proposal。
- Issue closed/reopened，轉成 status proposal。
- Acceptance checkbox change，轉成 evidence review proposal。
- 明確格式的 Goldband resolution comment。
- 新增普通 comment，作為 discussion reference，不直接修改 map。

### 7.2 Never automatic

以下變更不得自動套用：

- Destination。
- Included/excluded scope。
- Verification mode。
- Test seams。
- Dependency edges。
- Ticket deletion。
- Ticket verified status。
- Work Map completed status。

這些變更必須顯示 local/remote diff，取得使用者確認，再由 Work Map owner
執行正式 transition。

### 7.3 Concurrent changes

- 每次 sync 先讀 local revision 與 remote digest。
- Local revision 或 remote digest 與 checkpoint 不同時停止 mutation。
- 顯示 conflict，不執行 last-write-wins。
- GitHub/GitLab 缺少可靠 write CAS 時，不宣稱 distributed locking。
- 同一 ticket 的多方 claim 衝突回到使用者處理；不得任意挑 winner。

## 8. Authorization contract

所有 remote mutation 都是 outward-facing action。

需要 native host approval：

- Create map issue。
- Create ticket issues。
- Edit body、labels、assignees、dependency links。
- Close/reopen issue。
- Post resolution comment。

Read-only inspect、diff、preview 不需要 remote mutation approval，但仍需依 host
對 network/tool 的原生權限執行。

不得把 approval boolean 放進 input JSON 當成授權。

## 9. 實作工作

### Task 1：記錄 collaboration authority 決策

**Files**

- `docs/DECISIONS.md`
- `ARCHITECTURE.md`

**Action**

- 記錄 local Work Map 仍是 Phase 3 authority。
- Tracker 是 projection 與 collaboration surface。
- External changes 必須先成 candidate，再由 Work Map operation 套用。
- 明確記錄 distributed claim 不具 atomic guarantee。

**Output**

- Provider boundary 與 failure signals 有 durable record。

**Verification**

```bash
bash scripts/verify-decision-guidance.sh
```

### Task 2：定義 adapter、projection、sync schemas

**Files**

- `goldband-loop/workflows/tracker-adapters/types.ts`
- `goldband-loop/workflows/tracker-adapters/projection.ts`
- `goldband-loop/workflows/tracker-adapters/sync-state.ts`
- `goldband-loop/test/tracker-projection.test.ts`

**Action**

- 定義 provider-neutral adapter interface。
- 實作 deterministic map/ticket Markdown rendering。
- 實作 marker parser 與 digest。
- 實作 sync checkpoint schema。
- Parser 拒絕 duplicate marker、unknown schema、invalid IDs、oversized body。

**Output**

- Provider-neutral projection owner。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-projection.test.ts
bun run typecheck
```

### Task 3：實作 tracker configuration owner

**Files**

- `goldband-loop/workflows/tracker-config.ts`
- `goldband-loop/test/tracker-config.test.ts`
- `goldband.manifest.json`

**Action**

- Config 支援：
  - `off`
  - `github`
  - `gitlab`
- 保存 provider、repository identity、default labels、dependency capability。
- 不保存 token。
- Setup 先 read-only inspect CLI/auth/repository，再顯示 config preview。
- 寫 config 與遠端初始化分開授權。
- Missing CLI、auth、repository access 明確 blocked。

**Output**

- 可讀回的 tracker configuration，不含秘密。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-config.test.ts
```

### Task 4：實作 GitHub adapter

**Files**

- `goldband-loop/workflows/tracker-adapters/github.ts`
- `goldband-loop/test/tracker-github.test.ts`

**Action**

- 使用 `gh` argument arrays，不組 shell command string。
- Read operations：
  - repository identity
  - issue body/comments/labels/assignees/state
  - sub-issue/dependency capability
- Write operations：
  - create/update map issue
  - create/update ticket issue
  - apply labels
  - native sub-issue/dependency，無 capability 時明確 fallback 到 body links
- 每個 write 後重新 fetch 並驗證 marker、digest、relationship。
- Partial failure 保存 checkpoint，可 idempotent resume。
- Duplicate remote marker 或 foreign marker 停止。

**Output**

- GitHub projection round trip。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-github.test.ts
```

Tests 使用 fake `gh` adapter，不把 mock success 當 live provider proof。

### Task 5：實作 GitLab adapter

**Files**

- `goldband-loop/workflows/tracker-adapters/gitlab.ts`
- `goldband-loop/test/tracker-gitlab.test.ts`

**Action**

- 使用 `glab` argument arrays。
- 對齊 shared adapter contract，不讓 GitLab wire shape 洩漏。
- 支援 issue create/update、labels、assignee、links。
- Native dependency capability不存在時使用明確 body link fallback。
- 每個 write 後 readback。
- Partial failure、resume、duplicate marker 行為與 GitHub 一致。

**Output**

- GitLab projection round trip。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-gitlab.test.ts
```

### Task 6：實作 preview、publish、inspect、sync runtime

**Files**

- `goldband-loop/workflows/tracker-runtime.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/workflows/owned-runtime.ts`
- `goldband-loop/test/tracker-runtime.test.ts`

**Action**

- `preview`：
  - local only；
  - 列出將建立、更新、關閉的 remote artifacts；
  - 列出需要的 approvals。
- `publish`：
  - 只接受已 preview 的 operation digest；
  - 每個 outward step 經 native approval；
  - 寫 checkpoint；
  - 完成後 readback。
- `inspect`：
  - read-only；
  - 產生 local/remote digest comparison。
- `sync`：
  - remote changes 轉成 candidates；
  - safe discussion references 可直接記錄；
  - domain transition 必須使用者確認；
  - 套用後 increment Work Map revision、重新 projection、readback。

**Output**

- Resumable、idempotent、readback-verified tracker workflow。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-runtime.test.ts
```

Required tests：

- Preview has no writes。
- Publish requires matching preview digest。
- Resume after ticket 3 of 5。
- Retry does not duplicate issues。
- Remote drift blocks write。
- Unauthorized outward action stops。
- Readback mismatch leaves pending state。

### Task 7：定義公開 capability surface

**Files**

- `goldband.manifest.json`
- `goldband-loop/bin/goldband.ts`
- `goldband-loop/test/workflows-registry.test.ts`
- `goldband-loop/test/goldband-plan-sync-cli.test.ts`

**Action**

- 不新增 visible skill。
- 優先把 collaboration 做成 `plan/create` 的 optional tracker mode 與 Work Map
  internal operations。
- 如果使用者需要顯式操作，只新增一個 capability action：

```text
$goldband plan sync
```

- `plan sync` 在 runtime owner、safety gate、authorization、readback 都完成前，
  保持 registered-only experimental，不得先公開 prompt-only action。
- CLI 分開 read-only preview 與 outward publish。

**Output**

- Public vocabulary 最小化。

**Verification**

```bash
npm run generate:manifest
npm run check:manifest
npm run test:capability-invocations
cd goldband-loop
bun test test/workflows-registry.test.ts test/goldband-plan-sync-cli.test.ts
```

### Task 8：External change import

**Files**

- `goldband-loop/workflows/tracker-adapters/import.ts`
- `goldband-loop/workflows/work-map-store.ts`
- `goldband-loop/test/tracker-import.test.ts`

**Action**

- 將 remote delta 解析為 typed candidate。
- Candidate 顯示：
  - source provider/issue/user/time
  - local value
  - remote value
  - proposed Work Map operation
  - risk
- Approval 後仍由 Work Map validator 執行。
- Issue content 不得成為 system instruction 或 executable command。
- Verified/completed transition 仍需 Phase 2 evidence，不接受 closed checkbox 取代。

**Output**

- External collaboration 不繞過 Work Map invariants。

**Verification**

```bash
cd goldband-loop
bun test test/tracker-import.test.ts
```

Required adversarial tests：

- Prompt injection in issue body/comment。
- Forged Goldband marker。
- Closed issue without verification evidence。
- Remote scope rewrite。
- Conflicting assignees。
- Deleted dependency。
- Oversized comment/body。

### Task 9：Installer、status、telemetry、docs

**Files**

- `shell/install/workflow.sh`
- `shell/install/workflow-status.sh`
- `scripts/test-workflow-integration.sh`
- `goldband-loop/inventory.json`
- `goldband-loop/workflows/evidence.ts`
- Telemetry schema/tests
- `ARCHITECTURE.md`
- `OPERATIONS.md`
- `docs/generated/capabilities.md`

**Action**

- Installer 帶入 adapters，不建立 credentials。
- Status 顯示 tracker mode、CLI availability、auth readback，token 永不顯示。
- Telemetry 記錄 provider、operation、counts、status、duration、conflict reason，
  不記 issue body/private content。
- 文件說明 local-only default、approval boundary、non-atomic remote claim limitation。

**Output**

- 安裝、狀態、觀測與文件一致。

**Verification**

```bash
npm run generate:manifest
npm run check:manifest
npm run test:workflow-contracts
npm run test:telemetry
bash scripts/test-workflow-integration.sh
```

### Task 10：Live provider verification

**Artifacts**

- `docs/reports/work-map-github-live-verification.md`
- `docs/reports/work-map-gitlab-live-verification.md`

**Action**

- 在明確授權的 disposable private test repositories 執行：
  - publish new map
  - create dependent tickets
  - update one ticket
  - simulate partial failure and resume
  - create remote conflict
  - import approved change
  - reject unapproved scope change
  - read back markers、links、labels、assignees、state
- 刪除 test repository 需要另外明確授權，不包含在驗證預設範圍。

**Output**

- Provider behavior 的 live evidence；mock tests 不代替這一步。

**Verification**

- Report 記錄 exact CLI versions、repository、timestamps、operations、readbacks、
  blocked behavior、remaining limitations。

## 10. Phase 3 完成條件

- Local-only 仍是 default，未設定 provider 時無 network side effect。
- GitHub/GitLab 使用相同 provider-neutral adapter contract。
- Preview 無 mutation。
- Publish/sync 有 native approval、checkpoint、idempotency、readback。
- Remote changes 不會直接修改 Work Map。
- Verified/completed 狀態不能由 issue checkbox/close 取代。
- Concurrent drift 會停止，不使用 last-write-wins。
- Provider tokens 不進 config、argv、logs、telemetry、artifacts。
- Mock、contract、installer、live provider evidence 全部完成。
- `plan sync` 只有在 runtime owner 完整後才可公開。

Final gate：

```bash
npm run check:manifest
npm run test:workflow-contracts
npm run test:capability-invocations
npm run test:telemetry
npm run test:codex-portability
bash scripts/test-workflow-integration.sh
cd goldband-loop
bun run check:source
bun run test:workflows
bun test test/tracker-projection.test.ts \
  test/tracker-config.test.ts \
  test/tracker-github.test.ts \
  test/tracker-gitlab.test.ts \
  test/tracker-runtime.test.ts \
  test/tracker-import.test.ts
cd ..
npm run lint:style
git diff --check
npm test
```

## 11. 主要失敗模式

| Failure | Required response |
| --- | --- |
| Issue tracker 變成第二份 authority | 改回 candidate + Work Map operation |
| Remote write 沒有 native approval | Block before adapter write |
| Retry 產生 duplicate issues | 用 marker、operation ID、checkpoint idempotency 修正 |
| Closed issue直接標 verified | 拒絕；要求 Phase 2 evidence |
| Provider types 洩漏到 Work Map | 移回 adapter |
| Sync 使用 last-write-wins | 停止並顯示 conflict |
| 宣稱 distributed claim atomic | 修正文案；沒有 CAS 就不保證 |
| Token 出現在 argv/log/artifact | 阻止 release，補 secret regression test |
| Mock tests 被當成 live provider proof | 補 disposable repo live verification |

# Review evidence manifest authoring

`goldband.review-evidence.json` 是專案擁有的行為與驗證 contract。Goldband 在啟動 semantic review 前，會先用它決定哪些行為必須成立、哪些 deterministic checks 適用，以及目前 evidence 是否足以繼續。

Manifest 合法不代表測試已通過、review 已完成或可以部署。真正的 evidence 仍必須由同一個 candidate-bound runtime 執行並讀回。

## Quick start

先查看目前安裝所附的 guide、example 與 schema 路徑：

```bash
goldband review contract help
```

在 Git repository 任意 tracked subdirectory 執行：

```bash
goldband review contract init
```

`init` 會在 canonical repository root 建立 `goldband.review-evidence.json`。它使用 exclusive create，既有檔案不會被覆寫。產生的內容只有一格 high-risk `unsupported` behavior，因此格式合法但仍會阻擋 semantic review；這可避免 scaffold 被誤認成完整證據。

接著依專案真正的 contract 修改 behavior、provider、paths 與 command。可參考 [minimal local gate example](../examples/review-evidence/minimal-local-gate.json)，但必須把 TypeScript／npm 範例值換成該專案實際擁有的 check。

修改後只驗證 manifest，不執行 provider、不啟動 host，也不寫入 runtime store：

```bash
goldband review contract validate --manifest goldband.review-evidence.json
```

`validate` exit 0 只表示 installed runtime 接受這份 contract。輸出中的 `evidenceExecuted: false` 與 `completionAuthorized: false` 是刻意的，不是待補的成功訊號。

最後選擇 contract ownership：

- 專案共同擁有：將 repo-root `goldband.review-evidence.json` 納入 Git。Reviewed base 中的檔案是 authoritative baseline。
- 僅本機持有：repository 沒有 committed manifest 時，執行 `goldband review contract import --manifest <path>`，把完整 contract 註冊到 runtime-owned per-repository store。
- 單次 candidate extension：以 `review code --evidence-manifest <path>` 傳入完整 manifest；它只能 monotonic 增加 baseline coverage，不能縮小或取代 baseline。

用下列命令讀回實際 resolution、tracking state、source 與 digest：

```bash
goldband review contract inspect
```

## 最小 local gate

受支援的 public example 宣告一格 TypeScript contract，並以 path-scoped `npm run typecheck` provider 覆蓋它：

```json
{
  "schemaVersion": 2,
  "behaviorMatrix": [
    {
      "id": "typescript-contracts",
      "behavior": "The project preserves its declared TypeScript contracts.",
      "kind": "boundary",
      "input": "a candidate that changes TypeScript source, tests, or project configuration",
      "preconditions": "dependencies are installed in the isolated candidate snapshot",
      "expected": "the project typecheck exits successfully",
      "risk": "high",
      "disposition": "static",
      "providerIds": ["typescript-typecheck"]
    }
  ],
  "providers": [
    {
      "id": "typescript-typecheck",
      "owner": "package.json#scripts.typecheck",
      "kind": "project-gate",
      "lifecycle": "persistent",
      "cellIds": ["typescript-contracts"],
      "applicability": {
        "kind": "paths",
        "pathPrefixes": ["src", "test", "package.json", "tsconfig.json"]
      },
      "executionContext": {
        "sandboxOwner": "review-runtime",
        "runner": "sealed"
      },
      "operations": [
        {
          "id": "candidate-typecheck",
          "target": "candidate",
          "argv": ["npm", "run", "typecheck"],
          "expectedExit": "zero",
          "timeoutMs": 120000,
          "maxOutputBytes": 65536,
          "network": "deny",
          "evidenceLevel": "local"
        }
      ]
    }
  ],
  "authorizations": []
}
```

這只是 contract 形狀範例，不是 universal preset。只有當專案真的由 `package.json#scripts.typecheck` 擁有該行為，而且 command 可在 isolated snapshot 執行時，這些值才成立。

## Top-level fields

| Field | Contract |
| --- | --- |
| `schemaVersion` | 必須是 `2`。Runtime 不會替安全欄位猜預設值。 |
| `behaviorMatrix` | 非空行為清單。每格描述一個必須被評估的 domain／engineering fact。 |
| `providers` | Typed deterministic evidence owners。可以是空陣列，但 high-risk uncovered behavior 會 fail closed。 |
| `authorizations` | 外部 network／credential／shared-environment operation 的 typed approvals。Local runner 本身仍是 network-deny。 |

Unknown fields 會被拒絕。Manifest 目前不接受 instance-level `$schema` property；編輯器若需要 JSON Schema association，請把 `goldband.review-evidence.json` filename 對應到 installed 或 repository 內的 `review-evidence-manifest.schema.json`。

## Behavior cells

每個 cell 必須有：

- `id`：manifest 內唯一且穩定的 ID。
- `behavior`：要成立的行為事實。
- `kind`：`normal`、`branch`、`exception` 或 `boundary`。
- `input`、`preconditions`、`expected`：可被 reviewer 與 evidence owner理解的 contract。
- `risk`：`low`、`medium` 或 `high`。
- `disposition`：如何處理這格 evidence。
- `providerIds`：能證明此 cell 的 provider IDs。

Disposition：

| Value | Meaning |
| --- | --- |
| `automated` | 由自動化 behavior／regression check 證明。 |
| `static` | 由 typecheck、lint、schema、generated drift 等 static/project gate 證明。 |
| `runtime-readback` | 需要 runtime integration readback。 |
| `manual` | 目前只有人工證據；必須有 `reason`，仍是 coverage gap。 |
| `not-applicable` | 對這個 contract 確定不適用；必須有可判定的 `reason`。不要用它跳過尚未設計的 checks。 |
| `unsupported` | 目前無法提供 evidence；必須有 `reason`。High-risk 時阻擋 semantic host。 |

`automated`、`static` 與 `runtime-readback` 至少需要一個 provider。Cell 的 `providerIds` 與 provider 的 `cellIds` 必須雙向一致；單邊宣告會被 runtime 拒絕。

## Providers

每個 provider 必須宣告：

- `id`：manifest 全域唯一 provider ID。
- `owner`：實際 contract owner，例如 `package.json#scripts.typecheck`。
- `kind`：`regression`、`static`、`project-gate`、`property-fuzz` 或 `runtime-integration`。
- `lifecycle`：`persistent` 或 `transition`。
- `cellIds`：由此 provider 證明的 cells，且需與 cell 端 reciprocal。
- `applicability`：哪些 candidate paths 使它適用。
- `executionContext`：誰擁有 sandbox 與 runner。
- `operations`：至少一個 typed argv operation。

### Lifecycle

Repository-owned manifest 只接受 `persistent` providers。Persistent operation 應對 successor candidate 保持有效，不能保存會過期的 base RED。

一次性 bugfix RED／GREEN 使用 `transition` provider，並以 `transitionBinding` 綁定 exact repository、base、candidate、scope 與 operation contract digest。Transition evidence 屬於當次 artifact，不應手寫進 repository manifest。

### Applicability

Path scope：

```json
{ "kind": "paths", "pathPrefixes": ["src", "test", "package.json"] }
```

至少要有一個 non-empty prefix。Prefix 必須是 normalized repo-root coordinate：不以 `/`、drive prefix 開頭或 `/` 結尾，不含 `.`／`..`／empty segments，不用 `\\`，也不在前後留空白。寫 `src`，不要寫 `./src`、`../src`、`C:/src` 或 invocation subdirectory 的相對座標。

Global scope：

```json
{ "kind": "global", "reason": "The repository-wide policy must hold for every candidate." }
```

Global provider 每次都適用，必須說明原因。不要為了省下 path design 把所有 gates 設成 global。

### Execution context

一般 local evidence 使用 runtime-owned sealed runner：

```json
{ "sandboxOwner": "review-runtime", "runner": "sealed" }
```

需要 provider-owned macOS Seatbelt lane 時：

```json
{
  "sandboxOwner": "provider",
  "runner": "host-seatbelt",
  "lane": "the-owned-lane-id"
}
```

如果正式 producer／consumer handoff 不存在，runtime 會回報 `runtime-incomplete`，不會把 nested sandbox failure 當成 candidate failure。

## Operations

Operation 的主要欄位：

| Field | Contract |
| --- | --- |
| `id` | Provider 內唯一 operation ID；被 authorization 引用時，該 operation／authorization 配對在 manifest 內必須只解析到一組。 |
| `target` | `candidate`，或 transition regression provider 的 `base`。 |
| `argv` | 非空 argument array。第一項必須是由 `PATH` 解析的 command name，不能含 `/` 或 `\\`。 |
| `expectedExit` | `zero` 或 `nonzero`。後者必須提供 exact `expectedExitCode`。 |
| `timeoutMs` | `100` 至 `900000`。 |
| `maxOutputBytes` | `1` 至 `65536`。 |
| `network` | `deny` 或 `authorized`。 |
| `authorizationId` | `network: authorized` 時必填；deny 時禁止。 |
| `evidenceLevel` | `fixture`、`local`、`sandboxed-service`、`live-provider`、`device-platform` 或 `production-readback`。 |
| `requiredSystemTools` | 可選的 PATH tool names；不會因此放寬任意 filesystem access。 |
| `seed`、`iterations` | `property-fuzz` operations 必填，用於 replay。 |

Script launcher 必須把 interpreter 寫進 argv，例如：

```json
{ "argv": ["bash", "scripts/check-contract.sh"] }
```

不要只寫 `scripts/check-contract.sh`。Runtime 會拒絕 path-shaped executable，避免 shebang／interpreter 與依賴邊界變成隱含 contract。

## Network 與 authorizations

`live-provider`、`device-platform` 與 `production-readback` evidence 必須使用 `network: authorized` 與 matching `authorizationId`。Authorization 包含：

- `id`
- `operation`
- `scope`
- `approvedBy`
- `approvedAt`
- `expiresAt`

`expiresAt` 必須晚於 `approvedAt`。每個 `authorizationId` 必須找到同 ID、且 `operation` 相符的 authorization；每個 authorization 也必須被恰好一個 operation 引用。

目前 local review runner 仍是 deny-only。即使 manifest 與 authorization 格式合法，network operation 也需要 operation-specific external runner；缺少 runner 時會 fail closed。不要把 fixture 或 local green 結果描述成 live／device／production proof。

## Contract resolution

Runtime 在 evidence execution、lineage admission 與 semantic dispatch 前先解析：

```text
authoritative baseline + optional monotonic extension = effective contract
```

Resolution order：

1. Reviewed base 的 repo-root manifest。
2. Base 沒有 manifest 時，明確 import 的 runtime-owned per-repository contract。
3. 都沒有時 fail closed。

Working-tree、index 與 `--evidence-manifest` 內容是 candidate-controlled extension。它們可以增加 required coverage，但不能刪除、反轉、降風險或降低 evidence level。

## Platform boundary

- macOS：sealed executable evidence 由 Seatbelt owner 執行；evidence complete 後才能啟動 semantic review。
- Linux／Windows：目前沒有等價的 sealed evidence runner。需要 executable evidence 時回報 typed `runtime-incomplete`，不啟動 semantic host，也沒有 completion／closure authority。

Bubblewrap managed worktree boundary 不是 `review/code` evidence parity。

## Schema 與 runtime authority

JSON Schema 協助 editor 與 local structural validation，能描述 enums、required fields、局部 conditional rules與 unknown-field rejection。

以下規則需要 runtime graph／candidate context，因此 runtime validator 才是最終 authority：

- provider／cell reciprocal ownership；
- unknown provider／cell references；
- operation ID 與 authorization cross-reference；
- persistent RED 與 transition binding lifecycle；
- authoritative baseline monotonicity；
- exact repository／base／candidate／scope binding；
- authorization freshness與 external runner availability。

因此不要以「JSON Schema 通過」替代 `goldband review contract validate`，也不要以 `validate` 通過替代真正的 candidate-bound evidence run。

## 常見錯誤

### `review/code evidence contract is required`

Repository 沒有 committed baseline，也沒有 runtime-store baseline。先執行 `review contract init` 並完成 project-owned contract，或 validate 後明確 import 外部 manifest。

### `disposition ... requires a reason`

`manual`、`not-applicable` 與 `unsupported` 必須說明原因。若其實已有自動化 owner，改成相符 disposition 並宣告 provider。

### `must authorize each other`

Cell 的 `providerIds` 與 provider 的 `cellIds` 不一致。兩邊都必須引用對方。

### `persistent ... stale-prone`

Persistent provider 含 base RED。把一次性 RED／GREEN 移到 exact-bound transition artifact，或改成 successor-safe candidate check。

### `requires typed authorization`

Network operation 缺少 matching authorization。補上格式不代表 local runner會連網；仍需正式 external runner。

### `runtime-incomplete`

Manifest 合法，但目前 platform、sandbox、tool、dependency 或 provider lane 無法完成 evidence。不要改成 `not-applicable` 或降低 risk 來消除訊號。

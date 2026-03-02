# NativeContainer 安全規則與記憶體管理

## 安全系統

Unity Job System 的安全系統防止 race condition：

### 存取限制
- 同一 NativeContainer 不可同時被兩個 Job 寫入
- 主線程不可在 Job 執行期間讀寫 Job 持有的 NativeContainer
- 違反時拋出 `InvalidOperationException`

### [ReadOnly] / [WriteOnly]

```csharp
[BurstCompile]
public struct MyJob : IJob
{
    [ReadOnly] public NativeArray<int> Input;   // 多個 Job 可同時讀取
    [WriteOnly] public NativeArray<int> Output;  // 只寫，不可讀取
    public NativeArray<int> ReadWrite;           // 預設：獨佔讀寫
}
```

### Job 依賴鏈

```csharp
// Job B 依賴 Job A 完成
var handleA = jobA.Schedule();
var handleB = jobB.Schedule(handleA); // A 完成後才執行 B
handleB.Complete();

// 合併多個依賴
var combined = JobHandle.CombineDependencies(handleA, handleB);
var handleC = jobC.Schedule(combined);
```

---

## Allocator 詳細說明

### Allocator.Temp
- 最快分配速度
- 壽命 ≤ 1 幀（當前 frame 結束自動釋放）
- **不可傳入 Job 的 struct 欄位**（可用於 Job.Run() 同步執行）
- 適用於主線程內的臨時計算

### Allocator.TempJob
- 中等分配速度
- 壽命 ≤ 4 幀
- 可傳入 Job 的 struct 欄位
- **必須在 4 幀內手動 Dispose**，否則 Unity 發出 leak 警告
- 適用於短期 Job 臨時資料（如 placeholder Store、臨時 buffer）

### Allocator.Persistent
- 最慢分配速度（等同 malloc）
- 無壽命限制
- 必須手動 Dispose
- 適用於 Store 長期持有的資料

### 選擇指南

```
Store 的主資料         → Persistent（Session 生命週期）
Job 執行期間的臨時 buffer → TempJob（Job 完成後立即 Dispose）
Placeholder Store       → TempJob（Job 完成後立即 Dispose）
主線程內一次性計算      → Temp（frame 結束自動釋放）
```

---

## NativeList vs NativeArray

### NativeArray（固定大小）

```csharp
// 建立
var arr = new NativeArray<int>(capacity, Allocator.Persistent);

// 存取
int val = arr[i];
arr[i] = newVal;

// 排序（Burst-safe）
arr.Sort(); // 升序
arr.Sort(new MyComparer()); // 自訂比較器

// 子切片
var slice = arr.GetSubArray(startIndex, length);

// 釋放
arr.Dispose();
```

### NativeList（可變大小）

```csharp
// 建立（初始容量）
var list = new NativeList<int>(initialCapacity, Allocator.Persistent);

// 新增
list.Add(42);
list.AddNoResize(42); // 不自動擴容（效能更好，需確保容量足夠）

// 存取
int val = list[i];
list[i] = newVal;
int count = list.Length;

// 轉為 NativeArray（共享記憶體，不複製）
NativeArray<int> arr = list.AsArray();

// 清空（不釋放記憶體）
list.Clear();

// 釋放
list.Dispose();
```

---

## 扁平化模式（替代 managed 巢狀集合）

### 問題：List<T> 內含 List<T>

```csharp
// ❌ managed — 無法在 Burst 使用
class ZoneMetadata
{
    public List<int> CellIndices; // 每個 zone 有不同數量的 cell
}
List<ZoneMetadata> zones;
```

### 解法：Header + 扁平池

```csharp
// ✅ blittable — Burst-safe
struct ZoneHeader
{
    public ushort Id;
    public int CellIndicesOffset; // 指向扁平池的起始位置
    public int CellIndicesCount;  // 數量
}

struct ZoneRegistryStore
{
    public NativeList<ZoneHeader> Zones;
    public NativeList<int> AllCellIndices; // 扁平池
}

// 讀取 zone i 的所有 cell indices：
var header = store.Zones[i];
for (int j = 0; j < header.CellIndicesCount; j++)
{
    int cellIndex = store.AllCellIndices[header.CellIndicesOffset + j];
}
```

---

## IsCreated 防禦性檢查

```csharp
public void Dispose()
{
    // 避免 double-dispose 或對未分配的 container 呼叫 Dispose
    if (Entities.IsCreated) Entities.Dispose();
    if (Zones.IsCreated) Zones.Dispose();
    if (AllCellIndices.IsCreated) AllCellIndices.Dispose();
}
```

---

## 測試中的 Dispose 模式

### 模式 A：[SetUp] / [TearDown]（欄位級別）

```csharp
private EntityStateManager _manager;

[SetUp]
public void SetUp()
{
    _manager = new EntityStateManager(10, Allocator.TempJob);
}

[TearDown]
public void TearDown()
{
    _manager?.Dispose();
}
```

### 模式 B：Track + List（per-test helper 方法）

```csharp
private readonly List<IDisposable> _disposables = new();

private T Track<T>(T obj) where T : IDisposable
{
    _disposables.Add(obj);
    return obj;
}

[TearDown]
public void TearDown()
{
    for (int i = _disposables.Count - 1; i >= 0; i--)
        _disposables[i].Dispose();
    _disposables.Clear();
}

[Test]
public void 測試()
{
    var manager = Track(new EntityStateManager(10, Allocator.TempJob));
    // ... 自動在 TearDown 釋放
}
```

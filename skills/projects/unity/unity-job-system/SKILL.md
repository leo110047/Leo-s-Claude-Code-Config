---
name: unity-job-system
description: |
  Unity Job System + Burst Compiler + NativeContainer 開發指南。
  涵蓋 IJob、NativeArray/NativeList、[BurstCompile]、Store+Ops+Manager 模式、
  Sim/Render 並行、記憶體管理、Determinism 保證。

  Use when: 編寫 Job System 程式碼、使用 NativeContainer、加 [BurstCompile]、
  建立 Store/Ops/Manager、排程 Job、處理 NativeContainer Dispose、
  Sim/Render 分離、Switch ARM 效能優化。
allowed-tools: Read, Grep, Glob, Bash
---

# Unity Job System + Burst 開發指南

## 核心概念

Job System 將工作分配到 worker threads 並行執行，Burst 將 C# 編譯為高度優化的原生碼。
兩者結合 = Sim 核心在 worker thread 以接近 C++ 的效能執行，主線程同時處理渲染。

## When to Use

- 建立或修改 Sim 核心程式碼（Store / Ops / Manager）
- 排程 IJob 或 IJobParallelFor
- 使用 NativeArray / NativeList / NativeContainer
- 加 [BurstCompile] attribute
- Sim/Render 並行設計
- 處理 NativeContainer 生命週期（Dispose）

**NOT for:** 渲染優化（use unity-performance）、Profiler 使用（use unity-profiling）、
通用架構（use unity-architecture）

> NativeContainer 安全規則、Burst 類型限制、IJob 值語義 詳見 [references/](references/) 目錄

---

## Store + Ops + Manager 模式

本專案的 Job System 架構模式：

```
XxxStore (struct)     — NativeArray/NativeList，blittable，Job 可讀寫
XxxOps (static class) — [BurstCompile] 靜態方法，操作 ref XxxStore
XxxManager (class)    — IDisposable 包裝器，保留現有 public API，內部委派給 Ops
SimState (struct)     — 包含所有 Store，傳入 SimTickJob
SimTickJob (IJob)     — [BurstCompile]，順序呼叫所有 Ops
```

### Store（資料層）

```csharp
// blittable struct，只包含 NativeContainer + 純值欄位
public struct EntityStore
{
    public NativeArray<EntityData> Entities; // 固定大小
    public int Capacity;
}

// 建立與釋放
public static EntityStore Create(int capacity, Allocator allocator)
{
    return new EntityStore
    {
        Entities = new NativeArray<EntityData>(capacity, allocator),
        Capacity = capacity,
    };
}

public void Dispose()
{
    if (Entities.IsCreated) Entities.Dispose();
}
```

### Ops（邏輯層）

```csharp
// [BurstCompile] 靜態方法，可在 managed 和 Job 兩路徑呼叫
[BurstCompile]
public static class EntityOps
{
    // ref Store — Job 內直接操作 SimState 的 Store 欄位
    public static void UpdateTick(ref EntityStore store, uint currentTick)
    {
        for (int i = 0; i < store.Capacity; i++)
        {
            var e = store.Entities[i];
            // 修改後寫回（NativeArray 元素不可直接修改欄位）
            e.StatusTimer = e.StatusTimer > 0 ? e.StatusTimer - 1 : 0;
            store.Entities[i] = e;
        }
    }
}
```

### Manager（API 層）

```csharp
// IDisposable 管理 NativeContainer 生命週期
// 保留原有 public API，測試最小改動
public sealed class EntityStateManager : IDisposable
{
    public EntityStore Store; // 被 SimStateFactory 讀取

    public EntityStateManager(int capacity, Allocator allocator = Allocator.Persistent)
    {
        Store = EntityStore.Create(capacity, allocator);
    }

    // managed 路徑 — 委派給 Ops
    public void UpdateTick(uint tick) => EntityOps.UpdateTick(ref Store, tick);

    public void Dispose() => Store.Dispose();
}
```

---

## IJob 排程

### 基本排程

```csharp
[BurstCompile]
public struct SimTickJob : IJob
{
    public SimState State;
    public NativeArray<InteractionEvent> InjectedEvents;
    public int InjectedEventCount;

    public void Execute()
    {
        // 順序呼叫 Ops — 與 managed 路徑相同邏輯
        EntityOps.UpdateTick(ref State.Entities, State.CurrentTick);
        TerrainOps.UpdateTick(ref State.Terrain, State.CurrentTick);
        // ...
    }
}
```

### Schedule + Complete

```csharp
// 同步執行（測試 / 簡單情境）
job.Schedule().Complete();

// 非同步執行（Sim/Render 並行）
_simJobHandle = job.Schedule();
// ... 主線程做渲染 ...
_simJobHandle.Complete(); // 下一幀開始前確保完成
```

### IJob 值語義陷阱

```csharp
// IJob 是 struct — Schedule() 時被複製！
var job = new SimTickJob { State = state };
job.Schedule().Complete();

// ❌ 錯誤：job.State 仍是排程前的值
uint tick = job.State.CurrentTick; // 永遠是舊值！

// ✅ 正確：NativeArray/NativeList 元素修改透過共享指標自動可見
// ✅ 正確：純值欄位（CurrentTick, ActiveCount）需主線程手動同步
_currentTick++;
```

---

## NativeContainer 規則

### 分配器選擇

| Allocator | 速度 | 壽命 | 用途 |
|-----------|------|------|------|
| `Temp` | 最快 | ≤1 幀 | 單幀臨時計算，不可傳入 Job |
| `TempJob` | 中等 | ≤4 幀 | Job 臨時資料，必須 4 幀內 Dispose |
| `Persistent` | 最慢 | 無限 | Store 長期持有的資料 |

### 元素修改規則

```csharp
// ❌ 錯誤：NativeArray 元素是值複本，不可直接修改欄位
store.Entities[i].Health -= 10;

// ✅ 正確：複製 → 修改 → 寫回
var e = store.Entities[i];
e.Health -= 10;
store.Entities[i] = e;
```

### Dispose 規則

```csharp
// Manager 實作 IDisposable
public void Dispose()
{
    if (Store.Entities.IsCreated) Store.Entities.Dispose();
    if (Store.Zones.IsCreated) Store.Zones.Dispose();
}

// 測試必須在 [TearDown] 呼叫 Dispose
[TearDown]
public void TearDown()
{
    _manager?.Dispose();
}
```

### Placeholder Store 模式

```csharp
// Unity Job System 要求所有 NativeContainer 欄位必須已分配
// null 系統需建立空但有效的 placeholder
Projectiles = config.Projectiles != null
    ? config.Projectiles.Store
    : ProjectileStore.Create(0, Allocator.TempJob);

// Job 完成後釋放 placeholder
if (config.Projectiles == null) state.Projectiles.Dispose();
```

---

## [BurstCompile] 規則

### 支援的類型

- 基本型別：`bool, byte, sbyte, short, ushort, int, uint, long, ulong, float, double`
- struct（含 NativeContainer 欄位）
- enum
- 指標（unsafe context）
- Unity.Mathematics 向量：`float2/3/4, int2/3/4, bool2/3/4`

### 不支援的類型與特性

```csharp
// ❌ 不支援
class MyClass { }              // managed class
string message;                // managed type
char c;                        // 不支援
decimal d;                     // 不支援
List<T> list;                  // managed collection
Dictionary<K,V> dict;          // managed collection
delegate void MyAction();      // delegate
virtual void Method();         // 虛方法
try { } catch { }              // 例外處理
throw new Exception();         // 拋出例外
LINQ (.Where, .Select, etc.)  // LINQ

// ✅ 替代方案
NativeArray<T> / NativeList<T> // 替代 List/Array
NativeArray<bool> indexed      // 替代 HashSet（slot-indexed）
排序後的 NativeArray            // 替代 Dictionary 遍歷
for loop                       // 替代 LINQ
```

### BurstCompile 屬性

```csharp
// 基本用法
[BurstCompile]
public struct MyJob : IJob { }

// 靜態方法
[BurstCompile]
public static class MyOps
{
    [BurstCompile]
    public static void Process(ref MyStore store) { }
}
```

---

## Determinism 保證

### 禁止非確定性來源

```csharp
// ❌ 禁止
Dictionary<K,V>.Keys 遍歷        // 順序不確定
NativeHashMap 遍歷                // 順序不確定
System.Random / UnityEngine.Random // 非確定
float == float                    // 精度問題

// ✅ 正確
NativeArray + Sort                // 確定性遍歷
SeededRNG (Xoshiro256**)          // 確定性隨機
整數運算                          // 精確
```

### 雙路徑 Bit-Identical 驗證

```csharp
// managed 路徑（測試）
loop.ExecuteTick(events);

// Job 路徑（Runtime）
loop.ExecuteTickJob(igniteBuffer);

// 兩條路徑必須產生相同的 WorldStateHash
Assert.AreEqual(managedHash, jobHash);
```

---

## Sim/Render 並行

```
Frame N:
  主線程: Complete(Frame N-1 Sim) → 讀取 Store N-1 → Render → Schedule(Frame N Sim)
  Worker:                                              ← 執行 SimTickJob N →

Pipeline delay: Render 永遠顯示 1 幀前的 Sim 結果
代價: 33ms @ 30 FPS 延遲，對動作遊戲可接受
```

### GC 策略

- Store 在初始化時分配（Allocator.Persistent），Session 期間不釋放
- Job loop 內零 managed allocation
- GC 壓力僅來自 Render / UI / Network 層

---

## 常見錯誤

| 錯誤 | 原因 | 修正 |
|------|------|------|
| `has not been assigned or constructed` | Job struct 的 NativeContainer 欄位未分配 | 使用 Placeholder Store |
| IJob 後讀不回純值欄位 | IJob 是 struct，Schedule 時被複製 | 主線程手動同步 |
| NativeContainer leak 警告 | TearDown 未呼叫 Dispose | 加 [TearDown] Dispose |
| Burst 編譯失敗 | 使用了 managed type（class, string, LINQ） | 改用 blittable type |
| 遍歷順序不確定 | NativeHashMap/Dictionary 遍歷 | 改用排序後的 NativeArray |
| NativeArray 元素修改無效 | 直接修改 `arr[i].field` | 複製→修改→寫回 |

## Code Review Checklist

- [ ] Store struct 只包含 blittable 型別 + NativeContainer
- [ ] Ops 方法加 [BurstCompile]，無 managed type 使用
- [ ] Manager 實作 IDisposable
- [ ] 測試 [TearDown] 呼叫 Dispose
- [ ] NativeArray 元素修改使用複製→修改→寫回
- [ ] 無 NativeHashMap/NativeHashSet 遍歷
- [ ] 無 LINQ、delegate、try-catch 在 Burst 路徑
- [ ] Placeholder Store 用於 null 系統
- [ ] IJob 純值欄位不從 Job 讀回
- [ ] managed vs Job 路徑 bit-identical 驗證

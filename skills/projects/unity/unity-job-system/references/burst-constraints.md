# Burst Compiler 約束與最佳實踐

## HPC# (High Performance C#) 子集

Burst 編譯器只支援 C# 的一個子集，稱為 HPC#。

---

## 支援的類型

### 基本型別
- `bool`, `byte`, `sbyte`, `short`, `ushort`
- `int`, `uint`, `long`, `ulong`
- `float`, `double`
- `System.IntPtr`, `System.UIntPtr`

### 複合型別
- **struct**（Sequential / Explicit layout）
- **enum**（所有 storage type）
- **指標**（所有指向 Burst 支援型別的指標）
- **fixed array**（`fixed int buffer[64]`）

### Unity.Mathematics
- `float2`, `float3`, `float4`
- `int2`, `int3`, `int4`
- `bool2`, `bool3`, `bool4`
- `quaternion`, `float4x4`, 等
- 自動 SIMD 向量化

### NativeContainer
- `NativeArray<T>`
- `NativeList<T>`
- `NativeSlice<T>`
- `NativeReference<T>`（Unity.Collections 2.0+）

### 泛型
- 支援帶 interface 約束的泛型 struct
- 泛型 Job 需具體化

---

## 不支援的類型與特性

### 類型
| 不支援 | 替代方案 |
|--------|----------|
| `class` | 改用 `struct` |
| `string` | 改用 `FixedString32Bytes` / `FixedString64Bytes` / `FixedString128Bytes` |
| `char` | 改用 `byte` 或 `ushort` |
| `decimal` | 改用 `double` 或 `long`（定點數） |
| `List<T>` | 改用 `NativeList<T>` |
| `Dictionary<K,V>` | 改用排序後的 `NativeArray<KeyValuePair>` |
| `HashSet<T>` | 改用 `NativeArray<bool>`（slot-indexed） |
| managed array `T[]` | 改用 `NativeArray<T>` |

### 語言特性
| 不支援 | 替代方案 |
|--------|----------|
| `try-catch-finally` | 不使用；邏輯應保證不會拋出例外 |
| `throw` | 不使用；用回傳值表示錯誤 |
| `virtual` / `abstract` | 改用 interface 約束泛型 |
| `delegate` | 改用 `FunctionPointer<T>` |
| LINQ | 改用 `for` loop |
| `foreach` | 部分支援（NativeArray）；建議用 `for` loop 更安全 |
| boxing | 不可（struct → object） |
| `dynamic` | 不可 |
| `async/await` | 不可 |
| `yield return` | 不可 |
| `Reflection` | 不可 |

---

## [BurstCompile] 屬性選項

```csharp
// 預設（最常用）
[BurstCompile]

// 指定浮點精度（本專案使用整數，較少需要）
[BurstCompile(FloatPrecision.Standard, FloatMode.Default)]

// 停用安全檢查（僅 Release，提升效能）
[BurstCompile(DisableSafetyChecks = true)]

// 指定編譯目標（通常不需要手動設定）
[BurstCompile(OptimizeFor = OptimizeFor.Performance)]
```

---

## Burst 下的整數運算保證

本專案使用整數運算（非浮點）確保 Determinism：

- 整數加減乘除在所有平台上行為一致
- 整數除法截斷規則明確（C# 語言規格保證）
- 位元運算（shift, and, or, xor）在所有平台一致
- **不受浮點精度、SIMD 寬度、FMA 指令影響**

```csharp
// ✅ Burst-safe deterministic
int damage = baseDamage * multiplier / 100;
uint hash = Crc32.Compute(data);
int distance = IntegerMath.Distance(ax, ay, bx, by);
```

---

## FixedString（Burst-safe 字串替代）

```csharp
// 需要在 Burst 中使用字串時
using Unity.Collections;

FixedString32Bytes name = "Fire";
FixedString64Bytes message = "Zone expired";

// 格式化
FixedString128Bytes formatted = default;
formatted.Append("Tick: ");
formatted.Append(tickNumber);
```

---

## SharedStatic（跨 Job 共享靜態資料）

```csharp
// 當 Burst Job 需要存取靜態唯讀資料時
public struct InteractionTables
{
    public static readonly SharedStatic<NativeArray<int>> ZoneReactions =
        SharedStatic<NativeArray<int>>.GetOrCreate<InteractionTables, ZoneReactionsKey>();

    private struct ZoneReactionsKey { }
}

// 初始化（主線程，一次性）
InteractionTables.ZoneReactions.Data = new NativeArray<int>(...);

// Job 中讀取
var reactions = InteractionTables.ZoneReactions.Data;
```

---

## 常見 Burst 編譯錯誤

| 錯誤訊息 | 原因 | 修正 |
|----------|------|------|
| `Burst error BC1016: The managed type is not supported` | 使用了 class / string / managed array | 改用 struct / FixedString / NativeArray |
| `Burst error BC1017: The type is not blittable` | struct 包含 managed 欄位 | 移除 managed 欄位 |
| `Burst error BC1024: Try/Catch is not supported` | 使用了 try-catch | 移除例外處理 |
| `Burst error BC1025: Throw is not supported` | 使用了 throw | 改用回傳值 |
| `Burst error BC1026: Foreach is not supported` | 對非 NativeContainer 使用 foreach | 改用 for loop |
| `Loading assembly failed` | asmdef 缺少 Unity.Burst reference | 加入 Unity.Burst 到 asmdef |

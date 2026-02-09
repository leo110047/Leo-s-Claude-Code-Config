---
description: |
  Unity 遊戲上架 Google Play 完整流程，包含 AAB 200MB 限制處理、資產分發、簽名、測試和發佈策略。

  Use when: 準備上架 Google Play、處理 AAB 過大問題、配置 Play Asset Delivery、
  設置簽名密鑰、內測/公測發佈、處理 Google Play 審核。

  PRIORITY: 當用戶提到「上架」、「Google Play」、「AAB」、「200MB」時優先觸發。

  涵蓋：Build Settings、Keystore 管理、AAB 瘦身技巧、Play Asset Delivery (PAD)、
  Play Console 配置、版本管理、測試軌道、審核準備。

triggers:
  keywords:
    - google play
    - aab
    - 上架
    - 發佈
    - play console
    - play asset delivery
    - 200mb
    - app bundle
  intent_patterns:
    - "上架 google play"
    - "AAB 太大"
    - "超過 200MB"
    - "資產分發"
    - "簽名配置"
  file_patterns:
    - "**/ProjectSettings/ProjectSettings.asset"
    - "**/gradle.properties"
    - "**/*.keystore"

enforcement: suggest
---

# Unity Google Play 上架完整指南

## 📋 目錄
1. [AAB 200MB 限制概述](#aab-200mb-限制概述)
2. [Build Settings 配置](#build-settings-配置)
3. [AAB 瘦身技巧](#aab-瘦身技巧)
4. [Play Asset Delivery (PAD)](#play-asset-delivery-pad)
5. [Keystore 簽名管理](#keystore-簽名管理)
6. [Google Play Console 配置](#google-play-console-配置)
7. [測試與發佈流程](#測試與發佈流程)
8. [常見問題處理](#常見問題處理)

---

## 🚨 AAB 200MB 限制概述

### Google Play 規則
```
✅ 允許: AAB (Android App Bundle) ≤ 200MB
❌ 超過 200MB: 必須使用 Play Asset Delivery (PAD)
📦 總大小上限: 150MB (base) + 8GB (asset packs)
```

### 檢查當前 AAB 大小
```bash
# Build AAB 後檢查大小
ls -lh /path/to/your-game.aab

# 解壓查看內容（推薦使用 bundletool）
java -jar bundletool.jar build-apks \
  --bundle=your-game.aab \
  --output=output.apks \
  --mode=universal

# 查看各模塊大小
unzip -l your-game.aab
```

---

## ⚙️ Build Settings 配置

### 1. Player Settings（Unity Editor）

```csharp
// File: Editor/BuildSettings.cs
using UnityEditor;
using UnityEngine;

public class AndroidBuildSettings
{
    [MenuItem("Build/Configure Android for Google Play")]
    public static void ConfigureAndroid()
    {
        // ===== 基本設定 =====
        PlayerSettings.companyName = "YourCompany";
        PlayerSettings.productName = "YourGame";
        PlayerSettings.applicationIdentifier = "com.yourcompany.yourgame";

        // ===== Version =====
        PlayerSettings.bundleVersion = "1.0.0";
        PlayerSettings.Android.bundleVersionCode = 1; // 每次上傳遞增

        // ===== Build 設定 =====
        PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel24; // API 24 (Android 7.0)
        PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevel33; // API 33 (Android 13)

        // ===== 必須啟用 =====
        EditorUserBuildSettings.buildAppBundle = true; // 生成 AAB 而非 APK
        PlayerSettings.Android.useCustomKeystore = true;

        // ===== IL2CPP (推薦，減少包體) =====
        PlayerSettings.SetScriptingBackend(BuildTargetGroup.Android, ScriptingImplementation.IL2CPP);
        PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64; // 僅 ARM64

        // ===== 分包策略 =====
        PlayerSettings.Android.preferredInstallLocation = AndroidPreferredInstallLocation.Auto;

        Debug.Log("✅ Android Build Settings Configured for Google Play");
    }
}
```

### 2. Project Settings → Player → Publishing Settings

```
✅ Custom Keystore: 啟用
✅ Keystore Path: /path/to/your.keystore
✅ Keystore Password: ******
✅ Alias: your-key-alias
✅ Alias Password: ******

⚠️ 重要: 保存好 keystore 和密碼，丟失無法更新應用！
```

---

## 📦 AAB 瘦身技巧

### 策略 1: 壓縮和優化資產

```csharp
// 1. Texture 壓縮
// Select all textures → Inspector
Max Size: 2048 (或更小)
Compression: ASTC (ARM64 最佳)
Generate Mip Maps: 關閉（如果不需要）

// 2. Audio 壓縮
// Select all audio clips → Inspector
Load Type: Compressed In Memory
Compression Format: Vorbis
Quality: 70 (根據需求調整)

// 3. Mesh 優化
// Select all models → Inspector
Read/Write Enabled: 關閉
Optimize Mesh: 啟用
Mesh Compression: High

// 4. 移除未使用的資產
// 使用 Unity Addressables 或 AssetBundle
// 避免將大資產打包到 base module
```

### 策略 2: IL2CPP + Stripping

```csharp
// Player Settings → Other Settings
Scripting Backend: IL2CPP
Target Architectures: ARM64 only (不勾選 ARMv7)
Managed Stripping Level: High (或 Medium)

// 效果: 可減少 30-50% 的包體大小
```

### 策略 3: 分離不必要的資源

```csharp
// 將以下資源移到 StreamingAssets 或使用 PAD:
// - 高清貼圖
// - 視頻文件
// - 音樂文件（背景音樂）
// - 關卡資源（DLC）
```

### 策略 4: 使用 Unity Addressables

```csharp
// 安裝 Addressables Package
// Window → Package Manager → Addressables

// 標記遠程資源
[CreateAssetMenu]
public class RemoteAssetConfig : ScriptableObject
{
    public AssetReference highResTexture;
    public AssetReference videoClip;
}

// 運行時加載
using UnityEngine.AddressableAssets;

public class AssetLoader : MonoBehaviour
{
    public AssetReference assetRef;

    async void Start()
    {
        var handle = assetRef.LoadAssetAsync<Texture2D>();
        await handle.Task;
        Texture2D texture = handle.Result;
    }
}
```

---

## 🎮 Play Asset Delivery (PAD)

### 當 AAB > 200MB 時使用 PAD

### 步驟 1: 安裝 Google Play Plugins

```bash
# 下載 Play Plugins for Unity
# https://github.com/google/play-unity-plugins

# 導入到 Unity:
# Assets → Import Package → Custom Package
# 選擇 GooglePlayPlugins-*.unitypackage
```

### 步驟 2: 創建 Asset Pack

```csharp
// 1. 創建 Asset Pack 資料夾
Assets/
├── AssetPacks/
│   ├── HighResTextures/     (install-time: 立即下載)
│   ├── Level2Pack/          (fast-follow: 安裝後下載)
│   └── DLCPack/             (on-demand: 需要時下載)

// 2. 配置 Asset Pack
// Window → Google → Android App Bundle → Asset Delivery Settings

// 3. 設定 Delivery Mode:
// - install-time: 與 AAB 一起下載（最多 1GB）
// - fast-follow: 安裝後自動下載（最多 512MB 每個 pack）
// - on-demand: 按需下載（最多 512MB 每個 pack）
```

### 步驟 3: 代碼集成

```csharp
// File: AssetPackManager.cs
using Google.Play.AssetDelivery;
using System.Collections;
using UnityEngine;

public class AssetPackManager : MonoBehaviour
{
    private PlayAssetPackRequest downloadRequest;

    public IEnumerator DownloadAssetPack(string packName)
    {
        // 檢查 pack 狀態
        var checkRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);
        yield return checkRequest;

        if (checkRequest.Error != AssetDeliveryErrorCode.NoError)
        {
            Debug.LogError($"❌ Error checking pack: {checkRequest.Error}");
            yield break;
        }

        // 如果已下載，直接使用
        if (checkRequest.Status == AssetDeliveryStatus.Available)
        {
            Debug.Log("✅ Asset pack already available");
            LoadAssetsFromPack(packName);
            yield break;
        }

        // 開始下載
        downloadRequest = PlayAssetDelivery.RetrieveAssetPackAsync(packName);

        while (!downloadRequest.IsDone)
        {
            if (downloadRequest.Status == AssetDeliveryStatus.WaitingForWifi)
            {
                // 顯示對話框請求使用蜂窩網路
                var userConfirmation = PlayAssetDelivery.ShowCellularDataConfirmation();
                yield return userConfirmation;

                if (userConfirmation.Error != AssetDeliveryErrorCode.NoError ||
                    userConfirmation.Result != ConfirmationDialogResult.Accepted)
                {
                    Debug.Log("⚠️ User declined cellular download");
                    yield break;
                }
            }

            // 顯示下載進度
            float progress = downloadRequest.DownloadProgress;
            long downloaded = downloadRequest.BytesDownloaded;
            long total = downloadRequest.Size;

            Debug.Log($"📥 Downloading: {progress:P0} ({downloaded}/{total} bytes)");
            UpdateUI(progress);

            yield return null;
        }

        if (downloadRequest.Error != AssetDeliveryErrorCode.NoError)
        {
            Debug.LogError($"❌ Download failed: {downloadRequest.Error}");
            yield break;
        }

        Debug.Log("✅ Asset pack downloaded successfully");
        LoadAssetsFromPack(packName);
    }

    private void LoadAssetsFromPack(string packName)
    {
        // 方法 1: 從 AssetBundle 加載
        string assetBundlePath = downloadRequest.GetAssetBundlePath();
        AssetBundle bundle = AssetBundle.LoadFromFile(assetBundlePath);

        // 加載資源
        Texture2D texture = bundle.LoadAsset<Texture2D>("HighResTexture");

        // 方法 2: 使用 Addressables (推薦)
        // Addressables 會自動處理 Asset Pack
    }

    private void UpdateUI(float progress)
    {
        // 更新 UI 進度條
    }

    // 清理已下載的 on-demand pack（釋放空間）
    public void RemoveAssetPack(string packName)
    {
        PlayAssetDelivery.RemoveAssetPack(packName);
        Debug.Log($"🗑️ Removed asset pack: {packName}");
    }
}
```

### PAD 最佳實踐

```csharp
// ✅ 推薦的 Asset Pack 分配策略

// Base AAB (< 200MB):
// - Core gameplay scripts
// - UI assets
// - Essential audio (SFX)
// - First level assets
// - Low-res textures

// install-time pack (0-1GB):
// - Essential high-res textures
// - Tutorial level
// - Core characters

// fast-follow pack (建議 < 512MB):
// - Additional levels (2-5)
// - Additional characters
// - Background music

// on-demand packs (各 < 512MB):
// - DLC content
// - Optional high-res textures
// - Special events content
// - Language packs (非英語)
```

---

## 🔐 Keystore 簽名管理

### 生成 Keystore

```bash
# 使用 Unity 生成（推薦）
# Edit → Project Settings → Player → Publishing Settings
# → Create New Keystore

# 或使用 keytool 生成
keytool -genkey -v -keystore your-game.keystore \
  -alias your-key-alias \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

# 輸入資訊:
# - Keystore password: ******
# - Key password: ******
# - Name, Organization, etc.
```

### ⚠️ Keystore 安全管理

```bash
# 1. 備份 keystore（至少 3 份）
cp your-game.keystore ~/Dropbox/Backups/
cp your-game.keystore /external-drive/
# 打印 keystore 資訊並保存

# 2. 記錄 keystore 資訊
keytool -list -v -keystore your-game.keystore

# 輸出示例:
# Alias name: your-key-alias
# Creation date: Feb 9, 2024
# Entry type: PrivateKeyEntry
# Certificate fingerprints:
#   SHA1: XX:XX:XX:...
#   SHA256: YY:YY:YY:...

# ⚠️ SHA-1 和 SHA-256 指紋很重要（Google Play 需要）
```

### Play App Signing (推薦)

```
📝 Google Play Console 提供自動簽名服務:

1. 首次上傳 AAB 時，選擇「Let Google manage my app signing key」
2. Google 會保管發佈密鑰（release key）
3. 你只需保管上傳密鑰（upload key）
4. 即使上傳密鑰丟失，也可以聯繫 Google 重置

✅ 優點:
- 更安全（Google 管理發佈密鑰）
- 可重置上傳密鑰
- 支援 App Bundle 優化

❌ 不使用的風險:
- Keystore 丟失 = 無法更新應用 = 只能發佈新應用
```

---

## 🎛️ Google Play Console 配置

### 步驟 1: 創建應用

```
1. 訪問 https://play.google.com/console
2. 點擊「Create app」
3. 填寫基本資訊:
   - App name
   - Default language
   - App or game: Game
   - Free or paid: Free (通常)
4. 同意開發者計劃政策
```

### 步驟 2: 設置商店資訊

```
Dashboard → Store presence → Main store listing

必填項目:
✅ App name (30 characters)
✅ Short description (80 characters)
✅ Full description (4000 characters)
✅ App icon (512x512 PNG)
✅ Feature graphic (1024x500 JPG/PNG)
✅ Screenshots:
   - Phone: 至少 2 張 (最多 8 張)
   - 7-inch tablet: 至少 2 張
   - 10-inch tablet: 至少 2 張
✅ Category: Select appropriate category
✅ Contact details: Email, Website (optional), Privacy Policy URL

可選但推薦:
📱 Promotional video (YouTube URL)
🎨 Promo graphic (180x120)
```

### 步驟 3: 內容分級

```
Dashboard → Content rating → Start questionnaire

根據遊戲內容填寫問卷:
- 暴力程度
- 性內容
- 語言
- 藥物使用
- 賭博
- 等等

完成後會獲得各地區分級:
- ESRB (美國)
- PEGI (歐洲)
- USK (德國)
- IARC 通用分級
```

### 步驟 4: 目標受眾和內容

```
Dashboard → Target audience

設定:
✅ Target age groups (選擇目標年齡層)
✅ Appeals to children: Yes/No
✅ Store listing: 是否包含廣告

如果包含廣告:
✅ Ads declaration → Yes, my app contains ads
```

### 步驟 5: 數據安全

```
Dashboard → Data safety

必須聲明:
✅ 收集的用戶數據類型
✅ 數據使用目的
✅ 數據共享對象
✅ 數據安全措施

常見 Unity 遊戲收集的數據:
- Device ID (用於分析)
- Crash logs
- Game progress
- In-app purchase history
```

---

## 🚀 測試與發佈流程

### Build AAB

```csharp
// File: Editor/BuildPipeline.cs
using UnityEditor;
using UnityEngine;
using System;

public class BuildPipeline
{
    [MenuItem("Build/Build AAB for Google Play")]
    public static void BuildAAB()
    {
        // 配置
        string buildPath = "Builds/Android/YourGame.aab";

        // Build Options
        BuildPlayerOptions options = new BuildPlayerOptions
        {
            scenes = GetScenePaths(),
            locationPathName = buildPath,
            target = BuildTarget.Android,
            options = BuildOptions.None
        };

        // 確保生成 AAB
        EditorUserBuildSettings.buildAppBundle = true;

        // 開始 Build
        Debug.Log("🔨 Building AAB...");
        var report = BuildPipeline.BuildPlayer(options);

        if (report.summary.result == UnityEditor.Build.Reporting.BuildResult.Succeeded)
        {
            long sizeInBytes = report.summary.totalSize;
            float sizeInMB = sizeInBytes / (1024f * 1024f);

            Debug.Log($"✅ Build succeeded!");
            Debug.Log($"📦 AAB size: {sizeInMB:F2} MB");

            if (sizeInMB > 200)
            {
                Debug.LogWarning($"⚠️ AAB size ({sizeInMB:F2} MB) exceeds 200MB limit!");
                Debug.LogWarning("Consider using Play Asset Delivery (PAD)");
            }

            EditorUtility.RevealInFinder(buildPath);
        }
        else
        {
            Debug.LogError("❌ Build failed!");
        }
    }

    private static string[] GetScenePaths()
    {
        var scenes = EditorBuildSettings.scenes;
        string[] paths = new string[scenes.Length];
        for (int i = 0; i < scenes.Length; i++)
        {
            paths[i] = scenes[i].path;
        }
        return paths;
    }
}
```

### 測試流程

```
1. 內部測試 (Internal Testing)
   - 最多 100 個測試者
   - 審核時間: 數小時
   - 用途: 快速驗證 Build

2. 封閉測試 (Closed Testing)
   - 自定義測試者名單
   - 用途: Beta 測試

3. 開放測試 (Open Testing)
   - 任何人都可加入
   - 用途: 公開 Beta

4. 正式發佈 (Production)
   - 所有用戶
   - 審核時間: 1-7 天
```

### 上傳 AAB

```bash
# 方法 1: 手動上傳（推薦首次使用）
# 1. 進入 Google Play Console
# 2. 選擇應用 → Production → Create new release
# 3. 上傳 AAB 文件
# 4. 填寫 Release notes
# 5. Review and roll out

# 方法 2: 使用 fastlane 自動化（進階）
# 安裝 fastlane
gem install fastlane

# 初始化
cd /path/to/unity-project
fastlane init

# 配置 Fastfile
# lane :deploy do
#   gradle(task: "bundle", build_type: "Release")
#   upload_to_play_store(
#     track: 'internal',
#     aab: 'Builds/Android/YourGame.aab'
#   )
# end

# 執行上傳
fastlane deploy
```

### 版本管理

```csharp
// 每次發佈必須遞增 Version Code
// Player Settings → Version Code: 1 → 2 → 3 → ...

// 建議版本號規則:
// Version Name: 1.0.0 (給用戶看)
// Version Code: 1 (內部識別)

// 更新範例:
v1.0.0 (Code 1) - 初版
v1.0.1 (Code 2) - Bug fix
v1.1.0 (Code 3) - 新功能
v2.0.0 (Code 4) - 大版本更新
```

---

## ❓ 常見問題處理

### 問題 1: AAB 超過 200MB

```
解決方案優先級:

1️⃣ 優化資產（見 AAB 瘦身技巧）
   - 壓縮 Textures/Audio/Mesh
   - 移除未使用資產
   - 使用 IL2CPP + High Stripping

2️⃣ 如果仍超過 200MB → 使用 Play Asset Delivery
   - 將大資產移到 Asset Packs
   - 選擇合適的 delivery mode

3️⃣ 極端情況 → 考慮將內容拆分為多個應用
   - 例如: 主程式 + DLC 應用
```

### 問題 2: 簽名錯誤

```
錯誤: "Upload failed: APK signed with wrong key"

原因: 使用了不同的 Keystore

解決:
1. 確認使用正確的 Keystore
2. 檢查 Alias 和密碼
3. 如果是首次上傳，刪除草稿重新上傳
4. 如果已發佈過，必須使用原始 Keystore（無法更改）
```

### 問題 3: 審核被拒

```
常見拒絕原因:

1. 隱私政策缺失或不完整
   → 必須有 Privacy Policy URL

2. 未正確聲明數據收集
   → 完整填寫 Data safety 表單

3. 目標 SDK 版本過低
   → 必須 target API 31+ (Android 12)

4. 缺少必要權限說明
   → 使用敏感權限必須說明理由

5. Icon/Screenshots 不符合規範
   → 檢查尺寸和格式要求
```

### 問題 4: Play Asset Delivery 下載失敗

```csharp
// 添加錯誤處理和重試邏輯
public IEnumerator DownloadWithRetry(string packName, int maxRetries = 3)
{
    for (int i = 0; i < maxRetries; i++)
    {
        var request = PlayAssetDelivery.RetrieveAssetPackAsync(packName);
        yield return request;

        if (request.Error == AssetDeliveryErrorCode.NoError)
        {
            Debug.Log("✅ Download succeeded");
            yield break;
        }

        Debug.LogWarning($"⚠️ Download failed (Attempt {i+1}/{maxRetries}): {request.Error}");

        // 等待後重試
        yield return new WaitForSeconds(5f);
    }

    Debug.LogError("❌ Download failed after all retries");
    // 顯示錯誤訊息給玩家
}
```

### 問題 5: 64-bit 要求

```
Google Play 要求:
自 2019 年 8 月起，所有應用必須支援 64-bit (ARM64)

Unity 配置:
Player Settings → Other Settings
→ Scripting Backend: IL2CPP
→ Target Architectures: ✅ ARM64 (必須勾選)
                         ❌ ARMv7 (可以取消，減少包體)

⚠️ 如果只選 ARM64，部分舊設備無法運行
✅ 建議: 僅 ARM64（現代設備都支援）
```

---

## 📋 上架 Checklist

### Build 前檢查
```
✅ Bundle Identifier 正確
✅ Version Code 已遞增
✅ Keystore 配置正確
✅ Target SDK ≥ 31 (Android 12)
✅ IL2CPP + ARM64 啟用
✅ AAB ≤ 200MB（或配置 PAD）
✅ 測試過所有核心功能
✅ 沒有 Debug.Log 敏感資訊
```

### Console 前檢查
```
✅ App icon (512x512)
✅ Feature graphic (1024x500)
✅ Screenshots (所有尺寸)
✅ Short description (吸引人)
✅ Full description (詳細)
✅ Privacy Policy URL
✅ Content rating 完成
✅ Data safety 聲明完整
✅ Target audience 設定
```

### 上傳前檢查
```
✅ AAB 文件無損壞
✅ 簽名正確
✅ Release notes 準備好
✅ 選擇正確的 track (internal/production)
✅ 分階段發佈設定 (建議 10% → 50% → 100%)
```

---

## 🎯 最佳實踐總結

1. **永遠備份 Keystore**（至少 3 份）
2. **使用 Play App Signing**（讓 Google 管理發佈密鑰）
3. **優先優化資產**，再考慮 PAD
4. **從內部測試開始**，逐步擴大測試範圍
5. **使用分階段發佈**（Staged rollout），降低風險
6. **監控崩潰報告**（Play Console → Quality → Crashes）
7. **定期更新 SDK**，保持合規

---

## 📚 參考資源

- [Android App Bundle 官方文檔](https://developer.android.com/guide/app-bundle)
- [Play Asset Delivery 官方指南](https://developer.android.com/guide/playcore/asset-delivery)
- [Unity Play Plugins GitHub](https://github.com/google/play-unity-plugins)
- [Google Play Console 幫助中心](https://support.google.com/googleplay/android-developer)
- [Unity Android Build Settings](https://docs.unity3d.com/Manual/android-BuildProcess.html)

---

**上架流程時間估計:**
- 首次配置: 2-4 小時
- Build + 上傳: 30 分鐘
- 內部測試審核: 數小時
- 正式發佈審核: 1-7 天（通常 2-3 天）

**記住: 第一次上架最費時，後續更新會快很多！** 🚀

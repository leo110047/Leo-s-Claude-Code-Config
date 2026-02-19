# Leo's Claude Code Config

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**我的完整 Claude Code 設定集合 — Skills、Commands、Rules、Contexts、Hooks。**

經過日常密集使用演化而來的生產級配置，核心設計理念：**防止 AI 幻覺、系統性除錯、證據驅動開發**。

---

## 包含什麼

| 組件 | 數量 | 說明 |
|------|------|------|
| **Skills** | 11 全域 + 5 Unity | 涵蓋除錯、安全、架構、測試、效能等 |
| **Commands** | 4 | `/plan`、`/verify`、`/checkpoint`、`/code-review` |
| **Rules** | 3 | coding-style、security、git-workflow |
| **Contexts** | 3 | dev、review、research 模式切換 |
| **Hooks** | 5 | 自動格式化、型別檢查、console.log 警告等 |

---

## 快速開始

```bash
# 1. Clone
git clone https://github.com/leo110047/Skills.git
cd Skills

# 2. 一鍵安裝
./install.sh

# 3. 重啟 Claude Code，完成！
```

### 選擇性安裝

```bash
./install.sh skills       # 只裝 skills
./install.sh commands      # 只裝 commands
./install.sh skills rules  # 裝 skills + rules
./install.sh unity         # 在 Unity 專案中安裝專案 skills
./install.sh status        # 檢查安裝狀態
./install.sh uninstall     # 移除所有安裝
```

---

## 目錄結構

```
├── skills/
│   ├── global/                 # 11 個全域 skills（所有專案通用）
│   │   ├── systematic-debugging/
│   │   ├── evidence-based-coding/
│   │   ├── code-review-skill/
│   │   ├── backend-patterns/
│   │   ├── performance-optimization/
│   │   ├── testing-strategy/
│   │   ├── security-checklist/
│   │   ├── commit-conventions/
│   │   ├── decision-log/
│   │   ├── file-search/
│   │   ├── skill-developer/
│   │   └── skill-rules.json    # 衝突解決 + 防幻覺規則
│   └── projects/
│       └── unity/              # 5 個 Unity 專案 skills
├── commands/                   # 4 個斜線命令
├── contexts/                   # 3 個模式切換
├── rules/                      # 3 個永遠生效的規則
├── hooks/                      # Hook 配置 + 腳本
│   ├── hooks.json
│   └── scripts/
├── examples/                   # 範例 CLAUDE.md
├── install.sh                  # 安裝腳本
└── README.md
```

---

## Skills — 核心能力

### Skill 優先級

```
CRITICAL（絕對優先）
├─ systematic-debugging    有 bug/error 時自動觸發
└─ evidence-based-coding   全域強制，防止 AI 幻覺

HIGH
├─ security-checklist      安全問題
└─ performance-optimization 效能問題

MEDIUM
├─ code-review-skill       代碼審查
├─ backend-patterns        架構設計
└─ testing-strategy        測試策略

LOW（工具性質）
├─ commit-conventions      Git commit 規範
├─ decision-log            架構決策記錄
├─ file-search             代碼搜尋
└─ skill-developer         Skill 開發工具
```

### 三層防幻覺機制

這套設定的核心特色 — 防止 AI 猜測，強制證據驗證：

1. **evidence-based-coding** — 全域強制驗證，所有主張必須有證據
2. **systematic-debugging** — 禁止猜測式修復，必須系統性除錯
3. **skill-rules.json** — 衝突解決 + 防幻覺規則

**效果對比：**

```
❌ 沒有防護:
你: "getUserById 函數在哪裡？"
AI: "getUserById 可能在 src/services/user.service.ts"

✅ 有防護:
你: "getUserById 函數在哪裡？"
AI: [用 Grep 搜尋] → [用 Read 讀取]
    "我在 src/api/user.ts:45 找到了 getUserById..."
```

### 智能衝突解決

```
"API 很慢"           → performance-optimization（效能優先）
"設計 API"           → backend-patterns（架構優先）
"Review PR，測試失敗" → systematic-debugging（先修 bug）→ code-review-skill
```

---

## Commands — 工作流命令

| 命令 | 用途 |
|------|------|
| `/plan` | 開始新功能前的規劃，需確認才動工 |
| `/verify` | 一鍵跑 build + types + lint + tests + console.log 審計 |
| `/checkpoint` | 建立/比對工作回復點 |
| `/code-review` | 按 CRITICAL/HIGH/MEDIUM 分級的安全+品質審查 |

### `/verify` 參數

```
/verify              # 完整檢查（預設）
/verify quick        # 只跑 build + types
/verify pre-commit   # build + types + lint + console.log
/verify pre-pr       # 全部 + 安全掃描
```

---

## Rules — 永遠生效的底線

| Rule | 內容 |
|------|------|
| `coding-style.md` | 不可變性、檔案 <800 行、函數 <50 行、錯誤處理 |
| `security.md` | 每次 commit 前的安全檢查清單（OWASP） |
| `git-workflow.md` | Conventional commits、PR 流程 |

Rules 和 Skills 的差異：Rules **每次對話自動載入**，Skills 需要觸發。

---

## Contexts — 模式切換

| Context | 行為 |
|---------|------|
| `dev.md` | 先做出來、再做對、再做乾淨 |
| `review.md` | 按嚴重度排序、附修復建議 |
| `research.md` | 先理解再動手、多用搜尋工具 |

---

## Hooks — 自動化守護

| Hook | 觸發時機 | 功能 |
|------|---------|------|
| Dev server blocker | PreToolUse | 阻止在 tmux 外跑 dev server |
| Git push reminder | PreToolUse | push 前提醒檢查 |
| Doc file blocker | PreToolUse | 阻止建立無用的 .md 檔 |
| Strategic compact | PreToolUse | 50 次工具呼叫後提醒 compact |
| Prettier format | PostToolUse | 編輯後自動格式化 |
| TypeScript check | PostToolUse | 編輯 .ts 後自動型別檢查 |
| Console.log warn | PostToolUse + Stop | 警告 console.log 殘留 |

---

## Unity 專案 Skills

專為 Unity 遊戲開發的 5 個 skills：

| Skill | 用途 |
|-------|------|
| `unity-best-practices` | MonoBehaviour 設計、ScriptableObject、組件架構 |
| `unity-multiplatform` | iOS/Android/WebGL 多平台開發 |
| `unity-performance` | Profiler、GC 優化、渲染優化 |
| `unity-architecture` | MVC/ECS/Service Locator |
| `unity-app-store-deployment` | Google Play + App Store 雙平台上架 |

安裝到 Unity 專案：

```bash
cd /path/to/your-unity-project
/path/to/Skills/install.sh unity
```

---

## 建議工作流

```
開始新功能  →  /plan 描述需求
                ↓
確認計畫    →  開始寫 code（rules 自動生效）
                ↓
寫到一半    →  /checkpoint create 階段名稱
                ↓
寫完        →  /code-review
                ↓
修完問題    →  /verify pre-pr
                ↓
全部 PASS   →  commit & push
```

---

## 自訂與擴展

### 新增 Skill

```bash
mkdir skills/global/your-new-skill
# 建立 SKILL.md（參考 skill-developer skill）
```

### 新增專案類型

```bash
mkdir -p skills/projects/react
# 建立專案專用 skills + skill-rules.json
```

### 修改 Hook

編輯 `hooks/hooks.json`，然後重新合併到 `~/.claude/settings.json`。

---

## License

MIT License — 自由使用、修改和分發。

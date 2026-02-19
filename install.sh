#!/bin/bash

# Leo's Claude Code Config — 安裝腳本
# 用途：將 skills、commands、contexts、rules、hooks 安裝到 ~/.claude/

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

REPO_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
CLAUDE_DIR="$HOME/.claude"

# ─────────────────────────────────────
# 工具函數
# ─────────────────────────────────────

link_component() {
    local src="$1"
    local dest="$2"
    local name="$3"

    if [ ! -e "$src" ]; then
        echo -e "  ${YELLOW}[跳過] $name — 來源不存在${NC}"
        return
    fi

    if [ -L "$dest" ]; then
        local current_target
        current_target=$(readlink "$dest")
        if [ "$current_target" = "$src" ]; then
            echo -e "  ${GREEN}[已安裝] $name${NC}"
            return
        fi
        rm "$dest"
    elif [ -e "$dest" ]; then
        echo -e "  ${YELLOW}[備份] $name — 備份現有檔案到 ${dest}.bak${NC}"
        mv "$dest" "${dest}.bak"
    fi

    mkdir -p "$(dirname "$dest")"
    ln -s "$src" "$dest"
    echo -e "  ${GREEN}[安裝] $name${NC}"
}

show_help() {
    echo "用法: ./install.sh [選項]"
    echo ""
    echo "選項:"
    echo "  all         安裝所有組件（預設）"
    echo "  skills      只安裝全域 skills"
    echo "  commands    只安裝 commands"
    echo "  contexts    只安裝 contexts"
    echo "  rules       只安裝 rules"
    echo "  hooks       只安裝 hooks"
    echo "  unity       安裝 Unity 專案 skills 到當前目錄"
    echo "  uninstall   移除所有 symlinks"
    echo "  status      檢查安裝狀態"
    echo "  help        顯示此幫助"
    echo ""
    echo "範例:"
    echo "  ./install.sh              # 安裝全部"
    echo "  ./install.sh skills rules # 只安裝 skills 和 rules"
    echo "  ./install.sh unity        # 在 Unity 專案中安裝"
    echo "  ./install.sh status       # 檢查狀態"
}

install_skills() {
    link_component "$REPO_DIR/skills/global" "$CLAUDE_DIR/skills" "全域 Skills (11 個)"
}

install_commands() {
    link_component "$REPO_DIR/commands" "$CLAUDE_DIR/commands" "Commands (4 個)"
}

install_contexts() {
    link_component "$REPO_DIR/contexts" "$CLAUDE_DIR/contexts" "Contexts (3 個)"
}

install_rules() {
    link_component "$REPO_DIR/rules" "$CLAUDE_DIR/rules" "Rules (3 個)"
}

install_hooks() {
    link_component "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts" "Hook Scripts (5 個)"
    echo ""
    echo -e "  ${CYAN}[提示] Hooks 需要手動配置:${NC}"
    echo -e "  ${CYAN}  1. 將 hooks/hooks.json 的內容合併到 ~/.claude/settings.json${NC}"
    echo -e "  ${CYAN}  2. 將路徑中的 \${HOOKS_DIR} 替換為:${NC}"
    echo -e "  ${CYAN}     $CLAUDE_DIR/hooks${NC}"
}

install_unity() {
    local project_dir="$(pwd)"
    if [ ! -d "Assets" ]; then
        echo -e "${YELLOW}警告：當前目錄不像是 Unity 專案（沒有 Assets 資料夾）${NC}"
        read -p "是否繼續？(y/n): " cont
        if [ "$cont" != "y" ]; then
            echo -e "${RED}安裝取消${NC}"
            return
        fi
    fi
    mkdir -p "$project_dir/.claude"
    link_component "$REPO_DIR/skills/projects/unity" "$project_dir/.claude/skills" "Unity Skills (5 個)"
}

show_status() {
    echo -e "${BLUE}安裝狀態檢查${NC}"
    echo ""

    local components=("skills:$CLAUDE_DIR/skills" "commands:$CLAUDE_DIR/commands" "contexts:$CLAUDE_DIR/contexts" "rules:$CLAUDE_DIR/rules" "hooks:$CLAUDE_DIR/hooks/scripts")

    for item in "${components[@]}"; do
        local name="${item%%:*}"
        local path="${item##*:}"

        if [ -L "$path" ]; then
            local target
            target=$(readlink "$path")
            echo -e "  ${GREEN}[OK]${NC} $name -> $target"
        elif [ -e "$path" ]; then
            echo -e "  ${YELLOW}[存在但非 symlink]${NC} $name: $path"
        else
            echo -e "  ${RED}[未安裝]${NC} $name"
        fi
    done
}

do_uninstall() {
    echo -e "${YELLOW}移除安裝...${NC}"
    local paths=("$CLAUDE_DIR/skills" "$CLAUDE_DIR/commands" "$CLAUDE_DIR/contexts" "$CLAUDE_DIR/rules" "$CLAUDE_DIR/hooks/scripts")

    for p in "${paths[@]}"; do
        if [ -L "$p" ]; then
            rm "$p"
            echo -e "  ${GREEN}[移除] $p${NC}"
        fi
    done
    echo -e "${GREEN}完成${NC}"
}

# ─────────────────────────────────────
# 主程式
# ─────────────────────────────────────

echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${BLUE}  Leo's Claude Code Config Installer${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}倉庫位置：${NC}$REPO_DIR"
echo ""

# 無參數 = 安裝全部
if [ $# -eq 0 ]; then
    set -- "all"
fi

case "$1" in
    help|-h|--help)
        show_help
        exit 0
        ;;
    status)
        show_status
        exit 0
        ;;
    uninstall)
        do_uninstall
        exit 0
        ;;
esac

mkdir -p "$CLAUDE_DIR"

for arg in "$@"; do
    case "$arg" in
        all)
            echo -e "${GREEN}安裝所有組件...${NC}"
            echo ""
            install_skills
            install_commands
            install_contexts
            install_rules
            install_hooks
            ;;
        skills)
            install_skills
            ;;
        commands)
            install_commands
            ;;
        contexts)
            install_contexts
            ;;
        rules)
            install_rules
            ;;
        hooks)
            install_hooks
            ;;
        unity)
            install_unity
            ;;
        *)
            echo -e "${RED}未知選項: $arg${NC}"
            show_help
            exit 1
            ;;
    esac
done

echo ""
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo -e "${GREEN}安裝完成！${NC}"
echo -e "${BLUE}════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}下一步：${NC}"
echo "  1. 重啟 Claude Code"
echo "  2. 試試 /plan、/verify、/code-review 等命令"
echo "  3. 查看 ./install.sh status 確認安裝狀態"
echo ""

# This file must be sourced by bash, not executed directly.

show_status() {
    echo -e "${BLUE}安裝狀態檢查${NC}"
    echo ""

    if [ -L "$SKILLS_DIR" ]; then
        local skills_target
        skills_target=$(readlink "$SKILLS_DIR")
        echo -e "  ${GREEN}[OK]${NC} skills (legacy symlink) -> $skills_target"
    elif [ -d "$SKILLS_DIR" ]; then
        if [ -f "$SKILL_PROFILE_FILE" ]; then
            local profile_line
            profile_line=$(grep '^profile=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
            local profile="${profile_line#profile=}"
            local skills_line
            skills_line=$(grep '^skills=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
            local skills_csv="${skills_line#skills=}"
            local skill_count=0
            if [ -n "$skills_csv" ]; then
                skill_count=$(echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')
            fi
            echo -e "  ${GREEN}[OK]${NC} skills profile: ${profile:-unknown} (${skill_count} 個)"
        else
            echo -e "  ${YELLOW}[存在]${NC} skills 目錄存在，但不是 goldband profile 管理模式"
        fi
    else
        echo -e "  ${RED}[未安裝]${NC} skills"
    fi

    local components=("commands:$CLAUDE_DIR/commands" "contexts:$CLAUDE_DIR/contexts" "rules:$CLAUDE_DIR/rules" "hooks:$CLAUDE_DIR/hooks/scripts" "statusline:$CLAUDE_DIR/statusline-command.sh")

    for item in "${components[@]}"; do
        local name="${item%%:*}"
        local path="${item##*:}"

        if [ -L "$path" ]; then
            local target
            target=$(readlink "$path")
            echo -e "  ${GREEN}[OK]${NC} $name -> $target"
        elif [ -e "$path" ]; then
            echo -e "  ${YELLOW}[legacy copy]${NC} $name — 建議重跑 ./install.sh 轉成 repo-linked"
        else
            echo -e "  ${RED}[未安裝]${NC} $name"
        fi
    done

    if shell_launchers_installed; then
        echo -e "  ${GREEN}[OK]${NC} shell launchers (zsh)"
    elif [ -e "$SHELL_UPDATE_BIN" ] || [ -e "$SHELL_LAUNCHERS_FILE" ]; then
        echo -e "  ${YELLOW}[部分安裝]${NC} shell launchers — 建議重跑 ./install.sh launchers"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} shell launchers (zsh)"
    fi

    echo ""
    local settings_json="$CLAUDE_DIR/settings.json"
    if [ -f "$settings_json" ] && command -v jq &> /dev/null; then
        local hook_count
        hook_count=$(jq '[.hooks // {} | to_entries[] | .value | length] | add // 0' "$settings_json" 2>/dev/null)
        if [ "$hook_count" -gt 0 ] 2>/dev/null; then
            echo -e "  ${GREEN}[OK]${NC} hooks in settings.json ($hook_count 個 hook 已設定)"
        else
            echo -e "  ${YELLOW}[未設定]${NC} hooks in settings.json — 執行 ./install.sh hooks 來設定"
        fi
    elif [ -f "$settings_json" ]; then
        echo -e "  ${YELLOW}[需要 jq]${NC} 無法檢查 settings.json 中的 hooks 設定"
    else
        echo -e "  ${RED}[未安裝]${NC} settings.json 不存在"
    fi

    echo ""
    echo -e "${BLUE}Codex 狀態${NC}"

    if is_generated_codex_config "$CODEX_CONFIG_FILE"; then
        if grep -q '^# Local overlay: none$' "$CODEX_CONFIG_FILE" 2>/dev/null; then
            echo -e "  ${GREEN}[OK]${NC} codex-config (generated base only)"
        else
            echo -e "  ${GREEN}[OK]${NC} codex-config (generated base + local overlay)"
        fi
    elif [ -L "$CODEX_CONFIG_FILE" ]; then
        local target
        target=$(readlink "$CODEX_CONFIG_FILE")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex-config -> $target — 建議重跑 ./install.sh codex-config"
    elif [ -e "$CODEX_CONFIG_FILE" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-config — 建議重跑 ./install.sh codex-config"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-config"
    fi

    if [ -L "$CODEX_AGENTS_FILE" ]; then
        local target
        target=$(readlink "$CODEX_AGENTS_FILE")
        echo -e "  ${GREEN}[OK]${NC} codex-agents -> $target"
    elif [ -e "$CODEX_AGENTS_FILE" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-agents — 建議重跑 ./install.sh codex-agents"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-agents"
    fi

    if [ -L "$CODEX_RULES_DIR" ]; then
        local target
        target=$(readlink "$CODEX_RULES_DIR")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex-rules -> $target — 建議重跑 ./install.sh codex-rules"
    elif [ -d "$CODEX_RULES_DIR" ]; then
        if [ -L "$CODEX_RULES_DIR/default.rules" ]; then
            local rule_count
            rule_count=$(find "$CODEX_RULES_DIR" -name '*.rules' 2>/dev/null | wc -l | tr -d ' ')
            echo -e "  ${GREEN}[OK]${NC} codex-rules (${rule_count} 個 rule file)"
        else
            echo -e "  ${YELLOW}[存在]${NC} codex-rules 目錄存在，但缺少 default.rules link"
        fi
    elif [ -e "$CODEX_RULES_DIR" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-rules — 建議重跑 ./install.sh codex-rules"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-rules"
    fi

    if [ -d "$CODEX_SKILLS_DIR" ]; then
        if [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
            local profile_line
            profile_line=$(grep '^profile=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
            local profile="${profile_line#profile=}"
            local skills_line
            skills_line=$(grep '^skills=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
            local skills_csv="${skills_line#skills=}"
            local skill_count=0
            if [ -n "$skills_csv" ]; then
                skill_count=$(echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' ')
            fi
            echo -e "  ${GREEN}[OK]${NC} codex skills profile: ${profile:-unknown} (${skill_count} 個)"
        else
            echo -e "  ${YELLOW}[存在]${NC} codex skills 目錄存在，但不是 goldband profile 管理模式"
        fi
    else
        echo -e "  ${RED}[未安裝]${NC} codex skills"
    fi

    echo ""
    echo -e "${BLUE}workflow 狀態${NC}"

    local workflow_claude_dir="$HOME/.claude/skills/workflow"
    local workflow_codex_dir="$HOME/.codex/skills/workflow"
    local workflow_config_bin
    local goldband_language
    local workflow_version

    if [ -d "$workflow_claude_dir" ]; then
        workflow_version="$(read_workflow_version "$workflow_claude_dir" 2>/dev/null || echo "unknown")"
        echo -e "  ${GREEN}[OK]${NC} workflow Claude install (${workflow_version})"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} workflow Claude install"
    fi

    if [ -d "$workflow_codex_dir" ]; then
        workflow_version="$(read_workflow_version "$workflow_codex_dir" 2>/dev/null || echo "unknown")"
        echo -e "  ${GREEN}[OK]${NC} workflow Codex runtime (${workflow_version})"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} workflow Codex runtime"
    fi

    if [ -d "$workflow_codex_dir" ]; then
        local generated_count
        generated_count=$(find "$HOME/.codex/skills" -maxdepth 1 -name 'goldband-*' 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ${GREEN}[OK]${NC} workflow Codex generated skills: ${generated_count:-0}"
    fi

    if [ -d "$HOME/.workflow/projects" ]; then
        echo -e "  ${GREEN}[OK]${NC} workflow state dir (~/.workflow/projects)"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} workflow state dir (~/.workflow/projects)"
    fi

    if workflow_config_bin="$(find_workflow_config_bin 2>/dev/null)"; then
        goldband_language="$(read_goldband_wrapper_language "$workflow_config_bin")"
        echo -e "  ${GREEN}[OK]${NC} goldband wrapper language (${goldband_language})"
    fi
}

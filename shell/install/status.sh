# This file must be sourced by bash, not executed directly.

profile_skill_count() {
    local profile_file="$1"
    local skills_line skills_csv
    skills_line=$(grep '^skills=' "$profile_file" 2>/dev/null || true)
    skills_csv="${skills_line#skills=}"
    if [ -n "$skills_csv" ]; then
        echo "$skills_csv" | tr ',' '\n' | sed '/^$/d' | wc -l | tr -d ' '
    else
        printf '0\n'
    fi
}

show_status() {
    echo -e "${BLUE}安裝狀態檢查${NC}"
    echo ""
    show_claude_install_status
    echo ""
    show_claude_settings_status
    echo ""
    echo -e "${BLUE}Codex 狀態${NC}"
    show_codex_install_status
    echo ""
    echo -e "${BLUE}Git style gate 狀態${NC}"
    show_git_style_gate_status
    echo ""
    echo -e "${BLUE}workflow 狀態${NC}"
    show_workflow_status
}

show_claude_install_status() {
    show_claude_skills_status
    show_repo_path_status "claude CLAUDE.md" "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" "$REPO_DIR/claude/CLAUDE.md" "claude-guidance"
    show_repo_path_status "commands" "$CLAUDE_DIR/commands" "$REPO_DIR/commands" "commands"
    show_repo_path_status "contexts" "$CLAUDE_DIR/contexts" "$REPO_DIR/contexts" "contexts"
    show_repo_path_status "rules" "$CLAUDE_DIR/rules" "$REPO_DIR/rules" "rules"
    show_repo_path_status "hooks" "$CLAUDE_DIR/hooks/scripts" "$REPO_DIR/hooks/scripts" "hooks"
    show_repo_path_status "statusline" "$CLAUDE_DIR/statusline-command.sh" "$REPO_DIR/hooks/statusline-command.sh" "hooks"
    show_shell_launcher_status
}

show_claude_skills_status() {
    if [ -L "$SKILLS_DIR" ]; then
        local skills_target
        skills_target=$(readlink "$SKILLS_DIR")
        echo -e "  ${GREEN}[OK]${NC} skills (legacy symlink) -> $skills_target"
    elif [ -d "$SKILLS_DIR" ] && [ -f "$SKILL_PROFILE_FILE" ]; then
        local profile_line profile skill_count
        profile_line=$(grep '^profile=' "$SKILL_PROFILE_FILE" 2>/dev/null || true)
        profile="${profile_line#profile=}"
        skill_count="$(profile_skill_count "$SKILL_PROFILE_FILE")"
        echo -e "  ${GREEN}[OK]${NC} skills profile: ${profile:-unknown} (${skill_count} 個)"
    elif [ -d "$SKILLS_DIR" ]; then
        echo -e "  ${YELLOW}[存在]${NC} skills 目錄存在，但不是 goldband profile 管理模式"
    else
        echo -e "  ${RED}[未安裝]${NC} skills"
    fi
}

show_repo_path_status() {
    local name="$1"
    local path="$2"
    local src="$3"
    local install_target="$4"
    if repo_link_points_to "$path" "$src"; then
        local target
        target=$(readlink "$path")
        echo -e "  ${GREEN}[OK]${NC} $name -> $target"
    elif [ -f "$src" ] && [ -f "$path" ] && cmp -s "$src" "$path" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} $name (copy fallback)"
    elif [ -L "$path" ]; then
        local target
        target=$(readlink "$path")
        echo -e "  ${YELLOW}[legacy symlink]${NC} $name -> $target — 建議重跑 ./install.sh $install_target"
    elif [ -e "$path" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} $name — 建議重跑 ./install.sh 轉成 repo-linked"
    else
        echo -e "  ${RED}[未安裝]${NC} $name"
    fi
}

show_shell_launcher_status() {
    if shell_launchers_installed; then
        echo -e "  ${GREEN}[OK]${NC} shell launchers (zsh)"
    elif [ -e "$SHELL_UPDATE_BIN" ] || [ -e "$SHELL_LAUNCHERS_FILE" ]; then
        echo -e "  ${YELLOW}[部分安裝]${NC} shell launchers — 建議重跑 ./install.sh launchers"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} shell launchers (zsh)"
    fi
}

show_claude_settings_status() {
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
}

show_codex_install_status() {
    show_codex_config_status
    show_codex_profiles_status
    show_codex_requirements_status
    show_repo_path_status "codex AGENTS.md" "$CODEX_AGENTS_FILE" "$REPO_DIR/codex/AGENTS.md" "codex-agents"
    show_repo_path_status "codex custom agents" "$CODEX_CUSTOM_AGENTS_DIR" "$REPO_DIR/codex/agents" "codex-agents"
    show_repo_path_status "codex hooks.json" "$CODEX_HOOKS_FILE" "$REPO_DIR/codex/hooks.json" "codex-hooks"
    show_repo_path_status "codex hook scripts" "$CODEX_HOOKS_DIR" "$REPO_DIR/codex/hooks" "codex-hooks"
    show_codex_rules_status
    show_codex_skills_status
    show_mcp_token_status
}

show_codex_config_status() {
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
}

show_codex_profiles_status() {
    local profile_source_dir="$REPO_DIR/codex/profiles"
    [ -d "$profile_source_dir" ] || return 0
    local profile_total=0 profile_installed=0 profile_copy_count=0 profile_file
    for profile_file in "$profile_source_dir"/*.config.toml; do
        [ -f "$profile_file" ] || continue
        profile_total=$((profile_total + 1))
        local profile_dest="$CODEX_DIR/$(basename "$profile_file")"
        if repo_path_installed_from "$profile_file" "$profile_dest"; then
            profile_installed=$((profile_installed + 1))
            if [ ! -L "$profile_dest" ]; then
                profile_copy_count=$((profile_copy_count + 1))
            fi
        fi
    done
    if [ "$profile_total" -gt 0 ] && [ "$profile_installed" -eq "$profile_total" ]; then
        if [ "$profile_copy_count" -gt 0 ]; then
            echo -e "  ${GREEN}[OK]${NC} codex profiles (${profile_installed}/${profile_total}, copy fallback)"
        else
            echo -e "  ${GREEN}[OK]${NC} codex profiles (${profile_installed}/${profile_total})"
        fi
    elif [ "$profile_installed" -gt 0 ]; then
        echo -e "  ${YELLOW}[部分安裝]${NC} codex profiles (${profile_installed}/${profile_total}) — 建議重跑 ./install.sh codex-config"
    else
        echo -e "  ${RED}[未安裝]${NC} codex profiles"
    fi
}

show_codex_requirements_status() {
    local src="$REPO_DIR/codex/requirements.toml"
    [ -f "$src" ] || return 0
    if [ -f "$CODEX_REQUIREMENTS_FILE" ] && cmp -s "$src" "$CODEX_REQUIREMENTS_FILE" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} codex requirements -> $CODEX_REQUIREMENTS_FILE"
    elif [ -f "$CODEX_REQUIREMENTS_FILE" ]; then
        echo -e "  ${YELLOW}[存在]${NC} codex requirements 不同於 repo 版本 -> $CODEX_REQUIREMENTS_FILE"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} codex requirements — 執行 ./install.sh codex-requirements"
    fi
}

show_codex_rules_status() {
    if [ -L "$CODEX_RULES_DIR" ]; then
        local target
        target=$(readlink "$CODEX_RULES_DIR")
        echo -e "  ${YELLOW}[legacy symlink]${NC} codex-rules -> $target — 建議重跑 ./install.sh codex-rules"
    elif [ -d "$CODEX_RULES_DIR" ]; then
        show_codex_rules_dir_status
    elif [ -e "$CODEX_RULES_DIR" ]; then
        echo -e "  ${YELLOW}[legacy copy]${NC} codex-rules — 建議重跑 ./install.sh codex-rules"
    else
        echo -e "  ${RED}[未安裝]${NC} codex-rules"
    fi
}

show_codex_rules_dir_status() {
    local local_default="$REPO_DIR/codex/local/rules/default.rules"
    local goldband_default="$REPO_DIR/codex/rules/default.rules"
    if repo_path_installed_from "$local_default" "$CODEX_RULES_DIR/default.rules" &&
        repo_path_installed_from "$goldband_default" "$CODEX_RULES_DIR/goldband.rules"; then
        local rule_count
        rule_count=$(find "$CODEX_RULES_DIR" -name '*.rules' 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ${GREEN}[OK]${NC} codex-rules (${rule_count} 個 rule file)"
    elif ! repo_path_installed_from "$goldband_default" "$CODEX_RULES_DIR/goldband.rules"; then
        echo -e "  ${YELLOW}[存在]${NC} codex-rules 目錄存在，但缺少 goldband.rules portable link"
    else
        echo -e "  ${YELLOW}[存在]${NC} codex-rules 目錄存在，但缺少 default.rules link"
    fi
}

show_codex_skills_status() {
    if [ -d "$CODEX_SKILLS_DIR" ] && [ -f "$CODEX_SKILL_PROFILE_FILE" ]; then
        local profile_line profile skill_count
        profile_line=$(grep '^profile=' "$CODEX_SKILL_PROFILE_FILE" 2>/dev/null || true)
        profile="${profile_line#profile=}"
        skill_count="$(profile_skill_count "$CODEX_SKILL_PROFILE_FILE")"
        echo -e "  ${GREEN}[OK]${NC} codex skills profile: ${profile:-unknown} (${skill_count} 個)"
    elif [ -d "$CODEX_SKILLS_DIR" ]; then
        echo -e "  ${YELLOW}[存在]${NC} codex skills 目錄存在，但不是 goldband profile 管理模式"
    else
        echo -e "  ${RED}[未安裝]${NC} codex skills"
    fi
}

show_mcp_token_status() {
    if command -v node >/dev/null 2>&1 && [ -f "$REPO_DIR/scripts/check-mcp-token-status.mjs" ]; then
        node "$REPO_DIR/scripts/check-mcp-token-status.mjs" --summary --mcp-env-file "$REPO_DIR/codex/local/mcp.env" 2>/dev/null || true
    fi
}

show_git_style_gate_status() {
    if command -v git >/dev/null 2>&1; then
        local current_hooks_path
        current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
        if paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR"; then
            echo -e "  ${GREEN}[OK]${NC} global core.hooksPath -> $GIT_HOOKS_DIR"
        elif [ -n "$current_hooks_path" ]; then
            echo -e "  ${YELLOW}[外部設定]${NC} global core.hooksPath -> $current_hooks_path"
        else
            echo -e "  ${RED}[未安裝]${NC} global core.hooksPath 未設定"
        fi
    else
        echo -e "  ${YELLOW}[無法檢查]${NC} git 不可用"
    fi
}

show_workflow_status() {
    local workflow_claude_dir="$HOME/.claude/skills/workflow"
    local workflow_codex_dir="$HOME/.codex/skills/workflow"
    show_workflow_runtime_status "Claude install" "$workflow_claude_dir"
    show_workflow_runtime_status "Codex runtime" "$workflow_codex_dir"
    if [ -d "$workflow_codex_dir" ]; then
        local generated_count
        generated_count=$(find "$HOME/.codex/skills" -maxdepth 1 -name 'goldband-*' 2>/dev/null | wc -l | tr -d ' ')
        echo -e "  ${GREEN}[OK]${NC} workflow Codex generated skills: ${generated_count:-0}"
    fi
    show_workflow_state_dir_status
    show_goldband_wrapper_language_status
}

show_workflow_runtime_status() {
    local label="$1"
    local workflow_dir="$2"
    local workflow_version
    if [ -d "$workflow_dir" ]; then
        workflow_version="$(read_workflow_version "$workflow_dir" 2>/dev/null || echo "unknown")"
        echo -e "  ${GREEN}[OK]${NC} workflow $label (${workflow_version})"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} workflow $label"
    fi
}

show_workflow_state_dir_status() {
    if [ -d "$HOME/.workflow/projects" ]; then
        echo -e "  ${GREEN}[OK]${NC} workflow state dir (~/.workflow/projects)"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} workflow state dir (~/.workflow/projects)"
    fi
}

show_goldband_wrapper_language_status() {
    local workflow_config_bin goldband_language
    if workflow_config_bin="$(find_workflow_config_bin 2>/dev/null)"; then
        goldband_language="$(read_goldband_wrapper_language "$workflow_config_bin")"
        echo -e "  ${GREEN}[OK]${NC} goldband wrapper language (${goldband_language})"
    fi
}

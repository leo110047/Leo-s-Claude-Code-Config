# This file must be sourced by bash, not executed directly.

install_skills() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "full")
    install_skills_profile "full" "${skill_list[@]}"
}

install_skills_core() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "core")
    install_skills_profile "core" "${skill_list[@]}"
}

install_skills_dev() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_skill_profile_list "dev")
    install_skills_profile "dev" "${skill_list[@]}"
}

install_pack_core() {
    install_skills_core
    install_claude_guidance
    install_rules
    install_hooks
    install_shell_launchers
}

install_pack_quality() {
    install_skills_dev
    install_claude_guidance
    install_commands
    install_rules
    install_hooks
    install_shell_launchers
}

install_pack_unity() {
    install_pack_quality
    install_unity
}

install_codex_skills() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_codex_skill_profile_list "full")
    install_codex_skills_profile "full" "${skill_list[@]}"
}

install_codex_skills_core() {
    local skill_list=()
    while IFS= read -r skill; do
        [ -n "$skill" ] && skill_list+=("$skill")
    done < <(build_codex_skill_profile_list "core")
    install_codex_skills_profile "core" "${skill_list[@]}"
}

install_codex_config() {
    install_generated_codex_config
    install_codex_profile_configs
}

install_codex_requirements() {
    install_codex_requirements_file
}

install_codex_agents() {
    link_component "$REPO_DIR/codex/AGENTS.md" "$CODEX_AGENTS_FILE" "Codex AGENTS.md"
    link_component "$REPO_DIR/codex/agents" "$CODEX_CUSTOM_AGENTS_DIR" "Codex custom agents"
}

install_codex_prompts() {
    if repo_link_points_to "$CODEX_PROMPTS_DIR" "$REPO_DIR/codex/prompts"; then
        rm "$CODEX_PROMPTS_DIR"
    fi
    mkdir -p "$CODEX_PROMPTS_DIR"

    # Codex no longer exposes custom prompts in the slash menu, but keep the
    # legacy prompt as a materialized fallback for debug/readback compatibility.
    local src="$REPO_DIR/codex/prompts/goldband.md"
    if [ ! -e "$src" ]; then
        echo -e "  ${YELLOW}[跳過] Codex prompt goldband.md — 來源不存在${NC}"
        return
    fi
    if [ -f "$CODEX_GOLDBAND_PROMPT_FILE" ] && [ ! -L "$CODEX_GOLDBAND_PROMPT_FILE" ] && cmp -s "$src" "$CODEX_GOLDBAND_PROMPT_FILE"; then
        echo -e "  ${GREEN}[已安裝] Codex prompt goldband.md${NC}"
        return
    fi
    if [ -L "$CODEX_GOLDBAND_PROMPT_FILE" ]; then
        rm "$CODEX_GOLDBAND_PROMPT_FILE"
    elif [ -e "$CODEX_GOLDBAND_PROMPT_FILE" ]; then
        backup_existing_path "$CODEX_GOLDBAND_PROMPT_FILE"
    fi
    materialize_file_copy "$src" "$CODEX_GOLDBAND_PROMPT_FILE"
    echo -e "  ${GREEN}[安裝] Codex prompt goldband.md${NC}"
    echo -e "  ${YELLOW}note:${NC} Codex prompt fallback is a file copy; rerun ./install.sh after git pull to refresh it."
}

install_codex_hooks() {
    link_component "$REPO_DIR/codex/hooks.json" "$CODEX_HOOKS_FILE" "Codex hooks.json"
    link_component "$REPO_DIR/codex/hooks" "$CODEX_HOOKS_DIR" "Codex hook scripts"
}

install_codex_rules() {
    warn_codex_portable_rules_local_state
    install_codex_rules_dir
}

install_claude_guidance() {
    link_component "$REPO_DIR/claude/CLAUDE.md" "$CLAUDE_GLOBAL_INSTRUCTIONS_FILE" "Claude CLAUDE.md"
}

install_codex_core() {
    install_codex_config
    install_codex_agents
    install_codex_prompts
    install_codex_hooks
    install_codex_rules
    install_codex_skills_core
    install_shell_launchers
}

install_codex_full() {
    install_codex_config
    install_codex_agents
    install_codex_prompts
    install_codex_hooks
    install_codex_rules
    install_codex_skills
    install_shell_launchers
}

install_all_tools() {
    install_skills
    install_claude_guidance
    install_commands
    install_rules
    install_hooks
    install_shell_launchers
    install_codex_full
}

install_all_with_workflow() {
    install_all_tools
    install_workflow_host "auto" "standard"
}

install_commands() {
    link_component "$REPO_DIR/commands" "$CLAUDE_DIR/commands" "Commands"
}

install_rules() {
    link_component "$REPO_DIR/rules" "$CLAUDE_DIR/rules" "Rules (5 個)"
}

merge_hooks_config() {
    local hooks_json="$REPO_DIR/hooks/hooks.json"
    local settings_json="$CLAUDE_DIR/settings.json"
    local hooks_dir="$CLAUDE_DIR/hooks"

    if ! command -v jq &> /dev/null; then
        print_missing_jq_hooks_help "$hooks_dir"
        return
    fi

    local hooks_content
    hooks_content="$(read_expanded_hooks_content "$hooks_json" "$hooks_dir")"

    if [ -z "$hooks_content" ] || [ "$hooks_content" = "null" ]; then
        echo -e "  ${RED}[錯誤] 無法讀取 hooks.json${NC}"
        return
    fi

    if [ ! -f "$settings_json" ]; then
        echo '{}' > "$settings_json"
    fi

    cp "$settings_json" "${settings_json}.bak"
    echo -e "  ${CYAN}[備份] settings.json -> settings.json.bak${NC}"

    local existing_hooks
    existing_hooks=$(jq '.hooks // {}' "$settings_json")

    local merged_hooks
    merged_hooks="$(merge_claude_hooks_json "$existing_hooks" "$hooks_content")"

    jq --argjson hooks "$merged_hooks" '.hooks = $hooks' "$settings_json" > "${settings_json}.tmp" \
        && mv "${settings_json}.tmp" "$settings_json"

    echo -e "  ${GREEN}[合併] Hooks 設定已自動合併到 settings.json${NC}"
    merge_statusline_config "$hooks_json" "$settings_json"
    merge_permissions_config "$hooks_json" "$settings_json"
}

merge_claude_hooks_json() {
    local existing_hooks="$1"
    local hooks_content="$2"
    jq -n --argjson existing "$existing_hooks" --argjson new_hooks "$hooks_content" '
        def hook_key:
            .hooks[0].command // .hooks[0].prompt // .description // tostring;

        def merge_phase(phase):
            (($existing[phase] // []) + ($new_hooks[phase] // []))
            | group_by(hook_key)
            | map(last);

        {
            SessionStart: merge_phase("SessionStart"),
            UserPromptSubmit: merge_phase("UserPromptSubmit"),
            PreToolUse: merge_phase("PreToolUse"),
            PostToolUse: merge_phase("PostToolUse"),
            PostToolUseFailure: merge_phase("PostToolUseFailure"),
            Stop: merge_phase("Stop"),
            SubagentStop: merge_phase("SubagentStop"),
            Notification: merge_phase("Notification"),
            PreCompact: merge_phase("PreCompact"),
            PostCompact: merge_phase("PostCompact"),
            SessionEnd: merge_phase("SessionEnd")
        }
        '
}

print_missing_jq_hooks_help() {
    local hooks_dir="$1"
    echo -e "  ${YELLOW}[提示] jq 未安裝，無法自動合併 hooks 設定${NC}"
    echo -e "  ${CYAN}  請手動操作:${NC}"
    echo -e "  ${CYAN}  1. 將 hooks/hooks.json 的內容合併到 ~/.claude/settings.json${NC}"
    echo -e "  ${CYAN}  2. 將路徑中的 \${HOOKS_DIR} 替換為:${NC}"
    echo -e "  ${CYAN}     $hooks_dir${NC}"
    echo -e "  ${CYAN}  或安裝 jq 後重新執行: brew install jq${NC}"
}

read_expanded_hooks_content() {
    local hooks_json="$1"
    local hooks_dir="$2"
    jq --arg dir "$hooks_dir" '
        def expand_hook_paths:
            walk(if type == "string" then gsub("\\$\\{HOOKS_DIR\\}"; $dir) else . end);
        .hooks | expand_hook_paths
    ' "$hooks_json"
}

merge_statusline_config() {
    local hooks_json="$1"
    local settings_json="$2"
    local statusline_content
    statusline_content=$(jq '.statusLine // null' "$hooks_json")
    if [ "$statusline_content" != "null" ] && [ -n "$statusline_content" ]; then
        local expanded_statusline
        expanded_statusline=$(jq -n --argjson statusline "$statusline_content" --arg dir "$CLAUDE_DIR" '
            $statusline | walk(if type == "string" then gsub("\\$\\{CLAUDE_DIR\\}"; $dir) else . end)
        ')
        jq --argjson sl "$expanded_statusline" '.statusLine = $sl' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[合併] statusLine 設定已自動合併到 settings.json${NC}"
    fi
}

merge_permissions_config() {
    local hooks_json="$1"
    local settings_json="$2"
    local permissions_content
    permissions_content=$(jq '.permissions // null' "$hooks_json")
    if [ "$permissions_content" != "null" ] && [ -n "$permissions_content" ]; then
        local retired_permissions_file="$REPO_DIR/hooks/claude-retired-permission-allow.json"
        local retired_permissions_allow
        if [ -f "$retired_permissions_file" ]; then
            retired_permissions_allow=$(jq '.' "$retired_permissions_file")
        else
            retired_permissions_allow='[]'
        fi
        jq --argjson new_perms "$permissions_content" --argjson retired_allow "$retired_permissions_allow" '
            .permissions.defaultMode = ($new_perms.defaultMode // .permissions.defaultMode // "default") |
            .permissions.allow = (((.permissions.allow // []) - $retired_allow) + ($new_perms.allow // []) | unique) |
            .permissions.deny = ((.permissions.deny // []) + ($new_perms.deny // []) | unique)
        ' "$settings_json" > "${settings_json}.tmp" \
            && mv "${settings_json}.tmp" "$settings_json"
        echo -e "  ${GREEN}[合併] Permissions 設定已自動合併到 settings.json${NC}"
    fi
}

install_hooks() {
    link_component "$REPO_DIR/hooks/scripts" "$CLAUDE_DIR/hooks/scripts" "Hook Scripts"
    link_component "$REPO_DIR/hooks/statusline-command.sh" "$CLAUDE_DIR/statusline-command.sh" "Status Line Script"
    echo ""
    merge_hooks_config
}

install_style_gate() {
    if [ ! -d "$GIT_HOOKS_DIR" ]; then
        echo -e "  ${YELLOW}[跳過] Git style gate — 來源不存在${NC}"
        return
    fi
    if ! command -v git >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[跳過] Git style gate — git 不可用${NC}"
        return
    fi

    chmod +x "$GIT_HOOKS_DIR/pre-commit" "$GIT_HOOKS_DIR/commit-msg" 2>/dev/null || true

    local current_hooks_path
    current_hooks_path="$(git config --global --get core.hooksPath 2>/dev/null || true)"
    if [ -n "$current_hooks_path" ] && ! paths_equivalent "$current_hooks_path" "$GIT_HOOKS_DIR"; then
        echo -e "  ${YELLOW}[保留] global core.hooksPath 已設定為 $current_hooks_path${NC}"
        echo -e "  ${CYAN}  若要啟用 goldband style gate，請先確認既有 hook 後手動設定:${NC}"
        echo -e "  ${CYAN}  git config --global core.hooksPath \"$GIT_HOOKS_DIR\"${NC}"
        return
    fi

    git config --global core.hooksPath "$GIT_HOOKS_DIR"
    echo -e "  ${GREEN}[安裝] Git style gate -> global core.hooksPath=$GIT_HOOKS_DIR${NC}"
    install_goldband_project_style_gate
}

install_goldband_project_style_gate() {
    local project_gate="$REPO_DIR/scripts/check-goldband-project-style-gate.mjs"
    if [ ! -f "$project_gate" ]; then
        return
    fi

    local common_dir
    common_dir="$(git -C "$REPO_DIR" rev-parse --git-common-dir 2>/dev/null || true)"
    if [ -z "$common_dir" ]; then
        return
    fi
    case "$common_dir" in
        /*) ;;
        *) common_dir="$REPO_DIR/$common_dir" ;;
    esac

    local hook_path="$common_dir/hooks/pre-commit"
    local marker="scripts/check-goldband-project-style-gate.mjs --staged"
    if [ -f "$hook_path" ] && grep -q "$marker" "$hook_path"; then
        chmod +x "$hook_path" 2>/dev/null || true
        echo -e "  ${GREEN}[已安裝] goldband repo project style gate${NC}"
        return
    fi
    if [ -e "$hook_path" ] || [ -L "$hook_path" ]; then
        backup_existing_path "$hook_path"
    fi

    mkdir -p "$(dirname "$hook_path")"
    local tmp="${hook_path}.tmp.$$"
    {
        echo '#!/usr/bin/env bash'
        echo 'set -euo pipefail'
        echo ''
        echo 'node scripts/check-goldband-project-style-gate.mjs --staged'
    } > "$tmp"
    mv -f "$tmp" "$hook_path"
    chmod +x "$hook_path"
    echo -e "  ${GREEN}[安裝] goldband repo project style gate -> $hook_path${NC}"
}

install_unity() {
    local project_dir
    project_dir="$(pwd)"
    if [ ! -d "Assets" ]; then
        echo -e "${YELLOW}警告：當前目錄不像是 Unity 專案（沒有 Assets 資料夾）${NC}"
        read -p "是否繼續？(y/n): " cont
        if [ "$cont" != "y" ]; then
            echo -e "${RED}安裝取消${NC}"
            return
        fi
    fi
    mkdir -p "$project_dir/.claude"
    link_component "$REPO_DIR/skills/projects/unity" "$project_dir/.claude/skills" "Unity Skills (10 個)"
}

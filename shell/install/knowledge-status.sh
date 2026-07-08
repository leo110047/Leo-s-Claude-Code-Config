# This file must be sourced by bash, not executed directly.

show_knowledge_system_status() {
    local workflow_claude_dir="$1"
    local workflow_codex_dir="$2"
    show_knowledge_runtime_status "Claude" "$workflow_claude_dir"
    show_knowledge_runtime_status "Codex" "$workflow_codex_dir"
    show_prior_knowledge_status "Claude" "$workflow_claude_dir"
    show_prior_knowledge_status "Codex" "$workflow_codex_dir"
    show_mcp_knowledge_query_status
}

show_knowledge_runtime_status() {
    local label="$1"
    local runtime_dir="$2"
    local knowledge_bin="$runtime_dir/bin/goldband-knowledge"
    local review_bin="$runtime_dir/bin/goldband-knowledge-review"
    if [ -x "$knowledge_bin" ] && [ -x "$review_bin" ]; then
        echo -e "  ${GREEN}[OK]${NC} Knowledge $label CLI + candidate review"
    elif [ -x "$knowledge_bin" ]; then
        echo -e "  ${YELLOW}[部分]${NC} Knowledge $label CLI installed; candidate review missing"
    else
        echo -e "  ${YELLOW}[未安裝]${NC} Knowledge $label CLI"
    fi
}

show_prior_knowledge_status() {
    local label="$1"
    local runtime_dir="$2"
    if knowledge_runtime_contains "$runtime_dir" "Prior Knowledge" && \
       knowledge_runtime_contains "$runtime_dir" "goldband-knowledge search"; then
        echo -e "  ${GREEN}[OK]${NC} Knowledge $label workflow recall ({{PRIOR_KNOWLEDGE}})"
    else
        echo -e "  ${YELLOW}[未完整]${NC} Knowledge $label workflow recall not detected"
    fi
}

knowledge_runtime_contains() {
    local runtime_dir="$1"
    local needle="$2"
    local paths=()
    local path file
    [ -d "$runtime_dir" ] || return 1
    [ -e "$runtime_dir/review" ] && paths+=("$runtime_dir/review")
    [ -e "$runtime_dir/qa" ] && paths+=("$runtime_dir/qa")
    [ -e "$runtime_dir/workflows" ] && paths+=("$runtime_dir/workflows")
    [ "${#paths[@]}" -gt 0 ] || return 1
    for path in "${paths[@]}"; do
        if [ -f "$path" ] && grep -q "$needle" "$path" 2>/dev/null; then
            return 0
        fi
        if [ -d "$path" ]; then
            while IFS= read -r file; do
                grep -q "$needle" "$file" 2>/dev/null && return 0
            done < <(find -L "$path" -type f -name '*.md' 2>/dev/null)
        fi
    done
    return 1
}

show_mcp_knowledge_query_status() {
    if grep -q "knowledge-query" "$REPO_DIR/mcp/server/src/server.ts" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Knowledge MCP tool available in repo (enablement is host-specific)"
    else
        echo -e "  ${YELLOW}[未完整]${NC} Knowledge MCP tool not found in repo"
    fi
}

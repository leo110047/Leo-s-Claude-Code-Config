# This file must be sourced by bash, not executed directly.

show_knowledge_system_status() {
    local workflow_claude_dir="$1"
    local workflow_codex_dir="$2"
    show_knowledge_runtime_status "Claude" "$workflow_claude_dir"
    show_knowledge_runtime_status "Codex" "$workflow_codex_dir"
    show_knowledge_recall_status "Claude" "$workflow_claude_dir"
    show_knowledge_recall_status "Codex" "$workflow_codex_dir"
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

show_knowledge_recall_status() {
    local label="$1"
    local runtime_dir="$2"
    local knowledge_bin="$runtime_dir/bin/goldband-knowledge"
    local recall_contract="$runtime_dir/workflows/knowledge/recall.workflow.md"
    if [ -x "$knowledge_bin" ] && [ -f "$recall_contract" ] && \
       grep -Fqx '# $goldband knowledge recall' "$recall_contract" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Knowledge $label workflow recall (knowledge/recall)"
    else
        echo -e "  ${YELLOW}[未完整]${NC} Knowledge $label workflow recall not detected"
    fi
}

show_mcp_knowledge_query_status() {
    if grep -q "knowledge-query" "$REPO_DIR/mcp/server/src/server.ts" 2>/dev/null; then
        echo -e "  ${GREEN}[OK]${NC} Knowledge MCP tool available in repo (enablement is host-specific)"
    else
        echo -e "  ${YELLOW}[未完整]${NC} Knowledge MCP tool not found in repo"
    fi
}

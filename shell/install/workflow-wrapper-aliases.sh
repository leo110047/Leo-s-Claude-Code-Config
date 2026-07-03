#!/usr/bin/env bash

create_goldband_workflow_aliases() {
    local claude_runtime_root="$HOME/.claude/skills/workflow"
    local codex_skills_root="$HOME/.codex/skills"
    local goldband_language="zh-TW"
    local workflow_config_bin
    local alias_name
    local claude_target
    local codex_target
    local _description
    local _description_en

    if workflow_config_bin="$(find_workflow_config_bin 2>/dev/null)"; then
        goldband_language="$(read_goldband_wrapper_language "$workflow_config_bin")"
    fi

    while IFS='|' read -r alias_name claude_target codex_target _description _description_en; do
        create_goldband_claude_workflow_alias \
            "$claude_runtime_root" "$alias_name" "$claude_target" "$goldband_language"
        create_goldband_codex_workflow_alias \
            "$codex_skills_root" "$alias_name" "$codex_target" "$goldband_language"
    done < <(workflow_wrapper_manifest)
}

create_goldband_claude_workflow_alias() {
    local runtime_root="$1"
    local alias_name="$2"
    local target_name="$3"
    local goldband_language="$4"
    local alias_path="$HOME/.claude/skills/$alias_name"
    local source_skill="$runtime_root/$target_name/SKILL.md"

    [ -d "$runtime_root" ] || return 0
    [ -n "$target_name" ] || return 0
    [ -f "$source_skill" ] || return 0

    write_goldband_wrapper_skill "$source_skill" "$alias_path" "$target_name" "$alias_name"
    finalize_goldband_workflow_alias "$alias_path/SKILL.md" "$alias_name" "$goldband_language"
    install_goldband_review_runtime_assets \
        "$alias_name" \
        "$alias_path" \
        "$runtime_root/review" \
        "\$HOME/.claude/skills/$alias_name/review"
}

create_goldband_codex_workflow_alias() {
    local skills_root="$1"
    local alias_name="$2"
    local target_name="$3"
    local goldband_language="$4"
    local source_name="${target_name#workflow-}"
    local alias_path="$skills_root/$alias_name"
    local source_skill="$skills_root/$target_name/SKILL.md"

    [ -d "$skills_root" ] || return 0
    [ -n "$target_name" ] || return 0
    [ -f "$source_skill" ] || return 0

    write_goldband_wrapper_skill "$source_skill" "$alias_path" "$source_name" "$alias_name"
    finalize_goldband_workflow_alias "$alias_path/SKILL.md" "$alias_name" "$goldband_language"
    install_goldband_review_runtime_assets \
        "$alias_name" \
        "$alias_path" \
        "$skills_root/workflow/review" \
        "\$HOME/.codex/skills/$alias_name/review"
}

finalize_goldband_workflow_alias() {
    local skill_file="$1"
    local alias_name="$2"
    local goldband_language="$3"

    localize_goldband_wrapper_description "$skill_file" "$alias_name" "$goldband_language"
    inject_goldband_wrapper_language_runtime "$skill_file"
    localize_goldband_wrapper_language_policy "$skill_file"
    # Runtime path rewrite must run first; the hardener guards the normalized
    # `.agents/skills/workflow` form, not the legacy gstack spelling.
    rewrite_goldband_wrapper_runtime_paths "$skill_file"
    harden_goldband_wrapper_repo_runtime_detection "$skill_file"
}

harden_goldband_wrapper_repo_runtime_detection() {
    local skill_file="$1"
    local tmp_file

    [ -f "$skill_file" ] || return 0
    tmp_file="$(mktemp)"

    if ! awk '
        function hardened_runtime_line(variable_name) {
            print "[ -n \"$_ROOT\" ] && { [ -x \"$_ROOT/.agents/skills/workflow/bin/gstack-config\" ] || [ -x \"$_ROOT/.agents/skills/workflow/bin/workflow-config\" ]; } && " variable_name "=\"$_ROOT/.agents/skills/workflow\""
        }
        /^[[:space:]]*#/ {
            print
            next
        }
        /\.agents\/skills\/workflow/ && /\$_ROOT/ && /(^|[^[:alnum:]_])(GSTACK_ROOT|WORKFLOW_ROOT)=/ {
            if (/\.agents\/skills\/workflow\/bin\/(gstack-config|workflow-config)/) {
                print
                next
            }
            if (/\[[[:space:]]+-d[[:space:]]+"?\$_ROOT\/\.agents\/skills\/workflow"?[[:space:]]*\]/) {
                if (/GSTACK_ROOT=/) {
                    hardened_runtime_line("GSTACK_ROOT")
                    next
                }
                if (/WORKFLOW_ROOT=/) {
                    hardened_runtime_line("WORKFLOW_ROOT")
                    next
                }
            }
            failed = 1
        }
        { print }
        END { exit failed ? 2 : 0 }
    ' "$skill_file" > "$tmp_file"; then
        rm -f "$tmp_file"
        echo "failed to harden workflow runtime detection in $skill_file" >&2
        return 1
    fi

    mv "$tmp_file" "$skill_file"
}

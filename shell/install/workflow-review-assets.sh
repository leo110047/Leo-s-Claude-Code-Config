#!/usr/bin/env bash

install_goldband_review_runtime_assets() {
    local alias_name="$1"
    local alias_path="$2"
    local source_review_dir="$3"
    local visible_review_dir="$4"

    [ "$alias_name" = "goldband-review" ] || return 0
    [ -d "$source_review_dir" ] || return 0

    rm -rf "$alias_path/review"
    ln -snf "$source_review_dir" "$alias_path/review"
    rewrite_goldband_review_asset_paths "$alias_path/SKILL.md" "$visible_review_dir"
}

rewrite_goldband_review_asset_paths() {
    local skill_file="$1"
    local visible_review_dir="$2"
    local tmp_file

    [ -f "$skill_file" ] || return 0
    tmp_file="$(mktemp)"
    sed \
        -e "s|\\.claude/skills/review|$visible_review_dir|g" \
        -e "s|~/.claude/skills/workflow/review|$visible_review_dir|g" \
        -e "s|~/.claude/skills/gstack/review|$visible_review_dir|g" \
        -e "s|\\.agents/skills/workflow/review|$visible_review_dir|g" \
        -e "s|\\.agents/skills/gstack/review|$visible_review_dir|g" \
        -e "s|\\\$HOME/.codex/skills/workflow/review|$visible_review_dir|g" \
        -e "s|~/.codex/skills/workflow/review|$visible_review_dir|g" \
        "$skill_file" > "$tmp_file"
    mv "$tmp_file" "$skill_file"
}

create_repo_workflow_review_sidecar() {
    local repo_dir="$1"
    local sidecar_dir="$REPO_DIR/.agents/skills/workflow/review"

    [ -d "$repo_dir/review" ] || return 0
    mkdir -p "$sidecar_dir"

    link_workflow_review_asset "$repo_dir" "$sidecar_dir" "checklist.md"
    link_workflow_review_asset "$repo_dir" "$sidecar_dir" "design-checklist.md"
    link_workflow_review_asset "$repo_dir" "$sidecar_dir" "greptile-triage.md"
    link_workflow_review_asset "$repo_dir" "$sidecar_dir" "TODOS-format.md"

    if [ -d "$repo_dir/review/specialists" ]; then
        ln -snf \
            "$(workflow_review_asset_link_target "$repo_dir" "specialists")" \
            "$sidecar_dir/specialists"
    fi
}

link_workflow_review_asset() {
    local repo_dir="$1"
    local sidecar_dir="$2"
    local asset="$3"
    local target

    [ -f "$repo_dir/review/$asset" ] || return 0
    target="$(workflow_review_asset_link_target "$repo_dir" "$asset")"
    ln -snf "$target" "$sidecar_dir/$asset"
}

workflow_review_asset_link_target() {
    local repo_dir="$1"
    local asset="$2"

    if workflow_review_same_dir "$repo_dir" "$REPO_DIR/vendor/workflow"; then
        printf '../../../../vendor/workflow/review/%s\n' "$asset"
        return 0
    fi

    printf '%s/review/%s\n' "$repo_dir" "$asset"
}

workflow_review_same_dir() {
    local left="$1"
    local right="$2"
    local left_physical
    local right_physical

    left_physical="$(cd "$left" 2>/dev/null && pwd -P)" || return 1
    right_physical="$(cd "$right" 2>/dev/null && pwd -P)" || return 1
    [ "$left_physical" = "$right_physical" ]
}

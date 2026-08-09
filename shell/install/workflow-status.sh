# This file must be sourced by bash, not executed directly.

workflow_status_path_under_dir() {
    local candidate="$1"
    local base="$2"
    local candidate_real base_real
    candidate_real="$(cd "$candidate" 2>/dev/null && pwd -P)" || return 1
    base_real="$(cd "$base" 2>/dev/null && pwd -P)" || return 1
    case "$candidate_real" in
        "$base_real"|"$base_real"/*) return 0 ;;
        *) return 1 ;;
    esac
}

workflow_status_symlink_target_under_dir() {
    local candidate="$1"
    local base="$2"
    local link_dest candidate_dir resolved_dir resolved_path base_real
    link_dest="$(readlink "$candidate" 2>/dev/null || true)"
    [ -n "$link_dest" ] || return 1
    case "$link_dest" in
        /*) resolved_path="$link_dest" ;;
        *)
            candidate_dir="$(dirname "$candidate")"
            resolved_path="$candidate_dir/$link_dest"
            ;;
    esac
    resolved_dir="$(dirname "$resolved_path")"
    resolved_path="$(cd "$resolved_dir" 2>/dev/null && pwd -P)/$(basename "$resolved_path")" || return 1
    base_real="$(cd "$base" 2>/dev/null && pwd -P)" || return 1
    case "$resolved_path" in
        "$base_real"|"$base_real"/*) return 0 ;;
        *) return 1 ;;
    esac
}

workflow_generated_root_for_runtime() {
    local runtime_dir="$1"
    local skill_link="$runtime_dir/SKILL.md"
    local link_dest link_dir resolved_path skill_dir

    [ -L "$skill_link" ] || return 1
    link_dest="$(readlink "$skill_link" 2>/dev/null || true)"
    [ -n "$link_dest" ] || return 1
    case "$link_dest" in
        /*) resolved_path="$link_dest" ;;
        *)
            link_dir="$(dirname "$skill_link")"
            resolved_path="$link_dir/$link_dest"
            ;;
    esac
    link_dir="$(dirname "$resolved_path")"
    resolved_path="$(cd "$link_dir" 2>/dev/null && pwd -P)/$(basename "$resolved_path")" || return 1
    skill_dir="$(dirname "$resolved_path")"
    if [ -f "$skill_dir/setup" ] && [ -d "$skill_dir/goldband-upgrade" ]; then
        printf '%s\n' "$skill_dir"
        return 0
    fi
    [ "$(basename "$skill_dir")" = "goldband" ] || return 1
    dirname "$skill_dir"
}

workflow_marker_points_to_root() {
    local entry="$1"
    local runtime_root="$2"
    local generated_root="$3"
    local marker="$entry/.goldband-managed-skill"
    local source_path source_dir

    [ -f "$marker" ] || return 1
    source_path="$(sed -n 's/^source=//p' "$marker" | head -1)"
    [ -n "$source_path" ] || return 1
    if [ -d "$source_path" ]; then
        source_dir="$source_path"
    else
        source_dir="$(dirname "$source_path")"
    fi
    workflow_status_path_under_dir "$source_dir" "$runtime_root" && return 0
    [ -n "$generated_root" ] && workflow_status_path_under_dir "$source_dir" "$generated_root" && return 0
    return 1
}

workflow_skill_file_matches_under_dir() {
    local entry="$1"
    local root="$2"
    local source_skill

    [ -f "$entry/SKILL.md" ] || return 1
    [ -d "$root" ] || return 1

    for source_skill in "$root"/*/SKILL.md; do
        [ -f "$source_skill" ] || continue
        cmp -s "$entry/SKILL.md" "$source_skill" && return 0
    done

    return 1
}

workflow_entry_managed_by_goldband() {
    local entry="$1"
    local runtime_dir="$2"
    local generated_root="$3"
    local runtime_root

    [ -f "$entry/SKILL.md" ] || return 1
    runtime_root="$(cd "$runtime_dir" 2>/dev/null && pwd -P)" || return 1

    workflow_status_path_under_dir "$entry" "$runtime_root" && return 0

    if [ -L "$entry" ]; then
        workflow_status_path_under_dir "$entry" "$runtime_root" && return 0
        [ -n "$generated_root" ] && workflow_status_path_under_dir "$entry" "$generated_root" && return 0
    fi

    if [ -L "$entry/SKILL.md" ]; then
        workflow_status_symlink_target_under_dir "$entry/SKILL.md" "$runtime_root" && return 0
        [ -n "$generated_root" ] && workflow_status_symlink_target_under_dir "$entry/SKILL.md" "$generated_root" && return 0
    fi

    workflow_marker_points_to_root "$entry" "$runtime_root" "$generated_root" && return 0
    workflow_skill_file_matches_under_dir "$entry" "$runtime_root" && return 0
    [ -n "$generated_root" ] && workflow_skill_file_matches_under_dir "$entry" "$generated_root" && return 0
    return 1
}

workflow_exposed_skill_count() {
    local skills_dir="$1"
    local runtime_dir="$2"
    local generated_root="$3"
    local count=0
    local entry
    [ -d "$skills_dir" ] || {
        printf '0\n'
        return 0
    }
    for entry in "$skills_dir"/*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        workflow_entry_managed_by_goldband "$entry" "$runtime_dir" "$generated_root" || continue
        count=$((count + 1))
    done
    printf '%s\n' "$count"
}

workflow_goldband_top_level_count() {
    local skills_dir="$1"
    local runtime_dir="$2"
    local generated_root="$3"
    local count=0
    local entry name
    [ -d "$skills_dir" ] || {
        printf '0\n'
        return 0
    }
    for entry in "$skills_dir"/*; do
        [ -e "$entry" ] || [ -L "$entry" ] || continue
        workflow_entry_managed_by_goldband "$entry" "$runtime_dir" "$generated_root" || continue
        name="$(basename "$entry")"
        case "$name" in
            goldband|_goldband-command|goldband-upgrade) continue ;;
        esac
        count=$((count + 1))
    done
    printf '%s\n' "$count"
}

show_tracker_projection_status() {
    local state_root="${GOLDBAND_HOME:-$HOME/.goldband}"
    local config_file="$state_root/tracker/config.json"
    local summary mode repository cli
    if [ ! -f "$config_file" ]; then
        echo -e "  ${GREEN}[OK]${NC} Work Map tracker mode: off (local-only default)"
        return 0
    fi
    summary="$(node -e '
const fs = require("node:fs");
const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (value.schemaVersion !== 1 || !["off", "github", "gitlab"].includes(value.mode)) process.exit(2);
if (Object.prototype.hasOwnProperty.call(value, "token")) process.exit(3);
process.stdout.write(`${value.mode}\t${value.repository || ""}`);
' "$config_file" 2>/dev/null || true)"
    if [ -z "$summary" ]; then
        echo -e "  ${RED}[invalid]${NC} Work Map tracker configuration"
        GOLDBAND_STATUS_EXIT_CODE=2
        return 0
    fi
    mode="${summary%%$'\t'*}"
    repository="${summary#*$'\t'}"
    if [ "$mode" = "off" ]; then
        echo -e "  ${GREEN}[OK]${NC} Work Map tracker mode: off (local-only)"
        return 0
    fi
    [ "$mode" = "github" ] && cli="gh" || cli="glab"
    if ! command -v "$cli" >/dev/null 2>&1; then
        echo -e "  ${YELLOW}[blocked]${NC} Work Map tracker: $mode ($repository) — $cli CLI unavailable"
        return 0
    fi
    if "$cli" auth status >/dev/null 2>&1; then
        echo -e "  ${GREEN}[OK]${NC} Work Map tracker: $mode ($repository), auth available"
    else
        echo -e "  ${YELLOW}[blocked]${NC} Work Map tracker: $mode ($repository), auth unavailable"
    fi
}

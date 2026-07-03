# This file must be sourced by bash, not executed directly.

# Keep workflow support modules behind this entrypoint so direct callers like
# shell/goldband-install-workflow.sh get the same behavior as install.sh.
# shellcheck source=/dev/null
. "$REPO_DIR/shell/install/workflow-review-assets.sh"
# shellcheck source=/dev/null
. "$REPO_DIR/shell/install/workflow-wrapper-aliases.sh"

resolve_workflow_repo_dir() {
    local candidates=()

    if [ -n "${WORKFLOW_REPO_DIR:-}" ]; then
        candidates+=("$WORKFLOW_REPO_DIR")
    fi

    candidates+=(
        "$REPO_DIR/vendor/workflow"
        "$HOME/.claude/skills/workflow"
        "$HOME/.codex/skills/workflow"
        "$HOME/workflow"
        "$REPO_DIR/../workflow"
    )

    local candidate
    for candidate in "${candidates[@]}"; do
        [ -n "$candidate" ] || continue
        if [ -f "$candidate/setup" ]; then
            local resolved
            resolved="$(cd "$candidate" 2>/dev/null && pwd -P)" || continue
            echo "$resolved"
            return 0
        fi
    done

    return 1
}

read_workflow_version() {
    local repo_dir="$1"
    local version_file
    for version_file in "$repo_dir/VERSION" "$repo_dir/.installed-version"; do
        if [ -f "$version_file" ]; then
            tr -d '\n' < "$version_file"
            return 0
        fi
    done
    return 1
}

find_workflow_config_bin() {
    local candidate
    for candidate in \
        "$HOME/.codex/skills/workflow/bin/gstack-config" \
        "$HOME/.claude/skills/workflow/bin/gstack-config" \
        "$REPO_DIR/vendor/workflow/bin/gstack-config" \
        "$HOME/.codex/skills/workflow/bin/workflow-config" \
        "$HOME/.claude/skills/workflow/bin/workflow-config" \
        "$REPO_DIR/vendor/workflow/bin/workflow-config"
    do
        if [ -x "$candidate" ]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done
    return 1
}

read_goldband_wrapper_language() {
    local workflow_config_bin="$1"
    local language
    language="$("$workflow_config_bin" get goldband_language 2>/dev/null || true)"
    if [ -n "$language" ]; then
        printf '%s\n' "$language"
    else
        printf 'zh-TW\n'
    fi
}

write_goldband_wrapper_skill() {
    local source_skill="$1"
    local dest_dir="$2"
    local source_name="$3"
    local wrapper_name="$4"

    [ -f "$source_skill" ] || return 1

    rm -rf "$dest_dir"
    mkdir -p "$dest_dir"

    awk \
        -v source_name="$source_name" \
        -v wrapper_name="$wrapper_name" \
        '
        BEGIN {
            name_done = 0
            trigger_done = 0
        }
        !name_done && $0 ~ /^name: / {
            print "name: " wrapper_name
            name_done = 1
            next
        }
        !trigger_done {
            old_trigger = "/" source_name "."
            new_trigger = "/" wrapper_name "."
            if (index($0, old_trigger)) {
                sub(old_trigger, new_trigger)
                trigger_done = 1
            }
        }
        { print }
        ' "$source_skill" \
        | sed 's|\${CLAUDE_SKILL_DIR}/\.\./|\${CLAUDE_SKILL_DIR}/../workflow/|g' \
        > "$dest_dir/SKILL.md"
}

rewrite_goldband_wrapper_runtime_paths() {
    local skill_file="$1"
    local tmp_file
    local legacy_runtime_name="g""stack"
    local legacy_claude_root="~/.claude/skills/$legacy_runtime_name"
    local legacy_claude_relative=".claude/skills/$legacy_runtime_name"
    # Keep $HOME escaped here because this function rewrites literal SKILL.md text,
    # not expanded filesystem paths.
    local legacy_codex_root_literal="\$HOME/.codex/skills/$legacy_runtime_name"
    local legacy_codex_home="~/.codex/skills/$legacy_runtime_name"
    local legacy_agents_root=".agents/skills/$legacy_runtime_name"

    [ -f "$skill_file" ] || return 0

    tmp_file="$(mktemp)"
    sed \
        -e "s|$legacy_claude_root|~/.claude/skills/workflow|g" \
        -e "s|$legacy_claude_relative|.claude/skills/workflow|g" \
        -e "s|$legacy_codex_root_literal|\\\$HOME/.codex/skills/workflow|g" \
        -e "s|$legacy_codex_home|~/.codex/skills/workflow|g" \
        -e "s|$legacy_agents_root|.agents/skills/workflow|g" \
        -e "s|~/.gstack|~/.workflow|g" \
        -e "s|\\\$HOME/.gstack|\\\$HOME/.workflow|g" \
        "$skill_file" > "$tmp_file"

    mv "$tmp_file" "$skill_file"
}

workflow_wrapper_manifest() {
    local manifest_file="$REPO_DIR/shell/install/workflow-wrapper-manifest.txt"
    if [ ! -f "$manifest_file" ]; then
        echo "workflow wrapper manifest missing: $manifest_file" >&2
        return 1
    fi
    cat "$manifest_file"
}

goldband_wrapper_description() {
    local wrapper_name="$1"
    local language="${2:-zh-TW}"
    workflow_wrapper_manifest \
        | awk -F'|' -v name="$wrapper_name" -v lang="$language" '
            $1 == name {
                if (lang == "en") {
                    print "  " $5
                } else {
                    print "  " $4
                }
                found = 1
            }
            END { exit(found ? 0 : 1) }
        '
}

localize_goldband_wrapper_description() {
    local skill_file="$1"
    local wrapper_name="$2"
    local language="${3:-zh-TW}"
    local temp_file
    temp_file="$(mktemp)"

    goldband_wrapper_description "$wrapper_name" "$language" > "$temp_file"
    rewrite_goldband_wrapper_description "$skill_file" "$temp_file"
    rm -f "$temp_file"
}

rewrite_goldband_wrapper_description() {
    local skill_file="$1"
    local temp_file="$2"
    awk -v desc_file="$temp_file" '
        BEGIN {
            in_description = 0
            replaced = 0
        }
        replaced == 0 && $0 ~ /^description: [^|].*$/ {
            print "description: |"
            while ((getline line < desc_file) > 0) {
                print line
            }
            close(desc_file)
            replaced = 1
            next
        }
        replaced == 0 && $0 ~ /^description: \|$/ {
            print $0
            in_description = 1
            next
        }
        in_description == 1 {
            if ($0 ~ /^allowed-tools:/ || $0 ~ /^hooks:/ || $0 == "---") {
                while ((getline line < desc_file) > 0) {
                    print line
                }
                close(desc_file)
                print $0
                in_description = 0
                replaced = 1
                next
            }
            next
        }
        { print }
        END {
            if (in_description == 1 && replaced == 0) {
                while ((getline line < desc_file) > 0) {
                    print line
                }
                close(desc_file)
            }
        }
        ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
}

localize_goldband_wrapper_language_policy() {
    local skill_file="$1"

    [ -f "$skill_file" ] || return 0
    if grep -q '^## Goldband Wrapper Language Policy$' "$skill_file"; then
        return 0
    fi

    awk '
        BEGIN {
            frontmatter_markers = 0
            inserted = 0
        }
        {
            print
            if (!inserted && $0 == "---") {
                frontmatter_markers++
                if (frontmatter_markers == 2) {
                    print ""
                    print "## Goldband Wrapper Language Policy"
                    print ""
                    print "- 先讀取 `gstack-config get goldband_language`。支援 `zh-TW` 與 `en`，預設 `zh-TW`。"
                    print "- 若 `GOLDBAND_LANGUAGE` 是 `en`，所有直接顯示給使用者的提問、建議、選項、摘要，一律使用英文。"
                    print "- 否則所有直接顯示給使用者的提問、建議、選項、摘要，一律使用繁體中文。"
                    print "- 保留英文只用於 code、identifiers、commands、paths、env vars、filenames、以及精確 error strings。"
                    print "- 若繼承的 workflow 指令範本、AskUserQuestion 結構或內文示例和目前選擇語言不同，實際輸出前先翻成目前選擇的語言，不要直接把另一種語言的模板顯示給使用者。"
                    inserted = 1
                }
            }
        }
        END {
            if (!inserted) {
                print ""
                print "## Goldband Wrapper Language Policy"
                print ""
                print "- 先讀取 `gstack-config get goldband_language`。支援 `zh-TW` 與 `en`，預設 `zh-TW`。"
                print "- 若 `GOLDBAND_LANGUAGE` 是 `en`，所有直接顯示給使用者的提問、建議、選項、摘要，一律使用英文。"
                print "- 否則所有直接顯示給使用者的提問、建議、選項、摘要，一律使用繁體中文。"
                print "- 保留英文只用於 code、identifiers、commands、paths、env vars、filenames、以及精確 error strings。"
                print "- 若繼承的 workflow 指令範本、AskUserQuestion 結構或內文示例和目前選擇語言不同，實際輸出前先翻成目前選擇的語言，不要直接把另一種語言的模板顯示給使用者。"
            }
        }
    ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
}

inject_goldband_wrapper_language_runtime() {
    local skill_file="$1"

    [ -f "$skill_file" ] || return 0
    if grep -q '^_GOLDBAND_LANGUAGE=' "$skill_file"; then
        return 0
    fi

    awk '
        BEGIN { inserted = 0 }
        {
            print
            if (!inserted && $0 ~ /^_PROACTIVE=.*(workflow-config|gstack-config) get proactive/) {
                print "_GOLDBAND_CONFIG_BIN=\"$HOME/.codex/skills/workflow/bin/gstack-config\""
                print "[ -x \"$_GOLDBAND_CONFIG_BIN\" ] || _GOLDBAND_CONFIG_BIN=\"$HOME/.claude/skills/workflow/bin/gstack-config\""
                print "[ -x \"$_GOLDBAND_CONFIG_BIN\" ] || _GOLDBAND_CONFIG_BIN=\"$HOME/.codex/skills/workflow/bin/workflow-config\""
                print "[ -x \"$_GOLDBAND_CONFIG_BIN\" ] || _GOLDBAND_CONFIG_BIN=\"$HOME/.claude/skills/workflow/bin/workflow-config\""
                print "_GOLDBAND_LANGUAGE=$(\"$_GOLDBAND_CONFIG_BIN\" get goldband_language 2>/dev/null || echo \"zh-TW\")"
                print "[ -n \"$_GOLDBAND_LANGUAGE\" ] || _GOLDBAND_LANGUAGE=\"zh-TW\""
                print "echo \"GOLDBAND_LANGUAGE: $_GOLDBAND_LANGUAGE\""
                inserted = 1
            }
        }
    ' "$skill_file" > "${skill_file}.tmp"

    mv "${skill_file}.tmp" "$skill_file"
}

hide_workflow_root_skill() {
    local runtime_root="$1"
    local source_root
    local entry
    local base

    [ -e "$runtime_root" ] || return 0

    if [ -L "$runtime_root" ]; then
        source_root="$(readlink "$runtime_root")"
        [ -n "$source_root" ] || return 1

        rm -rf "$runtime_root"
        mkdir -p "$runtime_root"

        for entry in "$source_root"/.* "$source_root"/*; do
            [ -e "$entry" ] || continue
            base="${entry##*/}"
            [ "$base" = "." ] || [ "$base" = ".." ] && continue
            [ "$base" = "SKILL.md" ] && continue
            ln -snf "$entry" "$runtime_root/$base"
        done
        return 0
    fi

    rm -f "$runtime_root/SKILL.md"
}

hide_workflow_root_skills() {
    local host="$1"

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        hide_workflow_root_skill "$HOME/.claude/skills/workflow"
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        hide_workflow_root_skill "$HOME/.codex/skills/workflow"
    fi
}

write_workflow_installed_versions() {
    local host="$1"
    local version="$2"
    local runtime_root

    [ -n "$version" ] || return 0

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.claude/skills/workflow"
        [ -d "$runtime_root" ] && printf '%s\n' "$version" > "$runtime_root/.installed-version"
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        runtime_root="$HOME/.codex/skills/workflow"
        [ -d "$runtime_root" ] && printf '%s\n' "$version" > "$runtime_root/.installed-version"
    fi
}

cleanup_workflow_user_entries() {
    local claude_skills_dir="$HOME/.claude/skills"
    local codex_skills_dir="$HOME/.codex/skills"
    local legacy_runtime_name="g""stack"
    local legacy_upgrade_name="${legacy_runtime_name}-upgrade"
    local legacy_goldband_upgrade_name="goldband-${legacy_runtime_name}-upgrade"
    local alias_name
    local claude_target
    local codex_target
    local _description
    local claude_cleanup=()
    local codex_cleanup=()

    while IFS='|' read -r alias_name claude_target codex_target _description; do
        [ -n "$claude_target" ] && claude_cleanup+=("$claude_target")
        [ -n "$codex_target" ] && codex_cleanup+=("$codex_target")
    done < <(workflow_wrapper_manifest)

    claude_cleanup+=("goldband-upgrade" "$legacy_upgrade_name" "$legacy_goldband_upgrade_name" "$legacy_runtime_name" "${legacy_runtime_name}.bak")
    codex_cleanup+=("goldband-upgrade" "$legacy_goldband_upgrade_name" "$legacy_runtime_name")

    local entry
    for entry in "${claude_cleanup[@]}"; do
        [ -n "$entry" ] || continue
        rm -rf "$claude_skills_dir/$entry"
    done
    for entry in "${codex_cleanup[@]}"; do
        [ -n "$entry" ] || continue
        rm -rf "$codex_skills_dir/$entry"
    done

    for entry in "$claude_skills_dir"/workflow.bak* "$codex_skills_dir"/workflow.bak*; do
        [ -e "$entry" ] || continue
        rm -rf "$entry"
    done
}

normalize_workflow_runtime_install() {
    local host="$1"
    local legacy_runtime_name="g""stack"

    if [ "$host" = "claude" ] || [ "$host" = "auto" ]; then
        local legacy_claude_root="$HOME/.claude/skills/$legacy_runtime_name"
        local workflow_claude_root="$HOME/.claude/skills/workflow"

        if [ -e "$legacy_claude_root" ]; then
            rm -rf "$workflow_claude_root"
            mv "$legacy_claude_root" "$workflow_claude_root"
        fi
    fi

    if [ "$host" = "codex" ] || [ "$host" = "auto" ]; then
        local legacy_codex_root="$HOME/.codex/skills/$legacy_runtime_name"
        local workflow_codex_root="$HOME/.codex/skills/workflow"
        local legacy_skill
        local workflow_skill
        local legacy_prefix="${legacy_runtime_name}-"

        if [ -e "$legacy_codex_root" ]; then
            rm -rf "$workflow_codex_root"
            mv "$legacy_codex_root" "$workflow_codex_root"
        fi

        for legacy_skill in "$HOME/.codex/skills"/"$legacy_prefix"*; do
            [ -e "$legacy_skill" ] || continue
            workflow_skill="$HOME/.codex/skills/workflow-${legacy_skill##*/$legacy_prefix}"
            rm -rf "$workflow_skill"
            mv "$legacy_skill" "$workflow_skill"
        done
    fi
}

install_workflow_host() {
    local host="$1"
    local repo_dir
    local setup_status=0
    local mutation_snapshot=""

    if ! repo_dir="$(resolve_workflow_repo_dir)"; then
        echo -e "${RED}找不到 workflow runtime。${NC}"
        echo -e "  可設定 ${CYAN}WORKFLOW_REPO_DIR=/path/to/runtime${NC} 後重試"
        echo -e "  預設會先找 repo 內建的 ${CYAN}$REPO_DIR/vendor/workflow${NC}"
        exit 1
    fi

    local version="unknown"
    version="$(read_workflow_version "$repo_dir" 2>/dev/null || echo "unknown")"
    mkdir -p "$HOME/.workflow/projects"
    echo -e "${GREEN}安裝 workflow runtime (${host})...${NC}"
    echo -e "  repo: ${CYAN}$repo_dir${NC}"
    echo -e "  version: ${CYAN}$version${NC}"
    echo ""
    mutation_snapshot="$(create_workflow_vendor_mutation_snapshot "$repo_dir")"
    run_workflow_setup "$repo_dir" "$host" || setup_status="$?"
    restore_workflow_vendor_mutation_snapshot "$repo_dir" "$mutation_snapshot"
    if [ "$setup_status" -ne 0 ]; then
        exit "$setup_status"
    fi
    normalize_workflow_runtime_install "$host"
    create_repo_workflow_review_sidecar "$repo_dir"
    create_goldband_workflow_aliases
    cleanup_workflow_user_entries
    hide_workflow_root_skills "$host"
    write_workflow_installed_versions "$host" "$version"
}

create_workflow_vendor_mutation_snapshot() {
    local repo_dir="$1"
    local snapshot_dir
    local manifest
    local rel

    if ! workflow_review_same_dir "$repo_dir" "$REPO_DIR/vendor/workflow"; then
        return 0
    fi

    snapshot_dir="$(mktemp -d)"
    manifest="$snapshot_dir/manifest"
    (
        cd "$repo_dir" || exit 1
        find . -name SKILL.md -type f -print
        if [ -f ./gstack/llms.txt ]; then
            printf '%s\n' './gstack/llms.txt'
        fi
    ) > "$manifest"

    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        mkdir -p "$snapshot_dir/files/$(dirname "$rel")"
        cp "$repo_dir/$rel" "$snapshot_dir/files/$rel"
    done < "$manifest"

    printf '%s\n' "$snapshot_dir"
}

restore_workflow_vendor_mutation_snapshot() {
    local repo_dir="$1"
    local snapshot_dir="$2"
    local manifest
    local current_manifest
    local rel

    [ -n "$snapshot_dir" ] || return 0
    manifest="$snapshot_dir/manifest"
    [ -f "$manifest" ] || return 0

    current_manifest="$snapshot_dir/current-manifest"
    (
        cd "$repo_dir" || exit 1
        find . -name SKILL.md -type f -print
        if [ -f ./gstack/llms.txt ]; then
            printf '%s\n' './gstack/llms.txt'
        fi
    ) > "$current_manifest"

    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        if ! grep -Fxq "$rel" "$manifest"; then
            rm -f "$repo_dir/$rel"
        fi
    done < "$current_manifest"

    while IFS= read -r rel; do
        [ -n "$rel" ] || continue
        if [ -f "$snapshot_dir/files/$rel" ]; then
            cp "$snapshot_dir/files/$rel" "$repo_dir/$rel"
        fi
    done < "$manifest"

    rm -rf "$snapshot_dir"
}

run_workflow_setup() {
    local repo_dir="$1"
    local host="$2"
    local setup_status
    local errexit_was_set=0
    local legacy_runtime_name="g""stack"

    case "$-" in
        *e*) errexit_was_set=1 ;;
    esac
    set +e
    (
        cd "$repo_dir" || {
            echo "  [錯誤] 無法進入 workflow runtime: $repo_dir"
            exit 1
        }
        # goldband exposes workflow through goldband-* wrappers and removes the
        # native workflow entries after setup. Avoid upstream prefix mode here:
        # it mutates source SKILL.md frontmatter via gstack-patch-names, which
        # dirties the bundled vendor/workflow checkout during install.
        GSTACK_HOME="$HOME/.workflow" ./setup --host "$host" --no-prefix --quiet 2>&1
    ) | awk -v legacy="$legacy_runtime_name" '{
        gsub(legacy, "workflow")
        print
        fflush()
    }'
    setup_status=${PIPESTATUS[0]}
    if [ "$errexit_was_set" -eq 1 ]; then
        set -e
    else
        set +e
    fi
    return "$setup_status"
}

create_minimal_real_setup_fixture() {
  local loop_dir="$1"
  mkdir -p "$loop_dir/bin" "$loop_dir/browse/dist" "$loop_dir/generated" "$loop_dir/lib" "$loop_dir/review" "$loop_dir/workflows" "$loop_dir/scripts"
  cp "$ROOT_DIR/goldband-loop/setup" "$loop_dir/setup"
  cp "$ROOT_DIR/goldband-loop/lib/retired-workflow-entry-names.txt" "$loop_dir/lib/retired-workflow-entry-names.txt"
  cp "$ROOT_DIR/goldband-loop/lib/state-root.ts" "$loop_dir/lib/state-root.ts"
  cp "$ROOT_DIR/goldband-loop/lib/verification-receipt.ts" "$loop_dir/lib/verification-receipt.ts"
  cp "$ROOT_DIR/goldband-loop/bin/goldband-work-verify" "$loop_dir/bin/goldband-work-verify"
  cp "$ROOT_DIR/goldband-loop/bin/goldband-work-verify.ts" "$loop_dir/bin/goldband-work-verify.ts"
  chmod +x "$loop_dir/bin/goldband-work-verify" "$loop_dir/bin/goldband-work-verify.ts"
  local runtime_file
  for runtime_file in work-map-cli.ts work-map.ts work-map-store.ts work-map-runtime.ts types.ts; do
    cp "$ROOT_DIR/goldband-loop/workflows/$runtime_file" "$loop_dir/workflows/$runtime_file"
  done
  cp -R "$ROOT_DIR/goldband-loop/generated/host-skills" "$loop_dir/generated/host-skills"
  local host
  for host in claude codex factory opencode kiro; do
    printf '\n<!-- fixture host selector: %s -->\n' "$host" >> "$loop_dir/generated/host-skills/$host.SKILL.md"
  done
  chmod +x "$loop_dir/setup"
  write_fake_config_bin "$loop_dir"
  write_noop_runtime_bin "$loop_dir" "goldband-task-emission"
  cat > "$loop_dir/browse/dist/browse" <<'EOF_BROWSE'
#!/usr/bin/env bash
exit 0
EOF_BROWSE
  chmod +x "$loop_dir/browse/dist/browse"
  printf '%s\n' '{"engines":{"bun":">=1.3.11"}}' > "$loop_dir/package.json"
  printf '0.0.0-test\n' > "$loop_dir/VERSION"
  write_skill "$loop_dir" "goldband"
  write_skill "$loop_dir/browse" "goldband-browse"
  write_skill "$loop_dir/review" "goldband-review"
  write_skill "$loop_dir/qa" "goldband-qa"
  write_skill "$loop_dir/ship" "goldband-ship"
  write_skill "$loop_dir/goldband-upgrade" "goldband-upgrade"
  write_skill "$loop_dir/.agents/skills/goldband" "goldband"
  write_skill "$loop_dir/.agents/skills/goldband-review" "goldband-review"
  printf '%s\n' 'runtime: $HOME/.codex/skills/goldband' >> "$loop_dir/.agents/skills/goldband-review/SKILL.md"
  write_skill "$loop_dir/.agents/skills/goldband-qa" "goldband-qa"
  write_skill "$loop_dir/.agents/skills/goldband-upgrade" "goldband-upgrade"
  write_skill "$loop_dir/.factory/skills/goldband" "goldband"
  write_skill "$loop_dir/.factory/skills/goldband-review" "goldband-review"
  write_skill "$loop_dir/.opencode/skills/goldband" "goldband"
  write_skill "$loop_dir/.opencode/skills/goldband-review" "goldband-review"
  printf '%s\n' '{"schemaVersion":1,"interface":"$goldband <capability> <action>","manuals":[],"actions":[{"capability":"review","action":"code","contractPath":"generated/workflow-contracts/review/code.workflow.md"}]}' > "$loop_dir/generated/capability-actions.json"
  mkdir -p "$loop_dir/generated/workflow-contracts/review"
  printf '%b' '# $goldband review code\n\n## Goal\n\nReview a code diff.\n\n## Relevant context\n\n- Use current repository evidence.\n\n## Hard boundaries\n\n- Review only.\n\n## Verification\n\n- Verify every finding.\n' > "$loop_dir/generated/workflow-contracts/review/code.workflow.md"
  write_minimal_review_assets "$loop_dir"
}

write_minimal_review_assets() {
  local loop_dir="$1"
  cat > "$loop_dir/review/checklist.md" <<'EOF_CHECKLIST'
# test checklist
EOF_CHECKLIST
  cat > "$loop_dir/review/shared-rubric.md" <<'EOF_SHARED'
# test shared rubric
EOF_SHARED
  cat > "$loop_dir/review/findings-schema.md" <<'EOF_SCHEMA'
# test findings schema
EOF_SCHEMA
  cat > "$loop_dir/review/design-checklist.md" <<'EOF_DESIGN'
# test design checklist
EOF_DESIGN
  cat > "$loop_dir/review/greptile-triage.md" <<'EOF_GREPTILE'
# test greptile triage
EOF_GREPTILE
  cat > "$loop_dir/review/TODOS-format.md" <<'EOF_TODOS'
# test todos format
EOF_TODOS
}

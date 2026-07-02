function printHuman(summary) {
  printHeader(summary);
  printCheckSection('JSON', summary.jsonChecks);
  printCheckSection('TOML', summary.tomlChecks);
  printCheckSection('Repo Files', summary.requiredFileChecks);
  printCodexChecks(summary);
  printWorkflow(summary);
  printShellLaunchers(summary);
  printWarnings(summary);
  printReplay(summary);
  printErrors(summary);
}

function printHeader(summary) {
  console.log('goldband Config Verification');
  console.log('============================');
  console.log(`Overall: ${summary.ok ? 'PASS' : 'FAIL'}`);
  console.log(`Skills:  ${summary.skillCount}`);
  console.log(`Hooks:   ${hookSummary(summary)}`);
  printCodexSummary(summary);
  printWorkflowSummary(summary);
  console.log(`Shell:   ${shellSummary(summary)}`);
}

function hookSummary(summary) {
  return summary.hookCheck.ok
    ? `OK (${summary.hookCheck.checked} refs)`
    : 'FAIL';
}

function printCodexSummary(summary) {
  if (summary.codexRuleChecks.length === 0) return;
  const passed = summary.codexRuleChecks.filter((item) => item.ok).length;
  console.log(
    `Codex:   ${passed}/${summary.codexRuleChecks.length} execpolicy checks passed`,
  );
}

function printWorkflowSummary(summary) {
  if (
    !summary.workflowInstall.claudeInstalled &&
    !summary.workflowInstall.codexInstalled
  ) {
    return;
  }
  console.log(
    `workflow:  Claude=${yesNo(summary.workflowInstall.claudeInstalled)} Codex=${yesNo(summary.workflowInstall.codexInstalled)} State=${yesNo(summary.workflowInstall.stateInstalled)}`,
  );
}

function shellSummary(summary) {
  return `${summary.shellLaunchers.installed ? 'OK' : 'FAIL'} (POSIX=${yesNo(summary.shellLaunchers.shellInstalled)} PowerShell=${yesNo(summary.shellLaunchers.powershellInstalled)})`;
}

function yesNo(value) {
  return value ? 'yes' : 'no';
}

function printCheckSection(title, checks) {
  console.log('');
  console.log(`${title}:`);
  for (const item of checks) {
    console.log(
      `  [${item.ok ? 'OK' : 'FAIL'}] ${item.file} — ${item.message}`,
    );
  }
}

function printCodexChecks(summary) {
  if (summary.codexRuleChecks.length > 0) {
    console.log('');
    console.log('Codex Execpolicy:');
    for (const item of summary.codexRuleChecks) {
      console.log(
        `  [${item.ok ? 'OK' : 'FAIL'}] ${item.label} — ${item.message}`,
      );
    }
  }
}

function printWorkflow(summary) {
  if (
    !summary.workflowInstall.claudeInstalled &&
    !summary.workflowInstall.codexInstalled
  ) {
    return;
  }

  console.log('');
  console.log('workflow:');
  printWorkflowRuntime('Claude install', summary.workflowInstall, 'claude');
  printWorkflowRuntime('Codex runtime', summary.workflowInstall, 'codex');
}

function printWorkflowRuntime(label, workflowInstall, runtime) {
  const installed = workflowInstall[`${runtime}Installed`];
  if (!installed) {
    console.log(`  [INFO] ${label} not present`);
    return;
  }
  const version = workflowInstall[`${runtime}Version`] || 'unknown';
  const checks = workflowInstall[`${runtime}Checks`];
  console.log(`  [OK] ${label} — ${version}`);
  for (const item of checks) {
    const suffix = item.detail ? ` — ${item.detail}` : '';
    console.log(`  [${item.ok ? 'OK' : 'FAIL'}] ${item.file}${suffix}`);
  }
}

function printShellLaunchers(summary) {
  console.log('');
  console.log('Shell Launchers:');
  const launcherCheckGroups = [
    {
      label: 'POSIX',
      active: summary.shellLaunchers.shellInstalled,
      checks: summary.shellLaunchers.shellChecks ?? [],
    },
    {
      label: 'PowerShell',
      active: summary.shellLaunchers.powershellInstalled,
      checks: summary.shellLaunchers.powershellChecks ?? [],
    },
  ];
  for (const group of launcherCheckGroups) {
    if (group.checks.length === 0) continue;
    console.log(`  ${group.label}:`);
    for (const item of group.checks) {
      console.log(`    [${launcherStatus(summary, group, item)}] ${item.file}`);
    }
  }
}

function launcherStatus(summary, group, item) {
  if (item.ok) return 'OK';
  if (summary.shellLaunchers.installed && !group.active) return 'INFO';
  return 'FAIL';
}

function printWarnings(summary) {
  if (summary.warnings.length > 0) {
    console.log('');
    console.log('Warnings:');
    for (const warning of summary.warnings) {
      console.log(`  [WARN] ${warning}`);
    }
  }
}

function printReplay(summary) {
  if (summary.replay) {
    console.log('');
    console.log(`Router Replay: ${summary.replay.ok ? 'PASS' : 'FAIL'}`);
  }
}

function printErrors(summary) {
  if (summary.errors.length > 0) {
    console.log('');
    console.log('Errors:');
    for (const error of summary.errors) {
      console.log(`  [ERR] ${error}`);
    }
  }
}

module.exports = { printHuman };

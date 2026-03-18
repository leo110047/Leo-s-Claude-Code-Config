const CAREFUL_MODE_GUARDS = [
  {
    rule: 'rm-rf',
    detail: 'rm -rf / recursive force delete',
    matches(command) {
      return (
        /\brm\s+-[A-Za-z]*r[A-Za-z]*f[A-Za-z]*(?:\s|$)/.test(command)
        || /\brm\s+-[A-Za-z]*f[A-Za-z]*r[A-Za-z]*(?:\s|$)/.test(command)
        || /\brm\s+--recursive\s+--force(?:\s|$)/.test(command)
        || /\brm\s+--force\s+--recursive(?:\s|$)/.test(command)
      );
    }
  },
  {
    rule: 'git-force-push',
    detail: 'git push --force / --force-with-lease / -f',
    matches(command) {
      return /\bgit\s+push\b[^\n]*(?:--force(?:-with-lease)?|-f)(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'git-reset-hard',
    detail: 'git reset --hard',
    matches(command) {
      return /\bgit\s+reset\b[^\n]*\s--hard(?:\s|$)/.test(command);
    }
  },
  {
    rule: 'terraform-destroy',
    detail: 'terraform destroy',
    matches(command) {
      return /\bterraform\s+destroy\b/.test(command);
    }
  },
  {
    rule: 'kubectl-delete',
    detail: 'kubectl delete',
    matches(command) {
      return /\bkubectl\s+delete\b/.test(command);
    }
  },
  {
    rule: 'helm-uninstall',
    detail: 'helm uninstall',
    matches(command) {
      return /\bhelm\s+uninstall\b/.test(command);
    }
  },
  {
    rule: 'destructive-sql',
    detail: 'destructive SQL via psql/mysql/sqlite3/sqlcmd/pscale/prisma db execute',
    matches(command) {
      const usesDbClient = /\b(psql|mysql|sqlite3|sqlcmd|pscale|prisma\s+db\s+execute)\b/i.test(command);
      const destructiveSql = /\b(DROP|TRUNCATE)\s+(TABLE|DATABASE|SCHEMA)\b/i.test(command);
      return usesDbClient && destructiveSql;
    }
  }
];

function matchCarefulModeRisk(command) {
  if (!command) {
    return null;
  }

  const normalized = String(command).replace(/\s+/g, ' ').trim();
  return CAREFUL_MODE_GUARDS.find(rule => rule.matches(normalized)) || null;
}

module.exports = {
  CAREFUL_MODE_GUARDS,
  matchCarefulModeRisk
};

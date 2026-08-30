export type ClaudeBillingMode = 'subscription' | 'metered';

export type ClaudeAuthStatus = {
  loggedIn: boolean;
  authMethod: string;
  apiProvider?: string;
};

export type ClaudeReviewBudgetPolicy =
  | { billingMode: 'subscription'; maxBudgetUsd?: never }
  | { billingMode: 'metered'; maxBudgetUsd: number };

export type ClaudeCredentialEnvironment = Record<string, string | undefined>;

export const DEFAULT_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD = 3;
const MIN_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD = 0.01;
const MAX_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD = 100;

const SUBSCRIPTION_AUTH_METHODS = new Set(['claude.ai', 'oauth_token']);
const METERED_AUTH_METHODS = new Set([
  'api_key',
  'api_key_helper',
  'third_party',
]);

export function resolveClaudeReviewBudgetPolicy(
  auth: ClaudeAuthStatus,
  requestedMaxBudgetUsd?: number,
  credentialEnvironment: ClaudeCredentialEnvironment = {},
): ClaudeReviewBudgetPolicy {
  assertValidClaudeAuthStatus(auth);
  assertValidClaudeReviewMaxBudgetUsd(requestedMaxBudgetUsd);
  if (!auth.loggedIn || auth.authMethod === 'none') {
    throw new Error(
      'Claude authentication is unavailable; run `claude auth login` or configure a supported metered provider before review/code',
    );
  }
  const billingMode = billingModeFromCredentialPrecedence(
    auth,
    credentialEnvironment,
  );
  if (billingMode === 'subscription') {
    if (auth.apiProvider && auth.apiProvider !== 'firstParty') {
      throw new Error(
        `Claude auth status is inconsistent: subscription auth cannot use provider ${auth.apiProvider}`,
      );
    }
    if (requestedMaxBudgetUsd !== undefined) {
      throw new Error(
        '--review-claude-max-budget-usd is only valid with metered Claude authentication; subscription reviews do not use estimated-dollar limits',
      );
    }
    return { billingMode: 'subscription' };
  }
  if (billingMode === 'metered') {
    return {
      billingMode: 'metered',
      maxBudgetUsd:
        requestedMaxBudgetUsd ?? DEFAULT_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD,
    };
  }
  throw new Error(
    `unsupported Claude authentication method for review/code billing policy: ${auth.authMethod}`,
  );
}

export function assertValidClaudeReviewMaxBudgetUsd(
  value: number | undefined,
): void {
  if (value === undefined) return;
  if (!Number.isFinite(value)) {
    throw new Error('--review-claude-max-budget-usd must be a finite number');
  }
  if (
    value < MIN_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD ||
    value > MAX_METERED_CLAUDE_REVIEW_MAX_BUDGET_USD
  ) {
    throw new Error(
      '--review-claude-max-budget-usd must be between 0.01 and 100.00',
    );
  }
}

export function formatClaudeReviewBudgetUsd(value: number): string {
  assertValidClaudeReviewMaxBudgetUsd(value);
  return value.toFixed(2);
}

function assertValidClaudeAuthStatus(auth: ClaudeAuthStatus): void {
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(auth.authMethod)) {
    throw new Error('Claude authentication status returned an invalid auth method');
  }
  if (
    auth.apiProvider !== undefined &&
    !/^[A-Za-z0-9._-]{1,64}$/.test(auth.apiProvider)
  ) {
    throw new Error('Claude authentication status returned an invalid API provider');
  }
}

function billingModeFromCredentialPrecedence(
  auth: ClaudeAuthStatus,
  env: ClaudeCredentialEnvironment,
): ClaudeBillingMode | undefined {
  if (
    [
      'CLAUDE_CODE_USE_BEDROCK',
      'CLAUDE_CODE_USE_ANTHROPIC_AWS',
      'CLAUDE_CODE_USE_VERTEX',
      'CLAUDE_CODE_USE_FOUNDRY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_API_KEY',
    ].some((key) => Boolean(env[key]))
  ) {
    return 'metered';
  }
  if (env.CLAUDE_CODE_OAUTH_TOKEN) return 'subscription';
  if (SUBSCRIPTION_AUTH_METHODS.has(auth.authMethod)) return 'subscription';
  if (METERED_AUTH_METHODS.has(auth.authMethod)) return 'metered';
  return undefined;
}

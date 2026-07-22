export const BROWSER_SESSION_COMMANDS = [
	"accessibility",
	"attrs",
	"back",
	"console",
	"css",
	"forms",
	"forward",
	"goto",
	"html",
	"is",
	"links",
	"network",
	"perf",
	"reload",
	"snapshot",
	"status",
	"tabs",
	"text",
	"url",
	"wait",
] as const;

// These commands inspect existing browser state without causing navigation.
// Codex execpolicy rules may auto-allow only this subset. Navigation and wait
// commands must go through the host's normal approval path.
export const AUTO_ALLOWED_BROWSER_SESSION_COMMANDS = [
	"accessibility",
	"attrs",
	"console",
	"css",
	"forms",
	"html",
	"is",
	"links",
	"network",
	"perf",
	"snapshot",
	"status",
	"tabs",
	"text",
	"url",
] as const;

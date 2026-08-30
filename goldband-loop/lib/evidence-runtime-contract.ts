export const EVIDENCE_SANDBOX_ACTIVE_ENV = "GOLDBAND_EVIDENCE_SANDBOX_ACTIVE";
export const EVIDENCE_TEMP_ROOT_ENV = "GOLDBAND_EVIDENCE_TEMP_ROOT";

const EVIDENCE_CHILD_ENV_KEYS = [
	EVIDENCE_SANDBOX_ACTIVE_ENV,
	EVIDENCE_TEMP_ROOT_ENV,
	"TMPDIR",
	"TMP",
	"TEMP",
	"HOME",
	"GOLDBAND_HOME",
	"GOLDBAND_STATE_DIR",
	"GOLDBAND_STATE_ROOT",
	"CLAUDE_PLUGIN_DATA",
	"CLAUDE_PLUGIN_ROOT",
] as const;

export function evidenceChildProcessEnvironment(
	env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
	const forwarded: NodeJS.ProcessEnv = {};
	for (const key of EVIDENCE_CHILD_ENV_KEYS) {
		const value = env[key];
		if (value !== undefined) forwarded[key] = value;
	}
	return forwarded;
}

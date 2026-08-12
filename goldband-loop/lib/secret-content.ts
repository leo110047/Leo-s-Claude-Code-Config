export const SECRET_CONTENT_RULES: ReadonlyArray<{
	name: string;
	pattern: RegExp;
}> = [
	{ name: "openai-api-key", pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
	{ name: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/ },
	{ name: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
	{
		name: "private-key-block",
		pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*/,
	},
	{
		name: "jwt",
		pattern:
			/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
	},
	{ name: "bearer-token", pattern: /\bBearer\s+[A-Za-z0-9._~+/-]+=*/i },
	{
		name: "credential-uri",
		pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i,
	},
	{
		name: "credential-assignment",
		pattern:
			/\b(?:api[_-]?(?:key|token)|access[_-]?token|refresh[_-]?token|auth[_-]?token|token|secret|password|passwd|client[_-]?secret)\b\s*[:=]\s*['"]?[^\s'"]{6,}/i,
	},
];

export function detectSecretLikeContent(text: string): string | null {
	for (const { name, pattern } of SECRET_CONTENT_RULES) {
		if (pattern.test(text)) return name;
	}
	return null;
}

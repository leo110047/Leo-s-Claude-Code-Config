/** Normalize a Git remote into a stable, provider-neutral repository identity. */
export function canonicalizeRemote(url: string | null | undefined): string {
	if (!url) return "";
	let value = url.trim();
	if (!value) return "";

	value = value.replace(/^['"]|['"]$/g, "");
	const scpMatch = value.match(/^[^@\s]+@([^:]+):(.+)$/);
	if (scpMatch) {
		value = `${scpMatch[1]}/${scpMatch[2]}`;
	} else {
		value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
		value = value.replace(/^[^@/]+@/, "");
	}

	return value
		.replace(/\.git$/i, "")
		.replace(/\/+$/, "")
		.replace(/\/{2,}/g, "/")
		.toLowerCase();
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planSync } from "../bin/goldband.ts";

const cleanup: string[] = [];
afterEach(() => { for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe("goldband plan sync CLI", () => {
	test("forwards read-only preview through a materialized runtime snapshot", () => {
		const root = fixtureRoot();
		let argv: readonly string[] = [];
		const status = planSync(["preview", "--work-id", "work-1", "--host", "codex"], {
			entryFile: join(root, "bin", "goldband.ts"),
			spawn: ((_command, args) => { argv = args as string[]; return { status: 0, signal: null } as ReturnType<typeof Bun.spawnSync>; }) as never,
		});
		expect(status).toBe(0);
		expect(argv).toEqual(expect.arrayContaining(["sync", "preview", "--work-id", "work-1", "--host", "codex"]));
	});

	test("stabilizes configuration input and rejects synthetic approval flags", () => {
		const root = fixtureRoot();
		const input = join(root, "config.json");
		writeFileSync(input, '{"schemaVersion":1,"mode":"off","repository":null,"defaultLabels":[],"dependencyCapability":"body-links"}');
		let forwardedInput = "";
		planSync(["configure", "--input", input, "--host", "claude"], {
			entryFile: join(root, "bin", "goldband.ts"),
			spawn: ((_command, args) => { const index = args.indexOf("--input"); forwardedInput = args[index + 1] as string; expect(forwardedInput).not.toBe(input); return { status: 0, signal: null } as ReturnType<typeof Bun.spawnSync>; }) as never,
		});
		expect(forwardedInput).toContain("goldband-tracker-config-");
		expect(() => planSync(["publish", "--work-id", "work-1", "--operation-digest", "a".repeat(64), "--approved", "true", "--host", "codex"], { entryFile: join(root, "bin", "goldband.ts") })).toThrow("invalid or missing option --approved");
	});

	test("requires the explicit publish preview digest", () => {
		const root = fixtureRoot();
		expect(() => planSync(["publish", "--work-id", "work-1", "--host", "codex"], { entryFile: join(root, "bin", "goldband.ts") })).toThrow("requires --operation-digest");
	});

	test("binds publish to one explicit projection step", () => {
		const root = fixtureRoot();
		expect(() => planSync(["publish", "--work-id", "work-1", "--operation-digest", "a".repeat(64), "--host", "codex"], { entryFile: join(root, "bin", "goldband.ts") })).toThrow("requires --step");
		let argv: readonly string[] = [];
		planSync(["publish", "--work-id", "work-1", "--operation-digest", "a".repeat(64), "--step", "create:map", "--host", "codex"], {
			entryFile: join(root, "bin", "goldband.ts"),
			spawn: ((_command, args) => { argv = args as string[]; return { status: 0, signal: null } as ReturnType<typeof Bun.spawnSync>; }) as never,
		});
		expect(argv).toEqual(expect.arrayContaining(["--step", "create:map"]));
	});
});

function fixtureRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "goldband-plan-sync-")); cleanup.push(root);
	mkdirSync(join(root, "bin"), { recursive: true });
	mkdirSync(join(root, "runtime", "workflows"), { recursive: true });
	writeFileSync(join(root, "runtime", "workflows", "work-map-cli.ts"), "// fixture\n");
	return root;
}

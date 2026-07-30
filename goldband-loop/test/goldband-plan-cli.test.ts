import { afterEach, describe, expect, test } from "bun:test";
import {
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	planCreate,
	readStablePlanInput,
	resolvePlanRuntimeFile,
} from "../bin/goldband.ts";

const cleanup: string[] = [];

afterEach(() => {
	for (const path of cleanup.splice(0)) {
		rmSync(path, { recursive: true, force: true });
	}
});

describe("goldband plan create CLI", () => {
	test("dispatches through the materialized installed runtime", () => {
		const root = fixtureRoot();
		const input = join(root, "input.json");
		writeFileSync(input, "{}");
		let invocation: string[] = [];
		const status = planCreate(["--input", input, "--host", "codex"], {
			entryFile: join(root, "bin", "goldband.ts"),
			spawn: ((_command, args) => {
				invocation = args as string[];
				expect(invocation[0]).not.toBe(
					join(root, "runtime", "workflows", "work-map-cli.ts"),
				);
				expect(lstatSync(invocation[0]).isSymbolicLink()).toBe(false);
				expect(readFileSync(invocation[0], "utf8")).toBe("// fixture\n");
				return { status: 0, signal: null } as ReturnType<typeof Bun.spawnSync>;
			}) as never,
		});
		expect(status).toBe(0);
		expect(invocation.slice(1, 4)).toEqual(["--host", "codex", "--input"]);
		expect(invocation).toContain("codex");
		expect(invocation).toContain("--input");
	});

	test("does not follow .installed-source back to a workspace runtime", () => {
		const root = fixtureRoot(false);
		writeFileSync(join(root, ".installed-source"), "/writable/checkout\n");
		expect(() =>
			resolvePlanRuntimeFile(join(root, "bin", "goldband.ts")),
		).toThrow("installed Work Map runtime unavailable");
	});

	test("rejects an installed runtime symlink before spawning", () => {
		const root = fixtureRoot();
		const input = join(root, "input.json");
		writeFileSync(input, "{}");
		const runtime = join(root, "runtime", "workflows", "work-map-cli.ts");
		const target = join(root, "writable-work-map-cli.ts");
		writeFileSync(target, "// untrusted\n");
		rmSync(runtime);
		symlinkSync(target, runtime);
		let spawned = false;
		expect(() =>
			planCreate(["--input", input, "--host", "codex"], {
				entryFile: join(root, "bin", "goldband.ts"),
				spawn: (() => {
					spawned = true;
					return { status: 0, signal: null } as ReturnType<
						typeof Bun.spawnSync
					>;
				}) as never,
			}),
		).toThrow("installed Work Map runtime must not be a symbolic link");
		expect(spawned).toBe(false);
	});

	test("rejects symlinks anywhere in the runtime snapshot before spawning", () => {
		const root = fixtureRoot();
		const input = join(root, "input.json");
		writeFileSync(input, "{}");
		const target = join(root, "writable-dependency.ts");
		writeFileSync(target, "// untrusted\n");
		const runtimeLib = join(root, "runtime", "lib");
		mkdirSync(runtimeLib);
		symlinkSync(target, join(runtimeLib, "state-root.ts"));
		let spawned = false;
		expect(() =>
			planCreate(["--input", input, "--host", "codex"], {
				entryFile: join(root, "bin", "goldband.ts"),
				spawn: (() => {
					spawned = true;
					return { status: 0, signal: null } as ReturnType<
						typeof Bun.spawnSync
					>;
				}) as never,
			}),
		).toThrow("runtime snapshot contains a symbolic link");
		expect(spawned).toBe(false);
	});

	test("rejects symlink, non-regular, and oversized inputs while allowing relative paths", () => {
		const root = fixtureRoot();
		const target = join(root, "target.json");
		const link = join(root, "link.json");
		writeFileSync(target, "{}");
		symlinkSync(target, link);
		expect(() => readStablePlanInput(link)).toThrow("symbolic link");
		expect(() =>
			readStablePlanInput(link, { noFollowFlag: null }),
		).toThrow("symbolic link");
		expect(() => readStablePlanInput(root)).toThrow("regular file");
		const oldCwd = process.cwd();
		process.chdir(root);
		try {
			expect(readStablePlanInput("target.json").toString()).toBe("{}");
		} finally {
			process.chdir(oldCwd);
		}
		const large = join(root, "large.json");
		writeFileSync(large, Buffer.alloc(1024 * 1024 + 1));
		expect(() => readStablePlanInput(large)).toThrow("exceeds 1048576 bytes");

		const changing = join(root, "changing.json");
		writeFileSync(changing, '{"value":"one"}');
		const originalTimes = statSync(changing);
		expect(() =>
			readStablePlanInput(changing, {
				afterFirstRead: () => {
					writeFileSync(changing, '{"value":"two"}');
					utimesSync(changing, originalTimes.atime, originalTimes.mtime);
				},
			}),
		).toThrow("changed while being read");
	});

	test("requires one input and a resolvable parent host", () => {
		const root = fixtureRoot();
		const input = join(root, "input.json");
		writeFileSync(input, "{}");
		expect(() => planCreate([], { entryFile: join(root, "bin", "goldband.ts") }))
			.toThrow("requires --input");
		expect(() =>
			planCreate(["--input", input], {
				entryFile: join(root, "bin", "goldband.ts"),
				env: {},
			}),
		).toThrow("could not infer the parent host");
	});
});

function fixtureRoot(withRuntime = true): string {
	const root = mkdtempSync(join(tmpdir(), "goldband-plan-cli-"));
	cleanup.push(root);
	mkdirSync(join(root, "bin"), { recursive: true });
	if (withRuntime) {
		mkdirSync(join(root, "runtime", "workflows"), { recursive: true });
		writeFileSync(
			join(root, "runtime", "workflows", "work-map-cli.ts"),
			"// fixture\n",
		);
	}
	return root;
}

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";

const roots: string[] = [];
const migration = join(
  import.meta.dir,
  "..",
  "goldband-upgrade",
  "migrations",
  "v1.27.0.0.sh",
);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("v1.27.0.0 local config migration", () => {
  test("renames only the legacy artifacts-sync keys", () => {
    const home = mkdtempSync(join(tmpdir(), "goldband-artifact-migration."));
    roots.push(home);
    mkdirSync(join(home, ".goldband"), { recursive: true });
    mkdirSync(join(home, ".gbrain"), { recursive: true });
    writeFileSync(
      join(home, ".goldband", "config.yaml"),
      "gbrain_sync_mode: artifacts-only\ngbrain_sync_mode_prompted: true\n",
    );
    writeFileSync(join(home, ".gbrain", "config.json"), '{"sentinel":true}\n');
    writeFileSync(
      join(home, ".claude.json"),
      '{"mcpServers":{"gbrain":{"url":"https://example.invalid"}}}\n',
    );

    const beforeProviderConfig = readFileSync(join(home, ".gbrain", "config.json"), "utf8");
    const beforeMcp = readFileSync(join(home, ".claude.json"), "utf8");
    const result = spawnSync("bash", [migration], {
      env: { ...process.env, HOME: home },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(readFileSync(join(home, ".goldband", "config.yaml"), "utf8")).toBe(
      "artifacts_sync_mode: artifacts-only\nartifacts_sync_mode_prompted: true\n",
    );
    expect(readFileSync(join(home, ".gbrain", "config.json"), "utf8")).toBe(
      beforeProviderConfig,
    );
    expect(readFileSync(join(home, ".claude.json"), "utf8")).toBe(beforeMcp);
  });
});

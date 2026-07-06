import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const ROOT = path.resolve(import.meta.dir, "..");
const BIN = path.join(ROOT, "bin", "goldband-knowledge");

let tmpHome = "";
let tmpCwd = "";
let bodyFile = "";

function run(args: string[]): string {
  return execFileSync(BIN, args, {
    cwd: tmpCwd,
    env: { ...process.env, GOLDBAND_HOME: tmpHome },
    encoding: "utf8",
  });
}

function fail(args: string[]) {
  return spawnSync(BIN, args, {
    cwd: tmpCwd,
    env: { ...process.env, GOLDBAND_HOME: tmpHome },
    encoding: "utf8",
  });
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "goldband-knowledge-home-"));
  tmpCwd = fs.mkdtempSync(path.join(os.tmpdir(), "goldband-knowledge-cwd-"));
  bodyFile = path.join(tmpHome, "practice.md");
  fs.writeFileSync(
    bodyFile,
    [
      "## 做法",
      "Run browser QA with a stable synthetic fixture before touching staging.",
      "",
      "## 適用情境",
      "Use this when a workflow has browser state or fixture-sensitive checks.",
      "",
      "## 驗證證據",
      "A synthetic fixture reproduced the issue and the replay passed after the fix.",
      "",
    ].join("\n"),
    "utf8",
  );
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  fs.rmSync(tmpCwd, { recursive: true, force: true });
});

describe("goldband-knowledge CLI", () => {
  test("add writes markdown, updates index, and search returns path plus summary", () => {
    const addOut = run([
      "add",
      "--id",
      "qa-fixture-replay",
      "--title",
      "QA fixture replay before staging",
      "--type",
      "practice",
      "--domains",
      "qa,browser",
      "--scope",
      "project",
      "--summary",
      "Use synthetic browser fixtures before staging QA.",
      "--confidence",
      "8",
      "--body-file",
      bodyFile,
    ]);

    expect(addOut).toContain("WROTE");
    const entryPath = path.join(
      tmpHome,
      "knowledge",
      "entries",
      "qa-fixture-replay.md",
    );
    expect(fs.existsSync(entryPath)).toBe(true);

    const index = JSON.parse(
      fs.readFileSync(path.join(tmpHome, "knowledge", "index.json"), "utf8"),
    );
    expect(index.entries).toHaveLength(1);
    expect(index.entries[0].id).toBe("qa-fixture-replay");
    expect(index.entries[0].domains).toEqual(["qa", "browser"]);

    const searchOut = run([
      "search",
      "--domain",
      "qa",
      "--query",
      "fixture staging",
      "--status",
      "active",
    ]);
    expect(searchOut).toContain("KNOWLEDGE: 1 related entries");
    expect(searchOut).toContain(entryPath);
    expect(searchOut).toContain("Use synthetic browser fixtures before staging QA.");
  });

  test("graduate and retire keep entries searchable only by requested status", () => {
    run([
      "capture",
      "--id",
      "review-checklist-rule",
      "--title",
      "Review checklist rule candidate",
      "--type",
      "practice",
      "--domains",
      "review",
      "--summary",
      "Promote repeated review checklist guidance into a rule.",
      "--body-file",
      bodyFile,
    ]);

    const graduated = run([
      "graduate",
      "--id",
      "review-checklist-rule",
      "--to",
      "skills/global/evidence-based-coding/SKILL.md",
    ]);
    expect(graduated).toContain("GRADUATED");
    expect(run(["search", "--status", "graduated", "--query", "checklist"])).toContain(
      "review-checklist-rule",
    );
    expect(run(["search", "--status", "active", "--query", "checklist"])).toContain(
      "no matching entries",
    );

    const retired = run(["retire", "--id", "review-checklist-rule"]);
    expect(retired).toContain("RETIRED");
    expect(
      run([
        "search",
        "--status",
        "all",
        "--include-retired",
        "--query",
        "checklist",
      ]),
    ).toContain("review-checklist-rule");
  });

  test("schema validation rejects practice entries missing required sections", () => {
    const invalidBody = path.join(tmpHome, "invalid.md");
    fs.writeFileSync(invalidBody, "## 做法\nOnly one section.\n", "utf8");

    const result = fail([
      "add",
      "--id",
      "invalid-practice",
      "--title",
      "Invalid practice",
      "--type",
      "practice",
      "--domains",
      "general",
      "--summary",
      "Missing required body sections.",
      "--body-file",
      invalidBody,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("practice body missing required sections");
  });

  test("schema validation rejects frontmatter values that cannot round-trip", () => {
    const result = fail([
      "add",
      "--id",
      "invalid-summary",
      "--title",
      "Invalid summary",
      "--type",
      "practice",
      "--domains",
      "general",
      "--summary",
      'Contains "quoted" text',
      "--body-file",
      bodyFile,
    ]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unsupported frontmatter characters");
  });
});

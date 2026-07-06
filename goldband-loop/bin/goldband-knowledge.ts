#!/usr/bin/env bun
import { readFileSync } from "fs";
import {
  createKnowledgeEntry,
  currentCanonicalRemote,
  currentProjectSlug,
  entryPath,
  KNOWLEDGE_DOMAINS,
  KNOWLEDGE_SOURCES,
  KNOWLEDGE_STATUSES,
  KNOWLEDGE_TYPES,
  knowledgeRoot,
  parseKnowledgeFile,
  rebuildIndex,
  renderSearchRows,
  searchKnowledge,
  todayIsoDate,
  transitionKnowledgeStatus,
  writeKnowledgeEntry,
  type KnowledgeDomain,
  type KnowledgeScope,
  type KnowledgeSource,
  type KnowledgeStatus,
  type KnowledgeType,
} from "../lib/knowledge";

type Args = Record<string, string | boolean>;

function parseArgs(tokens: string[]): { command: string; args: Args } {
  const [command = "help", ...rest] = tokens;
  const args: Args = {};
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = rest[index + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      index += 1;
    }
  }
  return { command, args };
}

function usage(): string {
  return `Usage: goldband-knowledge <add|capture|search|graduate|retire|validate|reindex> [options]

Commands:
  add/capture   Create one curated knowledge entry and update index.json.
  search        Print path + one-line summary for matching entries.
  graduate      Mark an entry graduated; requires --id and --to.
  retire        Mark an entry retired; requires --id.
  validate      Validate one entry with --id or all entries.
  reindex       Rebuild knowledge/index.json from entry files.

Add options:
  --id <slug> --title <title> --type <problem-solution|decision|practice>
  --domains <qa,review,...> --summary <line> --body-file <path>
  --scope <global|project> --confidence <1-10> --source <manual|telemetry-miner|workflow-evidence>
  --status <candidate|active|graduated|retired> --project-slug <slug>

Search options:
  --domain <domain> --type <type> --scope <global|project|all>
  --status <status|all> --query <keywords> --limit <n> --project-slug <slug>

Knowledge root: \${GOLDBAND_HOME:-$HOME/.goldband}/knowledge
`;
}

function main(): void {
  const { command, args } = parseArgs(process.argv.slice(2));
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(usage());
    return;
  }
  if (command === "add" || command === "capture") return runAdd(args);
  if (command === "search") return runSearch(args);
  if (command === "graduate") return runGraduate(args);
  if (command === "retire") return runRetire(args);
  if (command === "validate") return runValidate(args);
  if (command === "reindex") return runReindex();
  throw new Error(`Unknown command: ${command}`);
}

function runAdd(args: Args): void {
  const scope = enumArg(args, "scope", ["global", "project"], "global") as KnowledgeScope;
  const projectSlug =
    stringArg(args, "project-slug", "") ||
    (scope === "project" ? currentProjectSlug() : "");
  const body = readBody(args);
  const entry = createKnowledgeEntry({
    id: requiredString(args, "id"),
    title: requiredString(args, "title"),
    type: enumArg(args, "type", KNOWLEDGE_TYPES, undefined) as KnowledgeType,
    domains: listArg(args, "domains", KNOWLEDGE_DOMAINS) as KnowledgeDomain[],
    scope,
    project_slug: projectSlug,
    canonical_remote: stringArg(args, "canonical-remote", "") || currentCanonicalRemote(),
    status: enumArg(args, "status", KNOWLEDGE_STATUSES, "active") as KnowledgeStatus,
    confidence: intArg(args, "confidence", 5),
    created: stringArg(args, "created", todayIsoDate()),
    updated: stringArg(args, "updated", todayIsoDate()),
    source: enumArg(args, "source", KNOWLEDGE_SOURCES, "manual") as KnowledgeSource,
    last_verified: nullableDateArg(args, "last-verified"),
    graduated_to: stringArg(args, "graduated-to", ""),
    links: commaList(stringArg(args, "links", "")),
    summary: requiredString(args, "summary"),
    body,
  });
  const filePath = writeKnowledgeEntry(entry);
  process.stdout.write(`WROTE ${filePath}\n`);
}

function runSearch(args: Args): void {
  const projectSlug = stringArg(args, "project-slug", "") || currentProjectSlug();
  const rows = searchKnowledge({
    domain: stringArg(args, "domain", ""),
    type: stringArg(args, "type", ""),
    scope: (stringArg(args, "scope", "all") || "all") as KnowledgeScope | "all",
    status: (stringArg(args, "status", "active") || "active") as KnowledgeStatus | "all",
    query: stringArg(args, "query", ""),
    projectSlug,
    limit: intArg(args, "limit", 10),
    includeRetired: Boolean(args["include-retired"]),
  });
  const rendered = renderSearchRows(rows);
  process.stdout.write(rendered || "KNOWLEDGE: no matching entries\n");
}

function runGraduate(args: Args): void {
  const id = requiredString(args, "id");
  const to = requiredString(args, "to");
  const summary = stringArg(args, "summary", "");
  const entry = transitionKnowledgeStatus(id, "graduated", {
    graduated_to: to,
    ...(summary ? { summary } : {}),
  });
  process.stdout.write(`GRADUATED ${entryPath(entry.id)} -> ${to}\n`);
}

function runRetire(args: Args): void {
  const id = requiredString(args, "id");
  const summary = stringArg(args, "summary", "");
  const entry = transitionKnowledgeStatus(id, "retired", summary ? { summary } : {});
  process.stdout.write(`RETIRED ${entryPath(entry.id)}\n`);
}

function runValidate(args: Args): void {
  const id = stringArg(args, "id", "");
  const root = knowledgeRoot();
  if (id) {
    parseKnowledgeFile(entryPath(id, root));
    process.stdout.write(`VALID ${entryPath(id, root)}\n`);
    return;
  }
  const index = rebuildIndex(root);
  process.stdout.write(`VALID ${index.entries.length} indexed entries\n`);
}

function runReindex(): void {
  const index = rebuildIndex();
  process.stdout.write(`REINDEXED ${index.entries.length} entries\n`);
}

function requiredString(args: Args, key: string): string {
  const value = stringArg(args, key, "");
  if (!value) throw new Error(`--${key} is required`);
  return value;
}

function stringArg(args: Args, key: string, fallback: string): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function intArg(args: Args, key: string, fallback: number): number {
  const raw = stringArg(args, key, "");
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) throw new Error(`--${key} must be an integer`);
  return value;
}

function enumArg<T extends readonly string[]>(
  args: Args,
  key: string,
  allowed: T,
  fallback: string | undefined,
): string {
  const value = stringArg(args, key, fallback || "");
  if (!value) throw new Error(`--${key} is required`);
  if (!allowed.includes(value)) {
    throw new Error(`--${key} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function listArg<T extends readonly string[]>(args: Args, key: string, allowed: T): string[] {
  const values = commaList(requiredString(args, key));
  for (const value of values) {
    if (!allowed.includes(value)) {
      throw new Error(`--${key} contains invalid value: ${value}`);
    }
  }
  return values;
}

function nullableDateArg(args: Args, key: string): string | null {
  const value = stringArg(args, key, "");
  return value || null;
}

function commaList(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function readBody(args: Args): string {
  const inline = stringArg(args, "body", "");
  if (inline) return inline;
  const bodyFile = stringArg(args, "body-file", "");
  if (!bodyFile) throw new Error("--body-file or --body is required");
  return readFileSync(bodyFile, "utf8");
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

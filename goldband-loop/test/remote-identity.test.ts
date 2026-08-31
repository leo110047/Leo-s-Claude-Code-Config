import { describe, expect, test } from "bun:test";
import { canonicalizeRemote } from "../lib/remote-identity";

describe("canonicalizeRemote", () => {
  test.each([
    ["https://github.com/example-owner/example-repo.git", "github.com/example-owner/example-repo"],
    ["git@github.com:example-owner/example-repo.git", "github.com/example-owner/example-repo"],
    ["ssh://git@gitlab.com/foo/bar", "gitlab.com/foo/bar"],
    ['"https://github.com/foo/bar.git"', "github.com/foo/bar"],
    ["https://GitHub.com/Foo/Bar/", "github.com/foo/bar"],
    ["https://github.com//foo//bar", "github.com/foo/bar"],
  ])("normalizes %s", (input, expected) => {
    expect(canonicalizeRemote(input)).toBe(expected);
  });

  test("returns an empty identity for a missing remote", () => {
    expect(canonicalizeRemote("")).toBe("");
    expect(canonicalizeRemote(null)).toBe("");
    expect(canonicalizeRemote(undefined)).toBe("");
  });
});

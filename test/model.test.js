import test from "node:test";
import assert from "node:assert/strict";
import { eligibleBranches, filterBranches, idOf, slug, worktrees } from "../mods/worktree-dashboard/model.js";

test("slug creates a safe one-directory worktree name", () => {
  assert.equal(slug("feature/login UI"), "feature-login-UI");
  assert.equal(slug("///fix///"), "fix");
  assert.equal(slug("   "), "");
});

test("worktrees parses normal, detached, and prunable porcelain records", () => {
  const input = [
    "worktree C:/src/app\nHEAD abc123\nbranch refs/heads/main",
    "worktree C:/worktrees/app/login\nHEAD def456\nbranch refs/heads/feature/login",
    "worktree C:/worktrees/app/detached\nHEAD fedcba\ndetached",
    "worktree C:/worktrees/app/old\nHEAD 000000\nprunable stale",
  ].join("\n\n");

  assert.deepEqual(worktrees(input), [
    { path: "C:/src/app", branch: "main", main: true },
    { path: "C:/worktrees/app/login", branch: "feature/login", main: false },
    { path: "C:/worktrees/app/detached", branch: "detached", main: false },
  ]);
});

test("eligibleBranches excludes branches already checked out by another worktree", () => {
  const branches = ["main", "feature/login", "fix/menu"];
  const entries = [{ branch: "main" }, { branch: "fix/menu" }];
  assert.deepEqual(eligibleBranches(branches, entries), ["feature/login"]);
});

test("filterBranches matches case-insensitively and ignores surrounding whitespace", () => {
  const branches = ["main", "feature/Login", "fix/menu"];
  assert.deepEqual(filterBranches(branches, " login "), ["feature/Login"]);
  assert.deepEqual(filterBranches(branches, ""), branches);
});

test("idOf remains distinct for worktrees in the same repository", () => {
  const group = { key: "local\u0000C:/src/app" };
  assert.notEqual(idOf(group, { path: "C:/src/app" }), idOf(group, { path: "C:/worktrees/app/login" }));
});

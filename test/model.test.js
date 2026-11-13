import test from "node:test";
import assert from "node:assert/strict";
import {
  cachedGroups, cacheSnapshot, commandName, eligibleBranches, filterBranches, filterGroups, FocusRequests, groupKey, groupSummary, idOf, moveIndex, moveSelectedId,
  listWindowHeight, normalizePath, pathContains, repoName, selectedId, slug, sortWorktrees, spaceForWorktree, trackingStatus, worktreePathName,
  visibleEntries, worktreeDestination, worktrees,
} from "../mods/worktrees/model.js";

const group = (key, branches, error = "") => ({
  key,
  entries: branches.map((branch, index) => ({ path: `C:/worktrees/${key}/${branch}`, branch, main: index === 0 })),
  error,
});

test("commandName accepts Herdr's qualified mod actions", () => {
  assert.equal(commandName("worktrees.up"), "up");
  assert.equal(commandName("new"), "new");
});

test("cachedGroups returns only a recent well-formed cache", () => {
  const groups = [{ key: "local\u0000C:/src/app", entries: [] }];
  assert.deepEqual(cachedGroups({ savedAt: 1_000, groups }, 1_500, 1_000), groups);
  assert.equal(cachedGroups({ savedAt: 1_000, groups }, 2_001, 1_000), null);
  assert.equal(cachedGroups({ savedAt: "now", groups }, 1_500, 1_000), null);
});

test("cacheSnapshot excludes live Herdr space data", () => {
  const snapshot = cacheSnapshot([{ key: "repo", machine: null, main: "C:/repo", name: "repo", folder: "C:/repo", error: "", entries: [{ path: "C:/repo", branch: "main", main: true, dirty: false, ahead: 3, behind: 2, space: { id: "space-1" } }] }]);
  assert.deepEqual(snapshot, [{ key: "repo", machine: null, main: "C:/repo", name: "repo", folder: "C:/repo", error: "", entries: [{ path: "C:/repo", branch: "main", main: true, dirty: false, ahead: 3, behind: 2 }] }]);
});

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
  assert.deepEqual(
    eligibleBranches(["main", "feature/login", "fix/menu"], [{ branch: "main" }, { branch: "fix/menu" }]),
    ["feature/login"],
  );
});

test("filterBranches matches case-insensitively and ignores surrounding whitespace", () => {
  const branches = ["main", "feature/Login", "fix/menu"];
  assert.deepEqual(filterBranches(branches, " login "), ["feature/Login"]);
  assert.deepEqual(filterBranches(branches, ""), branches);
});

test("group and repository helpers preserve machine separation and repository names", () => {
  assert.notEqual(groupKey(null, "C:/src/app"), groupKey("build-box", "C:/src/app"));
  assert.equal(repoName("C:/src/app"), "app");
  assert.equal(repoName("/home/me/repo/"), "repo");
  assert.equal(worktreePathName("C:\\worktrees\\app\\feature-login"), "feature-login");
});

test("trackingStatus reads behind/ahead counts and rejects malformed output", () => {
  assert.deepEqual(trackingStatus("2\t3"), { behind: 2, ahead: 3 });
  assert.deepEqual(trackingStatus("no upstream"), { behind: null, ahead: null });
});

test("groupSummary counts visible worktrees, open spaces, and changed worktrees", () => {
  assert.deepEqual(groupSummary([
    { dirty: false, space: { id: "main" } },
    { dirty: true, space: { id: "feature" } },
    { dirty: null },
  ]), { total: 3, open: 2, changed: 1 });
});

test("listWindowHeight fits visible entries while respecting its bounds", () => {
  const groups = [group("one", ["main", "feature/login"]), group("two", ["fix/menu"])];
  assert.equal(listWindowHeight(groups, "", 100, 1_000), 125 + 3 * 34 + 1 + 2 * 39 + 10);
  assert.equal(listWindowHeight(groups, "login", 260, 760), 260);
  assert.equal(listWindowHeight(groups, "", 100, 200), 200);
});

test("filterGroups retains matching entries and groups with errors", () => {
  const groups = [group("one", ["main", "feature/login"]), group("broken", [], "git failed")];
  const filtered = filterGroups(groups, "login");
  assert.deepEqual(filtered.map(item => [item.key, item.entries.map(entry => entry.branch)]), [["one", ["feature/login"]], ["broken", []]]);
});

test("visibleEntries flattens filtered groups in display order", () => {
  const groups = [group("one", ["main", "feature/login"]), group("two", ["fix/menu"])];
  assert.deepEqual(visibleEntries(groups, "").map(item => item.entry.branch), ["feature/login", "main", "fix/menu"]);
});

test("sortWorktrees puts open worktrees first, then sorts branch names ascending", () => {
  const entries = [
    { branch: "zebra", space: { id: "z" } },
    { branch: "Beta" },
    { branch: "alpha", space: { id: "a" } },
    { branch: "aardvark" },
  ];
  assert.deepEqual(sortWorktrees(entries).map(entry => entry.branch), ["alpha", "zebra", "aardvark", "Beta"]);
  assert.deepEqual(entries.map(entry => entry.branch), ["zebra", "Beta", "alpha", "aardvark"]);
});

test("selectedId chooses the first sorted visible worktree by default", () => {
  const groups = [group("one", ["main", "feature/login"])];
  assert.equal(selectedId(groups, "", null), idOf(groups[0], groups[0].entries[1]));
});

test("selectedId preserves a valid selection and resets an invalid one after filtering", () => {
  const groups = [group("one", ["main", "feature/login"])];
  const login = idOf(groups[0], groups[0].entries[1]);
  assert.equal(selectedId(groups, "", login), login);
  assert.equal(selectedId(groups, "main", login), idOf(groups[0], groups[0].entries[0]));
});

test("selectedId returns null when no worktree matches", () => {
  assert.equal(selectedId([group("one", ["main"])], "missing", "anything"), null);
});

test("moveIndex wraps at both list ends and handles an absent selection", () => {
  assert.equal(moveIndex(0, 3, -1), 2);
  assert.equal(moveIndex(2, 3, 1), 0);
  assert.equal(moveIndex(-1, 3, 1), 0);
  assert.equal(moveIndex(-1, 3, -1), 2);
  assert.equal(moveIndex(0, 0, 1), -1);
});

test("moveSelectedId navigates filtered worktrees and wraps", () => {
  const groups = [group("one", ["main", "feature/login", "fix/menu"])];
  const main = idOf(groups[0], groups[0].entries[0]);
  const menu = idOf(groups[0], groups[0].entries[2]);
  assert.equal(moveSelectedId(groups, "", main, -1), menu);
  assert.equal(moveSelectedId(groups, "login", null, 1), idOf(groups[0], groups[0].entries[1]));
});

test("normalizes Windows paths and checks descendants without prefix false positives", () => {
  assert.equal(normalizePath("C:\\repo\\sub"), "C:/repo/sub");
  assert.equal(pathContains("C:\\repo\\sub", "C:/repo"), true);
  assert.equal(pathContains("C:/repository", "C:/repo"), false);
});

test("spaceForWorktree assigns a space in a worktree subfolder", () => {
  const spaces = [{ id: "space-1", machine: null, folder: "C:/worktrees/app/login/src" }];
  const checkout = { path: "C:/worktrees/app/login" };
  assert.equal(spaceForWorktree(spaces, new Map(), null, checkout, [checkout])?.id, "space-1");
});

test("spaceForWorktree assigns a nested checkout instead of its parent", () => {
  const spaces = [{ id: "space-1", machine: null, folder: "C:/repo/submodule" }];
  const parent = { path: "C:/repo" };
  const nested = { path: "C:/repo/submodule" };
  assert.equal(spaceForWorktree(spaces, new Map(), null, parent, [parent, nested]), undefined);
  assert.equal(spaceForWorktree(spaces, new Map(), null, nested, [parent, nested])?.id, "space-1");
});

test("spaceForWorktree does not cross machine boundaries", () => {
  const spaces = [{ id: "space-1", machine: "remote", folder: "/work/app" }];
  const checkout = { path: "/work/app" };
  assert.equal(spaceForWorktree(spaces, new Map(), null, checkout, [checkout]), undefined);
});

test("worktreeDestination creates a normalized safe destination and rejects blank names", () => {
  assert.equal(worktreeDestination("C:\\Users\\me", "app", "feature/login"), "C:/Users/me/.herdr/worktrees/app/feature-login");
  assert.equal(worktreeDestination("/home/me", "app", "   "), null);
});

test("focus request is held through the initial loading screen then consumed by the list", () => {
  const focus = new FocusRequests();
  assert.equal(focus.target, "list");
  assert.equal(focus.take("branches"), null);
  assert.equal(focus.target, "list");
  assert.equal(focus.take("list"), "list");
  assert.equal(focus.target, null);
});

test("branch screen focus request survives loading and cannot be consumed by the list", () => {
  const focus = new FocusRequests("list");
  focus.request("branches");
  assert.equal(focus.take("list"), null);
  assert.equal(focus.target, "branches");
  assert.equal(focus.take("branches"), "branches");
  assert.equal(focus.target, null);
});

test("returning to the list requests a new filter focus after worktree creation", () => {
  const focus = new FocusRequests("name");
  focus.request("list");
  assert.equal(focus.take("list"), "list");
  assert.equal(focus.take("list"), null);
});

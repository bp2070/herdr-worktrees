import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const keys = JSON.parse(await readFile(new URL("../keys.json", import.meta.url), "utf8"));
const bindings = keys["mod:worktree-dashboard"];
const globalBindings = keys.global;

test("default keyboard contract opens the dashboard globally", () => {
  assert.equal(globalBindings?.["alt-shift-w"], "mod.open:worktree-dashboard");
});

test("default keyboard contract preserves input-safe navigation", () => {
  assert.ok(bindings, "keys.json must define the worktree-dashboard mod section");

  // Native Herdr Input consumes these keys before the mod sees raw events, so
  // they must be registered as mod commands for input-focused navigation.
  assert.equal(bindings.up, "worktree-dashboard.up");
  assert.equal(bindings.down, "worktree-dashboard.down");
  assert.equal(bindings.escape, "worktree-dashboard.escape");
});

test("default keyboard contract exposes worktree lifecycle actions", () => {
  assert.equal(bindings["alt-shift-n"], "worktree-dashboard.new");
  assert.equal(bindings["alt-shift-r"], "worktree-dashboard.remove");
});

test("default bindings reserve no tab override", () => {
  assert.equal(bindings.tab, undefined);
});

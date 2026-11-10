// Pure worktree data helpers. These deliberately have no Herdr or GPUI imports,
// so they can be exercised with Node's built-in test runner.

export const slug = name => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");

export const idOf = (group, entry) => `${group.key}\u0000${entry.path}`;

export function worktrees(text) {
  const rows = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find(line => line.startsWith("worktree "))?.slice(9);
    if (!path || lines.includes("bare") || lines.some(line => line.startsWith("prunable"))) continue;
    rows.push({
      path,
      branch: lines.find(line => line.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "detached",
      main: rows.length === 0,
    });
  }
  return rows;
}

export function eligibleBranches(branches, entries) {
  const checkedOut = new Set(entries.map(entry => entry.branch));
  return branches.filter(branch => !checkedOut.has(branch));
}

export function filterBranches(branches, filter) {
  const query = filter.trim().toLowerCase();
  return branches.filter(branch => !query || branch.toLowerCase().includes(query));
}

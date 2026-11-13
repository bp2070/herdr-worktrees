// Pure worktree data and navigation helpers. These deliberately have no Herdr
// or GPUI imports, so Node's built-in test runner can exercise them directly.

export const slug = name => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
// Herdr key bindings use worktrees.<command>; nextCommand may provide the
// fully qualified action or just its command suffix depending on the host.
export const commandName = command => command.startsWith("worktrees.") ? command.slice("worktrees.".length) : command;
export function cachedGroups(cache, now, maxAge) {
  if (!cache || !Array.isArray(cache.groups) || !Number.isFinite(cache.savedAt)) return null;
  const age = now - cache.savedAt;
  return age >= 0 && age <= maxAge ? cache.groups : null;
}

// Persist only Git data. Herdr space objects are live, can change between
// windows, and are restored from spaces() when a cached result is used.
export function cacheSnapshot(groups) {
  return groups.map(group => ({
    key: group.key, machine: group.machine, main: group.main, name: group.name, folder: group.folder, bare: Boolean(group.bare), error: group.error,
    entries: group.entries.map(entry => ({ path: entry.path, branch: entry.branch, main: entry.main, dirty: entry.dirty, ahead: entry.ahead ?? null, behind: entry.behind ?? null })),
  }));
}
export const idOf = (group, entry) => `${group.key}\u0000${entry.path}`;
export const normalizePath = path => path?.replace(/\\/g, "/") ?? null;
export const groupKey = (machine, main) => `${machine ?? ""}\u0000${main}`;
export const repoName = main => main.split(/[\\/]/).filter(Boolean).pop() ?? "repository";
export const worktreePathName = path => normalizePath(path)?.split("/").filter(Boolean).pop() ?? "worktree";
export const folderNameMatches = (entered, folder) => entered?.trim().toLowerCase() === folder?.trim().toLowerCase();

export function trackingStatus(text) {
  const [behind, ahead] = text.trim().split(/\s+/).map(Number);
  return Number.isInteger(behind) && behind >= 0 && Number.isInteger(ahead) && ahead >= 0 ? { behind, ahead } : { behind: null, ahead: null };
}

export function groupSummary(entries) {
  return entries.reduce((summary, entry) => ({
    total: summary.total + 1,
    open: summary.open + Number(Boolean(entry.space)),
    changed: summary.changed + Number(entry.dirty === true),
  }), { total: 0, open: 0, changed: 0 });
}

// The content-height budget accounts for the fixed window chrome, visible
// repository headers, compact worktree rows, and gaps between groups.
export function listWindowHeight(groups, filter, minimum = 300, maximum = 720) {
  const shown = filterGroups(groups, filter);
  const entries = shown.reduce((count, group) => count + group.entries.length, 0);
  const entryGaps = shown.reduce((count, group) => count + Math.max(0, group.entries.length - 1), 0);
  // Reserve 24px of layout headroom for native text metrics and the overlay
  // frame so the final row never touches the scroll viewport's lower edge.
  const desired = 149 + entries * 34 + entryGaps + shown.length * 39 + Math.max(0, shown.length - 1) * 10;
  return Math.min(maximum, Math.max(minimum, desired));
}

export function worktrees(text, hasMainCheckout = true) {
  const rows = [];
  for (const block of text.split(/\n\n+/)) {
    const lines = block.split("\n");
    const path = lines.find(line => line.startsWith("worktree "))?.slice(9);
    if (!path || lines.includes("bare") || lines.some(line => line.startsWith("prunable"))) continue;
    rows.push({
      path,
      branch: lines.find(line => line.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? "detached",
      main: hasMainCheckout && rows.length === 0,
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

// Open worktrees lead their repository's list. Use code-point comparison rather
// than locale settings so the visible order remains consistent across machines.
export function sortWorktrees(entries) {
  return [...entries].sort((a, b) => {
    const openOrder = Number(Boolean(b.space)) - Number(Boolean(a.space));
    if (openOrder) return openOrder;
    const aName = a.branch.toLowerCase();
    const bName = b.branch.toLowerCase();
    return aName < bName ? -1 : aName > bName ? 1 : a.branch < b.branch ? -1 : a.branch > b.branch ? 1 : 0;
  });
}

export function filterGroups(groups, filter) {
  const query = filter.trim().toLowerCase();
  return groups
    .map(group => ({ ...group, entries: sortWorktrees(group.entries.filter(entry => !query || entry.branch.toLowerCase().includes(query))) }))
    .filter(group => group.entries.length > 0 || group.error);
}

export function visibleEntries(groups, filter) {
  return filterGroups(groups, filter).flatMap(group => group.entries.map(entry => ({ group, entry })));
}

export function selectedId(groups, filter, current) {
  const entries = visibleEntries(groups, filter);
  return entries.some(({ group, entry }) => idOf(group, entry) === current) ? current : entries[0] ? idOf(entries[0].group, entries[0].entry) : null;
}

export function moveIndex(index, length, delta) {
  if (length <= 0) return -1;
  if (index < 0 || index >= length) return delta < 0 ? length - 1 : 0;
  return (index + delta + length) % length;
}

export function moveSelectedId(groups, filter, current, delta) {
  const entries = visibleEntries(groups, filter);
  if (!entries.length) return null;
  const index = entries.findIndex(({ group, entry }) => idOf(group, entry) === current);
  const next = moveIndex(index, entries.length, delta);
  return idOf(entries[next].group, entries[next].entry);
}

// The scroll area has one direct child per worktree, plus one for a visible
// empty error group. Return the child index that contains the selected row.
export function selectedScrollIndex(groups, filter, selected) {
  let index = 0;
  for (const group of filterGroups(groups, filter)) {
    const entryIndex = group.entries.findIndex(entry => idOf(group, entry) === selected);
    if (entryIndex >= 0) return index + entryIndex;
    index += group.entries.length || Number(Boolean(group.error));
  }
  return -1;
}

export function pathContains(folder, path) {
  let at = normalizePath(folder);
  let root = normalizePath(path);
  // Git and terminals can report Windows drive paths with different casing.
  // Fold only those paths; Unix paths (including remote-machine paths) remain
  // case-sensitive.
  if (/^[A-Za-z]:\//.test(at ?? "") && /^[A-Za-z]:\//.test(root ?? "")) {
    at = at.toLowerCase();
    root = root.toLowerCase();
  }
  return Boolean(at && root && (at === root || at.startsWith(`${root}/`)));
}

export function spaceForWorktree(spaces, paneFolders, machine, checkout, checkouts) {
  const path = normalizePath(checkout.path);
  return spaces.find(space => {
    const at = normalizePath(paneFolders.get(space.id) ?? space.folder);
    if ((space.machine ?? null) !== machine || !pathContains(at, path)) return false;
    return !checkouts.some(other => other.path !== checkout.path && other.path.length > checkout.path.length && pathContains(at, other.path));
  });
}

export function worktreeDestination(userHome, repository, name) {
  const component = slug(name.trim());
  return component ? `${normalizePath(userHome)}/.herdr/worktrees/${repository}/${component}` : null;
}

// Records a focus request until the corresponding screen has rendered. The
// view consumes it after native layout; tests can inspect this state without a
// GPUI window or OS-level focus API.
export class FocusRequests {
  constructor(initial = "list") {
    this.target = initial;
  }

  request(screen) {
    this.target = screen;
  }

  take(screen) {
    if (this.target !== screen) return null;
    this.target = null;
    return screen;
  }
}

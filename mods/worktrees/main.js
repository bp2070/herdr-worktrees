import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Scrollbar, ScrollHandle } from "gpui-base";
import { closeOverlay, exec, home, keys, nextCommand, openOverlay, panes, props, run, setShared, shared, spaces, theme } from "herdr";
import {
  cachedGroups, cacheSnapshot, commandName, eligibleBranches, filterBranches, filterGroups, FocusRequests, groupKey, groupSummary, idOf, listWindowHeight, moveIndex, moveSelectedId,
  folderNameMatches, pathContains, repoName, selectedId, selectedScrollIndex, slug, spaceForWorktree, trackingStatus, visibleEntries, worktreeDestination, worktreePathName, worktrees,
} from "./model.js";

const CACHE_KEY = "worktrees.cache.v2";
const CACHE_MAX_AGE = 120_000;

function folderOf(space, paneList = panes()) {
  const tabs = new Set((space.tabs ?? []).map(tab => tab.id));
  return paneList.find(pane => tabs.has(pane.tab) && pane.cwd)?.cwd ?? space.folder ?? null;
}

function withCurrentSpaces(groups, spaceList = spaces(), paneList = panes()) {
  const paneFolders = new Map(spaceList.map(space => [space.id, folderOf(space, paneList)]));
  return groups.map(group => {
    const checkouts = group.entries ?? [];
    return { ...group, entries: checkouts.map(entry => ({ ...entry, space: spaceForWorktree(spaceList, paneFolders, group.machine, entry, checkouts) })) };
  });
}

async function git(cwd, args, on) {
  const result = await exec("git", args, { cwd, on });
  return { ok: result.code === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? result.stdout ?? "").trim() };
}

export default class Worktrees extends View {
  init(_props, cx) {
    this.loading = true; this.refreshing = false; this.error = ""; this.groups = []; this.selected = null; this.focusRequests = new FocusRequests();
    this.listScroll = ScrollHandle.new(); this.branchScroll = ScrollHandle.new();
    this.mode = "list";
    this.filter = ""; this.branchFilter = ""; this.branchAt = 0; this.branches = []; this.branchLoading = false; this.createGroup = null; this.branch = null;
    this.removeEntry = null; this.removeGroup = null; this.removeDirty = false; this.removeLoading = false; this.cleanupPath = null; this.errorCopied = false;
    const cached = cachedGroups(shared(CACHE_KEY), Date.now(), CACHE_MAX_AGE);
    if (cached) {
      this.groups = withCurrentSpaces(cached);
      this.loading = false;
      this.ensureSelection();
    }
    this.filterInput = this.makeInput("Filter worktrees by branch name…", (value, cx) => { this.filter = value; this.selectFirst(); cx.notify(); });
    this.branchInput = this.makeInput("Filter branches…", (value, cx) => { this.branchFilter = value; this.branchAt = 0; cx.notify(); });
    this.nameInput = this.makeInput("Worktree folder name", (value, cx) => { this.worktreeName = value; cx.notify(); });
    this.removeInput = this.makeInput("Press Enter to remove", (value, cx) => { this.removeName = value; cx.notify(); });
    cx.timer.every(15000, cx => this.refresh(cx));
    cx.spawn(async cx => {
      for (;;) this.command(await nextCommand(), cx);
    });
    this.refresh(cx);
  }

  makeInput(placeholder, change) {
    const input = InputState.new({ value: "", placeholder });
    input.on("change", (_event, cx) => change(input.value(), cx));
    input.on("submit", (_event, cx) => this.command("enter", cx));
    return input;
  }

  activeInput() { return this.mode === "list" ? this.filterInput : this.mode === "branches" ? this.branchInput : this.mode === "name" ? this.nameInput : this.removeInput; }
  visibleGroups() { return filterGroups(this.groups, this.filter); }
  visibleEntries() { return visibleEntries(this.groups, this.filter); }
  selectFirst() { this.selected = selectedId(this.groups, this.filter, null); }
  ensureSelection() { this.selected = selectedId(this.groups, this.filter, this.selected); }
  selectedEntry() { return this.visibleEntries().find(({ group, entry }) => idOf(group, entry) === this.selected) ?? null; }
  shownBranches() { return filterBranches(this.branches, this.branchFilter); }
  windowHeight() {
    if (this.mode === "list") return listWindowHeight(this.groups, this.filter);
    if (this.mode === "branches") return Math.min(720, Math.max(300, 130 + this.shownBranches().length * 34));
    return 300;
  }

  move(delta, cx) {
    const items = this.mode === "branches" ? this.shownBranches() : this.visibleEntries();
    if (!items.length) return;
    if (this.mode === "branches") {
      this.branchAt = moveIndex(this.branchAt, items.length, delta);
      this.branchScroll.scroll_to_item(this.branchAt);
    } else {
      this.selected = moveSelectedId(this.groups, this.filter, this.selected, delta);
      const index = selectedScrollIndex(this.groups, this.filter, this.selected);
      if (index >= 0) this.listScroll.scroll_to_item(index);
    }
    this.activeInput().focus();
    cx.notify();
  }

  focusRequestedInput(screen) {
    if (this.focusRequests.take(screen)) this.activeInput().focus();
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true; this.loading = this.groups.length === 0; cx.notify();
    cx.spawn(async cx => {
      try {
        const paneList = panes(); const spaceList = spaces();
        const paneFolders = new Map(spaceList.map(space => [space.id, folderOf(space, paneList)]));
        const found = new Map();
        for (const space of spaceList) {
          const folder = folderOf(space, paneList); if (!folder) continue;
          const machine = space.machine ?? null;
          const [top, common] = await Promise.all([git(folder, ["rev-parse", "--show-toplevel"], machine), git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], machine)]);
          if (!top.ok || !common.ok) continue;
          const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
          const key = groupKey(machine, main);
          if (!found.has(key)) {
            const bare = await git(common.out, ["rev-parse", "--is-bare-repository"], machine);
            found.set(key, { key, machine, main, name: repoName(main), folder: top.out, bare: bare.ok && bare.out === "true" });
          }
        }
        this.groups = await Promise.all([...found.values()].map(async group => {
          const list = await git(group.main, ["worktree", "list", "--porcelain"], group.machine);
          if (!list.ok) return { ...group, entries: [], error: list.err || "Could not list worktrees." };
          const checkoutList = worktrees(list.out, !group.bare);
          const entries = await Promise.all(checkoutList.map(async entry => {
            const [status, tracking] = await Promise.all([
              git(entry.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], group.machine),
              git(entry.path, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], group.machine),
            ]);
            const space = spaceForWorktree(spaceList, paneFolders, group.machine, entry, checkoutList);
            return { ...entry, dirty: status.ok ? Boolean(status.out) : null, ...trackingStatus(tracking.ok ? tracking.out : ""), space };
          }));
          return { ...group, entries, error: "" };
        }));
        if (this.mode === "list") this.error = this.groups.length ? "" : "Open a Git repository in a Herdr space to manage its worktrees.";
        this.ensureSelection();
        setShared(CACHE_KEY, { savedAt: Date.now(), groups: cacheSnapshot(this.groups) });
      } catch (error) { if (this.mode === "list") this.error = String(error?.message ?? error); }
      finally {
        this.loading = false; this.refreshing = false; cx.notify();
      }
    });
  }

  startCreate(group, cx) {
    this.mode = "branches"; this.focusRequests.request("branches"); this.createGroup = group; this.branches = []; this.branchLoading = true; this.branchAt = 0; this.branchFilter = ""; this.branchInput.set_value(""); this.error = "";
    cx.notify();
    cx.spawn(async cx => {
      try {
        const result = await git(group.main, ["for-each-ref", "--format=%(refname:short)", "refs/heads"], group.machine);
        if (!result.ok) this.error = result.err || "Could not list branches.";
        else {
          this.branches = eligibleBranches(result.out.split("\n").filter(Boolean), group.entries);
          if (!this.branches.length) this.error = "All local branches already have a worktree.";
        }
      } catch (error) { this.error = String(error?.message ?? error); }
      finally {
        this.branchLoading = false;
        cx.notify();
      }
    });
  }

  chooseBranch(cx) {
    const branch = this.shownBranches()[this.branchAt];
    if (!branch) return;
    this.branch = branch; this.worktreeName = branch; this.mode = "name"; this.focusRequests.request("name"); this.nameInput.set_value(branch); cx.notify();
  }

  async machineHome(machine) {
    if (!machine) return home();
    let result;
    try { result = await exec("sh", ["-c", 'printf %s "$HOME"'], { on: machine }); } catch {}
    if (!result || result.code !== 0 || !result.stdout.trim()) result = await exec("powershell.exe", ["-NoProfile", "-Command", "[Console]::Write($HOME)"], { on: machine });
    if (result.code !== 0 || !result.stdout.trim()) throw new Error("Could not find the remote home folder.");
    return result.stdout.trim().replace(/\\/g, "/");
  }

  createWorktree(cx) {
    const name = this.worktreeName?.trim();
    if (!name || !slug(name) || !this.createGroup || !this.branch) { this.error = "Enter a valid folder name."; return cx.notify(); }
    const group = this.createGroup; this.error = "Creating worktree…"; cx.notify();
    cx.spawn(async cx => {
      try {
        const userHome = await this.machineHome(group.machine);
        const path = worktreeDestination(userHome, group.name, name);
        const result = await git(group.main, ["worktree", "add", path, this.branch], group.machine);
        if (!result.ok) throw new Error(result.err || "git worktree add failed.");
        setShared(CACHE_KEY, null);
        this.close();
        run("space.new", { folder: path, machine: group.machine });
      } catch (error) { this.error = String(error?.message ?? error); cx.notify(); }
    });
  }

  open(entry, group) {
    this.close();
    if (entry.space) run("space.select", { id: entry.space.id });
    else run("space.new", { folder: entry.path, machine: group.machine });
  }
  startRemove(entry, group, cx) {
    if (entry.main) {
      this.error = "The repository's main checkout cannot be removed.";
      return cx.notify();
    }
    this.mode = "remove"; this.removeEntry = entry; this.removeGroup = group; this.removeDirty = false; this.removeLoading = true; this.cleanupPath = null; this.removeName = ""; this.removeInput.set_value(""); this.error = ""; this.errorCopied = false; this.focusRequests.request("remove");
    cx.notify();
    cx.spawn(async cx => {
      try {
        const status = await git(entry.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], group.machine);
        if (!status.ok) throw new Error(status.err || "Could not inspect worktree changes.");
        this.removeDirty = Boolean(status.out);
      } catch (error) { this.error = String(error?.message ?? error); }
      finally { this.removeLoading = false; cx.notify(); }
    });
  }

  async worktreeStillRegistered(entry, group) {
    const list = await git(group.main, ["worktree", "list", "--porcelain"], group.machine);
    if (!list.ok) throw new Error(list.err || "Could not verify worktree removal.");
    return worktrees(list.out).some(checkout => pathContains(checkout.path, entry.path) && pathContains(entry.path, checkout.path));
  }

  removeWorktree(cx) {
    const entry = this.removeEntry; const group = this.removeGroup;
    if (!entry || !group || this.removeLoading) return;
    const name = worktreePathName(entry.path);
    if (this.removeDirty && !folderNameMatches(this.removeName, name)) {
      this.errorCopied = false;
      this.error = `Type ${name} to confirm removal of the changed worktree.`;
      return cx.notify();
    }
    this.removeLoading = true; this.error = ""; this.errorCopied = false; cx.notify();
    cx.spawn(async cx => {
      try {
        // Close terminals before removal: they can retain directory handles on Windows.
        if (entry.space) run("space.close", { id: entry.space.id, confirmed: true });
        const result = await git(group.main, ["worktree", "remove", "--force", entry.path], group.machine);
        if (result.ok) {
          this.finishRemoval(cx);
          return;
        }
        if (!await this.worktreeStillRegistered(entry, group)) {
          this.mode = "cleanup"; this.cleanupPath = entry.path; this.removeName = ""; this.removeInput.set_value(""); this.errorCopied = false;
          this.error = `${result.err || "Git removed the worktree registration but left its folder."} Type the folder name to delete the remaining folder.`;
          this.focusRequests.request("cleanup");
          return;
        }
        throw new Error(result.err || "git worktree remove failed.");
      } catch (error) { this.error = String(error?.message ?? error); }
      finally { this.removeLoading = false; cx.notify(); }
    });
  }

  finishRemoval(cx) {
    setShared(CACHE_KEY, null);
    this.mode = "list"; this.removeEntry = null; this.removeGroup = null; this.cleanupPath = null; this.removeName = ""; this.error = ""; this.errorCopied = false;
    this.focusRequests.request("list");
    this.refresh(cx);
    cx.notify();
  }

  cleanupRemaining(cx) {
    const path = this.cleanupPath; const name = worktreePathName(path);
    if (!path || this.removeLoading) return;
    if (!folderNameMatches(this.removeName, name)) {
      this.errorCopied = false;
      this.error = `Type ${name} to confirm deletion of the remaining folder.`;
      return cx.notify();
    }
    this.removeLoading = true; this.error = ""; this.errorCopied = false; cx.notify();
    cx.spawn(async cx => {
      try {
        let result;
        try {
          const escaped = path.replace(/'/g, "''");
          result = await exec("powershell.exe", ["-NoProfile", "-Command", `Remove-Item -LiteralPath '${escaped}' -Recurse -Force -ErrorAction Stop`], { on: this.removeGroup.machine });
        } catch {}
        if (!result || result.code !== 0) result = await exec("rm", ["-rf", path], { on: this.removeGroup.machine });
        if (result.code !== 0) throw new Error((result.stderr ?? result.stdout ?? "Could not delete the remaining worktree folder.").trim());
        this.finishRemoval(cx);
      } catch (error) { this.error = String(error?.message ?? error); }
      finally { this.removeLoading = false; cx.notify(); }
    });
  }
  close() { const overlay = props()?.overlay; if (overlay) closeOverlay(overlay); }

  command(command, cx) {
    command = commandName(command);
    if (command === "escape") {
      if ((this.mode === "remove" || this.mode === "cleanup") && this.removeLoading) return;
      if (this.mode === "list") return this.close();
      this.mode = this.mode === "name" ? "branches" : "list";
      this.focusRequests.request(this.mode);
      return cx.notify();
    }
    if (command === "down" && this.mode !== "name") return this.move(1, cx);
    if (command === "up" && this.mode !== "name") return this.move(-1, cx);
    if (command === "enter") {
      if (this.mode === "branches") return this.chooseBranch(cx);
      if (this.mode === "name") return this.createWorktree(cx);
      if (this.mode === "remove") return this.removeWorktree(cx);
      if (this.mode === "cleanup") return this.cleanupRemaining(cx);
      const selected = this.selectedEntry(); if (selected) return this.open(selected.entry, selected.group);
    }
    if (command === "new" && this.mode === "list") { const selected = this.selectedEntry(); if (selected) return this.startCreate(selected.group, cx); }
    if (command === "remove" && this.mode === "list") { const selected = this.selectedEntry(); if (selected) return this.startRemove(selected.entry, selected.group, cx); }
  }

  badge(label, color) {
    return div().flex_none().h(18).px(6).flex().items_center().rounded(5).bg(`${color}26`).text_size(10.5).font_semibold().text_color(color).child(label);
  }

  trackingStatus(entry, t) {
    return h_flex().flex_none().gap(5).items_center().text_size(10.5).font_semibold()
      .when(entry.ahead > 0, el => el.child(div().text_color(t.accent).child(`↑${entry.ahead}`)))
      .when(entry.behind > 0, el => el.child(div().text_color(t.blocked).child(`↓${entry.behind}`)));
  }

  worktreeRow(entry, group, index, count, t) {
    const selected = this.selected === idOf(group, entry);
    const active = Boolean(entry.space?.active);
    const folderName = worktreePathName(entry.path);
    // Bridge the 1px sibling gap without overlapping the next rail; overlap
    // would make the shared edge visibly darker at some display scales.
    const connector = div().relative().flex_none().w(16).h_full()
      .child(div().absolute().left(5).top(index === 0 ? 1 : 0).bottom(index === count - 1 ? 17 : -1).w(1).bg(`${t.dim}88`))
      .child(div().absolute().left(5).top(17).w(11).h(1).bg(`${t.dim}88`));
    const details = h_flex().flex_1().min_w(0).gap(10).items_center()
      .child(div().min_w(0).truncate().font_semibold().text_color(t.foreground).child(folderName))
      .child(h_flex().flex_none().gap(3).items_center().text_color(t.dim)
        .child(svg("mods/worktrees/branch.svg").size(13))
        .child(div().truncate().text_size(11).child(entry.branch)));
    const metadata = h_flex().flex_none().gap(4).items_center()
      .when(active, el => el.child(this.badge("Current", t.accent)))
      .when(Boolean(entry.space) && !active, el => el.child(this.badge("Open", t.accent)))
      .child(this.trackingStatus(entry, t))
      .when(entry.dirty === true, el => el.child(div().flex_none().size(7).rounded_full().bg(t.blocked)));
    const content = h_flex().flex_1().min_w(0).h_full().px(6).gap(9).items_center().rounded(7).bg(selected ? t.selected : t.surface).hover(state => state.bg(t.hover))
      .child(details)
      .child(metadata);
    return h_flex().id(`worktree-${group.key}-${index}`).flex_none().h(34).px(10).gap(4).items_center().cursor_pointer()
      .on_click((_event, cx) => { this.selected = idOf(group, entry); this.activeInput().focus(); cx.notify(); })
      .child(connector)
      .child(content);
  }

  loadingView(t, label) {
    return v_flex().flex_1().items_center().justify_center().gap(10).text_color(t.muted)
      .child(svg("mods/worktrees/spinner.svg").size(22).spin(900))
      .child(label);
  }

  inputField(input, t, screen) {
    return div().flex_none().on_size_change(() => this.focusRequestedInput(screen))
      .on_key_down((event, cx) => {
        if (["up", "down", "escape"].includes(event.key)) {
          this.command(event.key, cx);
          cx.stop_propagation();
        }
      })
      .child(Input.new(input).h(34).px(10).items_center().rounded(6).border(1)
        .border_color(t.accent).bg(t.background).text_color(t.foreground));
  }

  shortcut(command, fallback) {
    const binding = keys().find(key => key.section === "mod:worktrees" && key.action === `worktrees.${command}`)?.keys;
    return (binding ?? fallback).split("-").map(part => ({ alt: "Alt", ctrl: "Ctrl", shift: "Shift" }[part] ?? part.toUpperCase())).join("+");
  }

  renderList(t) {
    const groups = this.visibleGroups();
    // A ScrollHandle can reveal only direct children. Keep one direct child per
    // worktree (with the repository heading in the first one) so arrow-key
    // navigation can reveal a selected row without virtualizing the list.
    const rows = v_flex().id("worktrees-list").size_full().gap(1).pb(5).overflow_y_scroll().track_scroll(this.listScroll).children(groups.flatMap((group, groupIndex) => {
      const summary = groupSummary(group.entries);
      const summaryText = `${summary.total} ${summary.total === 1 ? "worktree" : "worktrees"} · ${summary.open} open${summary.changed ? ` · ${summary.changed} changes` : ""}`;
      const header = v_flex().gap(1)
        .child(h_flex().items_center().gap(8)
          .child(div().flex_1().truncate().font_semibold().text_color(t.foreground).child(group.name))
          .when(Boolean(group.machine), header => header.child(div().text_size(11).text_color(t.dim).child(group.machine))))
        .child(h_flex().min_w(0).gap(10).items_center()
          .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(group.main))
          .child(div().flex_none().text_size(11).text_color(t.muted).child(summaryText)));
      const afterGroup = groupIndex < groups.length - 1 ? 9 : 0;
      if (!group.entries.length) return [v_flex().flex_none().gap(4).mb(afterGroup)
        .child(header)
        .when(Boolean(group.error), el => el.child(div().text_color(t.blocked).child(group.error)))];
      return group.entries.map((entry, index) => v_flex().flex_none()
        .when(index === 0, el => el.gap(4).child(header).when(Boolean(group.error), item => item.child(div().text_color(t.blocked).child(group.error))))
        .when(index === group.entries.length - 1, el => el.mb(afterGroup))
        .child(this.worktreeRow(entry, group, index, group.entries.length, t)));
    }));
    const list = div().relative().flex_1().min_h(0).child(rows).child(Scrollbar.vertical("worktrees-list").absolute().inset_0());
    return v_flex().flex_1().min_h(0).gap(10)
      .child(this.inputField(this.filterInput, t, "list"))
      .when(this.loading, el => el.child(this.loadingView(t, "Loading worktrees…")))
      .when(!this.loading, el => el
        .when(Boolean(this.error), item => item.child(div().text_color(t.muted).child(this.error)))
        .when(groups.length > 0, item => item.child(list)));
  }

  renderBranches(t) {
    const branches = this.shownBranches();
    const rows = v_flex().id("branch-list").size_full().gap(2).overflow_y_scroll().track_scroll(this.branchScroll).children(branches.map((branch, index) =>
      h_flex().id(`branch-${index}`).flex_none().h(34).px(10).items_center().rounded(6).bg(index === this.branchAt ? t.selected : t.surface).hover(state => state.bg(t.hover)).cursor_pointer()
        .on_click((_event, cx) => { this.branchAt = index; this.activeInput().focus(); cx.notify(); })
        .child(div().truncate().text_color(t.foreground).child(branch)),
    ));
    const list = div().relative().flex_1().min_h(0).child(rows).child(Scrollbar.vertical("branch-list").absolute().inset_0());
    return v_flex().flex_1().min_h(0).gap(10)
      .when(this.branchLoading, el => el.child(this.loadingView(t, "Loading branches…")))
      .when(!this.branchLoading, el => el
        .child(div().text_color(t.muted).child(`New worktree in ${this.createGroup?.name ?? "repository"}`))
        .child(this.inputField(this.branchInput, t, "branches"))
        .when(Boolean(this.error), item => item.child(div().text_color(t.blocked).child(this.error)))
        .child(list));
  }

  renderName(t) {
    return v_flex().flex_1().gap(10)
      .child(div().text_color(t.muted).child(`Create a worktree for ${this.branch ?? "the selected branch"}.`))
      .child(div().text_size(11).text_color(t.dim).child("Folder name"))
      .child(this.inputField(this.nameInput, t, "name"))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().text_size(11).text_color(t.dim).child("Enter creates the worktree · Esc returns to branches"));
  }

  renderRemoval(t) {
    const entry = this.removeEntry;
    const name = worktreePathName(this.cleanupPath ?? entry?.path);
    const cleanup = this.mode === "cleanup";
    const requiresName = cleanup || this.removeDirty;
    return v_flex().flex_1().gap(10)
      .child(div().text_color(t.muted).child(cleanup ? `Git unregistered this worktree but left ${this.cleanupPath}.` : `Remove ${entry?.branch ?? "the selected branch"} at ${entry?.path ?? ""}. The branch will remain.`))
      .when(this.removeLoading, el => el.child(this.loadingView(t, cleanup ? "Deleting remaining folder…" : "Checking worktree…")))
      .when(!this.removeLoading, el => el
        .when(this.removeDirty, item => item.child(div().text_color(t.blocked).child("This worktree has uncommitted or untracked changes.")))
        .when(requiresName, item => item.child(div().text_size(11).text_color(t.dim).child(`Type ${name} to confirm.`)))
        .child(this.inputField(this.removeInput, t, cleanup ? "cleanup" : "remove"))
        .when(Boolean(this.error), item => item.child(v_flex().gap(5)
          .child(div().text_color(t.blocked).child(this.error))
          .child(div().flex_none().self_start().px(7).py(3).rounded(5).bg(t.surface).hover(state => state.bg(t.hover)).cursor_pointer().text_size(11).text_color(t.foreground)
            .child(this.errorCopied ? "Copied error" : "Copy error")
            .on_click((_event, cx) => { cx.write_to_clipboard(this.error); this.errorCopied = true; cx.notify(); }))))
        .child(div().text_size(11).text_color(t.dim).child(cleanup ? "Enter deletes the remaining folder · Esc keeps it" : "Enter removes the worktree · Esc cancels")));
  }

  render() {
    const t = theme();
    const targetHeight = this.windowHeight();
    const content = this.mode === "list" ? this.renderList(t) : this.mode === "branches" ? this.renderBranches(t) : this.mode === "name" ? this.renderName(t) : this.renderRemoval(t);
    const hint = this.mode === "list" ? `↑↓ select · Enter open · ${this.shortcut("new", "alt-shift-n")} new · ${this.shortcut("remove", "alt-shift-r")} remove · Esc close` : this.mode === "branches" ? "↑↓ select branch · Enter continue · Esc back" : this.mode === "name" ? "Enter create · Esc back" : "Esc cancel";
    const title = this.mode === "list" ? "Worktrees" : this.mode === "branches" ? "Choose a branch" : this.mode === "name" ? "Name worktree" : this.mode === "cleanup" ? "Delete remaining folder?" : "Remove worktree?";
    return v_flex().id("worktrees").w_full().h(targetHeight).p(14).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(title))
      .child(content)
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }
}

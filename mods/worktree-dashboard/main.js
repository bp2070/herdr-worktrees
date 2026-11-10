import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, v_virtual_list, InputState, Input, Scrollbar, VirtualListScrollHandle } from "gpui-base";
import { closeOverlay, exec, home, keys, nextCommand, openOverlay, panes, props, run, spaces, theme } from "herdr";
import {
  eligibleBranches, filterBranches, filterGroups, FocusRequests, groupKey, idOf, moveIndex, moveSelectedId,
  repoName, selectedId, slug, spaceForWorktree, visibleEntries, worktreeDestination, worktrees,
} from "./model.js";

function folderOf(space, paneList = panes()) {
  const tabs = new Set((space.tabs ?? []).map(tab => tab.id));
  return paneList.find(pane => tabs.has(pane.tab) && pane.cwd)?.cwd ?? space.folder ?? null;
}

async function git(cwd, args, on) {
  const result = await exec("git", args, { cwd, on });
  return { ok: result.code === 0, out: (result.stdout ?? "").trim(), err: (result.stderr ?? result.stdout ?? "").trim() };
}

export default class WorktreeDashboard extends View {
  init(_props, cx) {
    this.loading = true; this.refreshing = false; this.error = ""; this.groups = []; this.selected = null; this.focusRequests = new FocusRequests();
    this.worktreeScroll = VirtualListScrollHandle.new();
    this.branchScroll = VirtualListScrollHandle.new();
    this.mode = "list";
    this.filter = ""; this.branchFilter = ""; this.branchAt = 0; this.branches = []; this.branchLoading = false; this.createGroup = null; this.branch = null;
    this.filterInput = this.makeInput("Filter worktrees by branch name…", (value, cx) => { this.filter = value; this.selectFirst(); cx.notify(); });
    this.branchInput = this.makeInput("Filter branches…", (value, cx) => { this.branchFilter = value; this.branchAt = 0; cx.notify(); });
    this.nameInput = this.makeInput("Worktree folder name", (value, cx) => { this.worktreeName = value; cx.notify(); });
    // The input is absent during initial loading. refresh() focuses it only
    // after the list screen is mounted inside the native overlay.
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

  activeInput() { return this.mode === "list" ? this.filterInput : this.mode === "branches" ? this.branchInput : this.nameInput; }
  visibleGroups() { return filterGroups(this.groups, this.filter); }
  visibleEntries() { return visibleEntries(this.groups, this.filter); }
  selectFirst() { this.selected = selectedId(this.groups, this.filter, null); }
  ensureSelection() { this.selected = selectedId(this.groups, this.filter, this.selected); }
  selectedEntry() { return this.visibleEntries().find(({ group, entry }) => idOf(group, entry) === this.selected) ?? null; }
  shownBranches() { return filterBranches(this.branches, this.branchFilter); }

  move(delta, cx) {
    const items = this.mode === "branches" ? this.shownBranches() : this.visibleEntries();
    if (!items.length) return;
    if (this.mode === "branches") {
      this.branchAt = moveIndex(this.branchAt, items.length, delta);
      this.branchScroll.scroll_to_item(this.branchAt, "center");
    } else {
      this.selected = moveSelectedId(this.groups, this.filter, this.selected, delta);
      const at = this.listItems().findIndex(item => item.kind === "worktree" && idOf(item.group, item.entry) === this.selected);
      if (at >= 0) this.worktreeScroll.scroll_to_item(at, "center");
    }
    this.activeInput().focus();
    cx.notify();
  }

  scheduleRequestedFocus(cx) {
    const screen = this.focusRequests.take(this.mode);
    if (!screen) return;
    cx.timer.after(100, () => {
      if (this.mode === screen) this.activeInput().focus();
    });
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
          if (!found.has(key)) found.set(key, { key, machine, main, name: repoName(main), folder: top.out });
        }
        this.groups = await Promise.all([...found.values()].map(async group => {
          const list = await git(group.main, ["worktree", "list", "--porcelain"], group.machine);
          if (!list.ok) return { ...group, entries: [], error: list.err || "Could not list worktrees." };
          const checkoutList = worktrees(list.out);
          const entries = await Promise.all(checkoutList.map(async entry => {
            const status = await git(entry.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], group.machine);
            const space = spaceForWorktree(spaceList, paneFolders, group.machine, entry, checkoutList);
            return { ...entry, dirty: status.ok ? Boolean(status.out) : null, space };
          }));
          return { ...group, entries, error: "" };
        }));
        this.error = this.groups.length ? "" : "Open a Git repository in a Herdr space to manage its worktrees.";
        this.ensureSelection();
      } catch (error) { this.error = String(error?.message ?? error); }
      finally {
        this.loading = false; this.refreshing = false; cx.notify();
        this.scheduleRequestedFocus(cx);
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
        this.scheduleRequestedFocus(cx);
      }
    });
  }

  chooseBranch(cx) {
    const branch = this.shownBranches()[this.branchAt];
    if (!branch) return;
    this.branch = branch; this.worktreeName = branch; this.mode = "name"; this.focusRequests.request("name"); this.nameInput.set_value(branch); cx.notify(); this.scheduleRequestedFocus(cx);
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
        run("space.new", { folder: path, machine: group.machine });
        this.mode = "list"; this.error = ""; this.focusRequests.request("list"); this.refresh(cx);
      } catch (error) { this.error = String(error?.message ?? error); cx.notify(); }
    });
  }

  open(entry, group) { if (entry.space) run("space.select", { id: entry.space.id }); else run("space.new", { folder: entry.path, machine: group.machine }); }
  remove(entry) {
    if (entry.space && !entry.main) openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: entry.space.id, action: "remove" } });
  }
  close() { const overlay = props()?.overlay; if (overlay) closeOverlay(overlay); }

  command(command, cx) {
    if (command === "escape") {
      if (this.mode === "list") return this.close();
      this.mode = this.mode === "name" ? "branches" : "list";
      this.focusRequests.request(this.mode);
      cx.notify();
      return this.scheduleRequestedFocus(cx);
    }
    if (command === "down" && this.mode !== "name") return this.move(1, cx);
    if (command === "up" && this.mode !== "name") return this.move(-1, cx);
    if (command === "enter") {
      if (this.mode === "branches") return this.chooseBranch(cx);
      if (this.mode === "name") return this.createWorktree(cx);
      const selected = this.selectedEntry(); if (selected) return this.open(selected.entry, selected.group);
    }
    if (command === "new" && this.mode === "list") { const selected = this.selectedEntry(); if (selected) return this.startCreate(selected.group, cx); }
    if (command === "remove" && this.mode === "list") { const selected = this.selectedEntry(); if (selected) return this.remove(selected.entry); }
  }

  worktreeRow(entry, group, index, t) {
    const selected = this.selected === idOf(group, entry); const status = entry.dirty === null ? "status unavailable" : entry.dirty ? "changes" : "clean";
    return h_flex().id(`worktree-${group.key}-${index}`).flex_none().h(38).px(10).gap(9).items_center().rounded(6).cursor_pointer().bg(selected ? t.selected : t.surface).hover(state => state.bg(t.hover))
      .on_click((_event, cx) => { this.selected = idOf(group, entry); this.activeInput().focus(); cx.notify(); })
      .child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(entry.branch))
      .when(entry.main, el => el.child(div().flex_none().text_size(11).text_color(t.dim).child("main")))
      .when(Boolean(entry.space), el => el.child(div().flex_none().text_size(11).text_color(t.accent).child("open")))
      .child(div().flex_none().text_size(11).text_color(entry.dirty ? t.blocked : t.done).child(status));
  }

  loadingView(t, label) {
    return v_flex().flex_1().items_center().justify_center().gap(10).text_color(t.muted)
      .child(svg("mods/worktree-dashboard/spinner.svg").size(22).spin(900))
      .child(label);
  }

  inputField(input, t) {
    return Input.new(input).h(34).px(10).items_center().rounded(6).border(1)
      .border_color(t.accent).bg(t.background).text_color(t.foreground)
      .on_key_down((event, cx) => {
        if (["up", "down", "escape"].includes(event.key)) {
          this.command(event.key, cx);
          cx.stop_propagation();
        }
      });
  }

  shortcut(command, fallback) {
    const binding = keys().find(key => key.section === "mod:worktree-dashboard" && key.action === `worktree-dashboard.${command}`)?.keys;
    return (binding ?? fallback).split("-").map(part => ({ alt: "Alt", ctrl: "Ctrl", shift: "Shift" }[part] ?? part.toUpperCase())).join("+");
  }

  listItems() {
    return this.visibleGroups().flatMap(group => [
      { kind: "group", group },
      ...(group.error ? [{ kind: "error", group }] : []),
      ...group.entries.map((entry, entryIndex) => ({ kind: "worktree", group, entry, entryIndex })),
    ]);
  }

  renderList(t) {
    const items = this.listItems();
    const row = (item, index) => {
      if (item.kind === "group") return v_flex().id(`group-${item.group.key}`).flex_none().h(48).px(4).justify_center().gap(1)
        .child(h_flex().items_center().gap(8)
          .child(div().flex_1().truncate().font_semibold().text_color(t.foreground).child(item.group.name))
          .when(Boolean(item.group.machine), header => header.child(div().text_size(11).text_color(t.dim).child(item.group.machine))))
        .child(div().truncate().text_size(11).text_color(t.dim).child(item.group.main));
      if (item.kind === "error") return h_flex().id(`error-${item.group.key}`).flex_none().h(24).px(4).items_center().text_color(t.blocked).child(item.group.error);
      return this.worktreeRow(item.entry, item.group, item.entryIndex, t).id(`worktree-list-${index}`);
    };
    const rows = v_virtual_list("worktree-dashboard-list", items.length, items.map(item => item.kind === "group" ? 48 : item.kind === "error" ? 24 : 38), item => {
      const row = items[item];
      return row.kind === "group" ? `group-${row.group.key}` : row.kind === "error" ? `error-${row.group.key}` : idOf(row.group, row.entry);
    }, range => items.slice(range.start, range.end).map((item, index) => row(item, range.start + index))).track_scroll(this.worktreeScroll);
    const list = div().relative().flex_1().min_h(0).child(rows).child(Scrollbar.vertical("worktree-dashboard-list").absolute().inset_0());
    return v_flex().flex_1().min_h(0).gap(10)
      .when(this.loading, el => el.child(this.loadingView(t, "Loading worktrees…")))
      .when(!this.loading, el => el
        .child(this.inputField(this.filterInput, t))
        .when(Boolean(this.error), item => item.child(div().text_color(t.muted).child(this.error)))
        .when(items.length > 0, item => item.child(list)));
  }

  renderBranches(t) {
    const branches = this.shownBranches();
    const rows = v_virtual_list("branch-list", branches.length, 34, index => branches[index], range => branches.slice(range.start, range.end).map((branch, index) => {
      const at = range.start + index;
      return h_flex().id(`branch-${at}`).flex_none().h(34).px(10).items_center().rounded(6).bg(at === this.branchAt ? t.selected : t.surface).hover(state => state.bg(t.hover)).cursor_pointer()
        .on_click((_event, cx) => { this.branchAt = at; this.activeInput().focus(); cx.notify(); })
        .child(div().truncate().text_color(t.foreground).child(branch));
    })).track_scroll(this.branchScroll);
    const list = div().relative().flex_1().min_h(0).child(rows).child(Scrollbar.vertical("branch-list").absolute().inset_0());
    return v_flex().flex_1().min_h(0).gap(10)
      .when(this.branchLoading, el => el.child(this.loadingView(t, "Loading branches…")))
      .when(!this.branchLoading, el => el
        .child(div().text_color(t.muted).child(`New worktree in ${this.createGroup?.name ?? "repository"}`))
        .child(this.inputField(this.branchInput, t))
        .when(Boolean(this.error), item => item.child(div().text_color(t.blocked).child(this.error)))
        .child(list));
  }

  renderName(t) {
    return v_flex().flex_1().gap(10)
      .child(div().text_color(t.muted).child(`Create a worktree for ${this.branch ?? "the selected branch"}.`))
      .child(div().text_size(11).text_color(t.dim).child("Folder name"))
      .child(this.inputField(this.nameInput, t))
      .when(Boolean(this.error), el => el.child(div().text_color(t.blocked).child(this.error)))
      .child(div().text_size(11).text_color(t.dim).child("Enter creates the worktree · Esc returns to branches"));
  }

  render() {
    const t = theme();
    const content = this.mode === "list" ? this.renderList(t) : this.mode === "branches" ? this.renderBranches(t) : this.renderName(t);
    const hint = this.mode === "list" ? `↑↓ select · Enter open · ${this.shortcut("new", "alt-shift-n")} new · ${this.shortcut("remove", "alt-shift-r")} remove · Esc close` : this.mode === "branches" ? "↑↓ select branch · Enter continue · Esc back" : "Enter create · Esc back";
    return v_flex().id("worktree-dashboard").size_full().p(14).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(this.mode === "list" ? "Worktrees" : this.mode === "branches" ? "Choose a branch" : "Name worktree"))
      .child(content)
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }
}

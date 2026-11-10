import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, Scrollbar } from "gpui-base";
import { closeOverlay, exec, home, openOverlay, panes, props, run, spaces, theme } from "herdr";
import { eligibleBranches, filterBranches, idOf, slug, worktrees } from "./model.js";

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
    this.loading = true; this.refreshing = false; this.error = ""; this.groups = []; this.selected = null;
    this.mode = "list"; this.inputFocused = true; this.handle = cx.focus_handle();
    this.filter = ""; this.branchFilter = ""; this.branchAt = 0; this.branches = []; this.branchLoading = false; this.createGroup = null; this.branch = null;
    this.filterInput = this.makeInput("Filter worktrees by branch name…", (value, cx) => { this.filter = value; this.selectFirst(); cx.notify(); });
    this.branchInput = this.makeInput("Filter branches…", (value, cx) => { this.branchFilter = value; this.branchAt = 0; cx.notify(); });
    this.nameInput = this.makeInput("Worktree folder name", (value, cx) => { this.worktreeName = value; cx.notify(); });
    // Focus the overlay's own input after its native window has been mounted.
    // This also gives the new window keyboard ownership immediately on open.
    cx.timer.after(50, () => { if (this.mode === "list") this.filterInput.focus(); });
    cx.timer.every(15000, cx => this.refresh(cx));
    this.refresh(cx);
  }

  makeInput(placeholder, change) {
    const input = InputState.new({ value: "", placeholder });
    input.on("change", (_event, cx) => change(input.value(), cx));
    input.on("focus", (_event, cx) => { this.inputFocused = true; cx.notify(); });
    input.on("blur", (_event, cx) => { this.inputFocused = false; cx.notify(); });
    return input;
  }

  activeInput() { return this.mode === "list" ? this.filterInput : this.mode === "branches" ? this.branchInput : this.nameInput; }
  visibleGroups() {
    const filter = this.filter.trim().toLowerCase();
    return this.groups.map(group => ({ ...group, entries: group.entries.filter(entry => !filter || entry.branch.toLowerCase().includes(filter)) })).filter(group => group.entries.length || group.error);
  }
  visibleEntries() { return this.visibleGroups().flatMap(group => group.entries.map(entry => ({ group, entry }))); }
  selectFirst() { const first = this.visibleEntries()[0]; this.selected = first ? idOf(first.group, first.entry) : null; }
  ensureSelection() { if (!this.visibleEntries().some(({ group, entry }) => idOf(group, entry) === this.selected)) this.selectFirst(); }
  selectedEntry() { return this.visibleEntries().find(({ group, entry }) => idOf(group, entry) === this.selected) ?? null; }
  shownBranches() { return filterBranches(this.branches, this.branchFilter); }

  move(delta, cx) {
    const items = this.mode === "branches" ? this.shownBranches() : this.visibleEntries();
    if (!items.length) return;
    if (this.mode === "branches") this.branchAt = (this.branchAt + delta + items.length) % items.length;
    else {
      let at = items.findIndex(({ group, entry }) => idOf(group, entry) === this.selected);
      at = (at + delta + items.length) % items.length;
      this.selected = idOf(items[at].group, items[at].entry);
    }
    this.handle.focus();
    cx.notify();
  }

  refresh(cx) {
    if (this.refreshing) return;
    this.refreshing = true; this.loading = this.groups.length === 0; cx.notify();
    cx.spawn(async cx => {
      try {
        const paneList = panes(); const spaceList = spaces(); const found = new Map();
        for (const space of spaceList) {
          const folder = folderOf(space, paneList); if (!folder) continue;
          const machine = space.machine ?? null;
          const [top, common] = await Promise.all([git(folder, ["rev-parse", "--show-toplevel"], machine), git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], machine)]);
          if (!top.ok || !common.ok) continue;
          const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
          const key = `${machine ?? ""}\u0000${main}`;
          if (!found.has(key)) found.set(key, { key, machine, main, name: main.split(/[\\/]/).filter(Boolean).pop() ?? "repository", folder: top.out });
        }
        this.groups = await Promise.all([...found.values()].map(async group => {
          const list = await git(group.main, ["worktree", "list", "--porcelain"], group.machine);
          if (!list.ok) return { ...group, entries: [], error: list.err || "Could not list worktrees." };
          const checkoutList = worktrees(list.out);
          const entries = await Promise.all(checkoutList.map(async entry => {
            const status = await git(entry.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], group.machine);
            const path = entry.path.replace(/\\/g, "/");
            const space = spaceList.find(candidate => {
              const at = folderOf(candidate, paneList)?.replace(/\\/g, "/");
              return (candidate.machine ?? null) === group.machine && at && (at === path || at.startsWith(`${path}/`)) && !checkoutList.some(other => other.path !== entry.path && other.path.length > entry.path.length && (at === other.path || at.startsWith(`${other.path}/`)));
            });
            return { ...entry, dirty: status.ok ? Boolean(status.out) : null, space };
          }));
          return { ...group, entries, error: "" };
        }));
        this.error = this.groups.length ? "" : "Open a Git repository in a Herdr space to manage its worktrees.";
        this.ensureSelection();
      } catch (error) { this.error = String(error?.message ?? error); }
      finally { this.loading = false; this.refreshing = false; cx.notify(); }
    });
  }

  startCreate(group, cx) {
    this.mode = "branches"; this.createGroup = group; this.branches = []; this.branchLoading = true; this.branchAt = 0; this.branchFilter = ""; this.branchInput.set_value(""); this.error = "";
    // The branch filter is rendered only after this state change, so focus it
    // on the next native frame rather than the outgoing results view.
    cx.notify();
    cx.timer.after(50, () => this.branchInput.focus());
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
        // The branch input is absent during the centered loading screen; focus
        // it only after the chooser itself has been rendered.
        cx.timer.after(50, () => { if (this.mode === "branches") this.branchInput.focus(); });
      }
    });
  }

  chooseBranch(cx) {
    const branch = this.shownBranches()[this.branchAt];
    if (!branch) return;
    this.branch = branch; this.worktreeName = branch; this.mode = "name"; this.nameInput.set_value(branch); this.nameInput.focus(); cx.notify();
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
        const path = `${userHome}/.herdr/worktrees/${group.name}/${slug(name)}`;
        const result = await git(group.main, ["worktree", "add", path, this.branch], group.machine);
        if (!result.ok) throw new Error(result.err || "git worktree add failed.");
        run("space.new", { folder: path, machine: group.machine });
        this.mode = "list"; this.error = ""; this.refresh(cx); this.filterInput.focus();
      } catch (error) { this.error = String(error?.message ?? error); cx.notify(); }
    });
  }

  open(entry, group) { if (entry.space) run("space.select", { id: entry.space.id }); else run("space.new", { folder: entry.path, machine: group.machine }); }
  remove(entry) {
    if (entry.space && !entry.main) openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: { space: entry.space.id, action: "remove" } });
  }
  close() { const overlay = props()?.overlay; if (overlay) closeOverlay(overlay); }

  key(event, cx) {
    if (event.key === "escape") {
      if (this.mode === "list") return this.close();
      this.mode = this.mode === "name" ? "branches" : "list"; this.activeInput().focus(); return cx.notify();
    }
    if (event.key === "tab") { this.inputFocused = !this.inputFocused; if (this.inputFocused) this.activeInput().focus(); else this.handle.focus(); cx.stop_propagation(); return cx.notify(); }
    if (event.key === "/" && !this.inputFocused && this.mode !== "name") { this.inputFocused = true; this.activeInput().focus(); cx.stop_propagation(); return cx.notify(); }
    if (event.key === "down") return this.move(1, cx);
    if (event.key === "up") return this.move(-1, cx);
    if (event.key === "enter") {
      if (this.mode === "branches") return this.chooseBranch(cx);
      if (this.mode === "name") return this.createWorktree(cx);
      const selected = this.selectedEntry(); if (selected) return this.open(selected.entry, selected.group);
    }
    if (event.key === "n" && this.mode === "list" && !this.inputFocused) { const selected = this.selectedEntry(); if (selected) return this.startCreate(selected.group, cx); }
    if (event.key === "r" && this.mode === "list" && !this.inputFocused) { const selected = this.selectedEntry(); if (selected) return this.remove(selected.entry); }
  }

  worktreeRow(entry, group, index, t) {
    const selected = this.selected === idOf(group, entry); const status = entry.dirty === null ? "status unavailable" : entry.dirty ? "changes" : "clean";
    return h_flex().id(`worktree-${group.key}-${index}`).flex_none().h(38).px(10).gap(9).items_center().rounded(6).cursor_pointer().bg(selected ? t.selected : t.surface).hover(state => state.bg(t.hover))
      .on_click((_event, cx) => { this.selected = idOf(group, entry); this.handle.focus(); cx.notify(); })
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
      .border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground)
      .on_key_down((event, cx) => this.key(event, cx));
  }

  renderList(t) {
    const groups = this.visibleGroups();
    const rows = v_flex().id("worktree-dashboard-list").size_full().gap(14).overflow_y_scroll().children(groups.map(group =>
      v_flex().gap(6)
        .child(v_flex().gap(1)
          .child(h_flex().items_center().gap(8)
            .child(div().flex_1().truncate().font_semibold().text_color(t.foreground).child(group.name))
            .when(Boolean(group.machine), header => header.child(div().text_size(11).text_color(t.dim).child(group.machine))))
          .child(div().truncate().text_size(11).text_color(t.dim).child(group.main)))
        .when(Boolean(group.error), groupEl => groupEl.child(div().text_color(t.blocked).child(group.error)))
        .children(group.entries.map((entry, index) => this.worktreeRow(entry, group, index, t))),
    ));
    const list = div().relative().flex_1().min_h(0).child(rows).child(Scrollbar.vertical("worktree-dashboard-list").absolute().inset_0());
    return v_flex().flex_1().min_h(0).gap(10)
      .when(this.loading, el => el.child(this.loadingView(t, "Loading worktrees…")))
      .when(!this.loading, el => el
        .child(this.inputField(this.filterInput, t))
        .when(Boolean(this.error), item => item.child(div().text_color(t.muted).child(this.error)))
        .when(groups.length > 0, item => item.child(list)));
  }

  renderBranches(t) {
    const branches = this.shownBranches();
    const rows = v_flex().id("branch-list").size_full().gap(2).overflow_y_scroll().children(branches.map((branch, index) =>
      h_flex().id(`branch-${index}`).flex_none().h(34).px(10).items_center().rounded(6).bg(index === this.branchAt ? t.selected : t.surface).hover(state => state.bg(t.hover)).cursor_pointer()
        .on_click((_event, cx) => { this.branchAt = index; this.handle.focus(); cx.notify(); })
        .child(div().truncate().text_color(t.foreground).child(branch)),
    ));
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
    const hint = this.mode === "list" ? "/ search · Tab search/results · ↑↓ select · Enter switch · N new · R remove · Esc close" : this.mode === "branches" ? "Tab search/results · ↑↓ select branch · Enter continue · Esc back" : "Enter create · Esc back";
    return v_flex().id("worktree-dashboard").track_focus(this.handle).on_key_down((event, cx) => this.key(event, cx)).size_full().p(14).gap(10).bg(t.popover).text_size(13)
      .child(div().font_semibold().text_color(t.foreground).child(this.mode === "list" ? "Worktrees" : this.mode === "branches" ? "Choose a branch" : "Name worktree"))
      .child(content)
      .child(div().text_size(11).text_color(t.dim).child(hint));
  }
}

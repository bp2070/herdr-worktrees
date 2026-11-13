# Herdr Worktrees

A floating window for navigating Git worktrees already represented by Herdr spaces. It groups checkouts under each repository's main folder, lets the person filter and select a worktree with the keyboard, and creates a new checkout from an eligible local branch. The window follows the active Herdr theme and uses a centered spinner while Git data is loading.

![Herdr Worktrees](preview.png)

## What you see

The window has a title, then its content or a loading state. The worktree filter is visible and focused immediately, even while Git loads; the remaining space shows a centered 22px spinning branch icon above muted `Loading worktrees…` text. A recent worktree snapshot appears immediately when available while Git refreshes it in the background. The branch-chooser loading state uses the same spinner above `Loading branches…`.

The main screen has a 34px filter input and a scrollable list. Every repository group shows its short repository name, optional machine name, main checkout path, and a live visible-worktree summary (`3 worktrees · 2 open · 1 changes`). Its worktrees are sorted with worktrees already shown by a Herdr space (`open`) first, then by branch name ascending. Rows are 34px tall with a tight 1px gap between sibling worktrees, while the repository-to-list and repository-to-repository spacing remains more generous. Rows use a continuous muted tree outline beneath the repository header. The worktree folder name is shown with the Git branch beside it in brackets; the `main` label remains for the primary checkout. Compact badges show `Current` for the active Herdr space, `Open` for another open space, and Clean/Changes/Unknown Git state. The selected row content uses the theme's selected color while its tree outline remains unhighlighted.

The new-worktree flow first shows a branch filter and a scrollable local-branch list, then a name screen with a folder-name input. The name starts as the chosen branch name.

## How it behaves

The worktree filter receives focus as soon as the overlay lays out, including while the initial Git refresh is loading, and it always retains keyboard focus afterward; no list-focus state exists. The first visible worktree is selected. `↑` and `↓` wrap the highlighted result without leaving the input. `Enter` opens it. The configured new-worktree action (default `Alt+Shift+N`) starts creation in its repository, and the configured remove action (default `Alt+Shift+R`) opens safe removal for a non-main worktree that has a Herdr space. The bottom hint reads the live mod key bindings. `Esc` backs out of creation or closes the window. `Tab` has no mapping.

Creating lists local branches that are not currently checked out in any worktree. Enter on a branch continues to naming. Enter on the name creates `~/.herdr/worktrees/<repo>/<folder-name>`, checks out the selected branch there, and starts a new Herdr space. The folder name is sanitized into one safe path component.

## Built from

`mods/worktrees/mod.json` registers a `place: none` mod with a 720px-wide floating window. Its height follows the visible list content from a 260px minimum through a 760px maximum; longer lists scroll. `main.js` is a GPUI `View`; it reads spaces and panes, runs Git with `exec`, opens spaces with `space.select`/`space.new`, and opens the shipped `worktree` removal dialog with `openOverlay`. It uses `spinner.svg` with native `.spin(900)`.

`model.js` contains pure helpers for parsing `git worktree list --porcelain`, worktree sorting, branch eligibility/filtering, IDs, and safe folder slugs. Node's built-in test runner tests those helpers in `test/model.test.js`.

## Watch out

Only repositories with an existing Herdr space appear. The Worktrees window lists local branches only and intentionally omits any branch already checked out by a worktree. Removal relies on Herdr's shipped `worktree` mod. `herdr-app check` validates initial loading and eager UI construction, not keyboard focus, async Git calls, or live layout behavior.

## Done when

- `npm test` passes.
- `herdr-app check mods/worktrees` passes.
- The Worktrees window opens with its filter focused; `↑` and `↓` change the highlighted result while that input remains focused.
- The new-worktree screen shows a centered spinner while branches load, then focuses its branch filter.
- Creating a checkout opens it in a new Herdr space.

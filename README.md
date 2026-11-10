# Herdr Worktree Dashboard

A floating Herdr mod for browsing Git worktrees as grouped repository lists, switching workspaces, and creating worktrees from eligible local branches.

## Development

This repository is installed into Herdr as a directory junction:

```text
~/.config/herdr-app/mods/worktree-dashboard
  -> <repository>/mods/worktree-dashboard
```

Herdr hot-reloads edits in `mods/worktree-dashboard/`.

## Validation

```sh
npm test
npm run check
npm run validate
```

`npm test` covers the pure Git-data helpers in `model.js`. `npm run check` runs Herdr's load/render validation. It does not simulate interactive focus, keyboard, Git, or asynchronous behavior; verify those in the live app after validation.

## Use

Open or toggle the floating dashboard:

```sh
herdr-app do mod.open --name worktree-dashboard
```

The filter input retains keyboard focus. Use the mod-specific shortcuts in `keys.json`:

- `↑` / `↓` changes the highlighted result while leaving the input focused. These have mod-specific mappings because Herdr's native input consumes arrow keys before the mod can observe them.
- `Enter` opens the highlighted worktree.
- The configured **new worktree** shortcut begins the new-worktree flow (default: `Alt+Shift+N`).
- The configured **remove worktree** shortcut opens Herdr's built-in worktree removal dialog for a non-main highlighted worktree with a Herdr space (default: `Alt+Shift+R`).

The bottom hint reads Herdr's live `mod:worktree-dashboard` key bindings, so it updates when either action's mapping changes.
- `Esc` goes back or closes the dashboard. It has a mod-specific mapping because Herdr's native input consumes Escape before the mod can observe it.

`Tab` is intentionally not mapped.

The create flow lists local branches not already checked out by a worktree. It checks out the selected branch at `~/.herdr/worktrees/<repo>/<folder-name>` and opens it as a new Herdr space.

## Dependencies and assumptions

- Git must be available on each listed machine.
- The mod uses Herdr's shipped `worktree` mod for the safe removal confirmation dialog.
- A repository appears when a current Herdr space belongs to it.

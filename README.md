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

`npm test` covers pure Git-data helpers and the default `keys.json` contract. The key contract protects the input-safe mappings for `↑`, `↓`, and `Esc`, plus the default new/remove shortcuts. `npm run check` runs Herdr's load/render validation. It does not simulate interactive focus, keyboard routing, Git, or asynchronous behavior; verify those in the live app after validation.

## Use

Open or toggle the floating dashboard:

```sh
herdr-app do mod.open --name worktree-dashboard
```

Default global shortcut: `Alt+Shift+W`.

The filter input retains keyboard focus. Use the mod-specific shortcuts in `keys.json`:

- `↑` / `↓` changes the highlighted result while leaving the input focused. These have mod-specific mappings because Herdr's native input consumes arrow keys before the mod can observe them.
- `Enter` opens the highlighted worktree.
- The configured **new worktree** shortcut begins the new-worktree flow (default: `Alt+Shift+N`).
- The configured **remove worktree** shortcut opens Herdr's built-in worktree removal dialog for a non-main highlighted worktree with a Herdr space (default: `Alt+Shift+R`).

- `Esc` goes back or closes the dashboard. It has a mod-specific mapping because Herdr's native input consumes Escape before the mod can observe it.

The bottom hint reads Herdr's live `mod:worktree-dashboard` key bindings, so it updates when either action's mapping changes.

`Tab` is intentionally not mapped.

The create flow lists local branches not already checked out by a worktree. It checks out the selected branch at `~/.herdr/worktrees/<repo>/<folder-name>` and opens it as a new Herdr space.

## Future end-to-end testing

Herdr currently exposes `herdr-app check` for headless initial-load/render validation, but it cannot open a live overlay, synthesize keyboard input, or assert native focus. A future end-to-end suite should use Windows UI Automation against a running Herdr window to:

1. Open `worktree-dashboard` with `herdr-app do mod.open --name worktree-dashboard`.
2. Assert the filter input owns keyboard focus.
3. Send `↑`, `↓`, `Enter`, `Esc`, and the configured new/remove shortcuts.
4. Verify focus remains in the input while the highlighted row changes.
5. Exercise the branch chooser and worktree-name screens.

Run those tests in a dedicated Herdr profile/configuration and fixture Git repository so they cannot create or remove a person's real worktrees. Keep them separate from `npm test`: native UI tests require a visible desktop session and are expected to be slower and more environment-dependent.

### Required before list auto-scroll

Do not replace the regular worktree or branch lists with `v_virtual_list` just to implement selected-row auto-scroll until this end-to-end harness exists. Two virtual-list implementations passed `herdr-app check` but rendered no rows in the live window, so initial-load validation is not enough to safely verify that change. The end-to-end suite must first prove that grouped worktree and branch rows render, then assert that moving selection past the viewport scrolls the selected row into view.

## Dependencies and assumptions

- Git must be available on each listed machine.
- The mod uses Herdr's shipped `worktree` mod for the safe removal confirmation dialog.
- A repository appears when a current Herdr space belongs to it.

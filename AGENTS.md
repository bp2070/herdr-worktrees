# AGENTS.md

## Project

This repository packages the **Herdr Worktrees** mod: a floating native GPUI window for browsing Git worktrees represented by Herdr spaces, opening them, and creating eligible local-branch worktrees.

The repository is installed into Herdr as a directory junction at:

```text
~/.config/herdr-app/mods/worktrees -> <repository>/mods/worktrees
```

Herdr hot-reloads changes under `mods/worktrees/`.

## Repository layout

- `mods/worktrees/main.js` — the Herdr/GPUI view, asynchronous Git operations, and user interactions.
- `mods/worktrees/model.js` — pure data, navigation, path, and focus helpers. Keep this module independent of Herdr and GPUI imports.
- `mods/worktrees/mod.json` — mod registration and floating-window dimensions.
- `mods/worktrees/spinner.svg` — loading indicator asset.
- `keys.json` — global and `mod:worktrees` keyboard bindings.
- `test/model.test.js` — Node built-in test coverage for `model.js`.
- `test/keys.test.js` — default keyboard-contract coverage.
- `RECIPE.md` — user-facing implementation brief; update it when visible behavior or implementation assumptions materially change.
- `README.md` — development, installation, validation, and operational guidance.

`mods/worktrees/gpui-kit.d.ts` and `mods/worktrees/jsconfig.json` are local editor/type-support files and are ignored by Git. Treat Herdr-provided type declarations as the API source of truth; do not hand-maintain generated declarations.

## Commands

```sh
npm test       # Run all pure-helper and key-contract tests
npm run check  # Run Herdr's initial load/render validation
npm run validate  # Run test followed by check
```

For any mod change, run `npm run validate`. `herdr-app check` catches initial-load and eager-render failures, but does **not** validate live layout, focus routing, async behavior, or keyboard handling. Manually exercise relevant flows in the running Herdr app after UI or interaction changes.

## Implementation conventions

- Use ES modules and Node's built-in `node:test` runner; do not add a test framework without a clear need.
- Put deterministic, environment-independent logic in `model.js` and add or update focused unit tests with it.
- Keep `main.js` free to handle Herdr integration, rendering, state, and effects. Do not introduce DOM, HTML/CSS, Node APIs, or timer APIs: Herdr mods use GPUI-kit, not a browser runtime.
- Preserve cross-platform path handling. Normalize Windows separators where paths are compared, avoid prefix-based containment mistakes, and sanitize a requested worktree name to one safe path component.
- Preserve machine boundaries when associating spaces with worktrees.
- Maintain the input-focused keyboard model: the filter input retains focus while `↑`, `↓`, and `Esc` work through `mod:worktrees` bindings. Do not add a `Tab` override unless the product behavior intentionally changes.
- Keep the default bindings and `test/keys.test.js` in sync. Update the README when a documented default shortcut changes.
- Keep worktree creation restricted to local branches not already checked out, and retain the existing safe removal flow through Herdr's shipped `worktree` mod.

## Herdr-specific guardrails

- Review `RECIPE.md` and the existing mod before changing visual behavior, dimensions, commands, or key handling.
- Follow the installed Herdr API declarations for the currently running app version. APIs are native GPUI-kit APIs, not web APIs.
- Validate UI changes in the live app, especially filtering, focus after loading, wrapped selection, creation, and removal.
- Do not replace the regular lists with `v_virtual_list` merely to add selected-row auto-scroll. The repository documents known live-rendering failures and requires a future end-to-end UI harness first.

## Documentation and change scope

Keep changes narrow and avoid unrelated formatting. Update `README.md` and/or `RECIPE.md` when a user-visible workflow, shortcut, validation expectation, asset, or safety assumption changes. Do not commit generated output, local screenshots, dependencies, or Herdr's local type-support files.

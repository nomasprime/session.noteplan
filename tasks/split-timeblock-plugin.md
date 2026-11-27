# Task: Split timeblocking into a new `nomasprime.Timeblock` plugin

Status: complete (reviewer approved)

## Goal

Keep the Session (https://www.stayinsession.com/) integration in
`nomasprime.Session`, and move the standalone timeblocking commands into a new,
self-contained NotePlan plugin, `nomasprime.Timeblock`.

Both plugins live side by side in the NotePlan Plugins directory:

- `.../Plugins/nomasprime.Session/` (existing)
- `.../Plugins/nomasprime.Timeblock/` (new)

## Scope

Move to `nomasprime.Timeblock`:

- `/timeblock` command (`timeblock`) plus its helpers: `getNewRange`,
  `addTimeblockMetadata`, `promptTimeblockChanges`, `getSelectedTimeblockItem`,
  `assertSameNote`, `getUpdatedRange`, `resolveTimeEdit`.
- `/untimeblock` command (`untimeblock`).
- Shared low-level helpers they need (range parsing, clock/time formatting,
  duration parsing, `getSelectedLocation`, `isNoteTitleHeading`,
  `getTimeBlockMarker`, `localDate`, `runNoteCommand`, `showMessage`, etc.).
  NotePlan plugins cannot import each other's code, so **copy** the helpers each
  plugin needs. Do not leave dead code: each `script.js` contains only what its
  own commands use.

Keep in `nomasprime.Session`:

- `/start` (`sendToSession`) unchanged in behaviour. It still converts the item
  into a timeblock or adds a child timeblock before launching Session; that is
  part of the Session flow, not the standalone timeblocking feature.
- The `unestimatedSessionDuration` / `unestimatedSessionTitle` settings.

## Acceptance criteria

1. `nomasprime.Timeblock/` contains `plugin.json`, `script.js`, `README.md`,
   `package.json`, `vitest.config.mjs`, `tests/script.test.mjs`, `.gitignore`,
   `.prettierrc`, `.prettierignore`, and `noteplan.d.ts` (copied), modelled on the
   Session plugin.
2. `nomasprime.Timeblock/plugin.json`: `plugin.id` `nomasprime.Timeblock`,
   `plugin.name` `⏱️ Timeblock`, author `Nomas Prime`, version `0.1.0`, same min
   app/OS versions, commands `timeblock` and `untimeblock` with the existing
   descriptions, no settings, an accurate description and `lastUpdateInfo`.
3. `nomasprime.Session/plugin.json`: only the `start` command remains; the
   description and `lastUpdateInfo` no longer mention `/timeblock` or
   `/untimeblock` (say they moved to the Timeblock plugin); version bumped to
   `0.10.0` in both `plugin.json` and `package.json`.
4. User-visible behaviour of `/timeblock`, `/untimeblock` and `/start` is
   unchanged, except that the Timeblock plugin's error dialog title is
   `Timeblock` rather than `Session`.
5. Each `script.js` exports (globalThis + `module.exports`) only its own
   commands and the helpers its tests use.
6. Tests: the `/timeblock` and `/untimeblock` tests move from
   `nomasprime.Session/tests/script.test.mjs` to
   `nomasprime.Timeblock/tests/script.test.mjs` without weakening or deleting
   any assertion; the `/start` tests stay. Share no test code across plugins
   (duplicate the mock setup if needed). Total test count across both plugins is
   at least the current count.
7. READMEs: Session's README keeps the Session content and links to the
   Timeblock plugin for adding/editing/removing timeblocks; Timeblock's README
   takes over the "Adding / Updating / Removing A Timeblock" sections, its
   requirements and development instructions.
8. `pnpm install && pnpm test` passes in both plugin directories, and
   `pnpm exec prettier --check .` passes in both.
9. Do not touch other plugins. Do not commit (not a git repo anyway).

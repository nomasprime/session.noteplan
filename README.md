# 🎯 Session

Author: **Nomas Prime**

A NotePlan plugin that adds one command:

```text
/start
```

It starts a Session focus session from the current NotePlan task or checklist item.

## What gets sent

Given this NotePlan task:

```markdown
- [ ] Write architecture proposal #deep @computer
```

After you search for and select the NotePlan note titled `Influenza`, the plugin sends:

- Session `intent`: `Write architecture proposal`
- Session `duration`: `30`
- Session `categoryName`: `Influenza`

It does not send a NotePlan URL in Session notes, write metadata back into NotePlan, or add NotePlan line/block IDs.

The command uses the selected or current task directly, so it works across NotePlan's configurable task marker styles. That includes checkbox tasks and plain task markers such as `*`, `-`, and numbered tasks, depending on how the user has configured NotePlan.

For example:

```markdown
* [[Understand The Agentic AI Stack]]
```

sends `Understand The Agentic AI Stack` as the Session intent.

## Category matching

When you run `/start`, the plugin displays a fuzzy-searchable list of your NotePlan project notes. Select a note and its exact title is sent as Session's `categoryName`. The note's folder is shown in the search result to help distinguish notes with the same title, but it is not included in the category name.

Session's URL scheme can select an existing category by `categoryName`, but it cannot create a category or tell the plugin whether a category exists. The selected NotePlan note title must therefore exactly match an existing Session category. Otherwise, Session may fall back to its default category.

## Install manually

1. Download and unzip `nomasprime.Session.zip`.
2. In NotePlan, open **Settings/Preferences -> Plugins -> Open Plugin Folder**.
3. Copy the whole `nomasprime.Session` folder into the Plugins folder.
4. Restart NotePlan.
5. Put the cursor on a task line.
6. Run `/start`.

## Requirements

- NotePlan with plugin support.
- Session Pro, because Session's URL scheme is a Pro feature.

## Tests

The Vitest suite documents the plugin's current task parsing, note selection,
URL construction, and NotePlan integration behaviour.

```sh
pnpm install
pnpm test
```

Use `pnpm run test:watch` while developing.

## Session URL produced

The command sends Session a URL like:

```text
session:///start?intent=Write%20architecture%20proposal&duration=30&categoryName=Influenza
```

The plugin launches Session through NotePlan's `x-success` callback, so it does not need an HTML popup bridge.

## Publishing notes

Current plugin ID:

```text
nomasprime.Session
```

The folder name should match the plugin ID.

# 🎯 Session

A NotePlan plugin for [Session](https://www.stayinsession.com/).

Allows users to:

- Transform estimated items into timeblocks using duration shorthand
- Add timeblocks to unestimated items
- Automatically start sessions with backlinks to the corresponding timeblock

Recommend keeping working notes in NotePlan and focus or workflow notes in Session.

## Requirements

- NotePlan with timeblock detection enabled
- Session Pro

## Starting A Session

Run the `/start` command on one of the following:

- Bullet
- Open task
- Open checklist
- Section heading (not title heading)

The selected item's duration determines what happens:

| Item's Duration                                | Result                                                      |
| ---------------------------------------------- | ----------------------------------------------------------- |
| Shorthand appending title, eg, `'20m`          | Prepend longhand (ie, make time block) and remove shorthand |
| Longhand prepending title, eg, `09:00 - 09:20` | Shift time block to start now                               |
| Has neither                                    | Add child time block to selected item                       |

A new apostrophe estimate overrides an existing range. The same rules apply to
all supported item types in daily, project, and other calendar notes.

Items with either a shorthand or longhand duration are estimated sessions, and items without are unestimated sessions.

## Estimated Sessions

Running at 09:08 on an item with a shorthand duration:

```markdown
- Startup '20m
  - Splash face
  - Protein shake
```

produces:

```markdown
- 09:08 - 09:28 Startup ^abc123
  - Splash face
  - Protein shake
```

Session starts for 20 minutes with the intention `Startup` and a backlink to
`^abc123`. The selected item's type, indentation, children, folding notation, and
existing block ID are preserved.

Running again at 10:00 shifts the time block to this time:

```markdown
- 10:00 - 10:20 Startup ^abc123
  - Splash face
  - Protein shake
```

And updates the duration if a new estimate has been added:

```markdown
- 10:00 - 10:20 Startup '30m ^abc123
  - Splash face
  - Protein shake
```

becomes:

```markdown
- 10:00 - 10:30 Startup ^abc123
  - Splash face
  - Protein shake
```

Rerunning sends another start request to Session; it does not amend an earlier
Session history entry.

### Duration Shorthand

Use a standalone apostrophe estimate on the selected line:

- `'20m` → 20 minutes
- `'1h` → 60 minutes
- `'1h30m` → 90 minutes
- `'3h` → 180 minutes

Smart apostrophes (`’20m`) also work. Use whole hours and/or minutes, greater than
zero and shorter than 24 hours. Invalid durations cause the command to exit.

## Unestimated Sessions

Running at 09:08 on 26 September 2026 on an item without a duration:

```markdown
- Review README
```

produces (with the default settings):

```markdown
- Review README
  - 09:08 - 09:58 Session >2026-09-26 ^abc123
```

Each run on the parent item creates another checklist timeblock after its existing
children. Running on an existing open child timeblock shifts the timeblock to start now.

For a section heading, the new checklist is placed in that heading's body after
its existing content, before the next heading. This keeps it out of any nested
subsection. It has the same indentation as the heading, rather than being nested
under the preceding checklist.

The plugin settings control new child sessions:

- **Unestimated Session Duration:** defaults to `50m`.
- **Unestimated Session Title:** defaults to `Session`.

Session starts for the setting's duration with a cleaned derivative of the selected item's title as the intention and a backlink to the new child timeblock inserted into the notes.

## Other Details

- Session manages the session's category
- Item statuses are not automatically synced
- Timeblocks outside today’s daily note get today’s date link (`>YYYY-MM-DD`)
- The plugin adds NotePlan's required timeblock marker if one is configured in
  **Settings → Tasks → Detect Time Blocks**
- Backlinks use NotePlan's title-and-block-ID URL format (renaming a note can
  invalidate an existing Session backlink)
- NotePlan controls how overnight blocks appear in the timeline, the plugin does not split them into separate notes
- If launching fails, the saved block remains and an error is shown
- If observing old behaviour, try reloading plugins or restarting NotePlan

## Development

```sh
pnpm install
pnpm test
```

API references: [NotePlan plugins](https://help.noteplan.co/article/70-javascript-plugin-api),
[NotePlan time blocks](https://help.noteplan.co/article/121-time-blocking),
[NotePlan links](https://help.noteplan.co/article/49-x-callback-url-scheme),
[Session URL scheme](https://www.stayinsession.com/learn/session-url-scheme).

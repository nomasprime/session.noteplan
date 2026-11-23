# 🎯 Session

A NotePlan plugin for [Session](https://www.stayinsession.com/).

Allows users to:

- Transform estimated items into timeblocks using duration shorthand
- Add timeblocks to unestimated items
- Edit the start, end, or duration of an existing timeblock in NotePlan
- Remove a timeblock's time range and keep the item
- Automatically start sessions with backlinks to the corresponding timeblock

Recommend keeping working notes in NotePlan and focus or workflow notes in Session.

## Requirements

- NotePlan with timeblock detection enabled
- Session Pro for starting sessions from NotePlan

## Adding A Timeblock

Put the cursor on an item without a leading time and run `/timeblock`. Enter the
start and duration, or enter both 24-hour times.

| Input           | Result                                           |
| --------------- | ------------------------------------------------ |
| `now 45m`       | Start now and block 45 minutes                   |
| `+15m 45m`      | Start 15 minutes from now and block 45 minutes   |
| `-15m 45m`      | Start 15 minutes before now and block 45 minutes |
| `14:30 45m`     | Block `14:30 - 15:15`                            |
| `14:30 - 15:15` | Block `14:30 - 15:15`                            |

The command adds the range to the selected item without opening Session. It
uses the item's existing date link or daily note date. For other notes with no
date link, it adds today's date. It also adds the configured timeblock marker
if needed.

## Updating A Timeblock

Put the cursor on an item that begins with a 24-hour range such as
`09:00 - 09:50` and run `/timeblock`. The command saves the edit in
NotePlan without opening Session.

Enter a 24-hour time or a signed offset such as `+15m` in **Start time** or
**End time**. **Start time** also accepts `now`. Leave a field blank to keep
that endpoint when **Duration** is blank. To change just the start of
`09:00 - 09:50` to `09:15`, fill in **Start time** only.

| Fields filled in   | Result                                       |
| ------------------ | -------------------------------------------- |
| Start and end      | Use both endpoints to determine the duration |
| Start and duration | Set the end from the new start and duration  |
| End and duration   | Set the start from the new end and duration  |
| Duration only      | Keep the current start and set a new end     |

Use durations such as `45m` or `1h30m`. With explicit clock times, an end time
earlier than the start time represents the following day. If NotePlan shows a
text prompt, enter the same fields as `start=09:15 end=10:00` or `duration=45m`.

The edit updates the clock times on the existing item and keeps its scheduling
date, tags, and block ID.

## Removing A Timeblock

Put the cursor on a timeblock and run `/untimeblock`. For example, a task that says
`09:00 - 09:50 Review README ^abc123` becomes `Review README ^abc123`. The task,
its scheduling date, and any children stay in the note.

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import plugin from '../script.js'

const { sendToSession, parseDuration, parseBlockDuration, getIntent, buildTimeBlock, getDateTag, buildBlockURL, buildSessionURL } = plugin
const now = new Date(2026, 8, 24, 9, 7, 42)
const manifest = JSON.parse(readFileSync(new URL('../plugin.json', import.meta.url), 'utf8'))
const settingDefaults = Object.fromEntries(manifest['plugin.settings'].map(setting => [setting.key, setting.default]))

// Native paragraphs are detached snapshots. Selection indexes omit frontmatter;
// list indexes include it. Insertion invalidates the indexes of later snapshots.
function setup(content = "Startup '20m", options = {}) {
  // Keep the mock tied to the settings NotePlan actually exposes. Otherwise a
  // stale key shared by the code and test fixtures can silently pass every test.
  for (const key of Object.keys(options.settings || {})) {
    if (!Object.hasOwn(settingDefaults, key)) throw new Error(`Setting "${key}" is not declared in plugin.json`)
  }
  vi.useFakeTimers()
  vi.setSystemTime(now)
  const frontmatter = Array.isArray(options.frontmatter) ? options.frontmatter :
    options.frontmatter === false ? [] : ['---', 'title: Daily routine', '---']
  const leading = options.leading || []
  const records = [
    ...frontmatter.map(content => ({ content, type: 'text', indents: 0 })),
    ...leading,
    { content, type: 'checklist', indents: 0, ...options.paragraph },
    ...(options.tail || [
      { content: 'Splash face', type: 'checklist', indents: 1 },
      { content: 'Protein shake', type: 'checklist', indents: 1 },
      { content: 'Focus', type: 'checklist', indents: 0 }
    ])
  ]
  const parentIndex = frontmatter.length + leading.length
  let selectionIndex = parentIndex
  let nextID = 123
  function snapshot(record, fileIndex, selected = false) {
    const p = { ...record, _fileIndex: fileIndex, lineIndex: fileIndex - (selected ? frontmatter.length : 0) }
    if (!options.legacyIndexes) p.fileLineIndex = fileIndex
    // Native ID metadata survives content edits and duplication until removed via the API.
    p._blockId = record._blockId === undefined ? (record.content.match(/\^[\w-]+$/) || [''])[0] : record._blockId
    Object.defineProperty(p, 'blockId', { get: () => p._blockId })
    p.duplicate = () => snapshot(p, fileIndex, selected)
    return p
  }
  function render(r) {
    const prefix = { checklist: '+ ', checklistScheduled: '+ [>] ', checklistDone: '+ [x] ', checklistCancelled: '+ [-] ', open: '* ', scheduled: '* [>] ', list: '- ', title: '#'.repeat(r.headingLevel || 2) + ' ' }[r.type] || ''
    return '\t'.repeat(r.indents) + prefix + r.content
  }
  globalThis.Editor = {
    note: { title: 'Thursday, 24 September', filename: '20260924.md', type: 'Calendar',
      frontmatterAttributes: frontmatter.includes('title: Daily routine') ? { title: 'Daily routine' } : {}, ...options.note },
    get content() { return records.map(render).join('\n') },
    get paragraphs() { return records.map((r, i) => snapshot(r, i)) },
    get selectedParagraphs() { return [snapshot(records[selectionIndex], selectionIndex, true)] },
    addBlockID: vi.fn(p => {
      if (p.blockId) return
      p._blockId = '^abc' + nextID++
      p.content += ' ' + p._blockId
    }),
    removeBlockID: vi.fn(p => {
      p.content = p.content.replace(/\s+\^[\w-]+$/, '')
      p._blockId = ''
    }),
    updateParagraph: vi.fn(p => {
      records[p._fileIndex] = { content: p.content, type: p.type, indents: p.indents, headingLevel: p.headingLevel }
    }),
    insertParagraphAfterParagraph: vi.fn((content, after, type) => {
      records.splice(after._fileIndex + 1, 0, { content, type, indents: 0 })
    }),
    save: vi.fn().mockResolvedValue(undefined)
  }
  globalThis.DataStore = { settings: { ...settingDefaults, ...options.settings }, preference: vi.fn().mockReturnValue(options.marker || '') }
  globalThis.NotePlan = { openURL: vi.fn().mockResolvedValue(undefined) }
  globalThis.CommandBar = {
    textPrompt: vi.fn().mockResolvedValue(options.answer === undefined ? '' : options.answer),
    prompt: vi.fn().mockResolvedValue(0)
  }
  return { records, parentIndex, select: index => { selectionIndex = index } }
}

function setupTask(content = "Review README '50m", options = {}) {
  return setup(content, { ...options, paragraph: { type: 'open', ...options.paragraph } })
}

function launchedURLs() {
  const callback = new URL(NotePlan.openURL.mock.lastCall[0])
  const session = new URL(callback.searchParams.get('x-success'))
  return { callback, session, backlink: new URL(session.searchParams.get('notes')) }
}

function expectNoMutation(original) {
  expect(Editor.content).toBe(original)
  expect(Editor.updateParagraph).not.toHaveBeenCalled()
  expect(Editor.insertParagraphAfterParagraph).not.toHaveBeenCalled()
  expect(Editor.save).not.toHaveBeenCalled()
  expect(NotePlan.openURL).not.toHaveBeenCalled()
}

afterEach(() => {
  vi.useRealTimers()
  for (const name of ['Editor', 'DataStore', 'NotePlan', 'CommandBar']) delete globalThis[name]
})

describe('apostrophe estimates', () => {
  it.each([
    ["Startup '20m", 20], ["Break / Morning '20m …", 20], ["Grooming '10m", 10],
    ["Gym '3h", 180], ["Review README '50m", 50], ["Write '1h30m", 90],
    ["Write '0h30m", 30], ["Write '20M", 20], ["'20m Startup", 20],
    ['Work ’20m', 20], ['Work ’1h30m', 90], ["Work '20m…", 20],
    ['Work', null], ["Confirm today's three", null], ["Read 'something'", null],
    ['Work #focus(20m)', null], ['Work #bokeh(20m)', null]
  ])('reads %s as %s minutes', (source, duration) => {
    expect(parseDuration(source)).toBe(duration)
  })

  it.each(["'0m", "'0h", "'-20m", "'+20m", "'1.5h", "'20", "'20mx", "'20m30m", "'24h", "'99999999999999999999m", "'20m '1h"])(
    'rejects invalid or multiple estimates: %s', estimate => {
      expect(() => parseDuration('Work ' + estimate)).toThrow()
    }
  )
})

describe('shared timeblock text and URLs', () => {
  it('cleans the estimate, folding notation, dates, and IDs from the intent', () => {
    expect(getIntent("08:00 - 08:50 Review README '50m >tomorrow #🕑 … ^parent", '#🕑'))
      .toBe('Review README')
    expect(getIntent("Startup …", '')).toBe('Startup')
  })

  it('treats legacy focus tags like any other title text', () => {
    expect(getIntent("Work ’20m #focus #client", '')).toBe('Work #focus #client')
    expect(getIntent('Work #focused #focus/work #focus(20m) #bokeh', '')).toBe('Work #focused #focus/work #focus(20m) #bokeh')
  })

  it('keeps other times and tags in the title', () => {
    expect(getIntent("Prepare for 11:00 call '20m #client", '')).toBe('Prepare for 11:00 call #client')
    expect(buildTimeBlock("08:00-08:20 Prepare for 11:00 call ^keep123", now, 20, '', ''))
      .toBe("09:07 - 09:27 Prepare for 11:00 call ^keep123")
  })

  it('removes an estimate before the existing time range without leaving two ranges', () => {
    const source = "'30m 08:00 - 08:20 Work ^existing"
    expect(getIntent(source, '')).toBe('Work')
    expect(buildTimeBlock(source, now, 30, '', '')).toBe('09:07 - 09:37 Work ^existing')
  })

  it('adds the required detection marker only once', () => {
    const first = buildTimeBlock("Gym ^keep123", now, 180, '#🕑', '')
    expect(first).toBe("09:07 - 12:07 Gym #🕑 ^keep123")
    expect(buildTimeBlock(first, now, 180, '#🕑', '')).toBe(first)
  })

  it('wraps end times across midnight', () => {
    expect(buildTimeBlock("Shutdown", new Date(2026, 8, 24, 23, 45), 45, '', ''))
      .toBe("23:45 - 00:30 Shutdown")
  })

  it.each(['20260923.md', '20260925.txt', '2026-W39.md', '2026-09.md', '2026-Q3.md', '2026.md'])(
    'dates the timeblock today in another calendar note: %s', filename => {
      expect(getDateTag({ type: 'Calendar', filename }, now)).toBe('>2026-09-24')
    }
  )

  it('omits the tag only in today’s daily note', () => {
    expect(getDateTag({ type: 'Calendar', filename: '20260924.txt' }, now)).toBe('')
    expect(getDateTag({ type: 'Notes', filename: '20260924.md' }, now)).toBe('>2026-09-24')
  })

  it('replaces day scheduling tags on the actual block', () => {
    expect(buildTimeBlock("Work >tomorrow >2026-09-01 ^abc123", now, 20, '', '>2026-09-24'))
      .toBe("09:07 - 09:27 Work >2026-09-24 ^abc123")
    expect(buildTimeBlock("08:00-08:20 Work >yesterday ^abc123", now, 20, '', ''))
      .toBe("09:07 - 09:27 Work ^abc123")
  })

  it('encodes nested URLs and punctuation without changing the backlink', () => {
    const backlink = buildBlockURL({ title: 'R&D / café?' }, 'abc123')
    const session = new URL(buildSessionURL('Review README & notes', 20, backlink))
    expect(session.searchParams.get('intent')).toBe('Review README & notes')
    expect(session.searchParams.get('duration')).toBe('20')
    expect(session.searchParams.get('notes')).toBe(backlink)
    expect(new URL(backlink).searchParams.get('noteTitle')).toBe('R&D / café?^abc123')
  })
})

describe('existing timeblock durations', () => {
  it.each([
    ['09:00 - 09:20 Work', 20], ['9:00-10:30 Work', 90], ['09:00 – 10:00 Work', 60],
    ['23:45 - 00:30 Shutdown', 45], ['09:00 - 08:59 Long block', 1439],
    ['Work', null], ['Work at 11:00', null], ['09:00 Work', null]
  ])('reads %s as %s minutes', (source, expected) => {
    expect(parseBlockDuration(source)).toBe(expected)
  })

  it.each(['09:00 - 09:00 Work', '24:00 - 01:00 Work', '09:60 - 10:00 Work', '09:00 - 24:00 Work'])(
    'rejects an invalid or zero duration range: %s', source => {
      expect(() => parseBlockDuration(source)).toThrow()
    }
  )
})

// Each supported type follows the same duration rules. A real note title precedes
// section headings so heading tests also exercise body-relative selection indexes.
describe.each(['open', 'checklist', 'list', 'title'])('%s items', type => {
  function setupItem(content, options = {}) {
    return setup(content, {
      leading: [{ content: 'Daily routine', type: 'title', headingLevel: 1, indents: 0 }],
      ...options, paragraph: { type, headingLevel: type === 'title' ? 2 : undefined, ...options.paragraph }
    })
  }

  it('timeblocks an estimate in place, preserving type, children, folding, and ID', async () => {
    const source = "Work '20m … ^existing"
    const { records, parentIndex } = setupItem(source, { paragraph: { indents: 1 } })
    const before = structuredClone(records)
    await sendToSession()
    expect(records).toHaveLength(before.length)
    expect(records[parentIndex]).toMatchObject({ content: '09:07 - 09:27 Work … ^existing', type, indents: 1 })
    expect(records.slice(0, parentIndex)).toEqual(before.slice(0, parentIndex))
    expect(records.slice(parentIndex + 1)).toEqual(before.slice(parentIndex + 1))
    expect(Editor.insertParagraphAfterParagraph).not.toHaveBeenCalled()
    expect(Editor.addBlockID).not.toHaveBeenCalled()
    expect(CommandBar.textPrompt).not.toHaveBeenCalled()
    expect(launchedURLs().session.searchParams.get('intent')).toBe('Work')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('20')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^existing')
    expect(Editor.save.mock.invocationCallOrder[0]).toBeLessThan(NotePlan.openURL.mock.invocationCallOrder[0])
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('reruns the same block after consuming its estimate', async () => {
    const { records, parentIndex } = setupItem("Work '20m", { tail: [] })
    await sendToSession()
    vi.setSystemTime(new Date(2026, 8, 24, 11, 30))
    await sendToSession()
    expect(records[parentIndex]).toMatchObject({ content: '11:30 - 11:50 Work ^abc123', type })
    expect(records).toHaveLength(parentIndex + 1)
    expect(Editor.addBlockID).toHaveBeenCalledOnce()
    expect(NotePlan.openURL).toHaveBeenCalledTimes(2)
    expect(launchedURLs().session.searchParams.get('duration')).toBe('20')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^abc123')
    expect(CommandBar.textPrompt).not.toHaveBeenCalled()
  })

  it('lets a new estimate override an existing range', async () => {
    setupItem("08:00 - 08:20 Work ’1h30m ^existing")
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 10:37 Work ^existing')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('90')
  })

  it('creates a new child using defaults when there is no estimate or range', async () => {
    const { records, parentIndex } = setupItem('Work ^parent', { tail: [] })
    await sendToSession()
    expect(records[parentIndex].content).toBe('Work ^parent')
    expect(records[parentIndex + 1]).toMatchObject({
      content: '09:07 - 09:57 Session ^abc123', type: 'checklist', indents: type === 'title' ? 0 : 1
    })
    expect(launchedURLs().session.searchParams.get('intent')).toBe('Work')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('50')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^abc123')
    expect(launchedURLs().session.searchParams.has('categoryName')).toBe(false)
    expect(CommandBar.textPrompt).not.toHaveBeenCalled()
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('uses the configured child duration and title without prompting', async () => {
    setupItem('Work', { settings: { unestimatedSessionDuration: '1h15m', unestimatedSessionTitle: 'Attempt' }, tail: [] })
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 10:22 Attempt ^abc123')
    expect(launchedURLs().session.searchParams.get('intent')).toBe('Work')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('75')
    expect(CommandBar.textPrompt).not.toHaveBeenCalled()
  })

  it.each(["Work '20m", 'Work'])('supports project notes: %s', async source => {
    const { records, parentIndex } = setupItem(source + ' >tomorrow', {
      tail: [], marker: '#🕑', note: { type: 'Notes', filename: 'Projects/Work.md', title: 'Work project' }
    })
    await sendToSession()
    const block = records[source.includes("'") ? parentIndex : parentIndex + 1]
    expect(block.content).toContain('>2026-09-24 #🕑 ^abc123')
    expect(block.content).not.toContain('>tomorrow')
    if (!source.includes("'")) expect(records[parentIndex].content).toBe(source + ' >tomorrow')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('Work project^abc123')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('preserves previous attempts and adds one new checklist each time the source runs', async () => {
    const { records, parentIndex } = setupItem('Work', { tail: [
      { content: '08:00 - 08:20 Session ^done', type: 'checklistDone', indents: type === 'title' ? 0 : 1 },
      { content: '08:30 - 08:50 Session ^cancelled', type: 'checklistCancelled', indents: type === 'title' ? 0 : 1 }
    ] })
    const before = structuredClone(records)
    await sendToSession()
    await sendToSession()
    expect(records.slice(0, before.length)).toEqual(before)
    expect(records.slice(before.length)).toMatchObject([
      { content: '09:07 - 09:57 Session ^abc123', type: 'checklist' },
      { content: '09:07 - 09:57 Session ^abc124', type: 'checklist' }
    ])
    expect(records.filter(p => p.type === 'open')).toHaveLength(type === 'open' ? 1 : 0)
    expect(records[parentIndex].content).toBe('Work')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^abc124')
  })

  it('retimes a generated child when that child is selected', async () => {
    const { records, parentIndex, select } = setupItem('Work', { tail: [] })
    await sendToSession()
    select(parentIndex + 1)
    vi.setSystemTime(new Date(2026, 8, 24, 10, 0))
    await sendToSession()
    expect(records).toHaveLength(parentIndex + 2)
    expect(records[parentIndex + 1].content).toBe('10:00 - 10:50 Session ^abc123')
    expect(launchedURLs().session.searchParams.get('intent')).toBe('Session')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^abc123')
  })
})

// Insertion must not split the notes belonging to an existing child or silently
// place a heading's session under a different subsection.
describe('child placement and title protection', () => {
  it.each([false, true])('appends after nested work and notes with frontmatter (legacy: %s)', async legacyIndexes => {
    const { records, parentIndex } = setupTask('Work', {
      legacyIndexes, paragraph: { indents: 1 }, tail: [
        { content: 'Earlier session', type: 'checklist', indents: 2 },
        { content: 'Work notes', type: 'text', indents: 3 },
        { content: 'Other task', type: 'open', indents: 1 }
      ]
    })
    const before = structuredClone(records)
    await sendToSession()
    expect(records.slice(0, parentIndex + 3)).toEqual(before.slice(0, parentIndex + 3))
    expect(records[parentIndex + 3]).toMatchObject({ type: 'checklist', indents: 2, content: '09:07 - 09:57 Session ^abc123' })
    expect(records[parentIndex + 4]).toEqual(before[parentIndex + 3])
  })

  it('works without frontmatter', async () => {
    const { records } = setupTask('Work', { frontmatter: false, tail: [] })
    await sendToSession()
    expect(records[0].content).toBe('Work')
    expect(records[1]).toMatchObject({ content: '09:07 - 09:57 Session ^abc123', type: 'checklist', indents: 1 })
  })

  it('stops a list subtree at a blank line', async () => {
    const { records, parentIndex } = setupTask('Work', { tail: [
      { content: '', type: 'empty', indents: 0 },
      { content: 'Separate notes', type: 'text', indents: 1 }
    ] })
    await sendToSession()
    expect(records[parentIndex + 1].type).toBe('checklist')
    expect(records[parentIndex + 2].content).toBe('')
    expect(records[parentIndex + 3].content).toBe('Separate notes')
  })

  it.each([1, 2, 3])('keeps a session directly under its heading before a level %s heading', async nextLevel => {
    const { records, parentIndex } = setup('Research', {
      paragraph: { type: 'title', headingLevel: 2 },
      leading: [{ content: 'Project', type: 'title', headingLevel: 1, indents: 0 }],
      tail: [
        { content: 'Existing attempt', type: 'checklist', indents: 0 },
        { content: 'Notes under attempt', type: 'text', indents: 1 },
        { content: '', type: 'empty', indents: 0 },
        { content: 'Notes in section', type: 'text', indents: 0 },
        { content: '', type: 'empty', indents: 0 },
        { content: 'Another section', type: 'title', headingLevel: nextLevel, indents: 0 },
        { content: 'Its own checklist', type: 'checklist', indents: 0 }
      ]
    })
    const before = structuredClone(records)
    await sendToSession()
    expect(records.slice(0, parentIndex + 5)).toEqual(before.slice(0, parentIndex + 5))
    expect(records[parentIndex + 5]).toMatchObject({ content: '09:07 - 09:57 Session ^abc123', type: 'checklist', indents: 0 })
    expect(records.slice(parentIndex + 6)).toEqual(before.slice(parentIndex + 5))
  })

  it.each([false, true])('rejects the opening title heading with or without an estimate (legacy: %s)', async legacyIndexes => {
    for (const content of ['Project', "Project '20m", '09:00 - 09:20 Project']) {
      setup(content, { legacyIndexes, paragraph: { type: 'title', headingLevel: 1 },
        leading: [{ content: '', type: 'empty', indents: 0 }], tail: [] })
      const before = Editor.content
      await sendToSession()
      expectNoMutation(before)
      expect(Editor.addBlockID).not.toHaveBeenCalled()
      expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('note title heading'), ['OK'])
    }
  })

  it('rejects a title heading without frontmatter', async () => {
    setup('Project', { frontmatter: false, paragraph: { type: 'title', headingLevel: 1 } })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('note title heading'), ['OK'])
  })

  it('protects a non-H1 heading when it provides the note title', async () => {
    setup("Project '20m", { frontmatter: ['---', 'status: Active', '---'], paragraph: { type: 'title', headingLevel: 2 } })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
  })

  it('allows an opening section heading when the title is supplied by frontmatter', async () => {
    setup("Research '20m", { paragraph: { type: 'title', headingLevel: 2 } })
    await sendToSession()
    expect(Editor.content).toContain('## 09:07 - 09:27 Research ^abc123')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('allows later H1 sections', async () => {
    setup("Research '20m", {
      paragraph: { type: 'title', headingLevel: 1 },
      leading: [{ content: 'Project', type: 'title', headingLevel: 1, indents: 0 }]
    })
    await sendToSession()
    expect(Editor.content).toContain('# 09:07 - 09:27 Research ^abc123')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })
})

describe('shared session behavior', () => {
  it.each(['', '#focus', '#focus(20m)', '#bokeh', '#client'])(
    'always launches regardless of tags: %s', async tag => {
      setup("Work '20m " + tag, { tail: [] })
      await sendToSession()
      expect(NotePlan.openURL).toHaveBeenCalledOnce()
      expect(launchedURLs().session.searchParams.get('intent')).toBe(('Work ' + tag).trim())
      expect(CommandBar.prompt).not.toHaveBeenCalled()
    }
  )

  it('does not use tag attributes as estimates', async () => {
    setupTask('Work #focus(20m)', { tail: [] })
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:57 Session ^abc123')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('50')
  })

  it('does not inherit an estimate or time range from a parent', async () => {
    const { select, parentIndex } = setupTask("08:00 - 09:00 Parent '3h", {
      tail: [{ content: 'Work', type: 'checklist', indents: 1 }]
    })
    select(parentIndex + 1)
    await sendToSession()
    expect(Editor.content).toContain('\t\t+ 09:07 - 09:57 Session ^abc123')
    expect(launchedURLs().session.searchParams.get('intent')).toBe('Work')
  })

  it('reuses the duration of an overnight block', async () => {
    setup('23:45 - 00:30 Shutdown ^existing')
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:52 Shutdown ^existing')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('45')
  })

  it('uses the current local day and moves an old block to today', async () => {
    setup('23:45 - 00:30 Shutdown >2026-09-24 ^existing')
    vi.setSystemTime(new Date(2026, 8, 25, 0, 5))
    await sendToSession()
    expect(Editor.content).toContain('00:05 - 00:50 Shutdown >2026-09-25 ^existing')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('2026-09-24^existing')
  })

  it.each([
    { filename: '20260923.md', title: 'Yesterday', linkTitle: '2026-09-23' },
    { filename: '20260924.txt', title: 'Today', linkTitle: '2026-09-24' },
    { filename: '2026-W39.md', title: 'Week 39', linkTitle: 'Week 39' }
  ])('allows checklists in other calendar notes: $filename', async note => {
    setup("Work '20m", { note })
    await sendToSession()
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe(note.linkTitle + '^abc123')
    if (note.filename !== '20260924.txt') expect(Editor.content).toContain('>2026-09-24')
  })

  it('uses defaults for missing settings, without requiring a prompt API', async () => {
    setupTask('Work', { tail: [] })
    delete globalThis.DataStore
    delete CommandBar.textPrompt
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:57 Session ^abc123')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('uses defaults for blank settings', async () => {
    setupTask('Work', { settings: { unestimatedSessionDuration: '  ', unestimatedSessionTitle: '  ' }, tail: [] })
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:57 Session ^abc123')
  })

  it('uses defaults before settings have been saved', async () => {
    setupTask('Work', { tail: [] })
    DataStore.settings = {}
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:57 Session ^abc123')
    expect(launchedURLs().session.searchParams.get('duration')).toBe('50')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('does not need child APIs to retime an existing item', async () => {
    setup('08:00 - 08:20 Work')
    delete Editor.insertParagraphAfterParagraph
    await sendToSession()
    expect(Editor.content).toContain('09:07 - 09:27 Work ^abc123')
    expect(NotePlan.openURL).toHaveBeenCalledOnce()
  })
})

describe('eligibility and failures', () => {
  it.each(['scheduled', 'checklistScheduled', 'checklistDone', 'checklistCancelled', 'done', 'cancelled', 'text', 'empty', 'quote', 'separator'])(
    'rejects %s before any mutation', async type => {
      setup("Work '20m", { paragraph: { type } })
      const before = Editor.content
      await sendToSession()
      expectNoMutation(before)
      expect(CommandBar.textPrompt).not.toHaveBeenCalled()
      if (['scheduled', 'checklistScheduled'].includes(type)) {
        expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('Select the active copy'), ['OK'])
      }
    }
  )

  it.each(['', "'20m", "Work '20mx", "Work '0m", "Work '20m '30m", '09:00 - 09:00 Work', '24:00 - 01:00 Work', '09:00 - 09:20', '09:00 - 09:20 ^existing'])(
    'rejects invalid input without changes: %s', async content => {
      setup(content)
      const before = Editor.content
      await sendToSession()
      expectNoMutation(before)
      expect(Editor.addBlockID).not.toHaveBeenCalled()
      expect(CommandBar.prompt).toHaveBeenCalled()
    }
  )

  it('rejects an invalid default only when a child duration is needed', async () => {
    setupTask('Work', { settings: { unestimatedSessionDuration: '0m' } })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
    setupTask("Work '20m", { settings: { unestimatedSessionDuration: '0m' } })
    await sendToSession()
    expect(NotePlan.openURL).toHaveBeenCalledOnce()
  })

  it('rejects multiple selected paragraphs', async () => {
    setup()
    Object.defineProperty(Editor, 'selectedParagraphs', { value: Editor.paragraphs.slice(3, 5) })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
  })

  it('rejects an unsafe selection-to-file mapping', async () => {
    setupTask('Work')
    const selected = Editor.selectedParagraphs[0]
    selected.fileLineIndex++
    Object.defineProperty(Editor, 'selectedParagraphs', { value: [selected] })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('locate the selected item safely'), ['OK'])
  })

  it('requires the launch API before saving any timeblock', async () => {
    setup()
    const before = Editor.content
    delete globalThis.NotePlan
    await sendToSession()
    expect(Editor.content).toBe(before)
    expect(Editor.updateParagraph).not.toHaveBeenCalled()
    expect(Editor.save).not.toHaveBeenCalled()
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('launching Session'), ['OK'])
  })

  it.each(["Work '20m", 'Work'])('stops if saving fails: %s', async source => {
    setup(source)
    Editor.save.mockRejectedValue(new Error('Save failed'))
    await sendToSession()
    expect(NotePlan.openURL).not.toHaveBeenCalled()
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('The note was updated, but the command could not finish. Save failed'), ['OK'])
  })

  it.each(["Work '20m", 'Work'])('keeps the saved block if launching fails: %s', async source => {
    setup(source)
    NotePlan.openURL.mockRejectedValue(new Error('Launch failed'))
    await sendToSession()
    expect(Editor.save).toHaveBeenCalledOnce()
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('The note was updated, but the command could not finish. Launch failed'), ['OK'])
  })

  it.each(["Work '20m", 'Work'])('does not write when an ID cannot be created: %s', async source => {
    setup(source)
    Editor.addBlockID.mockImplementation(() => {})
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
  })

  it('never gives a new child its parent’s ID', async () => {
    setupTask('Work ^parent')
    Editor.addBlockID.mockImplementation(p => { p.content += ' ^parent' })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('unique link'), ['OK'])
  })
})

describe('native block ID and error reporting regressions', () => {
  it('creates a session for the reported README task without changing its ID', async () => {
    const { records, parentIndex } = setupTask('README >today ^xrxtnd', {
      tail: [], note: { type: 'Notes', title: 'Project', filename: 'Project.md' }
    })
    await sendToSession()
    expect(records[parentIndex].content).toBe('README >today ^xrxtnd')
    expect(records[parentIndex + 1]).toMatchObject({
      content: '09:07 - 09:57 Session >2026-09-24 ^abc123', type: 'checklist', indents: 1
    })
    expect(Editor.removeBlockID).toHaveBeenCalledOnce()
    expect(launchedURLs().session.searchParams.get('intent')).toBe('README')
    expect(launchedURLs().backlink.searchParams.get('noteTitle')).toBe('Project^abc123')
    expect(CommandBar.prompt).not.toHaveBeenCalled()
  })

  it('shows native error dialogs rather than failing silently', async () => {
    setupTask("Work 'invalid", { settings: { unestimatedSessionDuration: '0m' } })
    const before = Editor.content
    await sendToSession()
    expectNoMutation(before)
    expect(CommandBar.prompt).toHaveBeenCalledWith('Session', expect.stringContaining('duration greater than zero'), ['OK'])
  })
})

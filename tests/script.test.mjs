import { afterEach, describe, expect, it, vi } from 'vitest'
import plugin from '../script.js'

const {
  addXSuccess,
  buildSessionURL,
  cleanNoteLinkText,
  cleanTaskText,
  getCurrentParagraph,
  getDurationMinutes,
  getNoteChoiceLabel,
  getNoteTitle,
  getSelectedOptionIndex,
  isPlainListLine,
  isTaskLike,
  isTaskMarkerLine,
  openSessionURL,
  selectSessionCategoryName,
  sendToSession
} = plugin

const notePlanGlobals = [
  'Editor',
  'DataStore',
  'CommandBar',
  'NotePlan',
  'Clipboard'
]

afterEach(() => {
  for (const name of notePlanGlobals) delete globalThis[name]
})

describe('task text cleanup', () => {
  it.each([
    ['- [ ] Write architecture proposal #deep @computer', 'Write architecture proposal'],
    ['* [x] Ship release >2026-08-05 {review} ^block-id', 'Ship release'],
    ['+ [>] Scheduled task', 'Scheduled task'],
    ['1. [X] Numbered checkbox', 'Numbered checkbox'],
    ['- Plain list task', 'Plain list task'],
    ['  *   Keep internal spacing   tidy  ', 'Keep internal spacing tidy'],
    ['[[Understand The Agentic AI Stack]]', 'Understand The Agentic AI Stack'],
    ['[[Architecture|Write the proposal]]', 'Write the proposal']
  ])('cleans %j to %j', (source, expected) => {
    expect(cleanTaskText(source)).toBe(expected)
  })

  it('only unwraps a note link when it is the complete cleaned title', () => {
    expect(cleanNoteLinkText('Review [[Architecture]]')).toBe('Review [[Architecture]]')
  })
})

describe('task recognition', () => {
  it.each([
    'open',
    'scheduled',
    'done',
    'cancelled',
    'checklist',
    'checklistDone',
    'checklistScheduled',
    'checklistCancelled',
    'list',
    'bullet',
    'numbered',
    'bulletList',
    'numberedList'
  ])('accepts NotePlan paragraph type %s', type => {
    expect(isTaskLike({ type, content: 'Task' })).toBe(true)
  })

  it('recognizes checkbox and plain list markers from raw text', () => {
    expect(isTaskMarkerLine('- [ ] Checkbox')).toBe(true)
    expect(isTaskMarkerLine('1. [x] Done')).toBe(true)
    expect(isPlainListLine('* Plain task')).toBe(true)
    expect(isTaskLike({ type: 'text', rawContent: '+ Plain task' })).toBe(true)
  })

  it('does not treat ordinary prose or an empty list marker as a task', () => {
    expect(isTaskLike({ type: 'text', content: 'Ordinary prose' })).toBe(false)
    expect(isTaskMarkerLine('- [ ]')).toBe(false)
    expect(isPlainListLine('- ')).toBe(false)
  })
})

describe('note and option handling', () => {
  it('uses a note title when present and otherwise derives it from the filename', () => {
    expect(getNoteTitle({ title: 'Influenza', filename: 'Projects/Other.md' })).toBe('Influenza')
    expect(getNoteTitle({ filename: 'Projects/Influenza.md' })).toBe('Influenza')
    expect(getNoteTitle({ filename: String.raw`Projects\\Influenza.txt` })).toBe('Influenza')
    expect(getNoteTitle({})).toBe('')
  })

  it('includes the containing folder in the choice label, but not the category name', async () => {
    globalThis.DataStore = {
      projectNotes: [
        { title: 'Zulu', filename: 'Archive/Zulu.md' },
        { title: 'Influenza', filename: 'Projects/Health/Influenza.md' }
      ]
    }
    globalThis.CommandBar = {
      showOptions: vi.fn().mockResolvedValue({ index: 0 })
    }

    await expect(selectSessionCategoryName()).resolves.toBe('Influenza')
    expect(CommandBar.showOptions).toHaveBeenCalledWith(
      ['Influenza — Projects / Health', 'Zulu — Archive'],
      'Select note for Session category'
    )
  })

  it('returns an empty category when the selection is cancelled', async () => {
    globalThis.DataStore = { projectNotes: [{ title: 'Influenza' }] }
    globalThis.CommandBar = { showOptions: vi.fn().mockResolvedValue(-1) }

    await expect(selectSessionCategoryName()).resolves.toBe('')
  })

  it('documents supported option result shapes and folder labels', () => {
    expect(getSelectedOptionIndex(2)).toBe(2)
    expect(getSelectedOptionIndex({ index: 3 })).toBe(3)
    expect(getSelectedOptionIndex({})).toBe(-1)
    expect(getNoteChoiceLabel({ filename: 'Influenza.md' }, 'Influenza')).toBe('Influenza')
  })
})

describe('Session URL construction', () => {
  it.each([
    [{ durationMinutes: '45' }, '45'],
    [{ durationMinutes: ' 25 ' }, '25'],
    [{ durationMinutes: 10 }, '10'],
    [{ durationMinutes: '0' }, '30'],
    [{ durationMinutes: '-5' }, '30'],
    [{ durationMinutes: '1.5' }, '30'],
    [{ durationMinutes: 'abc' }, '30'],
    [{}, '30'],
    [null, '30']
  ])('normalizes duration setting %j to %s minutes', (settings, expected) => {
    expect(getDurationMinutes(settings)).toBe(expected)
  })

  it('encodes the intent, duration, and category', () => {
    expect(buildSessionURL('Write proposal & review', 'Health / Work', { durationMinutes: '45' }))
      .toBe('session:///start?intent=Write%20proposal%20%26%20review&duration=45&categoryName=Health%20%2F%20Work')
  })

  it('omits an empty category', () => {
    expect(buildSessionURL('Focus', '', {}))
      .toBe('session:///start?intent=Focus&duration=30')
  })

  it('adds the Session URL as an encoded x-success callback', () => {
    expect(addXSuccess('noteplan://open?noteTitle=Daily', 'session:///start?intent=Focus'))
      .toBe('noteplan://open?noteTitle=Daily&x-success=session%3A%2F%2F%2Fstart%3Fintent%3DFocus')
    expect(addXSuccess('noteplan://open', 'session:///start?intent=Focus'))
      .toBe('noteplan://open?x-success=session%3A%2F%2F%2Fstart%3Fintent%3DFocus')
  })
})

describe('NotePlan integration', () => {
  it('resolves the selected paragraph to the canonical Editor paragraph', () => {
    const canonical = { lineIndex: 4, type: 'open', rawContent: '- [ ] Canonical task' }
    globalThis.Editor = {
      note: { title: 'Daily' },
      selectedParagraphs: [{ lineIndex: 4, content: 'Selected task' }],
      paragraphs: [canonical]
    }

    expect(getCurrentParagraph()).toBe(canonical)
  })

  it('falls back to the paragraph at the cursor selection', () => {
    const canonical = { lineIndex: 2, contentRange: { start: 20 }, content: 'Task' }
    globalThis.Editor = {
      note: { title: 'Daily' },
      selectedParagraphs: [],
      selection: { start: 24 },
      paragraphRangeAtCharacterIndex: vi.fn().mockReturnValue({ start: 20 }),
      paragraphs: [canonical]
    }

    expect(getCurrentParagraph()).toBe(canonical)
  })

  it('runs /start using the task, selected note title, setting, and callback', async () => {
    const paragraph = {
      lineIndex: 0,
      type: 'open',
      rawContent: '- [ ] Write architecture proposal #deep @computer'
    }
    globalThis.Editor = {
      note: { title: 'Daily Notes' },
      selectedParagraphs: [paragraph],
      paragraphs: [paragraph]
    }
    globalThis.DataStore = {
      settings: { durationMinutes: '45' },
      projectNotes: [
        { title: 'Zulu', filename: 'Archive/Zulu.md' },
        { title: 'Influenza', filename: 'Projects/Influenza.md' }
      ]
    }
    globalThis.CommandBar = {
      showOptions: vi.fn().mockResolvedValue(0),
      showMessage: vi.fn()
    }
    globalThis.NotePlan = { openURL: vi.fn().mockResolvedValue(undefined) }

    await sendToSession()

    expect(CommandBar.showOptions).toHaveBeenCalledWith(
      ['Influenza — Projects', 'Zulu — Archive'],
      'Select note for Session category'
    )
    expect(NotePlan.openURL).toHaveBeenCalledWith(
      'noteplan://x-callback-url/openNote?noteTitle=Daily%20Notes' +
      '&x-success=session%3A%2F%2F%2Fstart%3Fintent%3DWrite%2520architecture%2520proposal' +
      '%26duration%3D45%26categoryName%3DInfluenza'
    )
    expect(CommandBar.showMessage).not.toHaveBeenCalled()
  })

  it('stops with guidance when the cursor is not on a task', async () => {
    const paragraph = { lineIndex: 0, type: 'text', content: 'Ordinary prose' }
    globalThis.Editor = {
      note: { title: 'Daily' },
      selectedParagraphs: [paragraph],
      paragraphs: [paragraph]
    }
    globalThis.CommandBar = { showMessage: vi.fn().mockResolvedValue(undefined) }
    globalThis.NotePlan = { openURL: vi.fn() }

    await sendToSession()

    expect(CommandBar.showMessage).toHaveBeenCalledWith(
      'Put the cursor on a task or checklist item before running /start.'
    )
    expect(NotePlan.openURL).not.toHaveBeenCalled()
  })

  it('copies the raw Session URL when NotePlan.openURL is unavailable', async () => {
    globalThis.Clipboard = { string: '' }
    globalThis.CommandBar = { showMessage: vi.fn().mockResolvedValue(undefined) }

    await openSessionURL('session:///start?intent=Focus', 'noteplan://open')

    expect(Clipboard.string).toBe('session:///start?intent=Focus')
    expect(CommandBar.showMessage).toHaveBeenCalledWith('Session URL copied to the clipboard.')
  })
})

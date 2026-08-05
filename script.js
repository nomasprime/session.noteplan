/*
 * Session for NotePlan
 * Author: Nomas Prime
 *
 * Command: /start
 *
 * Behaviour:
 * - Uses the selected/current task or checklist item as the Session intent.
 * - Prompts the user to search for and select a NotePlan project note.
 * - Sends the selected note's title to Session as the category name.
 * - Does not store a NotePlan URL in Session notes.
 * - Does not write any Session metadata back to the task.
 * - Does not add NotePlan line/block IDs.
 */

async function sendToSession() {
  try {
    const paragraph = getCurrentParagraph()
    if (!paragraph || !isTaskLike(paragraph)) {
      await showMessage('Put the cursor on a task or checklist item before running /start.')
      return
    }

    const sourceText = getCurrentLineText(paragraph)
    const taskIntent = cleanTaskText(sourceText)
    if (!taskIntent) {
      console.log('Session plugin could not derive source text: ' + getEditorTextDebugInfo(paragraph))
      await showMessage('The selected line does not contain a usable task title.')
      return
    }

    const categoryName = await selectSessionCategoryName()
    if (!categoryName) return

    const settings = getPluginSettings()
    const callbackURL = await getNotePlanCallbackURL()
    if (!callbackURL) return

    const sessionURL = buildSessionURL(taskIntent, categoryName, settings)
    await openSessionURL(sessionURL, callbackURL)
  } catch (error) {
    console.log('Session plugin error: ' + stringifyError(error))
    await showMessage('Session plugin failed. Open Help → Plugin Console for the error details.')
  }
}

function getCurrentParagraph() {
  if (typeof Editor === 'undefined' || !Editor.note) return null

  const selected = Editor.selectedParagraphs || []
  if (selected.length > 0) {
    const selectedParagraph = selected[0]
    if (typeof selectedParagraph.lineIndex === 'number') {
      const paragraphs = Editor.paragraphs || []
      const match = paragraphs.find(p => p.lineIndex === selectedParagraph.lineIndex)
      if (match) return match
    }
    return selectedParagraph
  }

  const selection = Editor.selection
  if (
    selection &&
    typeof selection.start === 'number' &&
    typeof Editor.paragraphRangeAtCharacterIndex === 'function'
  ) {
    const range = Editor.paragraphRangeAtCharacterIndex(selection.start)
    if (range) {
      const paragraphs = Editor.paragraphs || []
      const match = paragraphs.find(p => p.contentRange && p.contentRange.start === range.start)
      if (match) return match
    }
  }

  return null
}

function isTaskLike(paragraph) {
  const type = paragraph.type || ''
  const taskTypes = [
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
  ]
  if (taskTypes.includes(type)) return true

  const raw = getParagraphText(paragraph)
  return isTaskMarkerLine(raw) || isPlainListLine(raw)
}

async function getNotePlanCallbackURL() {
  const note = Editor.note
  if (!note) {
    await showMessage('No active NotePlan note is open.')
    return null
  }

  const noteTitle = getNoteTitle(note) ||
    (typeof Editor !== 'undefined' && Editor.title ? String(Editor.title) : '')
  if (!noteTitle) {
    await showMessage('Could not determine the current NotePlan note title.')
    return null
  }

  return 'noteplan://x-callback-url/openNote?noteTitle=' + encodeURIComponent(noteTitle)
}

function getNoteTitle(note) {
  if (note && note.title) return String(note.title)

  const filename = note && note.filename ? String(note.filename) : ''
  if (!filename) return ''

  const segments = filename.replace(/\\/g, '/').split('/').filter(Boolean)
  const leaf = segments.length > 0 ? segments[segments.length - 1] : filename
  return leaf.replace(/\.[^.]+$/, '')
}

async function selectSessionCategoryName() {
  if (
    typeof DataStore === 'undefined' ||
    typeof CommandBar === 'undefined' ||
    typeof CommandBar.showOptions !== 'function'
  ) {
    await showMessage('Note selection is not available in this version of NotePlan.')
    return ''
  }

  const noteChoices = (DataStore.projectNotes || [])
    .map(note => ({
      note,
      title: getNoteTitle(note)
    }))
    .filter(choice => choice.title)
    .sort((left, right) => left.title.localeCompare(right.title))

  if (noteChoices.length === 0) {
    await showMessage('No NotePlan project notes are available to use as Session categories.')
    return ''
  }

  const labels = noteChoices.map(choice => getNoteChoiceLabel(choice.note, choice.title))
  const result = await CommandBar.showOptions(labels, 'Select note for Session category')
  const selectedIndex = getSelectedOptionIndex(result)

  if (selectedIndex < 0 || selectedIndex >= noteChoices.length) return ''
  return noteChoices[selectedIndex].title
}

function getNoteChoiceLabel(note, title) {
  const filename = String((note && note.filename) || '').replace(/\\/g, '/')
  const segments = filename.split('/').filter(Boolean)
  if (segments.length <= 1) return title

  segments.pop()
  return title + ' — ' + segments.join(' / ')
}

function getSelectedOptionIndex(result) {
  if (typeof result === 'number') return result
  if (result && typeof result.index === 'number') return result.index
  return -1
}

function getPluginSettings() {
  try {
    return typeof DataStore !== 'undefined' && DataStore.settings ? DataStore.settings : {}
  } catch (error) {
    console.log('Could not read settings; using defaults: ' + stringifyError(error))
    return {}
  }
}

function buildSessionURL(intent, categoryName, settings) {
  const params = []
  params.push('intent=' + encodeURIComponent(intent))

  const duration = getDurationMinutes(settings)
  params.push('duration=' + encodeURIComponent(duration))

  if (categoryName) params.push('categoryName=' + encodeURIComponent(categoryName))

  return 'session:///start?' + params.join('&')
}

async function openSessionURL(sessionURL, callbackURL) {
  if (typeof NotePlan !== 'undefined' && typeof NotePlan.openURL === 'function') {
    await NotePlan.openURL(addXSuccess(callbackURL, sessionURL))
    return
  }

  if (typeof Clipboard !== 'undefined') {
    Clipboard.string = sessionURL
    await showMessage('Session URL copied to the clipboard.')
    return
  }

  throw new Error('No supported URL opener is available')
}

function addXSuccess(callbackURL, sessionURL) {
  const separator = callbackURL.includes('?') ? '&' : '?'
  return callbackURL + separator + 'x-success=' + encodeURIComponent(sessionURL)
}

function getDurationMinutes(settings) {
  const duration = getSettingString(settings, 'durationMinutes')
  if (duration && /^\d+$/.test(duration) && Number(duration) > 0) return duration
  return '30'
}

function getSettingString(settings, key) {
  if (!settings || !Object.prototype.hasOwnProperty.call(settings, key)) return ''
  const value = settings[key]
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function cleanTaskText(text) {
  const cleaned = String(text || '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+\[[ xX>\-]\]\s*/, '')
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/, '')
    .replace(/\s+\^[A-Za-z0-9_-]+\s*$/, '')
    .replace(/\s+#\S+/g, '')
    .replace(/\s+@\S+/g, '')
    .replace(/\s+>\d{4}-\d{2}-\d{2}/g, '')
    .replace(/\s+\{[^}]+\}/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleanNoteLinkText(cleaned)
}

function isTaskMarkerLine(text) {
  return /^\s*(?:[-*+]|\d+\.)\s+\[[ xX>\-]\]\s+/.test(String(text || ''))
}

function isPlainListLine(text) {
  return /^\s*(?:[-*+]|\d+\.)\s+\S/.test(String(text || ''))
}

function cleanNoteLinkText(text) {
  return String(text || '')
    .replace(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/, function (_match, title, alias) {
      return (alias || title || '').trim()
    })
    .trim()
}

function getCurrentLineText(paragraph) {
  return firstNonEmptyString([
    getParagraphText(paragraph),
    getSelectedLinesText(),
    getSelectionLineText(),
    getSelectedText()
  ])
}

function getParagraphText(paragraph) {
  if (!paragraph) return ''
  return paragraph.rawContent || getRawNoteLine(paragraph) || paragraph.content || ''
}

function getSelectedLinesText() {
  if (typeof Editor === 'undefined') return ''
  return normalizeTextCandidate(Editor.selectedLinesText)
}

function getSelectedText() {
  if (typeof Editor === 'undefined') return ''
  return normalizeTextCandidate(Editor.selectedText)
}

function getSelectionLineText() {
  if (typeof Editor === 'undefined' || !Editor.selection || typeof Editor.selection.start !== 'number') return ''

  const noteContent = getActiveNoteContent()
  if (!noteContent) return ''

  const start = Math.max(0, Math.min(Editor.selection.start, noteContent.length))
  const lineStart = noteContent.lastIndexOf('\n', start - 1) + 1
  const nextLineBreak = noteContent.indexOf('\n', start)
  const lineEnd = nextLineBreak === -1 ? noteContent.length : nextLineBreak

  return noteContent.slice(lineStart, lineEnd)
}

function getRawNoteLine(paragraph) {
  if (!paragraph || typeof paragraph.lineIndex !== 'number') return ''

  const noteContent = getActiveNoteContent()
  if (!noteContent) return ''

  const lines = noteContent.split(/\r?\n/)
  return lines[paragraph.lineIndex] || ''
}

function getActiveNoteContent() {
  if (typeof Editor === 'undefined') return ''
  if (typeof Editor.content === 'string') return Editor.content
  if (Editor.note && typeof Editor.note.content === 'string') return Editor.note.content
  return ''
}

function firstNonEmptyString(values) {
  for (const value of values) {
    const normalized = normalizeTextCandidate(value)
    if (normalized) return normalized
  }
  return ''
}

function normalizeTextCandidate(value) {
  if (Array.isArray(value)) return value.join('\n').trim()
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function getEditorTextDebugInfo(paragraph) {
  try {
    return JSON.stringify({
      paragraphType: paragraph && paragraph.type,
      paragraphLineIndex: paragraph && paragraph.lineIndex,
      paragraphContent: paragraph && paragraph.content,
      paragraphRawContent: paragraph && paragraph.rawContent,
      selectedLinesText: typeof Editor !== 'undefined' ? Editor.selectedLinesText : undefined,
      selectedText: typeof Editor !== 'undefined' ? Editor.selectedText : undefined,
      selection: typeof Editor !== 'undefined' ? Editor.selection : undefined,
      selectionLineText: getSelectionLineText()
    })
  } catch (error) {
    return stringifyError(error)
  }
}

async function showMessage(message) {
  if (typeof CommandBar !== 'undefined' && typeof CommandBar.showMessage === 'function') {
    await CommandBar.showMessage(message)
  } else {
    console.log(message)
  }
}

function stringifyError(error) {
  try {
    if (typeof error === 'string') return error
    if (error && error.message) return error.message
    return JSON.stringify(error)
  } catch (_e) {
    return String(error)
  }
}

Object.assign(typeof globalThis === 'undefined' ? this : globalThis, {
  sendToSession
})

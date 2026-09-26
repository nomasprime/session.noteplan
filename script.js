/* Session for NotePlan — /start */

async function sendToSession() {
  let blockSaved = false
  try {
    if (typeof Editor === 'undefined' || !Editor.note) {
      throw new Error('Open a note and put the cursor on a bullet, open task, checklist, or section heading.')
    }
    // Use the native selected paragraph directly for in-place updates, including
    // folded notes and notes with frontmatter.
    const selected = Editor.selectedParagraphs || []
    if (selected.length !== 1) {
      throw new Error('Put the cursor on one bullet, open task, checklist, or section heading.')
    }
    const paragraph = selected[0]
    const note = Editor.note
    const source = String(paragraph.content || '')
    // A [>] original is scheduling history. A date link on an open item is fine.
    if (!['open', 'checklist', 'list', 'title'].includes(paragraph.type)) {
      const hint = ['scheduled', 'checklistScheduled'].includes(paragraph.type) ?
        ' Select the active copy of this rescheduled item.' : ''
      throw new Error('Select a bullet, open task, checklist, or section heading.' + hint)
    }
    const location = getSelectedLocation(paragraph)
    if (isNoteTitleHeading(paragraph, location)) {
      throw new Error('The note title heading cannot start a session. Select an item or section heading below it.')
    }
    // An explicit estimate overrides a range. Once consumed, the range supplies
    // the duration on subsequent runs; only untimed items need a child session.
    let duration = parseDuration(source)
    if (duration === null) duration = parseBlockDuration(source)
    const createChild = duration === null
    const marker = getTimeBlockMarker()
    const intent = getIntent(source, marker)
    if (!intent) throw new Error('The selected line needs a title.')
    if (typeof Editor.addBlockID !== 'function' || typeof Editor.updateParagraph !== 'function') {
      throw new Error('This version of NotePlan does not support the APIs required by /start.')
    }
    if (createChild && (typeof Editor.insertParagraphAfterParagraph !== 'function' || typeof paragraph.duplicate !== 'function')) {
      throw new Error('This version of NotePlan does not support creating a child timeblock.')
    }
    if (typeof NotePlan === 'undefined' || typeof NotePlan.openURL !== 'function') {
      throw new Error('This version of NotePlan does not support launching Session.')
    }

    const settings = typeof DataStore === 'undefined' ? {} : (DataStore.settings || {})
    if (createChild) duration = parseDurationValue(String(settings.unestimatedSessionDuration || '50m').trim() || '50m')

    const insertion = createChild ? getChildInsertion(location) : null
    const target = createChild ? paragraph.duplicate() : paragraph
    if (createChild && getBlockID(target)) {
      // Changing content does not clear the native block-ID metadata copied
      // from the source. Clear it on the detached copy before assigning a new ID.
      if (typeof Editor.removeBlockID !== 'function') {
        throw new Error('This version of NotePlan does not support clearing the copied block ID for a child session.')
      }
      Editor.removeBlockID(target)
    }
    const blockContent = createChild ? (getIntent(settings.unestimatedSessionTitle || 'Session', marker) || 'Session') : source
    const now = new Date()
    target.content = buildTimeBlock(blockContent, now, duration, marker, getDateTag(note, now))
    if (createChild || !getBlockID(target)) Editor.addBlockID(target)
    // A child must have its own ID, never a cached ID inherited from its parent.
    const blockID = createChild ? getBlockID({ content: target.content }) : getBlockID(target)
    if (!blockID) throw new Error('NotePlan could not create a link to this line.')
    if (createChild && Editor.paragraphs.some(p => getBlockID(p) === blockID)) {
      throw new Error('NotePlan could not create a unique link for the child session.')
    }
    const blockURL = buildBlockURL(note, blockID)
    const sessionURL = buildSessionURL(intent, duration, blockURL)

    // Persist the time block before handing control to Session.
    if (createChild) {
      Editor.insertParagraphAfterParagraph(target.content, insertion.after, 'checklist')
      blockSaved = true
      // Inserting changes line indexes. Re-read the new native paragraph by ID.
      const inserted = Editor.paragraphs.find(p => getBlockID(p) === blockID)
      if (!inserted) throw new Error('Could not locate the new session item. Check the note before retrying.')
      inserted.indents = insertion.indents
      Editor.updateParagraph(inserted)
    } else {
      Editor.updateParagraph(target)
      blockSaved = true
    }
    if (typeof Editor.save === 'function') await Editor.save()
    // NotePlan's own x-success callback hands off to Session after saving.
    await NotePlan.openURL(blockURL + '&x-success=' + encodeURIComponent(sessionURL))
  } catch (error) {
    const message = error && error.message ? error.message : String(error)
    console.log('Session: ' + message)
    await showMessage((blockSaved ? 'The note was updated, but the command could not finish. ' : '') + message)
  }
}

function getSelectedLocation(selected) {
  const paragraphs = Editor.paragraphs
  // Selection indexes exclude frontmatter; paragraph-list indexes include it.
  const frontmatter = String(Editor.content).match(/^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/)
  const bodyStart = frontmatter ? (frontmatter[0].match(/\n/g) || []).length : 0
  let index = selected.fileLineIndex
  if (!Number.isInteger(index) || index < 0) {
    index = selected.lineIndex + bodyStart
  }
  const position = paragraphs.findIndex(p => p.lineIndex === index)
  const parent = paragraphs[position]
  if (!parent || parent.content !== selected.content || parent.type !== selected.type || parent.indents !== selected.indents) {
    throw new Error('Could not locate the selected item safely. Select it again and run /start.')
  }
  return { paragraphs, position, parent, bodyStart }
}

function isNoteTitleHeading(selected, location) {
  if (selected.type !== 'title') return false
  const first = location.paragraphs.find(p => p.lineIndex >= location.bodyStart && String(p.content).trim())
  if (first !== location.parent) return false
  const properties = Editor.note.frontmatterAttributes || {}
  // Protect the opening H1 even with a title property. If frontmatter supplies
  // the title, a differently named opening section heading is still usable.
  return selected.headingLevel === 1 || !String(properties.title || '').trim() ||
    selected.content.trim() === String(properties.title).trim()
}

function getChildInsertion(location) {
  const { paragraphs, position, parent } = location
  if (parent.type === 'title') {
    // Keep the new checklist directly in this heading's section, before any
    // following heading (including a nested subsection), at the body indent.
    let after = parent
    for (let i = position + 1; i < paragraphs.length; i++) {
      const next = paragraphs[i]
      if (next.type === 'title') break
      if (String(next.content).trim()) after = next
    }
    return { after, indents: parent.indents }
  }
  // Append after all contiguous descendants, so existing work and notes keep
  // their current parent. A blank line or heading ends an indented subtree.
  let after = parent
  for (let i = position + 1; i < paragraphs.length; i++) {
    const next = paragraphs[i]
    if (!String(next.content).trim() || next.type === 'title' || next.type === 'separator' ||
        /^(?:---+|\*\*\*+|___+)\s*$/.test(next.content) || next.indents <= parent.indents) break
    after = next
  }
  return { after, indents: parent.indents + 1 }
}

function parseDuration(content) {
  // A standalone apostrophe followed by a number denotes an estimate. Ordinary
  // contractions and quoted prose stay intact; smart apostrophes also work.
  const tokens = String(content).match(/(?:^|\s)['’][+-]?\d[^\s…]*/g) || []
  if (tokens.length > 1) throw new Error("Use one duration on the line, such as '20m or '1h30m.")
  return tokens.length ? parseDurationValue(tokens[0].trim()) : null
}

function parseDurationValue(value) {
  const match = String(value).trim().match(/^['’]?(?:(\d+)h(?:(\d+)m)?|(\d+)m)$/i)
  if (!match) throw new Error('Invalid duration. Use whole minutes or hours, such as 20m, 1h, or 1h30m.')
  const minutes = Number(match[1] || 0) * 60 + Number(match[2] || match[3] || 0)
  if (!Number.isSafeInteger(minutes) || minutes <= 0 || minutes >= 1440) {
    throw new Error('Use a duration greater than zero and shorter than 24 hours.')
  }
  return minutes
}

function parseBlockDuration(content) {
  const range = String(content).match(/^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})(?=\s|$)/)
  if (!range) return null
  const [, startHour, startMinute, endHour, endMinute] = range.map(Number)
  if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
    throw new Error('Invalid time range. Use 24-hour times, such as 09:00 - 09:50.')
  }
  // A smaller end time is the following day, e.g. 23:45 - 00:30 = 45 minutes.
  const duration = ((endHour - startHour) * 60 + endMinute - startMinute + 1440) % 1440
  if (!duration) throw new Error('The timeblock must have a duration greater than zero and shorter than 24 hours.')
  return duration
}

function stripLeadingTime(content) {
  // Replace the old timeblock prefix; other times within the title stay intact.
  return String(content).replace(/^\s*(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[-–]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?(?=\s|$)\s*/, '')
}

function stripEstimate(content) {
  return String(content).replace(/(?:^|\s)['’](?:\d+h(?:\d+m)?|\d+m)(?=\s|…|$)/gi, ' ')
}

function getIntent(content, marker) {
  let title = stripLeadingTime(stripEstimate(content))
    .replace(/(?:^|\s+)\^[A-Za-z0-9_-]+\s*$/, '')
    .replace(/(?:^|\s)>(?:\d{4}-\d{2}-\d{2}|today|tomorrow|yesterday)(?=\s|$)/g, ' ')
  if (marker) title = title.split(marker).join(' ')
  return title.replace(/\s*(?:…|\.{3})\s*$/, '').replace(/\s+/g, ' ').trim()
}

function buildTimeBlock(content, now, duration, marker, dateTag) {
  let body = stripLeadingTime(stripEstimate(content)).trim()
  // The ID must remain at the end of the line for NotePlan's block links.
  const id = body.match(/\s+(\^[A-Za-z0-9_-]+)\s*$/)
  if (id) body = body.slice(0, id.index).trimEnd()
  // This command starts work now, so replace explicit scheduling dates.
  body = body.replace(/(?:^|\s)>(?:\d{4}-\d{2}-\d{2}|today|tomorrow|yesterday)(?=\s|$)/g, '').replace(/\s+/g, ' ').trim()
  const start = formatTime(now)
  const end = ' - ' + formatTime(new Date(now.getTime() + duration * 60000))
  const parts = [start + end, body]
  if (dateTag) parts.push(dateTag)
  if (marker && !body.normalize('NFC').includes(marker.normalize('NFC'))) parts.push(marker)
  if (id) parts.push(id[1])
  return parts.join(' ')
}

function formatTime(date) {
  return String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
}

function localDate(date) {
  return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0')
}

function isTodayDailyNote(note, now) {
  const filename = String(note.filename || '').split('/').pop().replace(/\.(md|txt)$/i, '')
  return note.type === 'Calendar' && filename === localDate(now).replace(/-/g, '')
}

function getDateTag(note, now) {
  return isTodayDailyNote(note, now) ? '' : '>' + localDate(now)
}

function getTimeBlockMarker() {
  if (typeof DataStore === 'undefined' || typeof DataStore.preference !== 'function') return ''
  const value = DataStore.preference('timeblockTextMustContainString')
  return value == null || value === 'undefined' ? '' : String(value).trim()
}

function getBlockID(paragraph) {
  const match = String(paragraph.content || '').match(/(?:^|\s)\^([A-Za-z0-9_-]+)\s*$/)
  return match ? match[1] : String(paragraph.blockId || '').replace(/^\^/, '')
}

function buildBlockURL(note, blockID) {
  // NotePlan supports noteTitle=YYYY-MM-DD^blockID for daily notes too.
  let title = String(note.title || '')
  if (note.type === 'Calendar') {
    const day = String(note.filename || '').match(/(?:^|\/)(\d{4})(\d{2})(\d{2})\.(?:md|txt)$/i)
    if (day) title = day[1] + '-' + day[2] + '-' + day[3]
  }
  if (!title) throw new Error('Could not determine the note title for the time-block link.')
  return 'noteplan://x-callback-url/openNote?noteTitle=' + encodeURIComponent(title + '^' + blockID)
}

function buildSessionURL(intent, duration, blockURL) {
  const params = ['intent=' + encodeURIComponent(intent), 'duration=' + encodeURIComponent(duration),
    'notes=' + encodeURIComponent(blockURL)]
  return 'session:///start?' + params.join('&')
}

async function showMessage(message) {
  if (typeof CommandBar !== 'undefined' && typeof CommandBar.prompt === 'function') {
    await CommandBar.prompt('Session', message, ['OK'])
  } else {
    console.log(message)
  }
}

Object.assign(typeof globalThis === 'undefined' ? this : globalThis, { sendToSession })

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sendToSession, parseDuration, parseBlockDuration, getIntent, buildTimeBlock, getDateTag, buildBlockURL, buildSessionURL }
}

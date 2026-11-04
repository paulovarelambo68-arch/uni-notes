// How a subject's index note is read, shared by sync-vault.mjs (which notes to copy) and
// build-content.mjs (where notes go and which index sections show), so both agree on what
// site.yaml's `publish` list covers.

// "**Name**" or "__Name__" -> "Name".
export function stripBold(text) {
  const m = text.trim().match(/^(\*\*|__)(.*)\1$/)
  return m ? m[2].trim() : text.trim()
}

// A heading as the site shows it: without wrapping bold, after site.yaml's `headings` fixes.
export function headingText(raw, fixes = {}) {
  const text = stripBold(raw)
  return fixes?.[text] ?? text
}

// The site.yaml entry for a subject, matching its name without regard to case.
export function subjectConfig(siteConfig, subject) {
  const entries = Object.entries(siteConfig.subjects ?? {})
  return entries.find(([name]) => name.toLowerCase() === subject.toLowerCase())?.[1] ?? {}
}

// How `publish` entries are compared with headings and note names: ignoring case and extra
// whitespace, and straight versus curly quotes or a hyphen versus a dash, so that
// "Pressure-Volume Loop, Starling's Law" finds "Pressure–Volume Loop, Starling’s Law".
export function matchKey(text) {
  return String(text)
    .normalize("NFC")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

// A note as `publish` lists it or a link names it: "Folder/Note.md" -> matchKey("Note").
const noteKey = (name) => matchKey(String(name).split("/").pop().replace(/\.md$/i, ""))

// The subject's `publish` list, or null when the whole subject is published. One entry per
// heading, { heading, notes }: notes is null for the whole heading (`- Immunology I`), or the
// names of the only notes under it that go on the site, written one per line:
//   - Cardiovascular System:
//       - Circulation Overview – Circuits, Vessels and the MAP Equation
// (not as `[a, b]`, which YAML would split at the commas in the names). A name YAML reads as a
// mapping, such as a line ending in a colon, is taken as the text it was. A `publish:` key left
// empty (say, its only entry commented out) is an empty list, not "everything", and a heading
// followed by no notes gets notes []; publishProblems reports both.
export function publishList(config) {
  if (!config || !Object.hasOwn(config, "publish")) return null
  const asText = (n) =>
    n && typeof n === "object" && !Array.isArray(n)
      ? Object.entries(n).map(([k, v]) =>
          v == null ? k : `${k}: ${[v].flat(Infinity).join(", ")}`,
        )
      : [n]
  const entries = []
  for (const item of [config.publish ?? []].flat(Infinity)) {
    if (item && typeof item === "object") {
      for (const [heading, notes] of Object.entries(item)) {
        const names = [notes ?? []].flat(Infinity).flatMap(asText)
        entries.push({
          heading: heading.trim(),
          notes: names.map((n) => String(n ?? "").trim()).filter(Boolean),
        })
      }
    } else if (String(item ?? "").trim()) {
      entries.push({ heading: String(item).trim(), notes: null })
    }
  }
  return entries
}

// [text](dest), [text](<dest>) and [text](dest "title"): the destination, as written.
export const MARKDOWN_LINK =
  /\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

// Wikilink, embed and markdown-link targets in a text, as written but without aliases or
// #headings: "Note", "Folder/Note.md", "img.png". External links and bare #headings are skipped.
export function linksInText(text) {
  const targets = []
  for (const m of text.matchAll(/\[\[([^\]|#\\]+)/g)) targets.push(m[1].trim())
  for (const m of text.matchAll(MARKDOWN_LINK)) {
    const dest = (m[2] ?? m[3]).replace(/#.*$/, "")
    if (!dest || /^[a-z][a-z0-9+.-]*:/i.test(dest)) continue // #heading, http:, mailto:, …
    try {
      targets.push(decodeURIComponent(dest))
    } catch {
      targets.push(dest)
    }
  }
  return targets.filter(Boolean)
}

// Link targets that name an attachment rather than a note, when no file says otherwise. Only
// known media extensions count, since note names can contain dots ("pH 7.4 Buffering").
export const ATTACHMENT =
  /\.(png|jpe?g|gif|svg|webp|avif|bmp|heic|pdf|mp3|wav|m4a|ogg|flac|webm|mp4|mov|mkv|ogv)$/i

const EVERY = "every" // a heading, or an index line, whose links are all published
const HEADING = /^(#{1,6})\s+(.*?)\s*$/
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/
const NEW_BLOCK = /^ {0,3}(([-*_])( *\2){2,} *$|>|```|~~~)/ // thematic break, quote, code fence

// The index's lines after its frontmatter, with one flag per line: is that line published? A
// heading is published when its text (as written or as fixed) matches a `publish` entry, or it
// sits under a published "# Section". Levels follow the site's folders, not the Markdown:
// "# " is a sidebar folder and every deeper heading a subfolder of it, so "## A" followed by
// "### B" are sibling subfolders and publishing A doesn't publish B. Other lines follow the
// nearest heading above them, and lines before the first heading are published.
// Under a heading published with a list of notes, only the links to those notes are published,
// so consumers ask `publishes(line, target)` link by link. The lines shown are decided per list
// item (see listedLines). A note matches by the name its link uses or by its title after
// site.yaml's `rename`. Attachments (`isNote` false: the consumers pass one that knows the
// files) follow their line. Also returns the `publish` headings that match no heading
// (`unmatched`), and the listed notes that no line under their heading links to
// (`unmatchedNotes`, { heading, note }).
export function indexLines(text, publish, options = {}) {
  const { headings: fixes, rename, isNote = (t) => !ATTACHMENT.test(t) } = options ?? {}
  const body = text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "")
  const lines = body.split("\n")
  if (!publish) {
    const published = lines.map(() => true)
    return { lines, published, publishes: () => true, unmatched: [], unmatchedNotes: [] }
  }

  const wanted = new Map() // heading key -> EVERY, or the keys of the notes it publishes
  const listed = new Map() // heading key -> keys of every note listed for it
  for (const { heading, notes } of publish) {
    const key = matchKey(heading)
    const had = wanted.get(key)
    const add = notes ? new Set(notes.map(noteKey)) : EVERY
    wanted.set(key, had === EVERY || add === EVERY ? EVERY : new Set([...(had ?? []), ...add]))
    listed.set(key, new Set([...(listed.get(key) ?? []), ...(notes ?? []).map(noteKey)]))
  }
  const renamed = new Map(Object.entries(rename ?? {}).map(([k, v]) => [noteKey(k), noteKey(v)]))
  const namesOf = (target) => {
    const key = noteKey(target)
    return renamed.has(key) ? [key, renamed.get(key)] : [key]
  }
  const union = (a, b) =>
    a === EVERY || b === EVERY ? EVERY : !a ? b : !b ? a : new Set([...a, ...b])
  const noteLinks = (line) => linksInText(line).filter(isNote)

  const found = new Set() // heading keys seen, and "heading\0note" for listed notes linked
  const stack = [] // enclosing headings: { level, keys, allow }
  const headings = lines.map((line) => line.match(HEADING))
  // What each line publishes: EVERY link, the keys of the notes it may link to, or nothing.
  const allows = lines.map((line, i) => {
    const h = headings[i]
    if (h) {
      const level = h[1].length === 1 ? 1 : 2 // folder or subfolder, as build-content places notes
      while (stack.length && stack.at(-1).level >= level) stack.pop()
      const names = [stripBold(h[2]), headingText(h[2], fixes)].map(matchKey)
      const keys = [...new Set(names)].filter((n) => wanted.has(n)) // as written and as fixed
      for (const key of keys) found.add(key)
      const own = keys.map((key) => wanted.get(key)).reduce(union, null)
      const allow = stack.reduce((acc, s) => union(acc, s.allow), own) || null
      stack.push({ level, keys, allow })
      return allow
    }
    const allow = stack.length ? stack.at(-1).allow : EVERY
    if (allow) {
      for (const name of noteLinks(line).flatMap(namesOf)) {
        for (const s of stack) {
          for (const key of s.keys) if (listed.get(key).has(name)) found.add(`${key}\0${name}`)
        }
      }
    }
    return allow
  })

  const listedHere = (i, t) => allows[i] instanceof Set && namesOf(t).some((n) => allows[i].has(n))
  const published = listedLines(lines, headings, allows, (i) => {
    const notes = noteLinks(lines[i])
    return notes.length ? notes.some((t) => listedHere(i, t)) : null
  })
  const publishes = (i, t) =>
    allows[i] === EVERY ||
    (allows[i] instanceof Set && (isNote(t) ? listedHere(i, t) : published[i]))
  const unmatched = [...new Set(publish.map((p) => p.heading))].filter(
    (h) => !found.has(matchKey(h)),
  )
  const unmatchedNotes = publish.flatMap(({ heading, notes }) => {
    const key = matchKey(heading)
    if (!notes || !found.has(key)) return []
    return notes
      .filter((n) => !found.has(`${key}\0${noteKey(n)}`))
      .map((note) => ({ heading, note }))
  })
  return { lines, published, publishes, unmatched, unmatchedNotes }
}

// Which lines are published: those under a whole published heading, none under an unpublished
// one, and under a heading with a list of notes, list item by list item. An item, with the lines
// nested in it, is published when it links to a listed note and hidden when it links only to
// other notes; one that links to no note follows the item it is nested in (text outside a list
// is published). An item that holds a published line is published too, so a listed note keeps
// its place under an unlisted one (as plain text there) instead of becoming an indented code
// block. `ownOf(i)` is line i's own verdict: true, false, or null when it links to no note.
function listedLines(lines, headings, allows, ownOf) {
  const published = lines.map((_, i) => Boolean(allows[i]))
  let items = [] // open list items, innermost last: { content, line, on, parent }
  let afterBlank = true
  lines.forEach((line, i) => {
    if (headings[i] || !(allows[i] instanceof Set)) {
      items = []
      afterBlank = true
      return
    }
    if (!line.trim()) {
      afterBlank = true // blank lines stay
      return
    }
    const indent = column(line)
    const marker = line.match(LIST_ITEM)
    // A new item or block, or text after a blank line, closes the items it isn't indented
    // under; other text continues the innermost item (Markdown's lazy continuation).
    if (marker || afterBlank || NEW_BLOCK.test(line)) {
      while (items.length && items.at(-1).content > indent) items.pop()
    }
    const owner = items.at(-1) ?? null
    const own = ownOf(i)
    const on = own ?? (owner ? owner.on : true)
    published[i] = on
    if (on)
      for (let it = owner; it && !published[it.line]; it = it.parent) published[it.line] = true
    if (marker) items.push({ content: indent + marker[2].length + 1, line: i, on, parent: owner })
    afterBlank = false
  })
  return published
}

// Indentation of a line in columns, a tab reaching the next multiple of 4 as in CommonMark.
function column(line) {
  let col = 0
  for (const ch of line) {
    if (ch === " ") col++
    else if (ch === "\t") col += 4 - (col % 4)
    else break
  }
  return col
}

// What is wrong with a subject's `publish` list, given its index as read by indexLines: phrases
// such as `publishes "X", but its index has no such heading`. Empty when nothing is.
export function publishProblems(publish, sections) {
  if (!publish) return []
  if (publish.length === 0) return ["has an empty publish list"]
  const quote = (names) => [...new Set(names)].map((n) => `"${n}"`).join(", ")
  const problems = []
  if (sections.unmatched.length) {
    problems.push(`publishes ${quote(sections.unmatched)}, but its index has no such heading`)
  }
  for (const { heading, notes } of publish) {
    if (notes?.length === 0) problems.push(`lists no notes under "${heading}"`)
  }
  const missing = new Map() // heading -> listed notes not linked under it
  for (const { heading, note } of sections.unmatchedNotes) {
    missing.set(heading, [...(missing.get(heading) ?? []), note])
  }
  for (const [heading, notes] of missing) {
    const them = new Set(notes).size === 1 ? "it" : "them"
    problems.push(
      `publishes ${quote(notes)} under "${heading}", but nothing under that heading links to ${them}`,
    )
  }
  return problems
}

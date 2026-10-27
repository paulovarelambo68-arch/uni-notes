#!/usr/bin/env node
// Turns the flat Obsidian vault(s) in vault/ into the structured content/ folder Quartz builds.
//
// The notes in vault/ are never modified. Structure comes from each subject's index note:
//   # Section            -> folder
//   ### Subsection       -> subfolder
//   - [[Note]]           -> note placed in that subfolder, in that order
// Notes not listed in the index go to the Concepts folder, attachments to attachments/.
//
// Presentation tweaks (all build-time):
//   - page titles from site.yaml renames, links keep their original wording
//   - headings start at h2 and lose redundant **bold**
//   - opening blockquote -> "Definition" callout, blockquote under "Summary" -> summary callout,
//     blockquotes starting with a bold label ("**Memory hook:**") -> tip callout
//   - ==highlights== containing **bold**, links or math render that markup instead of showing it
//   - image-placeholder embeds that point nowhere are dropped
//   - with `publish` in site.yaml, only the listed index sections and the notes they reach go
//     on the site (sync-vault.mjs applies the same rule when it copies the vault)
//   - links to notes that aren't on the site (not written yet, or held back) become plain text,
//     and index sections left without links are hidden; links in code are left alone
//   - notes with an audio track in audio/ get a `narration` field for the narration player

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { execFileSync } from "node:child_process"
import YAML from "yaml"
import {
  MARKDOWN_LINK,
  headingText,
  indexLines,
  publishList,
  stripBold,
  subjectConfig,
} from "./index-sections.mjs"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const VAULT = path.join(ROOT, "vault")
const AUDIO = path.join(ROOT, "audio")
const OUT = path.join(ROOT, "content")
const GENERATED = path.join(ROOT, ".generated")

const siteConfig = YAML.parse(fs.readFileSync(path.join(ROOT, "site.yaml"), "utf8")) ?? {}
const CONCEPTS = siteConfig.conceptsFolder ?? "Concepts"
const IGNORED = new Set([".obsidian", ".trash", ".git"])

const explorerOrder = {}
let rank = 0
const setRank = (name) => {
  if (!(name in explorerOrder)) explorerOrder[name] = rank++
}

excludeGeneratedFromGit()

const subjects = fs
  .readdirSync(VAULT, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !IGNORED.has(d.name) && !d.name.startsWith("."))
  .map((d) => d.name)
  .sort((a, b) => subjectOrder(a) - subjectOrder(b) || a.localeCompare(b))

// Each subject's index and `publish` list. A list that is empty or names no heading stops the
// build before anything is written, so a typo can't take a subject off the live site.
const indexes = new Map(subjects.map((s) => [s, readIndex(s)]))
const problems = []
for (const [s, { publish, sections }] of indexes) {
  if (publish?.length === 0) problems.push(`${s} has an empty publish list`)
  else if (sections.unmatched.length) {
    const names = sections.unmatched.map((p) => `"${p}"`).join(", ")
    problems.push(`${s} publishes ${names}, but its index has no such heading`)
  }
}
if (problems.length) {
  console.error(
    `site.yaml: ${problems.join("; ")}. Fix it (or delete the publish line); nothing built.`,
  )
  process.exit(1)
}

fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(OUT, { recursive: true })
fs.mkdirSync(GENERATED, { recursive: true })

// What each subject puts on the site. One with no notes besides its index gets no page, and the
// home page shows it as plain text. Every note (by name and alias) and attachment name on the
// site is collected so links across subjects still count.
const onSite = new Map(subjects.map((s) => [s, subjectFiles(s)]))
const empty = subjects.filter((s) => {
  const { index } = indexes.get(s)
  return !onSite.get(s).files.some((f) => f !== index && f.toLowerCase().endsWith(".md"))
})
const siteNotes = new Set()
const siteAssets = new Set()
for (const s of subjects.filter((s) => !empty.includes(s))) {
  for (const file of onSite.get(s).files) {
    const base = path.basename(file).toLowerCase()
    if (!base.endsWith(".md")) {
      siteAssets.add(base)
      continue
    }
    siteNotes.add(base.slice(0, -3))
    for (const alias of aliasesOf(file)) siteNotes.add(alias)
  }
}

const summaries = subjects.filter((s) => !empty.includes(s)).map(buildSubject)
writeHome(summaries)
fs.writeFileSync(
  path.join(GENERATED, "explorer-order.json"),
  JSON.stringify(explorerOrder, null, 2),
)

for (const s of empty) console.log(`${s}: no notes on the site yet, left out`)
for (const s of summaries) {
  console.log(
    `${s.subject}: ${s.indexed} indexed notes, ${s.concepts} concepts, ${s.assets} attachments` +
      (s.warnings.length ? `\n  ${s.warnings.join("\n  ")}` : ""),
  )
}

// Subjects appear in the sidebar in the order Subjects.md lists them, the rest after.
function subjectOrder(subject) {
  const home = path.join(VAULT, "Subjects.md")
  const listed = fs.existsSync(home)
    ? [...fs.readFileSync(home, "utf8").matchAll(/\[\[([^\]|#\\]+)/g)].map((m) =>
        m[1].trim().toLowerCase(),
      )
    : []
  const i = listed.indexOf(subject.toLowerCase())
  return i < 0 ? Infinity : i
}

// content/ and .generated/ must stay out of git, but they can't go in .gitignore: Quartz skips
// gitignored files when it builds. .git/info/exclude is per-clone, so add them on every clone.
function excludeGeneratedFromGit() {
  const exclude = path.join(ROOT, ".git", "info", "exclude")
  if (!fs.existsSync(path.dirname(exclude))) return
  const current = fs.existsSync(exclude) ? fs.readFileSync(exclude, "utf8") : ""
  const missing = ["/content/", "/.generated/"].filter((p) => !current.split("\n").includes(p))
  if (missing.length === 0) return
  const header = "# generated by scripts/build-content.mjs (kept out of .gitignore, see the script)"
  fs.appendFileSync(
    exclude,
    `${current.endsWith("\n") || !current ? "" : "\n"}${header}\n${missing.join("\n")}\n`,
  )
}

// A subject's files by lowercased note name (no .md) or attachment file name, its index note,
// which lines of the index its `publish` list covers, and the notes held back: listed only
// under unpublished headings (the same notes sync-vault.mjs leaves out of this subject).
function readIndex(subject) {
  const config = subjectConfig(siteConfig, subject)
  const publish = publishList(config)
  const files = [...walk(path.join(VAULT, subject))]
  const byName = new Map()
  for (const file of files) byName.set(nameOf(file), file)
  const index = byName.get(subject.toLowerCase()) ?? byName.get("index")
  const sections = indexLines(index ? readText(index) : "", publish, config.headings)
  const shown = new Set()
  const hidden = new Set()
  sections.lines.forEach((line, i) => {
    for (const t of linkTargets(line)) (sections.published[i] ? shown : hidden).add(t)
  })
  const subjectNames = new Set(subjects.map((s) => s.toLowerCase()))
  const held = new Set([...hidden].filter((t) => !shown.has(t) && !subjectNames.has(t)))
  return { files, byName, index, publish, sections, held }
}

// The files of vault/<Subject> that go on the site: all but held-back notes, or with a `publish`
// list only the index and what its published sections reach, link by link, never through a
// held-back note. sync-vault.mjs copies by the same rule; applying it here too covers notes
// written straight into vault/.
function subjectFiles(subject) {
  const { files, byName, index, publish, sections, held } = indexes.get(subject)
  const isNote = (file) => file.toLowerCase().endsWith(".md")
  const visible = (file) => file === index || !isNote(file) || !held.has(nameOf(file))
  if (!publish || !index) return { files: files.filter(visible), publish }

  const keep = new Set([index])
  const queue = sections.lines.flatMap((line, i) =>
    sections.published[i] ? linkTargets(line) : [],
  )
  while (queue.length) {
    const file = byName.get(queue.shift())
    if (!file || keep.has(file) || !visible(file)) continue
    keep.add(file)
    if (isNote(file)) queue.push(...linkTargets(readText(file)))
  }
  return { files: files.filter((f) => keep.has(f)), publish }
}

// "Note.md" -> "note", "img.png" -> "img.png": how links name a file.
function nameOf(file) {
  const base = path.basename(file).toLowerCase()
  return base.endsWith(".md") ? base.slice(0, -3) : base
}

function readText(file) {
  return fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
}

function buildSubject(subject) {
  const dir = path.join(VAULT, subject)
  const cfg = subjectConfig(siteConfig, subject)
  const renames = cfg.rename ?? {}
  const headingFixes = cfg.headings ?? {}
  const { files, publish } = onSite.get(subject)
  const warnings = []

  // Collect files by basename, the way Obsidian's shortest-path links resolve them.
  const notes = new Map() // lowercased name -> { name, file }
  const assets = new Map() // lowercased filename -> { name, file }
  for (const file of files) {
    const base = path.basename(file)
    if (base.toLowerCase().endsWith(".md")) {
      const name = base.slice(0, -3)
      notes.set(name.toLowerCase(), { name, file })
    } else {
      assets.set(base.toLowerCase(), { name: base, file })
    }
  }

  const modified = lastModifiedDates(dir)

  const indexNote = notes.get(subject.toLowerCase()) ?? notes.get("index")
  if (!indexNote)
    warnings.push(`no index note found (expected ${subject}.md), everything goes to ${CONCEPTS}`)

  // Output name of every note, after renames. Keyed by lowercased original name.
  const outName = new Map()
  for (const [key, n] of notes) {
    if (n === indexNote) continue
    outName.set(key, sanitize(renames[n.name] ?? n.name))
  }

  // Walk the index to decide folders and order.
  const placement = new Map() // lowercased note name -> relative folder
  setRank(subject)
  if (indexNote) {
    let section = null
    let subsection = null
    const index = indexLines(fs.readFileSync(indexNote.file, "utf8"), publish, headingFixes)
    for (const [i, line] of index.lines.entries()) {
      const h = line.match(/^(#{1,6})\s+(.*?)\s*$/)
      if (h) {
        const text = headingText(h[2], headingFixes)
        if (h[1].length === 1) {
          section = text
          subsection = null
        } else {
          subsection = text
        }
        continue
      }
      if (!index.published[i]) continue
      for (const link of line.matchAll(/(?<!!)\[\[([^\]|#\\]+)/g)) {
        const key = link[1].trim().toLowerCase()
        if (!notes.has(key) || placement.has(key) || notes.get(key) === indexNote) continue
        const parts = [section, subsection].filter(Boolean).map(sanitize)
        parts.forEach(setRank)
        placement.set(key, parts.join("/"))
        setRank(titleFor(notes.get(key).name, renames))
      }
    }
  }
  explorerOrder[CONCEPTS] = 1e6

  const resolveNote = (target) => {
    const key = path.basename(target.trim()).replace(/\.md$/i, "").toLowerCase()
    return notes.has(key) ? key : null
  }
  const resolveAsset = (target) => assets.get(path.basename(target.trim()).toLowerCase()) ?? null

  // In prose a renamed link keeps its original wording; on the index page it shows the new title.
  const missing = new Set() // targets of links in notes with no page on the site
  const rewrite = (md, { preferTitle = false, index = false } = {}) =>
    rewriteLinks(md, {
      resolveNote,
      resolveAsset,
      outName,
      notes,
      indexNote,
      subject,
      warnings,
      missing: index ? new Set() : missing, // the index's own missing entries aren't news
      label: (key, written) => (preferTitle ? titleFor(notes.get(key).name, renames) : written),
    })

  const scripts = narrationScripts(subject)

  // Notes
  let indexed = 0
  let concepts = 0
  for (const [key, n] of notes) {
    if (n === indexNote) continue
    const folder = placement.get(key) ?? CONCEPTS
    placement.has(key) ? indexed++ : concepts++
    const renamed = renames[n.name] !== undefined
    let body = fs.readFileSync(n.file, "utf8").replace(/\r\n/g, "\n")
    const { frontmatter, content } = splitFrontmatter(body)
    let text = rewrite(content)
    text = normalizeHeadings(text)
    text = addCallouts(text)
    text = expandHighlights(text)
    if (!text.replace(/!\[\[[^\]]*\]\]/g, "").trim() && !/!\[\[/.test(text)) {
      text = "*This note is still empty.*\n"
    }
    const fm = {
      title: titleFor(n.name, renames),
      modified: modified.get(n.file) ?? fs.statSync(n.file).mtime.toISOString(),
      ...frontmatter,
    }
    if (renamed) fm.aliases = [...new Set([...(fm.aliases ?? []), n.name])]
    const narration = addNarration(subject, n, outName.get(key), warnings, scripts)
    if (narration) fm.narration = narration
    writeNote(path.join(OUT, subject, folder, `${outName.get(key)}.md`), fm, text)
  }

  // Attachments
  for (const a of assets.values()) {
    const dest = path.join(OUT, subject, "attachments", a.name)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.copyFileSync(a.file, dest)
  }

  // Subject home page = the index note's published sections, with empty sections removed.
  if (indexNote) {
    let text = fs.readFileSync(indexNote.file, "utf8").replace(/\r\n/g, "\n")
    const index = indexLines(text, publish, headingFixes)
    text = index.lines.filter((_, i) => index.published[i]).join("\n")
    text = text.replace(/^(#{1,6})[ \t]+(.*?)[ \t]*$/gm, (_, hashes, t) => {
      return `${hashes.length === 1 ? "##" : "###"} ${headingText(t, headingFixes)}`
    })
    text = rewrite(text, { preferTitle: true, index: true })
    text = dropEmptySections(text).replace(/^---\s*$/gm, "") // headings already separate sections
    writeNote(path.join(OUT, subject, "index.md"), { title: subject }, text)
  } else {
    writeNote(path.join(OUT, subject, "index.md"), { title: subject }, "")
  }

  for (const base of scripts.values()) {
    warnings.push(`${path.relative(ROOT, base)}.md matches no note in vault/${subject}`)
  }
  if (missing.size) {
    const names = [...missing].sort()
    warnings.push(
      `${names.length} linked notes aren't on the site, their links are plain text: ` +
        names.slice(0, 6).join(", ") +
        (names.length > 6 ? ", …" : ""),
    )
  }

  return { subject, indexed, concepts, assets: assets.size, warnings }
}

// Narration scripts of a subject, keyed by lowercased note name, so the lookup doesn't depend
// on the file system's case sensitivity (macOS ignores case, the CI runner doesn't).
function narrationScripts(subject) {
  const scripts = new Map()
  if (!fs.existsSync(AUDIO)) return scripts
  const dir = fs
    .readdirSync(AUDIO, { withFileTypes: true })
    .find((d) => d.isDirectory() && d.name.toLowerCase() === subject.toLowerCase())
  if (!dir) return scripts
  for (const file of fs.readdirSync(path.join(AUDIO, dir.name))) {
    if (file.endsWith(".md")) {
      scripts.set(file.slice(0, -3).toLowerCase(), path.join(AUDIO, dir.name, file.slice(0, -3)))
    }
  }
  return scripts
}

// Audio track from audio/<Subject>/<Note>.{md,mp3,json} (see scripts/narrate.mjs): copies the
// MP3 next to the subject's attachments and returns the timings for the narration player.
function addNarration(subject, note, name, warnings, scripts) {
  const base = scripts.get(note.name.toLowerCase())
  if (!base) return null
  scripts.delete(note.name.toLowerCase())
  const label = path.relative(ROOT, base)
  const script = fs.readFileSync(`${base}.md`, "utf8")
  const source = script.match(/^---\n[\s\S]*?^source:\s*(\S+)/m)?.[1]
  if (source && source !== shortHash(fs.readFileSync(note.file))) {
    warnings.push(
      `${label}.md was written for an older version of the note; update it and run npm run audio`,
    )
  }
  let timeline = null
  try {
    timeline = JSON.parse(fs.readFileSync(`${base}.json`, "utf8"))
  } catch {}
  if (!timeline || !fs.existsSync(`${base}.mp3`)) {
    warnings.push(`${label}.md has no audio yet; run npm run audio`)
    return null
  }
  if (timeline.script !== shortHash(script)) {
    warnings.push(`${label}.md changed since its audio was made; run npm run audio`)
  }
  const src = `${subject}/audio/${name}.mp3`
  fs.mkdirSync(path.join(OUT, subject, "audio"), { recursive: true })
  fs.copyFileSync(`${base}.mp3`, path.join(OUT, src))
  return {
    src,
    voice: timeline.voice,
    duration: timeline.duration,
    sections: timeline.sections,
    credit: siteConfig.audio?.credit ?? null,
  }
}

function shortHash(data) {
  return crypto.createHash("sha1").update(data).digest("hex").slice(0, 12)
}

function rewriteLinks(md, ctx) {
  const {
    resolveNote,
    resolveAsset,
    outName,
    notes,
    indexNote,
    subject,
    warnings,
    missing,
    label,
  } = ctx
  // [text](Note%20Name.md) links to notes that aren't on the site become their text.
  let inCode = codeRanges(md)
  md = md.replace(MARKDOWN_LINK, (whole, text, angled, plain, at) => {
    const href = (angled ?? plain).replace(/#.*$/, "")
    if (md[at - 1] === "!" || inCode(at) || !/\.md$/i.test(href)) return whole
    if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(href)) return whole // http:, /absolute, //host
    let file = href
    try {
      file = decodeURIComponent(href)
    } catch {}
    const name = path.basename(file).slice(0, -3)
    if (resolveNote(name) || siteNotes.has(name.toLowerCase())) return whole
    missing.add(name)
    return text
  })

  inCode = codeRanges(md)
  return md.replace(/(!?)\[\[([^\]]+?)\]\]/g, (whole, bang, inner, at) => {
    if (inCode(at)) return whole // code shows the link as written
    // Inside tables Obsidian escapes the alias pipe as \|; keep whatever was used.
    const sep = inner.includes("\\|") ? "\\|" : "|"
    const [targetPart, ...rest] = inner.split(sep)
    const alias = rest.length ? rest.join(sep) : null
    const hashAt = targetPart.indexOf("#")
    const target = hashAt >= 0 ? targetPart.slice(0, hashAt) : targetPart
    const anchor = hashAt >= 0 ? targetPart.slice(hashAt) : ""

    const base = path.basename(target.trim()).toLowerCase()
    // In another subject: Quartz resolves it across the site.
    const elsewhere = siteAssets.has(base) || siteNotes.has(base.replace(/\.md$/, ""))

    if (bang) {
      const asset = resolveAsset(target)
      if (asset) return whole
      if (!resolveNote(target)) {
        if (elsewhere) return whole
        warnings.push(
          `dropped embed with no file: ![[${inner.slice(0, 60)}${inner.length > 60 ? "…" : ""}]]`,
        )
        return ""
      }
    }

    const key = resolveNote(target)
    if (!key) {
      const name = path.basename(target.trim()).replace(/\.md$/i, "")
      // [[#Heading]], attachments and notes in other subjects resolve in Quartz itself.
      if (!name || resolveAsset(target) || elsewhere) return whole
      missing.add(name)
      return alias ?? target.trim()
    }
    if (notes.get(key) === indexNote) {
      return `${bang}[[${subject}/index${anchor}${sep}${alias ?? target.trim()}]]`
    }
    const newTarget = outName.get(key)
    if (newTarget === target.trim()) return whole
    // Keep the original wording in the sentence; only the destination changes.
    return `${bang}[[${newTarget}${anchor}${sep}${alias ?? label(key, target.trim())}]]`
  })
}

function normalizeHeadings(md) {
  const lines = md.split("\n")
  let inFence = false
  let min = 7
  const isHeading = []
  for (const [i, line] of lines.entries()) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const m = !inFence && line.match(/^(#{1,6})\s+\S/)
    isHeading[i] = Boolean(m)
    if (m) min = Math.min(min, m[1].length)
  }
  if (min === 7) return md
  const shift = 2 - min
  return lines
    .map((line, i) => {
      if (!isHeading[i]) return line
      const m = line.match(/^(#{1,6})\s+(.*?)\s*$/)
      const level = Math.min(6, Math.max(2, m[1].length + shift))
      return `${"#".repeat(level)} ${stripBold(m[2])}`
    })
    .join("\n")
}

function addCallouts(md) {
  const lines = md.split("\n")
  const out = []
  let lastContent = null // last non-empty line before the current block
  let i = 0
  while (i < lines.length) {
    if (!/^\s*>/.test(lines[i])) {
      if (lines[i].trim()) lastContent = lines[i]
      out.push(lines[i++])
      continue
    }
    const block = []
    while (i < lines.length && /^\s*>/.test(lines[i])) block.push(lines[i++])
    const first = block[0].replace(/^\s*>\s?/, "")

    if (/^\[!/.test(first)) {
      out.push(...block) // already a callout
    } else if (lastContent === null) {
      out.push("> [!abstract] Definition", ...block)
    } else if (/^#{1,6}\s+.*summary/i.test(lastContent)) {
      out.push("> [!summary]", ...block)
    } else {
      const label = first.match(/^(==)?\*\*(.+?):?\*\*:?(==)?:?\s*(.*)$/)
      if (label) {
        out.push(`> [!tip] ${label[2].replace(/:$/, "")}`, `> ${label[4]}`, ...block.slice(1))
      } else {
        out.push(...block)
      }
    }
    lastContent = block[block.length - 1]
  }
  return out.join("\n")
}

// Quartz's ==highlight== keeps its content as raw text, so **bold**, links or $math$ inside one
// show their markup. Such highlights become an HTML span, whose content Markdown still parses.
// Same matching as Quartz: one line, closes at the first "==", content can't start with "=".
function expandHighlights(md) {
  const inCode = codeRanges(md)
  const math = [...md.matchAll(/\$\$[\s\S]*?\$\$|\$[^$\n]+\$/g)].map((m) => [
    m.index,
    m.index + m[0].length,
  ])
  const inMath = (at) => math.some(([from, to]) => at >= from && at < to)
  return md.replace(/==(?!=)((?:[^=\n]|=(?!=))+?)==/g, (whole, inner, at) => {
    if (inCode(at) || inMath(at) || !/[*_[\]$`<&~]/.test(inner)) return whole
    return `<span class="text-highlight">${inner}</span>`
  })
}

function dropEmptySections(md) {
  // Remove headings with no links under them (counting their subsections), and bare "-" bullets.
  const parts = md.replace(/^[ \t]*[-*+][ \t]*$/gm, "").split(/(?=^#{1,6} )/m)
  const level = (p) => p.match(/^(#{1,6}) /)?.[1].length ?? 0
  return parts
    .filter((p, i) => {
      if (!level(p)) return true
      for (let j = i; j < parts.length && (j === i || level(parts[j]) > level(p)); j++) {
        if (/\[\[/.test(parts[j])) return true
      }
      return false
    })
    .join("")
}

function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!m) return { frontmatter: {}, content: text }
  try {
    return { frontmatter: YAML.parse(m[1]) ?? {}, content: text.slice(m[0].length) }
  } catch {
    return { frontmatter: {}, content: text }
  }
}

function writeNote(file, frontmatter, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `---\n${YAML.stringify(frontmatter)}---\n\n${body.trim()}\n`)
}

function writeHome(summaries) {
  // If the author keeps a Subjects.md note at the vault root, it becomes the home page.
  // Links named after a subject ([[Neurophysiology]]) are pointed at that subject's index.
  // Links to anything with no page yet (a subject without notes) become plain text.
  const homeFile = path.join(VAULT, "Subjects.md")
  if (fs.existsSync(homeFile)) {
    const { frontmatter, content } = splitFrontmatter(fs.readFileSync(homeFile, "utf8"))
    const bySubject = new Map(summaries.map((s) => [s.subject.toLowerCase(), s.subject]))
    const pages = new Set(
      [...walk(OUT)]
        .filter((f) => f.endsWith(".md"))
        .map((f) => path.basename(f, ".md").toLowerCase()),
    )
    const body = content.replace(
      /(!?)\[\[([^\]|#]+)(#[^\]|]*)?(\|[^\]]*)?\]\]/g,
      (m, bang, target, anchor = "", alias = "") => {
        const subject = bySubject.get(target.trim().toLowerCase())
        if (subject) return `${bang}[[${subject}/index${anchor}${alias || `|${target.trim()}`}]]`
        if (bang || pages.has(path.basename(target.trim()).toLowerCase())) return m
        return alias ? alias.slice(1) : target.trim()
      },
    )
    writeNote(path.join(OUT, "index.md"), { title: frontmatter.title ?? "Study Notes" }, body)
    return
  }
  const list = summaries
    .map(
      (s) => `- [[${s.subject}/index|${s.subject}]] (${s.indexed} topics, ${s.concepts} concepts)`,
    )
    .join("\n")
  writeNote(path.join(OUT, "index.md"), { title: "Study Notes" }, `## Subjects\n\n${list}\n`)
}

// content/ is generated, so Quartz can't read dates from git itself. Pass through the date
// of the last commit that touched each vault file.
function lastModifiedDates(dir) {
  const dates = new Map()
  try {
    const log = execFileSync("git", ["log", "--format=%x00%cI", "--name-only", "--", dir], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: ROOT,
      encoding: "utf8",
    }).trim()
    let date = null
    for (const line of log.split("\n")) {
      if (line.startsWith("\0")) date = line.slice(1)
      else if (line && date) {
        const file = path.join(top, line)
        if (!dates.has(file)) dates.set(file, date)
      }
    }
  } catch {
    // not a git checkout; callers fall back to file mtimes
  }
  return dates
}

function titleFor(name, renames) {
  if (renames[name]) return renames[name]
  // "cation" -> "Cation", but leave "pO₂, pCO₂" or "E_K" alone.
  const firstWord = name.split(/\s/)[0]
  return firstWord === firstWord.toLowerCase() ? name[0].toUpperCase() + name.slice(1) : name
}

function sanitize(name) {
  return name
    .replace(/[\\/:*?"<>|#^[\]]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name) || entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

// Lowercased names a note links to or embeds, like nameOf(): "Note.md" -> "note".
function linkTargets(text) {
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
  return targets.map((t) => path.basename(t).toLowerCase().replace(/\.md$/, ""))
}

// Aliases the way Quartz reads them: `aliases` or `alias`, a list or comma-separated text.
function aliasesOf(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const { aliases, alias } = splitFrontmatter(text).frontmatter
  const values = [aliases ?? alias ?? []].flat().map(String)
  return [...values, ...values.flatMap((v) => v.split(","))]
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
}

// Whether a position in the text is inside a code fence or an inline code span.
function codeRanges(md) {
  const ranges = []
  // Fences may be indented (in a list) or quoted (in a callout).
  const fence = /^[ \t>]*(```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t>]*\1[^\n]*$|(?![\s\S]))/gm
  for (const m of md.matchAll(fence)) {
    ranges.push([m.index, m.index + m[0].length])
  }
  for (const m of md.matchAll(/`[^`\n]+`/g)) ranges.push([m.index, m.index + m[0].length])
  return (at) => ranges.some(([from, to]) => at >= from && at < to)
}

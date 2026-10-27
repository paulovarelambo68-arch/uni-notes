#!/usr/bin/env node
// Copies the author's Obsidian vault into vault/, one folder per subject, following Subjects.md.
//   node scripts/sync-vault.mjs [path/to/Obsidian Vault]
//
// Subjects.md at the vault root lists the subjects ([[Neurophysiology]]). For each one:
//   - if the vault has a folder named after the subject, all of it is copied, as before;
//   - the subject's index note (found anywhere in the vault) is copied, and every note,
//     image or file linked from it is followed, link by link, wherever it lives in the vault.
// So a subject can be a folder, or just an index note with its notes loose in the vault.
// A subject whose index links to nothing yet is skipped until it has notes.
// With `publish: [Section, …]` for a subject in site.yaml, only the notes listed under those
// index headings, and what they link to, are copied (a subject folder is then followed link by
// link too). Notes listed only under other headings stay out, whoever links to them. A
// `publish` list naming a subject or heading that doesn't exist stops the sync.
//
// vault/<Subject>/ is made to match exactly (files gone from Obsidian are deleted here), and
// subjects no longer listed in Subjects.md are removed. Nothing in the Obsidian vault is changed.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import YAML from "yaml"
import { MARKDOWN_LINK, indexLines, publishList, subjectConfig } from "./index-sections.mjs"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const DEST = path.join(ROOT, "vault")
const SRC = path.resolve(process.argv[2] ?? path.join(os.homedir(), "Documents", "Obsidian Vault"))
const SKIPPED_DIRS = new Set(["__auto_backup__"]) // plus every dot-folder (.obsidian, .trash, …)
const HOME = "Subjects.md"
const siteConfig = YAML.parse(fs.readFileSync(path.join(ROOT, "site.yaml"), "utf8")) ?? {}

if (!fs.existsSync(SRC)) fail(`Obsidian vault not found: ${SRC}`)

// Every file in the vault, by lowercased basename, the way Obsidian's shortest links resolve.
const byName = new Map() // lowercased basename -> [absolute paths]
for (const file of walk(SRC)) {
  const key = path.basename(file).toLowerCase()
  byName.set(key, [...(byName.get(key) ?? []), file])
}

const homeFile = path.join(SRC, HOME)
const subjects = fs.existsSync(homeFile)
  ? [...new Set(linksIn(homeFile).map((l) => path.basename(l)))]
  : fs
      .readdirSync(DEST, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
if (subjects.length === 0) fail(`no subjects linked from ${homeFile}, nothing synced`)

const subjectKeys = new Set(subjects.map((s) => `${s.toLowerCase()}.md`))
const folderOf = (s) => {
  const dir = path.join(SRC, s)
  return fs.existsSync(dir) && fs.statSync(dir).isDirectory() ? dir : null
}
// Files inside a subject's own folder always belong to that subject.
const owner = new Map() // absolute path -> subject
for (const s of subjects) {
  const dir = folderOf(s)
  if (dir) for (const file of walk(dir)) owner.set(file, s)
}

const warnings = []
const indexOf = (s, dir) => {
  const own = dir && path.join(dir, `${s}.md`)
  return own && fs.existsSync(own) ? own : resolve(`${s}.md`, dir, `${s} (index)`)
}

// site.yaml `publish` lists. One naming a subject or heading that doesn't exist would publish
// too much or nothing, so stop before anything is copied (sync-notes.sh then commits nothing).
for (const [name, config] of Object.entries(siteConfig.subjects ?? {})) {
  if (publishList(config) && !subjects.some((s) => s.toLowerCase() === name.toLowerCase())) {
    fail(
      `site.yaml: "${name}" has a publish list, but ${HOME} links no such subject. Nothing synced.`,
    )
  }
}
const indexLinks = new Map() // subject -> links in the published parts of its index
const shown = new Set() // files listed in a published index section, any subject
const hidden = new Set() // files listed in an unpublished one
const indexes = new Set([homeFile])
for (const s of subjects) {
  const dir = folderOf(s)
  const index = indexOf(s, dir)
  if (!index) continue
  const config = subjectConfig(siteConfig, s)
  const publish = publishList(config)
  if (publish?.length === 0) {
    fail(
      `site.yaml: ${s} has an empty publish list. List the headings to publish, or delete the ` +
        "line to publish the whole subject. Nothing synced.",
    )
  }
  const sections = indexLines(fs.readFileSync(index, "utf8"), publish, config.headings)
  if (sections.unmatched.length) {
    const names = sections.unmatched.map((p) => `"${p}"`).join(", ")
    fail(`site.yaml: ${s} publishes ${names}, but its index has no such heading. Nothing synced.`)
  }
  indexes.add(index)
  const links = []
  sections.lines.forEach((line, i) => {
    for (const link of linksInText(line)) {
      const file = resolve(linkKey(link), dir, `[[${link}]] in ${path.basename(index)}`)
      if (file) (sections.published[i] ? shown : hidden).add(file)
      if (sections.published[i]) links.push(link)
    }
  })
  // Without a publish list the whole index is followed, frontmatter links included, as always.
  indexLinks.set(s, publish ? links : linksIn(index))
}
// Notes listed only in unpublished sections: held back site-wide. Subject indexes never are;
// attachments aren't either (a published note may embed the same image).
const held = new Set([...hidden].filter((f) => isNote(f) && !shown.has(f) && !indexes.has(f)))

const synced = []
for (const subject of subjects) {
  const dir = folderOf(subject)
  const publish = publishList(subjectConfig(siteConfig, subject))
  const index = indexOf(subject, dir)
  if (!index) {
    console.log(`${subject}: no ${subject}.md in the vault, skipped`)
    continue
  }

  // A subject folder is copied whole, unless a publish list asks for its sections only.
  const files = new Map() // path relative to vault/<Subject>/ -> absolute source path
  if (dir && !publish) {
    for (const file of walk(dir)) {
      if (!held.has(file)) files.set(path.relative(dir, file), file)
    }
  }
  if (![...files.values()].includes(index)) files.set(`${subject}.md`, index)

  // Follow links from the index (its published sections) and from every note reached,
  // collecting notes and attachments.
  const queue = [...files.values()].filter(isNote)
  const seen = new Set(files.values())
  while (queue.length) {
    const note = queue.shift()
    for (const link of note === index ? indexLinks.get(subject) : linksIn(note)) {
      const key = linkKey(link)
      if (key === HOME.toLowerCase()) continue
      if (subjectKeys.has(key) && key !== `${subject.toLowerCase()}.md`) continue // other index
      const file = resolve(key, dir, `[[${link}]] in ${path.basename(note)}`)
      if (!file || seen.has(file) || held.has(file)) continue
      seen.add(file)
      const taken = owner.get(file)
      if (taken && taken !== subject) continue // lives in another subject; the link still works
      if (taken === undefined) owner.set(file, subject)
      const rel = path.basename(file)
      if (files.has(rel)) {
        warnings.push(`${subject}: two files named "${rel}", kept the one in the subject folder`)
        continue
      }
      files.set(rel, file)
      if (isNote(file)) queue.push(file)
    }
  }

  const notes = [...files.keys()].filter(isNote).length
  if (notes === 1) {
    const what = publish ? "its published sections link to no notes" : "index links to no notes"
    console.log(`${subject}: ${what} yet, skipped`)
    continue
  }
  const changes = mirror(files, path.join(DEST, subject))
  synced.push(subject)
  console.log(
    `${subject}: ${notes} notes, ${files.size - notes} attachments` +
      (changes ? `, ${changes} files changed` : ", up to date") +
      (publish ? ` (only ${publish.join(", ")})` : ""),
  )
}

// Subject folders in the repo that are no longer synced.
for (const d of fs.readdirSync(DEST, { withFileTypes: true })) {
  if (d.isDirectory() && !d.name.startsWith(".") && !synced.includes(d.name)) {
    fs.rmSync(path.join(DEST, d.name), { recursive: true })
    console.log(`${d.name}: no longer in ${HOME} (or has no notes), removed from the site`)
  }
}

// The home note becomes the site's home page; without it the site lists the subjects itself.
if (fs.existsSync(homeFile)) fs.copyFileSync(homeFile, path.join(DEST, HOME))
else fs.rmSync(path.join(DEST, HOME), { force: true })

for (const w of new Set(warnings)) console.log(`  warning: ${w}`)

// Make dest match files exactly. Returns how many files were added, changed or removed.
function mirror(files, dest) {
  let changes = 0
  const wanted = new Set([...files.keys()].map((rel) => path.join(dest, rel)))
  if (fs.existsSync(dest)) {
    for (const file of walk(dest)) {
      if (!wanted.has(file)) {
        fs.rmSync(file)
        changes++
      }
    }
    removeEmptyDirs(dest)
  }
  for (const [rel, src] of files) {
    const out = path.join(dest, rel)
    const data = fs.readFileSync(src)
    if (fs.existsSync(out) && data.equals(fs.readFileSync(out))) continue
    fs.mkdirSync(path.dirname(out), { recursive: true })
    fs.writeFileSync(out, data)
    changes++
  }
  return changes
}

// Lowercased file name a link points to: "Note" -> "note.md", "img.png" -> "img.png",
// "pH 7.4 Buffering" -> "ph 7.4 buffering.md".
function linkKey(link) {
  const base = path.basename(link).toLowerCase()
  return base.endsWith(".md") || (path.extname(base) && byName.has(base)) ? base : `${base}.md`
}

// Wikilink, embed and markdown-link targets in a note, without aliases or #headings.
function linksIn(file) {
  return linksInText(fs.readFileSync(file, "utf8"))
}

function linksInText(text) {
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

// The vault file a link points to. With duplicates, prefer the subject's folder, then the root.
function resolve(key, dir, where) {
  const candidates = byName.get(key.toLowerCase()) ?? []
  if (candidates.length === 0) return null
  if (candidates.length === 1) return candidates[0]
  const inFolder = candidates.find((f) => dir && f.startsWith(dir + path.sep))
  if (inFolder) return inFolder
  const pick = candidates.find((f) => path.dirname(f) === SRC) ?? candidates[0]
  warnings.push(
    `${where}: several files named "${path.basename(pick)}", used ${path.relative(SRC, pick)}`,
  )
  return pick
}

function isNote(file) {
  return file.toLowerCase().endsWith(".md")
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_DIRS.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

function removeEmptyDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) removeEmptyDirs(path.join(dir, entry.name))
  }
  if (fs.readdirSync(dir).filter((n) => n !== ".DS_Store").length === 0)
    fs.rmSync(dir, { recursive: true })
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

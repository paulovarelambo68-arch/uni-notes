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
  return fixes[text] ?? text
}

// The site.yaml entry for a subject, matching its name without regard to case.
export function subjectConfig(siteConfig, subject) {
  const entries = Object.entries(siteConfig.subjects ?? {})
  return entries.find(([name]) => name.toLowerCase() === subject.toLowerCase())?.[1] ?? {}
}

// The subject's `publish` list, or null when the whole subject is published. A `publish:` key
// left empty (say, its only entry commented out) is an empty list, not "everything".
export function publishList(config) {
  if (!config || !Object.hasOwn(config, "publish")) return null
  return [config.publish ?? []]
    .flat()
    .map((p) => String(p ?? "").trim())
    .filter(Boolean)
}

// [text](dest), [text](<dest>) and [text](dest "title"): the destination, as written.
export const MARKDOWN_LINK =
  /\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

// The index's lines after its frontmatter, with one flag per line: is that line published? A
// heading is published when its text (as written or as fixed, ignoring case) is in `publish`,
// or a heading above it is; other lines follow the nearest heading above them, and lines before
// the first heading are published. Also returns the `publish` entries that match no heading.
export function indexLines(text, publish, fixes = {}) {
  const body = text.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n?/, "")
  const lines = body.split("\n")
  if (!publish) return { lines, published: lines.map(() => true), unmatched: [] }
  const wanted = new Set(publish.map((p) => p.toLowerCase()))
  const found = new Set()
  const stack = [] // enclosing headings: { level, published }
  const published = lines.map((line) => {
    const h = line.match(/^(#{1,6})\s+(.*?)\s*$/)
    if (!h) return stack.length === 0 || stack.at(-1).published
    while (stack.length && stack.at(-1).level >= h[1].length) stack.pop()
    const names = [stripBold(h[2]), headingText(h[2], fixes)].map((n) => n.toLowerCase())
    const match = names.find((n) => wanted.has(n))
    if (match) found.add(match)
    const on = Boolean(match) || stack.some((s) => s.published)
    stack.push({ level: h[1].length, published: on })
    return on
  })
  return { lines, published, unmatched: publish.filter((p) => !found.has(p.toLowerCase())) }
}

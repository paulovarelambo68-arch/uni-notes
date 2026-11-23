#!/usr/bin/env node
// Writes narration scripts (audio/<Subject>/<Note>.md) from vault notes with Claude, the way
// AGENTS.md asks: a writer, then separate fidelity and listenability reviewers, then a revision.
//   node scripts/write-narration.mjs "<Subject>/<Note>" [...] [--voice irish-female|irish-male]
// Then `npm run audio` makes the tracks. Several notes run in parallel.
// Needs CLAUDE_PROXY_API_KEY (and CLAUDE_PROXY_BASE_URL, default https://api.anthropic.com) in
// .env or the environment. Each step is cached in audio/.cache/scripts/ under the note's hash,
// so a failed run resumes where it stopped and an edited note starts over.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const MODEL = "claude-opus-5-5"
const EXAMPLE_SCRIPT = path.join(
  ROOT,
  "audio/Integrated Physiological Responses to Exercise",
  "Altitude – Less Oxygen, Acclimatisation, Performance and Altitude Training.md",
)

const args = process.argv.slice(2)
const voiceAt = args.indexOf("--voice")
const voice = voiceAt >= 0 ? args.splice(voiceAt, 2)[1] : "irish-female"
if (!args.length) fail('usage: node scripts/write-narration.mjs "<Subject>/<Note>" [--voice name]')

loadDotEnv()
const KEY = process.env.CLAUDE_PROXY_API_KEY
const BASE = (process.env.CLAUDE_PROXY_BASE_URL || "https://api.anthropic.com").replace(/\/$/, "")
if (!KEY) fail("CLAUDE_PROXY_API_KEY is not set (put it in .env)")
// The opening of an approved script, for format and tone (frontmatter dropped).
const EXAMPLE = fs
  .readFileSync(EXAMPLE_SCRIPT, "utf8")
  .replace(/^---\n[\s\S]*?\n---\n+/, "")
  .split("\n")
  .slice(0, 35)
  .join("\n")

const RULES = `Rules for a narration script (it is read aloud by a text-to-speech voice to a student revising):
- Cover every fact in the note, and add none. No outside knowledge, no extra examples, no embellished claims.
- Never read tables as tables, never describe images, and never mention figures, drawings, slides or tables ("as the drawing shows", "in the table"). A fact that appears only in a table or a figure caption is still a fact: say it in natural prose. Where the note's text walks through a figure (for example "In step 1, ..."), narrate the process it describes without referring to the picture.
- Spell out every symbol, unit, number and abbreviation the way it should be spoken: "twenty point nine per cent", "kilojoules". Write abbreviations that are spoken letter by letter with spaces between the letters, as earlier scripts do: "A T P", "A D P", "A M P", "F A D", "N A D plus", "N A D H", "F A D H two", "acetyl co A". Write "NAD+" as "N A D plus", "H2O" as "water", "CO2" as "carbon dioxide", chemical formulas in words, "~" as "about", "->" as words.
- No parentheses, slashes, dashes used as punctuation, semicolons, colons inside sentences, arrows, bullet points, bold, italics, highlights or any Markdown other than the "## " section titles. Hyphenated words are fine.
- British and Irish spelling.
- Vary the connectors that open or join sentences: no connector (So, Then, Next, Here, In turn, Meanwhile, This means, For example, In other words, ...) used more than twice in the whole script.
- Every sentence under 35 words. One sentence per line. Blank line only between sections.
- A sentence in the note that only points the reader to another note ("covered in [[...]]", "as X explains") is left out; any fact inside it is kept. Never read wikilink syntax.
- Section structure: the first section is an opening, titled with the note's title exactly, made from the note's opening quote or introduction. Then one "## " section per heading of the note, in order, whose title is EXACTLY the heading text as written (for "### 1. Energy and work" the title is "1. Energy and work"; for "### Summary" it is "Summary"). Never add, merge, rename or skip sections. Repeat nothing between sections except where the note itself repeats (the Summary restates points, so narrate its points as the note gives them, briefly).
- It should sound like a clear, warm tutor talking: natural spoken English, short framing sentences are welcome, but no padding and no new content.`

const results = await Promise.allSettled(args.map(write))
let failed = false
results.forEach((r, i) => {
  if (r.status === "rejected") {
    failed = true
    console.log(`${args[i]}: failed: ${r.reason?.message}`)
  }
})
process.exit(failed ? 1 : 0)

async function write(arg) {
  const [subject, ...rest] = arg.replace(/\.md$/, "").split("/")
  const title = rest.join("/")
  const noteFile = path.join(ROOT, "vault", subject, `${title}.md`)
  if (!title || !fs.existsSync(noteFile)) throw new Error(`no note at vault/${subject}/${title}.md`)
  const note = fs.readFileSync(noteFile, "utf8")
  const source = crypto.createHash("sha1").update(note).digest("hex").slice(0, 12)
  const cache = path.join(ROOT, "audio/.cache/scripts", subject, `${title} ${source}`)
  fs.mkdirSync(cache, { recursive: true })
  const step = async (name, make) => {
    const file = path.join(cache, `${name}.md`)
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim()
    const text = await make()
    fs.writeFileSync(file, text + "\n")
    return text
  }
  const label = (s) => `${title} / ${s}`
  const noteBlock = `<note title="${title}">\n${note}\n</note>`

  const draft = await step("draft", async () =>
    stripFences(
      await call(
        `You write narration scripts for audio versions of a student's physiology revision notes.\n\n${RULES}\n\nHere is the beginning of an approved script for another note, for format and tone:\n<example>\n${EXAMPLE}\n</example>\n\nOutput only the script, starting with "## ${title}". No frontmatter, no commentary, no code fences.`,
        `${noteBlock}\n\nWrite the narration script for this note.`,
        label("writer"),
      ),
    ),
  )
  const scriptBlock = `<script>\n${draft}\n</script>`
  const [fidelity, listen] = await Promise.all([
    step("fidelity", () =>
      call(
        `You are a meticulous fidelity reviewer of narration scripts made from physiology notes.\n\n${RULES}\n\nCompare the script with the note fact by fact. Report: every fact, number, example or qualifier of the note missing from the script (quote the note); every claim in the script that the note does not make, or states differently, overstates or simplifies wrongly (quote both); wrong spoken renderings of numbers, units or symbols; section titles that don't exactly match the note's headings. Be exhaustive and specific, give each issue a suggested fix, and say nothing about style. If there is nothing to fix in a category, say so.`,
        `${noteBlock}\n\n${scriptBlock}`,
        label("fidelity review"),
      ),
    ),
    step("listen", () =>
      call(
        `You are a listenability reviewer of narration scripts that a text-to-speech voice reads to students.\n\n${RULES}\n\nCheck the script against every rule above and for how it sounds aloud: count each connector's uses and flag any used more than twice; flag sentences of 35 words or more; forbidden punctuation or symbols; anything the voice would mispronounce or read oddly; references to tables, figures or pictures; sentences hard to follow by ear, ambiguous pronouns, monotonous rhythm, abrupt transitions. Quote each problem line and give a concrete rewrite that keeps its facts exactly. Do not suggest adding or removing facts.`,
        `${noteBlock}\n\n${scriptBlock}`,
        label("listenability review"),
      ),
    ),
  ])
  const final = await step("final", async () =>
    stripFences(
      await call(
        `You revise narration scripts for audio versions of a student's physiology notes.\n\n${RULES}\n\nApply every valid point of the two reviews; where a review is wrong about the note, follow the note. Keep everything that is already right. Output only the complete revised script, starting with "## ${title}". No frontmatter, no commentary, no code fences.`,
        `${noteBlock}\n\n${scriptBlock}\n\n<fidelity_review>\n${fidelity}\n</fidelity_review>\n\n<listenability_review>\n${listen}\n</listenability_review>`,
        label("revision"),
      ),
    ),
  )

  const body = final.replace(/\n*(## [^\n]+)\n+/g, "\n\n$1\n\n").trim()
  const out = path.join(ROOT, "audio", subject, `${title}.md`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, `---\nnote: ${title}\nvoice: ${voice}\nsource: ${source}\n---\n\n${body}\n`)
  console.log(`${label("written")}: ${path.relative(ROOT, out)}`)
  for (const problem of check(body, note, title)) console.log(`  check: ${problem}`)
}

// Mechanical checks of the rules a reader can miss: section titles, sentence length, symbols,
// figure mentions and connectors. Printed as warnings; read the lines they name.
function check(script, note, title) {
  const problems = []
  const headings = note
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .split("\n")
    .filter((l) => /^#{1,6}\s/.test(l))
    .map((l) => l.replace(/^#+\s*/, "").trim())
  const sections = script
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim())
  const want = [title, ...headings]
  if (sections.join("\n") !== want.join("\n"))
    problems.push(`sections ${JSON.stringify(sections)} differ from ${JSON.stringify(want)}`)
  const lines = script.split("\n").filter((l) => l.trim() && !l.startsWith("## "))
  const starts = new Map()
  for (const line of lines) {
    const words = line.split(/\s+/).length
    if (words >= 35) problems.push(`${words} words: ${line.slice(0, 80)}…`)
    if (/[()/;[\]*=_~<>|#→–—\d]| - /.test(line)) problems.push(`symbol: ${line.slice(0, 80)}…`)
    if (/\b(table|figure|drawing|diagram|slide|image|picture)\b/i.test(line))
      problems.push(`mentions a figure? ${line.slice(0, 80)}…`)
    const m = line.match(
      /^(For example|In other words|This means|In turn|In short|By contrast|As a result|Put simply|In fact|At the same time|So|Then|Next|Here|Meanwhile|Yet|But|Instead|Also|Still|Likewise|Similarly|Now|Thus|Hence|However|Overall)\b/,
    )
    if (m) starts.set(m[1], (starts.get(m[1]) ?? 0) + 1)
  }
  for (const [word, n] of starts) if (n > 2) problems.push(`"${word}" opens ${n} sentences`)
  return problems
}

async function call(system, user, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const t0 = Date.now()
    try {
      const res = await fetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": KEY,
          "anthropic-version": "2023-06-01",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 128000, // max effort can think for 100K tokens; less made requests fail
          thinking: { type: "adaptive" },
          output_config: { effort: "max" },
          stream: true,
          system,
          messages: [{ role: "user", content: user }],
        }),
      })
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 300)}`)
      let buf = ""
      let text = ""
      let stop = null
      const dec = new TextDecoder()
      for await (const chunk of res.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const data = buf
            .slice(0, i)
            .split("\n")
            .find((l) => l.startsWith("data:"))
          buf = buf.slice(i + 2)
          if (!data) continue
          let ev
          try {
            ev = JSON.parse(data.slice(5))
          } catch {
            continue
          }
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta")
            text += ev.delta.text
          if (ev.type === "message_delta") stop = ev.delta?.stop_reason
          if (ev.type === "error") throw new Error(JSON.stringify(ev.error))
        }
      }
      if (stop !== "end_turn" || !text.trim())
        throw new Error(`stopped (${stop}), ${text.length} chars`)
      console.log(`${label}: done in ${Math.round((Date.now() - t0) / 1000)} s`)
      return text.trim()
    } catch (e) {
      console.log(`${label}: attempt ${attempt} failed: ${e.message}`)
      if (attempt === 4) throw e
      await new Promise((r) => setTimeout(r, 20000 * attempt))
    }
  }
}

function stripFences(text) {
  return text
    .replace(/^```[a-z]*\n/, "")
    .replace(/\n```$/, "")
    .trim()
}

function loadDotEnv() {
  const file = path.join(ROOT, ".env")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2")
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

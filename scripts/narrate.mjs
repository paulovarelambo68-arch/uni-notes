#!/usr/bin/env node
// Turns narration scripts in audio/ into an audio track per note, with ElevenLabs.
//   npm run audio                    # every script whose audio is missing or out of date
//   npm run audio -- Neuron          # only that note (exact name; else names containing it)
//   npm run audio -- --force Neuron  # regenerate even if up to date
//   npm run audio -- --dry-run       # show what would be generated and the character cost
//   npm run audio -- --find-voices irish [female|male]   # search the ElevenLabs voice library
//
// A script is audio/<Subject>/<Note>.md: frontmatter (note, voice, source), then one "## Title"
// per section and one sentence per line. Sections become the player's section jumps and
// sentences its phrase jumps. Each section is one ElevenLabs request "with timestamps"; the
// MP3s are joined frame by frame into audio/<Subject>/<Note>.mp3 and the timings go to
// <Note>.json, which the build hands to the player. The key comes from ELEVENLABS_API_KEY,
// read from the environment or from .env (gitignored).
//
// Nothing is paid for twice: each section's response is cached in audio/.cache/ (gitignored)
// as soon as it arrives, so a failed run resumes where it stopped, and <Note>.json keeps the
// character timings, so renaming sections or re-splitting sentences needs no new audio.

import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import YAML from "yaml"

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..")
const AUDIO = path.join(ROOT, "audio")
const CACHE = path.join(AUDIO, ".cache")
const API = "https://api.elevenlabs.io"

const siteConfig = YAML.parse(fs.readFileSync(path.join(ROOT, "site.yaml"), "utf8")) ?? {}
const cfg = siteConfig.audio ?? {}
const MODEL = cfg.model ?? "eleven_multilingual_v2"
const SETTINGS = sortKeys(cfg.settings ?? {})
const FORMAT = "mp3_44100_128"
// Characters per request: eleven_v3 takes up to 5,000; eleven_v4 and eleven_multilingual_v2 10,000.
const MAX_CHARS = MODEL.startsWith("eleven_v3") ? 4900 : 9500
// The neighbouring sections' text keeps the intonation continuous; eleven_v3 rejects it.
const STITCH = !MODEL.startsWith("eleven_v3")
// ElevenLabs leaves almost no silence at the end of a request, so sections get a pause between them.
const PAUSE = cfg.sectionPause ?? 0.8

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((a) => a.startsWith("--")))
const terms = argv.filter((a) => !a.startsWith("--"))
// `npm run audio --dry-run` (without the "--") hands the flag to npm, not to this script.
if (process.env.npm_config_dry_run === "true") flags.add("--dry-run")
if (process.env.npm_config_force === "true") flags.add("--force")
const unknown = [...flags].filter((f) => !["--force", "--dry-run", "--find-voices"].includes(f))
if (unknown.length)
  fail(`unknown option ${unknown.join(", ")} (use --dry-run, --force or --find-voices)`)
const DRY = flags.has("--dry-run")

loadDotEnv()
const KEY = process.env.ELEVENLABS_API_KEY

if (flags.has("--find-voices")) {
  await findVoices(terms[0] ?? "irish", terms[1])
  process.exit(0)
}

const scripts = selectScripts(
  [...walk(AUDIO)].filter((f) => f.endsWith(".md")),
  terms,
)
if (!scripts.length)
  fail(`no narration scripts${terms.length ? ` matching ${terms.join(", ")}` : ""} in audio/`)

let spent = 0
for (const file of scripts) {
  const script = parseScript(file)
  const label = path.relative(AUDIO, file)
  const voice = cfg.voices?.[script.voice]
  if (!voice?.id)
    fail(`${label}: voice "${script.voice}" is not set up under audio.voices in site.yaml`)
  const long = script.sections.find((s) => s.text.length > MAX_CHARS)
  if (long) fail(`${label}: section "${long.title}" is over ${MAX_CHARS} characters; split it`)
  const out = file.replace(/\.md$/, "")
  // Only what ElevenLabs hears: section titles and sentence splits don't change the audio.
  const fingerprint = hash(
    JSON.stringify([script.sections.map((s) => s.text), voice.id, MODEL, SETTINGS, PAUSE]),
  )
  const existing = readJson(`${out}.json`)
  const chars = script.sections.reduce((n, s) => n + s.text.length, 0)
  const about = `${script.sections.length} sections, ${chars} characters, voice ${voice.name ?? script.voice}`

  if (
    !flags.has("--force") &&
    existing?.fingerprint === fingerprint &&
    existing.segments?.length === script.sections.length &&
    fs.existsSync(`${out}.mp3`)
  ) {
    // Same audio. Refresh titles, sentence timings and frontmatter from the stored timings.
    const timeline = buildTimeline(script, voice, fingerprint, existing.segments)
    const changed = JSON.stringify(timeline) !== JSON.stringify(existing)
    if (changed && !DRY) writeTimeline(`${out}.json`, timeline)
    console.log(
      `${label}: up to date${changed ? (DRY ? " (timings would be refreshed)" : " (timings refreshed)") : ""}`,
    )
    continue
  }
  const FORCE = flags.has("--force") // a fresh take: ignores cached sections too
  const cached = FORCE
    ? []
    : script.sections.filter((_, i) => fs.existsSync(cacheFile(script, i, voice)))
  const toPay = chars - cached.reduce((n, s) => n + s.text.length, 0)
  if (DRY) {
    console.log(
      `${label}: would generate ${about}; costs ${toPay} characters` +
        (cached.length ? ` (${cached.length} sections cached)` : ""),
    )
    continue
  }
  if (!KEY && toPay) fail("ELEVENLABS_API_KEY is not set (put it in .env)")

  console.log(`${label}: generating ${about}`)
  const parts = []
  for (const [i, section] of script.sections.entries()) {
    const cache = cacheFile(script, i, voice)
    let res = FORCE ? null : readJson(cache)
    const wasCached = Boolean(res)
    if (!res) {
      res = await speak(voice, { text: section.text, ...context(script, i) })
      if (!res.audio_base64 || !res.alignment?.characters)
        fail(`ElevenLabs returned no audio or timings for section "${section.title}"`)
      fs.mkdirSync(CACHE, { recursive: true })
      fs.writeFileSync(
        cache,
        JSON.stringify({ audio_base64: res.audio_base64, alignment: res.alignment }),
      )
      spent += section.text.length
    }
    const mp3 = mp3Frames(Buffer.from(res.audio_base64, "base64"))
    parts.push({ mp3, alignment: res.alignment })
    process.stdout.write(
      `  ${i + 1}/${script.sections.length} ${section.title} (${mp3.duration.toFixed(1)}s${wasCached ? ", cached" : ""})\n`,
    )
  }

  // Each section's audio, followed by a pause unless it's the last; durations include the pause.
  const audio = parts.map(({ mp3 }, i) => (i < parts.length - 1 ? joinSilence(mp3, PAUSE) : mp3))
  const segments = parts.map(({ alignment }, i) => ({
    duration: round(audio[i].duration, 6),
    alignment: compactAlignment(alignment),
  }))
  fs.writeFileSync(`${out}.mp3`, Buffer.concat(audio.map((a) => a.data)))
  const timeline = buildTimeline(script, voice, fingerprint, segments)
  writeTimeline(`${out}.json`, timeline)
  console.log(
    `  wrote ${path.relative(ROOT, out)}.mp3 (${formatTime(timeline.duration)}) and .json`,
  )
}
if (!DRY)
  console.log(spent ? `ElevenLabs characters used: ${spent}` : "No ElevenLabs characters used.")

// Section and sentence start times for the player, from each section's audio length and
// ElevenLabs' character timings. Section offsets add up the real MP3 durations.
function buildTimeline(script, voice, fingerprint, segments) {
  let offset = 0
  const sections = script.sections.map((section, i) => {
    const times = sentenceTimes(section, segments[i].alignment)
    const start = offset
    offset += segments[i].duration
    return {
      title: section.title,
      start: round(start),
      sentences: section.sentences.map((text, j) => ({
        text,
        start: round(start + (j === 0 ? 0 : times[j].start)),
        end: round(start + times[j].end),
      })),
    }
  })
  return {
    note: script.note,
    source: script.source,
    script: hash(script.raw),
    voice: voice.name ?? script.voice,
    model: MODEL,
    fingerprint,
    duration: round(offset),
    sections,
    segments,
  }
}

// Readable sections, but each segment's timing arrays on one line.
function writeTimeline(file, timeline) {
  const { segments, ...rest } = timeline
  const head = JSON.stringify(rest, null, 2).replace(/\n}$/, "")
  const body = segments.map((s) => "    " + JSON.stringify(s)).join(",\n")
  fs.writeFileSync(file, `${head},\n  "segments": [\n${body}\n  ]\n}\n`)
}

function context(script, i) {
  if (!STITCH) return {}
  const s = script.sections
  return { previous_text: s[i - 1]?.text.slice(-400), next_text: s[i + 1]?.text.slice(0, 400) }
}

function cacheFile(script, i, voice) {
  const { previous_text, next_text } = context(script, i)
  const key = hash(
    JSON.stringify([
      script.sections[i].text,
      previous_text,
      next_text,
      voice.id,
      MODEL,
      SETTINGS,
      FORMAT,
    ]),
  )
  return path.join(CACHE, `${key}.json`)
}

// An exact note name picks just that script; otherwise names containing the term.
function selectScripts(files, terms) {
  if (!terms.length) return files
  return terms
    .flatMap((term) => {
      const t = term.toLowerCase()
      const exact = files.filter((f) => path.basename(f, ".md").toLowerCase() === t)
      return exact.length
        ? exact
        : files.filter((f) => path.basename(f, ".md").toLowerCase().includes(t))
    })
    .filter((f, i, all) => all.indexOf(f) === i)
}

// --- narration scripts ---

function parseScript(file) {
  const raw = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/)
  const meta = m ? (YAML.parse(m[1]) ?? {}) : {}
  const body = m ? raw.slice(m[0].length) : raw
  const sections = []
  for (const line of body.split("\n")) {
    const heading = line.match(/^##\s+(.*?)\s*$/)
    if (heading) sections.push({ title: heading[1], sentences: [] })
    else if (line.trim()) {
      if (!sections.length) fail(`${file}: text before the first "## Section" heading`)
      sections.at(-1).sentences.push(line.trim())
    }
  }
  const empty = sections.find((s) => !s.sentences.length)
  if (empty) fail(`${file}: section "${empty.title}" has no sentences`)
  for (const s of sections) s.text = s.sentences.join(" ")
  return {
    note: meta.note ?? path.basename(file, ".md"),
    voice: meta.voice,
    source: meta.source ?? null,
    raw,
    sections,
  }
}

// Start and end time of each sentence within its section, from ElevenLabs' character timings.
function sentenceTimes(section, stored) {
  const alignment = expandAlignment(stored)
  const chars = alignment.characters
  const said = chars.join("")
  // Offset of each alignment entry in the joined string (entries are usually one character).
  const at = []
  let pos = 0
  for (const c of chars) {
    at.push(pos)
    pos += c.length
  }
  const entryAt = (offset) => {
    let lo = 0
    let hi = at.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (at[mid] <= offset) lo = mid
      else hi = mid - 1
    }
    return lo
  }
  let cursor = 0
  return section.sentences.map((sentence) => {
    let found = said.indexOf(sentence, cursor)
    if (found < 0) found = said.indexOf(sentence.slice(0, 20), cursor)
    if (found < 0) found = cursor // timings drifted; keep going in order
    const first = entryAt(found)
    const last = entryAt(Math.min(said.length - 1, found + sentence.length - 1))
    cursor = found + sentence.length
    return {
      start: alignment.character_start_times_seconds[first],
      end: alignment.character_end_times_seconds[last],
    }
  })
}

// --- ElevenLabs ---

async function speak(voice, { text, previous_text, next_text }) {
  const body = {
    text,
    model_id: MODEL,
    voice_settings: SETTINGS,
    previous_text: previous_text || undefined,
    next_text: next_text || undefined,
  }
  for (let attempt = 1; ; attempt++) {
    let res
    try {
      res = await fetch(
        `${API}/v1/text-to-speech/${voice.id}/with-timestamps?output_format=${FORMAT}`,
        {
          method: "POST",
          headers: { "xi-api-key": KEY, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(180_000),
        },
      )
      if (res.ok) return await res.json()
    } catch (err) {
      // Network failure or timeout: retry like a server error.
      if (attempt < 5) {
        console.log(`  network error (${err.cause?.code ?? err.name}), retrying`)
        await new Promise((r) => setTimeout(r, 3000 * attempt))
        continue
      }
      fail(`ElevenLabs unreachable: ${err.message}. Run again; finished sections are cached.`)
    }
    const detail = await res.json().catch(() => ({}))
    const message = detail?.detail?.message ?? detail?.detail ?? res.statusText
    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 3000 * attempt
      await new Promise((r) => setTimeout(r, wait))
      continue
    }
    const status = detail?.detail?.status ?? detail?.detail?.code
    if (["missing_permissions", "insufficient_permissions"].includes(status)) {
      fail(
        `ElevenLabs: ${message}\nEnable "Text to Speech" for this key at elevenlabs.io → Developers → API Keys.`,
      )
    }
    if (status === "voice_not_found" && voice.owner && !voice.added) {
      await addLibraryVoice(voice)
      voice.added = true
      continue
    }
    fail(
      `ElevenLabs ${res.status}: ${typeof message === "string" ? message : JSON.stringify(message)}` +
        "\nSections finished before this one are cached; running again won't pay for them twice.",
    )
  }
}

// Voice-library voices have to be added to the account ("My Voices") before the API can use them.
async function addLibraryVoice(voice) {
  console.log(`  adding library voice ${voice.name ?? voice.id} to My Voices`)
  const res = await fetch(`${API}/v1/voices/add/${voice.owner}/${voice.id}`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "content-type": "application/json" },
    body: JSON.stringify({ new_name: voice.name ?? voice.id }),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    fail(`ElevenLabs could not add voice ${voice.id}: ${detail?.detail?.message ?? res.statusText}`)
  }
}

async function findVoices(accent, gender) {
  if (!KEY) fail("ELEVENLABS_API_KEY is not set (put it in .env)")
  const params = new URLSearchParams({
    accent,
    language: "en",
    page_size: "100",
    sort: "usage_character_count_1y",
  })
  if (gender) params.set("gender", gender)
  const res = await fetch(`${API}/v1/shared-voices?${params}`, { headers: { "xi-api-key": KEY } })
  const data = await res.json()
  if (!res.ok) fail(`ElevenLabs ${res.status}: ${data?.detail?.message ?? res.statusText}`)
  for (const v of data.voices ?? []) {
    console.log(
      [
        v.name,
        `id ${v.voice_id}`,
        `owner ${v.public_owner_id}`,
        v.gender,
        v.age,
        v.accent,
        v.use_case,
        v.descriptive,
      ]
        .filter(Boolean)
        .join(" | ") +
        `\n    ${(v.description ?? "").replace(/\s+/g, " ").slice(0, 160)}\n    preview ${v.preview_url}`,
    )
  }
}

// --- MP3 ---

// Splits an MP3 into frames, dropping ID3 tags and the Xing/Info header frame, so several files
// can be concatenated into one stream whose length the browser computes from the bitrate.
function mp3Frames(buf) {
  const frameLength = (h) => {
    const version = (h[1] >> 3) & 3
    const mpeg1 = version === 3
    const rate = RATES[(h[2] >> 2) & 3] / (mpeg1 ? 1 : version === 2 ? 2 : 4)
    const bitrate = BITRATES[mpeg1 ? 1 : 2][h[2] >> 4] * 1000
    return Math.floor(((mpeg1 ? 144 : 72) * bitrate) / rate) + ((h[2] >> 1) & 1)
  }
  const BITRATES = {
    1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  }
  const RATES = [44100, 48000, 32000]
  let i = 0
  if (buf.toString("latin1", 0, 3) === "ID3") {
    const size =
      ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f)
    i = 10 + size + (buf[5] & 0x10 ? 10 : 0)
  }
  const frames = []
  let samples = 0
  let sampleRate = 44100
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) {
      i++
      continue
    }
    const version = (buf[i + 1] >> 3) & 3 // 3: MPEG-1, 2: MPEG-2, 0: MPEG-2.5
    const layer = (buf[i + 1] >> 1) & 3 // 1: Layer III
    const bitrateIndex = buf[i + 2] >> 4
    const rateIndex = (buf[i + 2] >> 2) & 3
    if (
      version === 1 ||
      layer !== 1 ||
      bitrateIndex === 0 ||
      bitrateIndex === 15 ||
      rateIndex === 3
    ) {
      i++
      continue
    }
    const mpeg1 = version === 3
    sampleRate = RATES[rateIndex] / (mpeg1 ? 1 : version === 2 ? 2 : 4)
    const length = frameLength(buf.subarray(i, i + 4))
    if (i + length > buf.length) break
    const frame = buf.subarray(i, i + length)
    const tag = frame.toString("latin1", 0, Math.min(64, length))
    if (!(frames.length === 0 && /Xing|Info|VBRI/.test(tag))) {
      frames.push(frame)
      samples += mpeg1 ? 1152 : 576
    }
    i += length
  }
  if (!frames.length) fail("ElevenLabs returned audio that is not MP3")
  return { data: Buffer.concat(frames), duration: samples / sampleRate, sampleRate, frameLength }
}

// Appends silent frames shaped like the stream's own: same header, no padding, all-zero side
// information and main data, which every MP3 decoder plays as silence.
function joinSilence(mp3, seconds) {
  const header = Buffer.from(mp3.data.subarray(0, 4))
  header[2] &= ~0x02
  const mpeg1 = ((header[1] >> 3) & 3) === 3
  const samples = mpeg1 ? 1152 : 576
  const length = mp3.frameLength(header)
  const frame = Buffer.alloc(length)
  header.copy(frame)
  const count = Math.round((seconds * mp3.sampleRate) / samples)
  return {
    data: Buffer.concat([mp3.data, ...Array(count).fill(frame)]),
    duration: mp3.duration + (count * samples) / mp3.sampleRate,
  }
}

// --- helpers ---

function loadDotEnv() {
  const file = path.join(ROOT, ".env")
  if (!fs.existsSync(file)) return
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (m && process.env[m[1]] === undefined)
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, "$2")
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    return null
  }
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}

function hash(text) {
  return crypto.createHash("sha1").update(text).digest("hex").slice(0, 12)
}

function round(seconds, places = 3) {
  const f = 10 ** places
  return Math.round(seconds * f) / f
}

// Character timings in milliseconds, with the characters as one string when each entry is a
// single character (always, for plain text), to keep <Note>.json small.
function compactAlignment(a) {
  const single = a.characters.every((c) => [...c].length === 1)
  return {
    characters: single ? a.characters.join("") : a.characters,
    starts: a.character_start_times_seconds.map((t) => Math.round(t * 1000)),
    ends: a.character_end_times_seconds.map((t) => Math.round(t * 1000)),
  }
}

// Back to the API's shape; accepts both a response's alignment and the compact form.
function expandAlignment(a) {
  if (!a.starts) return a
  return {
    characters: typeof a.characters === "string" ? [...a.characters] : a.characters,
    character_start_times_seconds: a.starts.map((t) => t / 1000),
    character_end_times_seconds: a.ends.map((t) => t / 1000),
  }
}

function sortKeys(obj) {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
}

function formatTime(seconds) {
  return `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

# Agent notes

Static site of Obsidian uni notes built with Quartz v5, deployed to GitHub Pages. Read
`README.md` first for the user-facing picture; this file covers what isn't obvious from it.

## Pipeline

```
~/Documents/Obsidian Vault     the author writes here; subjects listed in Subjects.md
  │  sync-notes.sh → scripts/sync-vault.mjs (commits and pushes vault/ and site.yaml)
  ▼
vault/<Subject>/*.md, images   repo copy of the notes, flat, source of truth for the build
  │  scripts/build-content.mjs (+ site.yaml)
  ▼
content/<Subject>/<Section>/<Subsection>/<Note>.md   generated, never commit
content/<Subject>/Concepts/…   notes not linked from the index
content/<Subject>/attachments/…
.generated/explorer-order.json   sidebar ranks, read by quartz.ts
  │  npx quartz build
  ▼
public/   the static site
```

Commands: `npm run content`, `npm run site`, `npm run serve` (port 8080).

## Rules

- **Don't edit files in `vault/`** unless the author asks for a content change. It's their
  notes and they write it in Obsidian. Presentation fixes belong in `build-content.mjs` or
  `site.yaml`, so they also apply to notes written later.
- Prefer build-time transforms over asking the author to change how they write. Suggestions
  are fine; required new habits are not.
- Keep upstream Quartz files (`quartz/`, `docs/`, upstream `.github/workflows/*`) unchanged
  where possible, so `npx quartz upgrade` merges cleanly. Changed so far: `quartz.ts`,
  `quartz/styles/custom.scss`, `package.json`, `README.md`, `.gitignore` (`.env`), and
  `.github/dependabot.yml` was deleted.
- **Never commit or print the ElevenLabs key.** It lives in `.env` (gitignored); the repo is
  public.

## Non-obvious details

- **The Obsidian vault is mixed.** Neurophysiology is a folder; other subjects are an index
  note with their notes loose at the vault root, and some Neurophysiology notes live at the root
  too. `sync-vault.mjs` therefore copies a subject's folder (if any) and then follows links from
  its index, note by note, resolving by basename anywhere in the vault (skipping dot-folders and
  `__auto_backup__`). A file inside one subject's folder, or first reached from an earlier
  subject in `Subjects.md`, belongs to that subject only, so basenames stay unique. Subjects
  whose index links to nothing are skipped, and the home page shows them as plain text.
- **Subject order** in the sidebar follows the link order in `Subjects.md`.
- **Publishing part of a subject.** `publish: [Heading, …]` under a subject in `site.yaml`
  limits it to those index headings. Levels follow the sidebar, not Markdown: a `#` heading
  includes the subsections under it, but `##`…`######` are sibling subfolders (that is how
  `build-content.mjs` places notes), so `## A` does not include a following `### B`.
  `scripts/index-sections.mjs` decides
  which index lines that covers, matching a heading as written or after the `headings` fixes,
  without bold, ignoring case; `sync-vault.mjs` and `build-content.mjs` both use it.
  The index is read without its frontmatter. An empty `publish:` (key present, no entries) is an
  empty list, not "everything".
  - **Sync:** follows links from the published lines only (a subject folder is then followed
    link by link too, not copied whole). A note file listed only under unpublished headings, in
    any subject's index, is held back site-wide (by path) and never followed; subject indexes
    and attachments never are. An empty `publish`, one naming no heading, or a site.yaml subject
    with `publish` that Subjects.md doesn't link makes the sync fail before copying, so
    `sync-notes.sh` commits nothing. `sync-notes.sh` commits `site.yaml` with `vault/`, since CI
    builds with the committed `publish` lists. A subject left with no notes besides its index
    is skipped.
  - **Build:** applies the same rule to `vault/` (for notes written straight into it; held back
    by name, per subject), places and shows only published index lines, gives a subject with no
    notes no page (links to it become text), and exits non-zero on an empty or unmatched
    `publish` before writing anything, so CI keeps the last deployed site.
  - Links to notes that aren't on the site become plain text: wikilinks and markdown links to
    `.md` files (`[t](Note.md)`, `[t](<Note.md>)`, `[t](Note.md "title")`), but not inside code
    (inline, fenced, indented or quoted fences). Links to notes and attachments of other
    subjects are kept (`siteNotes` reads aliases like Quartz: `aliases` or `alias`, a list or
    comma-separated).

- **`content/` can't be in `.gitignore`.** Quartz globs with `gitignore: true` and would find
  zero files. `build-content.mjs` adds `/content/` and `/.generated/` to `.git/info/exclude`
  on each run instead. If `git status` ever shows `content/`, that step didn't run.
- **Sidebar order.** The explorer's `sortFn` runs in the browser and is serialised with
  `.toString()`, so it can't close over variables. `quartz.ts` builds it with `new Function`
  and inlines the ranks from `.generated/explorer-order.json`. Ranks are keyed by display
  name (page title or folder name).
- **Explorer titles are shortened.** `mapFn` in `quartz.ts` drops a " – subtitle" (spaced
  hyphen, en or em dash) from note names in the sidebar only. The plugin ignores its `order`
  option and always runs filter, map, sort, so `sortFn` looks ranks up by `node.data.title`
  (the full title), falling back to `displayName` for folders.
- **Highlights with markup inside.** The OFM plugin keeps `==…==` content as raw text, so
  `==**bold**==`, links or math inside showed their syntax. `expandHighlights()` turns such
  highlights into `<span class="text-highlight">…</span>` (inline HTML, so the content is
  still parsed); plain ones are left to Quartz.
- Heading anchor links (the chain icon on hover) are hidden in `custom.scss`.
- **Plugin option overrides** (`componentRegistry.setOptionOverrides`) are keyed by the
  plugin's full source string from `quartz.config.yaml`, e.g. `"@quartz-community/explorer"`,
  not `"explorer"`.
- **Link rewriting.** Notes are placed into folders and some are renamed, so the build rewrites
  every `[[wikilink]]` to the output name, keeping the written text as the alias. In tables,
  Obsidian escapes the alias pipe as `\|`, and the rewrite keeps that. Links resolve with
  Quartz's `shortest` strategy, so basenames must stay unique within the site.
- **Dates.** `content/` is generated, so Quartz can't get dates from git. The build writes a
  `modified` frontmatter field from the last commit touching each vault file (CI checks out
  with `fetch-depth: 0` for this).
- **Callout heuristics** in `addCallouts()`: the note's first block being a quote → Definition;
  a quote right after a heading containing "summary" → Summary; a quote starting with a bold
  `Label:` → tip titled Label. Existing `> [!…]` callouts are left alone.
- **Base URL.** The deploy workflow rewrites `baseUrl` and the footer "Source" link from the
  repo owner and name at build time. The values committed in `quartz.config.yaml` are
  placeholders for local builds.
- `hard-line-breaks` is on, matching Obsidian's default: a single newline is a line break.
- Mobile fix in `custom.scss`: the closed explorer drawer leaked open folder titles, because
  `.folder-outer.open` sets `visibility: visible` inside a `visibility: hidden` parent.

## Local plugins (`plugins/`)

Three component plugins live in the repo, registered in `quartz.config.yaml`
(`narration-player` is described under Audio narration below):

- **`back-button`**: floating arrow on concept pages (`/concepts/`) that returns to the note
  at its previous scroll position. Renders a fixed `<button class="concept-back">` on every
  page; the inline script shows it only on concept pages (toggling `html.bb-visible`) and
  restores scroll. Styles in `custom.scss`.
- **`focus-fullscreen`**: script-only (component returns `null`). Listens for
  `readermodechange` and toggles the browser Fullscreen API, so focus mode also hides the
  browser chrome. Syncs back: a `fullscreenchange` exit (e.g. Esc) while `reader-mode="on"`
  clicks `.readermode` to turn focus mode off.

Pattern for another script-only plugin: `package.json` with a `quartz` block
(`category: "component"`), `index.js` re-exporting from `components/index.js`, a component
whose `afterDOMLoaded` string is the inline script, then a `- source: "./plugins/<name>"`
entry in `quartz.config.yaml`.

## Audio narration

```
audio/<Subject>/<Note>.md      narration script (committed): frontmatter note, voice, source;
                               "## Section" per part, one sentence per line
  │  npm run audio (scripts/narrate.mjs → ElevenLabs, one request per section)
  ▼
audio/<Subject>/<Note>.mp3     joined track (committed)
audio/<Subject>/<Note>.json    sentence and section start times (committed)
  │  build-content.mjs addNarration()
  ▼
content/<Subject>/audio/<Note>.mp3 + a `narration` frontmatter field → narration-player plugin
```

- **Writing a script.** Ask nothing of the author; write it from the vault note. Rules: cover
  every fact, add none, never read tables, images or figure references ("as in cells B and C"),
  spell out symbols, units and abbreviations, no parentheses/slashes/dashes/semicolons/arrows,
  British/Irish spelling, varied connectors (no connector more than twice), sentences under 35
  words. Section titles must equal the note's heading text, callout title or list-item bold
  label (without the colon) so the player can highlight and offer "listen from here"; the
  first section is the opening and is never matched. `source` is the first 12 hex characters
  of the SHA-1 of the vault note (`shasum -a 1`), which lets the build flag stale scripts.
  Alternate `voice` between notes. The first two scripts were written by one agent and then
  checked by separate fidelity and listenability reviewers; do the same for new ones.
- **Regeneration is cached.** `<Note>.json` stores a fingerprint of the sentences, voice id,
  model and settings; `npm run audio` skips scripts whose fingerprint matches, so editing
  frontmatter alone costs nothing. `--force` regenerates.
- **MP3 joining.** No ffmpeg: `mp3Frames()` drops ID3 and the Xing/Info frame of each section
  and concatenates frames, so browsers compute duration from the constant bitrate. Section
  offsets are frame counts × 1152 / sample rate, so timings stay exact. ElevenLabs ends each
  request almost without silence, so `joinSilence()` adds `audio.sectionPause` seconds of
  all-zero frames between sections (verified silent by decoding with `afconvert`).
- **Stray syllables at section ends.** With `next_text`, eleven_v4 sometimes ends a section by
  starting on the next one: after the last word and a 200–450 ms pause, 40–140 ms of (mostly
  voiced) sound, cut off by the end of the request. Found in 33 of 301 non-final sections on
  2026-10-27 and never in final sections, which get no `next_text`. The character timings don't
  show it (they stretch the last letters over the pause and run late), so `trimTail()` decodes
  each non-final section with `afconvert` or `ffmpeg`, looks at 10 ms RMS windows over its last
  1.2 s, and cuts whole frames in the middle of the pause when a burst of at most 200 ms follows
  at least 120 ms of quiet and the last word is timed to start at least 0.1 s before the burst
  (so a real short last word is never cut). It cut 38 sections; every cut section still ends in
  at least 160 ms of silence. One faint unvoiced breath (-43 dBFS) remains in Membrane Potential.
  `TAIL.version` is in the fingerprint, so changing the rule rebuilds tracks from the cache.
- **Loudness.** A voice's `gain` in `site.yaml` is applied by `applyGain()` before joining, the way
  mp3gain works: it adds `gain / 1.5` to the 8-bit `global_gain` of every Layer III granule that
  has coded audio, which scales the decoded sound by exactly 1.5 dB per step (verified: decoded
  output equals the original × the gain to within 1 LSB, same sample count). It enters the
  fingerprint only when non-zero, so changing it rebuilds tracks from `audio/.cache` for free.
  Values were picked by measuring active-speech RMS and peaks after decoding: v4 Patrick was
  5.7 dB quieter than Jessica with peaks near -2 dBFS, hence +1.5 / -4.5 (both about -22 dBFS
  speech, Patrick's peak -0.4 dBFS). Re-measure before raising a voice: it must not clip.
- **Credit.** ElevenLabs' free plan requires attribution; `audio.credit` in `site.yaml` is shown
  under the player. Remove it only on a paid plan.
- **Model.** `eleven_v4` for every track since 2026-10-27 (chosen by ear over `eleven_v3` on the
  Cytokines note; v4 reads about 7% faster and about 4 dB quieter). It takes `previous_text`/
  `next_text`, timestamps and the voice settings, and up to 10,000 characters per request.
  `eleven_v3` rejects `previous_text`/`next_text` and takes 5,000, so `narrate.mjs` special-cases
  it (`STITCH`, `MAX_CHARS`).
- **The key's permissions.** Text to Speech is required, and is enough to use any voice-library
  voice by its id (checked 2026-10-27). Voices: Read is needed for `--find-voices`; Voices: Write
  only if ElevenLabs ever answers `voice_not_found` for a library voice (`owner` set in
  `site.yaml` makes `narrate.mjs` add it then). Without Voices: Read, library voice ids can be
  read from the public page elevenlabs.io/text-to-speech/irish-accent (voice ids are in the
  preview URLs).
- **Player contract.** One `.narration` per page; `narration.inline.js` sets up on `nav` and
  tears down via `window.addCleanup` with an `AbortController`, because micromorph reuses the
  player's DOM between two narrated notes. Speed (0.5–3.0, steps of 0.1) is stored in
  `localStorage["narration:speed"]`, the position per page in `narration:<pathname>`. The `×`
  badge (`.nar-close`) shows only while docked; it pauses and sets `closed`, which keeps the
  player undocked until `play()` runs again.

## Reader-mode ("focus mode") contract

The sidebar button comes from `@quartz-community/reader-mode` (npm), restyled in
`custom.scss` (sidebar-toggle glyph; pinned top-left while active; hidden on concept pages).
Clicking it toggles `reader-mode="on|off"` on `<html>` and synchronously dispatches
`readermodechange` (`CustomEvent`, `detail.mode`) on `document` from inside the click
handler, so listeners still count as a user gesture. State persists across SPA navigation
(module-level flag, re-applied on `nav`/`render`). React to focus mode by listening for
`readermodechange`, never by re-binding the button.

## Checking a change

1. `npm run content`: read the per-subject summary and warnings (dropped embeds, missing
   index).
2. `npm run site`: it must finish without errors.
3. For visual changes, `npm run serve` and look at a topic page, a Concepts page, the subject
   index, and a phone-width viewport. Hover a link to check popovers.

## Planned

Practice tests the reader can take in the browser, also written as Markdown. One sketch:
frontmatter `type: test`, one `##` heading per question, `- [x]`/`- [ ]` options,
`answer:`/`tolerance:` lines for numeric questions, `> ` for explanations. It would be a
custom Quartz transformer plus a client-side component, with scores kept in `localStorage`.
Nothing is built yet.

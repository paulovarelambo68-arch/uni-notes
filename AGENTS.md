# Agent notes

Static site of Obsidian uni notes built with Quartz v5, deployed to GitHub Pages. Read
`README.md` first for the user-facing picture; this file covers what isn't obvious from it.

## Pipeline

```
~/Documents/Obsidian Vault     the author writes here; subjects listed in Subjects.md
  │  sync-notes.sh → scripts/sync-vault.mjs (commits and pushes vault/ only)
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

- **`content/` can't be in `.gitignore`.** Quartz globs with `gitignore: true` and would find
  zero files. `build-content.mjs` adds `/content/` and `/.generated/` to `.git/info/exclude`
  on each run instead. If `git status` ever shows `content/`, that step didn't run.
- **Sidebar order.** The explorer's `sortFn` runs in the browser and is serialised with
  `.toString()`, so it can't close over variables. `quartz.ts` builds it with `new Function`
  and inlines the ranks from `.generated/explorer-order.json`. Ranks are keyed by display
  name (page title or folder name).
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
- **Credit.** ElevenLabs' free plan requires attribution; `audio.credit` in `site.yaml` is shown
  under the player. Remove it only on a paid plan.
- **The key's permissions.** Text to Speech is required; Voices: Read for `--find-voices`;
  Voices: Write only if a voice-library voice has to be added to the account (`owner` set in
  `site.yaml`, added automatically on `voice_not_found`).
- **Player contract.** One `.narration` per page; `narration.inline.js` sets up on `nav` and
  tears down via `window.addCleanup` with an `AbortController`, because micromorph reuses the
  player's DOM between two narrated notes. Speed (0.5–3.0, steps of 0.1) is stored in
  `localStorage["narration:speed"]`, the position per page in `narration:<pathname>`.

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

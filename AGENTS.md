# Agent notes

Static site of Obsidian uni notes built with Quartz v5, deployed to GitHub Pages. Read
`README.md` first for the user-facing picture; this file covers what isn't obvious from it.

## Pipeline

```
vault/<Subject>/*.md, images   author's Obsidian folder, flat, source of truth
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
  `quartz/styles/custom.scss`, `package.json`, `README.md`, and `.github/dependabot.yml` was
  deleted.

## Non-obvious details

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

Two component plugins live in the repo, registered in `quartz.config.yaml`:

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

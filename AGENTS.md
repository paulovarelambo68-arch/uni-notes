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

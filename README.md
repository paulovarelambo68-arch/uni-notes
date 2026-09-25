# Study Notes

Uni notes written in Obsidian, published as a static site with [Quartz](https://quartz.jzhao.xyz).

## How it works

```
vault/<Subject>/        the Obsidian folder exactly as written; the build never modifies it
site.yaml               build-time tweaks: nicer page titles, heading typo fixes
scripts/build-content.mjs  vault/ → content/ (generated, not committed)
```

The notes keep their usual Obsidian layout: one flat folder. The site structure comes from the
**index note**, the note named after the folder (`vault/Neurophysiology/Neurophysiology.md`):

| In the index note | On the site                     |
| ----------------- | ------------------------------- |
| `# Section`       | sidebar folder                  |
| `### Subsection`  | subfolder                       |
| `- [[Note]]`      | the note, in that order         |
| not listed        | goes to the **Concepts** folder |
| images            | work as they do in Obsidian     |

So adding a topic means writing the note and linking it from the index. A term note linked
from inside the text (`[[refractory]]`) just shows up under Concepts and in hover previews.

The build also tidies presentation without changing the notes:

- an opening `>` quote becomes a **Definition** box, a `>` quote under `### Summary` becomes a
  summary box, and a quote starting with a bold label (`>**Memory hook:**`) becomes a tip box
- headings start at h2 and drop redundant `**bold**`
- `![[PASTE IMAGE: …]]` placeholders are hidden until the image exists
- the notes renamed in `site.yaml` get a better page title, and the sentences linking to them
  keep their original wording

## Updating the notes

With a zip of the Obsidian folder (e.g. sent over Taildrop):

```sh
npm run import -- ~/Downloads/Neurophysiology.zip   # syncs vault/Neurophysiology, deletions included
git add vault && git commit -m "Update notes" && git push
```

Or on GitHub: open `vault/Neurophysiology/` → **Add file → Upload files**, drop the changed
`.md` files and images, commit.

Each push to `main` builds the site in GitHub Actions to check that nothing broke.

## Adding a subject

Add a folder `vault/<Subject>/` with an index note `<Subject>.md`, laid out like the
Neurophysiology one. It appears on the home page and in the sidebar automatically.

## Local preview

```sh
npm ci
npm run serve        # http://localhost:8080
```

## Publishing

Not live yet. To publish on GitHub Pages:

1. Settings → Pages → Source: **GitHub Actions**
2. Run the **Build site** workflow manually (Actions tab → Build site → Run workflow). To
   publish on every push instead, delete the `if:` line on the deploy job in
   `.github/workflows/site.yaml`.

The site URL is set by `baseUrl` in `quartz.config.yaml` (`mateo19182.github.io/uni-notes`).

## Upgrading Quartz

This repo is built on the upstream Quartz history, so `npx quartz upgrade` works. The Quartz files
changed here are `quartz.ts` (sidebar order), `quartz/styles/custom.scss`, `package.json` and
`quartz.config.yaml`.

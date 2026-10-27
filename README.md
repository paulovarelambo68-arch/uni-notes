# Study Notes

Obsidian uni notes published as a static website with [Quartz](https://quartz.jzhao.xyz),
hosted for free on GitHub Pages.

You keep writing in Obsidian as usual. The notes live in `vault/`, and every push to `main`
rebuilds the website from them.

- [First-time setup](#first-time-setup)
- [Updating the notes](#updating-the-notes)
- [How notes become the site](#how-notes-become-the-site)
- [Adding a subject](#adding-a-subject)
- [Audio narration](#audio-narration)
- [Working on the site](#working-on-the-site)

## First-time setup

### 1. Get the repo onto your account

The repo was set up on Mateo's account. For the site to live at
`<your-username>.github.io/uni-notes`, the repo needs to belong to you:

- **Mateo:** Settings → General → Danger Zone → **Transfer ownership** → your username.
- **You:** accept the transfer from the email GitHub sends.

(Already a collaborator and just want to try it? Anything below works the same way on Mateo's
account, but the site URL would be his.)

### 2. Make it public

Free GitHub accounts only get Pages for **public** repos: Settings → General → Danger Zone →
**Change visibility** → Public. Anyone with the link can then read the notes and the repo.

### 3. Turn on GitHub Pages

Settings → **Pages** → Build and deployment → Source: **GitHub Actions**.

### 4. Publish

Publishing is switched off until you are happy with it. Pushes only check that the site
still builds.

- **Publish once:** Actions tab → **Build site** → **Run workflow**.
- **Publish on every push:** in `.github/workflows/site.yaml`, delete the line
  `if: github.event_name == 'workflow_dispatch'` on the `deploy` job and push.

After a minute or two the site is at **`https://<your-username>.github.io/uni-notes`**. The link
also appears under Settings → Pages. The workflow sets the URL from whoever owns the repo, so
nothing needs editing after the transfer.

### 5. (Optional) Run it on your computer

Needs [Node.js 22+](https://nodejs.org) and git.

```sh
git clone https://github.com/<your-username>/uni-notes.git
cd uni-notes
npm ci
npm run serve        # preview at http://localhost:8080, rebuilds when files change
```

## Updating the notes

Pick whichever fits how you work.

**Sync from your Obsidian vault (what this machine uses).** Keep writing in
`~/Documents/Obsidian Vault` and run:

```sh
sh ~/Documents/uni-notes/sync-notes.sh
```

It publishes every subject linked from the vault's `Subjects.md`. For each one it copies the
subject's folder if there is one (like `Neurophysiology/`), plus the index note and everything
it links to, wherever those notes and images sit in the vault, following links from note to
note. Then it commits `vault/` (and `site.yaml`) and pushes. Notes you delete or unlink disappear from the site;
a subject whose index doesn't link to any note yet is left off until it does. The copy step on
its own is `node scripts/sync-vault.mjs` (nothing is committed).

To publish only part of a subject, list the index headings that are ready in `site.yaml`:

```yaml
subjects:
  Integrated Physiological Responses to Exercise:
    publish: [Immunology I, Immunology II] # add "Exercise Immunology" when it's ready
```

The other sections' notes stay out of the repo and off the site, and links to them from
published notes show as plain text until they're published. Sections are the folders the site
shows: a `# Section` includes its subsections, while `##` and deeper headings are each their own
(so `## Immunology II` doesn't include a `### Exercise Immunology` below it). Headings are matched
as the site shows them, ignoring case. If a name matches no heading, or the list is
empty, the sync and the build stop without changing anything, so a typo can't publish or delete
a whole subject. `sync-notes.sh` commits `site.yaml` along with the notes.

**A. Write straight into the repo.** In Obsidian, _Open folder as vault_ → pick
the repo's `vault/` folder. Your notes are `vault/Neurophysiology/`. Install the community
plugin **Obsidian Git**, then use _Commit and push_ from the command palette when you want the
site updated. `.obsidian/` (your settings and plugins) is gitignored and stays on your machine.

**B. Keep your vault where it is.** Zip the subject folder and run:

```sh
npm run import -- ~/Downloads/Neurophysiology.zip   # syncs vault/Neurophysiology, deletions included
git add vault && git commit -m "Update notes" && git push
```

**C. From the browser.** On GitHub, open `vault/Neurophysiology/` → **Add file → Upload
files** → drop the new or changed `.md` files and images → Commit. Deleting a note this way
means deleting it on GitHub too.

To check that it worked, look at the Actions tab: a green check means the site built.

## How notes become the site

The build (`scripts/build-content.mjs`) reads `vault/` and writes a structured copy to
`content/`, which Quartz turns into the site. **Your notes are never modified**, and
`content/` is generated each time, so it isn't committed.

### Structure comes from the index note

The note named after the folder (`vault/Neurophysiology/Neurophysiology.md`) decides the
sidebar:

| In the index note | On the site                     |
| ----------------- | ------------------------------- |
| `# Section`       | sidebar folder                  |
| `### Subsection`  | subfolder                       |
| `- [[Note]]`      | the note, in the order listed   |
| not listed        | goes to the **Concepts** folder |
| empty section     | hidden until it has links       |

So a new topic note needs one line in the index. A term note you link from the text
(`[[refractory]]`) doesn't: it lands in Concepts and shows as a hover preview wherever it's
linked.

### Things the build tidies up for you

- An opening `>` quote becomes a **Definition** box.
- A `>` quote under a `### Summary` heading becomes a **Summary** box.
- A quote starting with a bold label, like `>**Memory hook:** …`, becomes a tip box with that
  title.
- Headings start at the right level, and `### **Bold heading**` loses the redundant bold.
- `![[PASTE IMAGE: …]]` placeholders (embeds with no file) are hidden.
- Term notes starting lowercase get a capitalised page title (`cation` → "Cation").

Obsidian features that work as usual: wikilinks, `[[Note|alias]]`, `[[Note#Heading]]`, image
embeds with sizes (`![[img.png|300]]`), `==highlights==`, tables, callouts (`> [!tip]`), LaTeX
(`$E_{Na}$`), Mermaid, tags.

### Page titles: `site.yaml`

Some notes are named after the phrase you linked from, like `without decaying`. `site.yaml`
gives them a proper page title and URL without renaming your file. Sentences that link to them
keep their original wording.

```yaml
subjects:
  Neurophysiology:
    rename:
      "without decaying": "Non-decremental conduction"
    headings:
      "Neurotransmiters": "Neurotransmitters" # fixes a heading in the index
```

If you rename the file in Obsidian later, remove its line here.

### Writing tips (optional)

None of these are required, but they help the site:

- Name term notes after the concept, and use an alias for the sentence wording:
  `[[Refractory period|refractory]]`. Then no `site.yaml` entry is needed.
- Frontmatter `tags: [exam]` adds tag pages; `aliases: [AP]` makes `[[AP]]` resolve.
- Descriptive image names (`ap-phases.png`) make nicer URLs than `Screenshot 2026-…png`.

## Adding a subject

With `sync-notes.sh`: link the subject from `Subjects.md` and give it an index note named after
it, laid out like the Neurophysiology one. Its notes can live in a folder of the same name or
loose in the vault. It appears on the home page and in the sidebar once the index links to a
note, in the order `Subjects.md` lists the subjects.

Otherwise, create `vault/<Subject>/` with an index note `vault/<Subject>/<Subject>.md`. With
option A, just add the folder next to `Neurophysiology/` in Obsidian.

## Audio narration

A note can have an audio track, read by an ElevenLabs voice. The player sits under the title:

| Control                   | What it does                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| ‹ ›                       | previous / next sentence ("previous" restarts the sentence if you're past its start)                         |
| « »                       | previous / next section                                                                                      |
| − 1.0× +                  | speed in steps of 0.1, from 0.5× to 3.0×; click the number to reset                                          |
| progress bar              | click or drag to seek; the gaps mark sections. With it focused, ← → move by sentence, Shift + ← → by section |
| speaker next to a heading | listen from that part of the note                                                                            |
| × on the floating player  | close it: the narration pauses and the player goes back under the title until you press play again           |

Once playing, the player docks to the bottom of the window when you scroll past it, the part
being read is highlighted, and it remembers where you stopped. Headphone and lock-screen
next/previous buttons move by sentence.

**How a track is made.** The audio isn't read straight from the note. A narration script,
`audio/<Subject>/<Note>.md`, is a spoken version of it: no tables or images, symbols spelled
out ("Na⁺" → "sodium"), and connectors so it sounds narrated. One `## Section` per part of the
note (named like its heading or bold label, so the player can highlight it), one sentence per
line. You can edit the wording freely. Then:

```sh
npm run audio -- --dry-run   # what would be generated, and how many characters it costs
npm run audio                # generate every missing or changed track (only those)
```

It needs an ElevenLabs API key with **Text to Speech** access in `.env`
(`ELEVENLABS_API_KEY=…`; `.env` is gitignored, never commit it), and a way to decode MP3 to check
the end of each section: `afconvert`, built into macOS, or `ffmpeg`. ElevenLabs sometimes starts
saying the next section at the very end of one; that stray syllable is cut off automatically. ElevenLabs charges about one
credit per character of script, and never twice for the same audio: finished sections are
cached in `audio/.cache/` (so a run that fails part-way resumes), and renaming a section or
splitting a sentence differently only recomputes the timings. `--force` asks for a fresh
reading of a note. Commit the `audio/` folder (scripts, `.mp3`, `.json`) the normal way;
`sync-notes.sh` only commits `vault/` and `site.yaml`. When a note changes after its script was written,
`npm run content` warns that the narration is out of date.

Voices are set in `site.yaml` under `audio.voices`, and scripts alternate between them from
note to note. They are Irish voices from the ElevenLabs voice library's "Educational" category,
read with `eleven_v4`, ElevenLabs' highest-quality model (`audio.model`). Any library voice works
by its id with a Text to Speech key; `npm run audio -- --find-voices irish female` searches the
library, but the key needs **Voices: Read** for that. Changing a voice regenerates the
tracks that use it; changing the model regenerates every track. Each voice's `gain` (in dB,
steps of 1.5) evens out loudness between voices without re-encoding; changing it, or the pause
between sections (`sectionPause`), rebuilds the tracks from the local cache for free. The same
section sets the "Voice by ElevenLabs" credit under the player, which the free plan requires.

## Working on the site

```sh
npm run serve     # build + live preview on http://localhost:8080
npm run site      # one-off build into public/, as CI does
npm run content   # only regenerate content/ from vault/ (prints warnings)
```

| File                          | What it's for                                         |
| ----------------------------- | ----------------------------------------------------- |
| `vault/`                      | the notes, one folder per subject                     |
| `site.yaml`                   | renames, heading fixes, sections to publish, audio    |
| `scripts/build-content.mjs`   | vault → content: structure, callouts, link rewriting  |
| `sync-notes.sh`               | sync the vault, commit `vault/` and `site.yaml`, push |
| `scripts/sync-vault.mjs`      | Obsidian vault → `vault/`, following `Subjects.md`    |
| `scripts/import-vault.sh`     | `npm run import`: sync a zipped folder into `vault/`  |
| `audio/`                      | narration scripts and the generated audio tracks      |
| `scripts/narrate.mjs`         | `npm run audio`: narration scripts → ElevenLabs audio |
| `plugins/narration-player/`   | the audio player on narrated notes                    |
| `quartz.config.yaml`          | Quartz settings: site title, colours, fonts, plugins  |
| `quartz.ts`                   | sidebar ordering (reads the order the build writes)   |
| `quartz/styles/custom.scss`   | custom CSS                                            |
| `.github/workflows/site.yaml` | build on push, deploy to Pages                        |

Change the site title or colours in `quartz.config.yaml` (`pageTitle`, `theme`). The
[Quartz docs](https://quartz.jzhao.xyz) cover the rest.

If you work on the site with a coding agent, [`AGENTS.md`](AGENTS.md) has the details it
needs.

### Upgrading Quartz

The repo is built on Quartz's own git history, so upgrades merge cleanly:

```sh
git remote add upstream https://github.com/jackyzha0/quartz.git   # once per clone
npx quartz upgrade
npm run site    # check it still builds before pushing
```

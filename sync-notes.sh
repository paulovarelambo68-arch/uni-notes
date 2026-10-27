#!/bin/sh
# Sync the Obsidian vault into the repo, then commit and push so the website rebuilds.
# Synced: every subject linked from Subjects.md, with the notes and images its index links to
# (wherever they are in the vault), plus Subjects.md itself. See scripts/sync-vault.mjs.
# site.yaml is committed with the notes, since its `publish` lists decide what gets copied.
# Usage: sh ~/Documents/uni-notes/sync-notes.sh  (or: ./sync-notes.sh)

set -e
REPO="$HOME/Documents/uni-notes"
OBSIDIAN="$HOME/Documents/Obsidian Vault"

cd "$REPO"
git pull --ff-only --quiet

node scripts/sync-vault.mjs "$OBSIDIAN"

if [ -z "$(git status --porcelain -- vault site.yaml)" ]; then
  echo "No changes — the site is already up to date."
  exit 0
fi

git add vault site.yaml
git commit --quiet -m "Update notes"
git push
echo "Published: changes pushed, site rebuild triggered."

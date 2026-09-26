#!/bin/sh
# Sync the Obsidian vault into the repo, then commit and push so the website rebuilds.
# Synced: the Neurophysiology subject folder, plus the Subjects.md home note if present.
# Usage: sh ~/Documents/uni-notes/sync-notes.sh  (or: ./sync-notes.sh)

set -e
REPO="$HOME/Documents/uni-notes"
OBSIDIAN="$HOME/Documents/Obsidian Vault"

cd "$REPO"
git pull --ff-only --quiet

rsync -a --delete --exclude='.obsidian' "$OBSIDIAN/Neurophysiology/" "$REPO/vault/Neurophysiology/"

# Home note at the vault root becomes the site's home page. Remove it from the repo
# if it disappears from the vault, so the site falls back to the generated list.
if [ -f "$OBSIDIAN/Subjects.md" ]; then
  cp "$OBSIDIAN/Subjects.md" "$REPO/vault/Subjects.md"
else
  rm -f "$REPO/vault/Subjects.md"
fi

if git diff --quiet && git diff --cached --quiet && [ -z "$(git status --porcelain)" ]; then
  echo "No changes — the site is already up to date."
  exit 0
fi

git add vault
git commit --quiet -m "Update notes"
git push
echo "Published: changes pushed, site rebuild triggered."

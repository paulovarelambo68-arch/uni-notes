#!/usr/bin/env bash
# Replace a subject in vault/ with the contents of a zipped Obsidian folder.
#   npm run import -- ~/Downloads/Neurophysiology.zip
# The zip's top-level folder name is the subject. Notes deleted in the vault are deleted here too.
set -euo pipefail

zip="${1:?usage: npm run import -- path/to/Subject.zip}"
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

unzip -q "$zip" -d "$tmp"
rm -rf "$tmp/__MACOSX"

mapfile -t dirs < <(find "$tmp" -mindepth 1 -maxdepth 1 -type d ! -name '.*')
if [ "${#dirs[@]}" -eq 1 ] && [ -z "$(find "$tmp" -mindepth 1 -maxdepth 1 -type f ! -name '.*')" ]; then
  src="${dirs[0]}"
  subject="$(basename "$src")"
else
  # Zipped from inside the folder: name the subject after the zip file.
  src="$tmp"
  subject="$(basename "$zip" .zip)"
fi

dest="$root/vault/$subject"
mkdir -p "$dest"
rsync -a --delete --exclude '.obsidian' --exclude '.trash' --exclude '.DS_Store' "$src/" "$dest/"

echo "Updated vault/$subject:"
git -C "$root" status --short -- "vault/$subject"

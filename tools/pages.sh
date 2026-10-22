#!/bin/sh
# Publishes web/ to the gh-pages branch (GitHub Pages: https://lenevot60.github.io/echo-show-dashboard/).
# The skill starts web/youtube/index.html from there (youtubeUrl in lambda/config.json).
set -e
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
git worktree add -q "$tmp" gh-pages
cp -R web/. "$tmp/"
cd "$tmp"
git add -A
git commit -q -m "pages: update from web/" || echo "niets veranderd"
git push -q origin gh-pages
cd - >/dev/null
git worktree remove "$tmp"

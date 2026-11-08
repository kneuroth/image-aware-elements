#!/usr/bin/env bash
# Publish every @image-aware package whose current version isn't on npm yet.
#
# Run `pnpm changeset version` (and commit) first; this only uploads.
#
# pnpm packs each package — that's what turns `workspace:*` into real version
# numbers — and npm does the upload. pnpm 11's built-in publish (which
# `changeset publish` uses) gets a 404 from the registry for this account,
# while npm publishing the same tarball works. Packages go up in dependency
# order, core first, and it stops at the first failure.
set -euo pipefail
cd "$(dirname "$0")/.."

pnpm turbo run build --filter='./packages/*'

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

for p in core element react angular editor; do
  name="@image-aware/$p"
  version="$(node -p "require('./packages/$p/package.json').version")"
  if npm view "$name@$version" version --prefer-online >/dev/null 2>&1; then
    echo "skip  $name@$version (already on npm)"
    continue
  fi
  (cd "packages/$p" && pnpm pack --pack-destination "$out" >/dev/null)
  echo "publish  $name@$version"
  npm publish "$out/image-aware-$p-$version.tgz" --access public
done

echo "done — npm can take a few minutes to show new versions"

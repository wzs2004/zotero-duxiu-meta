#!/usr/bin/env bash
#
# Build dist/duxiumeta.xpi (and a versioned copy).
# Only requires zip + sed.

set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(sed -n 's/^[[:space:]]*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -1)
if [ -z "$VERSION" ]; then
  echo "Could not read version from manifest.json" >&2
  exit 1
fi

rm -rf dist
mkdir -p dist

zip -r -X -q dist/duxiumeta.xpi \
  manifest.json \
  bootstrap.js \
  prefs.js \
  chrome \
  README.md \
  LICENSE

cp dist/duxiumeta.xpi "dist/duxiumeta-${VERSION}.xpi"

echo "Built dist/duxiumeta.xpi (version ${VERSION})"
unzip -l dist/duxiumeta.xpi | tail -n 3

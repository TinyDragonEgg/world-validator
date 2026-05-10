#!/usr/bin/env bash
set -e
VERSION="${1:?Usage: release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -i "s/\"{{version}}\"/\"$VERSION\"/g" "$ROOT/module.json"
sed -i "s/{{version}}/$VERSION/g"         "$ROOT/module.json"
cd "$ROOT"
zip -r "world-validator.zip" module.json src/ languages/ LICENSE README.md CHANGELOG.md
echo "Done. Run: git add -A && git commit -m \"Release $VERSION\" && git tag $VERSION && git push origin main --tags"

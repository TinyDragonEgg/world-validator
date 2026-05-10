# CLAUDE.md — world-validator bootstrap

You are scaffolding a Foundry VTT v13 module from scratch. Follow every instruction exactly. Ask nothing. Use scripts for all multi-file work.

---

## Identity

- Module ID: `world-validator`
- Display name: World Validator
- Author: Tiny Dragon
- Foundry: v13, dnd5e system
- License: MIT

---

## DEV_NOTES — read before touching any code

- Single source file: `src/world-validator.js`
- All logging goes through `WV.log(level, ctx, ...args)`. Never use `console.log` directly.
- The error interceptor wraps `console.error` and `console.warn` at module load time — this is intentional and must run before `Hooks.once("init")`.
- `_id` fields must be EXACTLY 16 lowercase alphanumeric characters. Count manually.
- Image paths: forward slashes, no leading slash, must exist in Foundry Data.
- CSS uses `--wv-*` variables defined in `:root`. Never hardcode colors.
- No external dependencies. No other modules required.
- The `generateContextPack()` function introspects the live dnd5e system model. It will only produce accurate output when run inside a Foundry world with dnd5e active. Do not mock or stub it.
- `introspectItemType` and `introspectActorType` read `game.system.model` at runtime. If the system model structure changes between dnd5e versions, these functions may return fewer paths — that is expected behavior, not a bug.
- The Claude API key is stored world-scoped and restricted. Never log it.
- `anthropic-dangerous-direct-browser-access` header is required for browser-side Anthropic API calls.

---

## Step 1 — Scaffold

Create `scripts/scaffold.sh`, run it immediately.

```bash
#!/usr/bin/env bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

mkdir -p "$ROOT"/{scripts,src,languages,.github/workflows}

cat > "$ROOT/module.json" <<'EOF'
{
  "id": "world-validator",
  "title": "World Validator",
  "description": "GM-only Foundry VTT v13 / dnd5e validator. Validates JSON against your live schema, browses all valid attribute paths and enums, generates a Claude Code context pack, and monitors other modules for errors.",
  "version": "{{version}}",
  "compatibility": { "minimum": "13", "verified": "13" },
  "authors": [{ "name": "Tiny Dragon" }],
  "license": "MIT",
  "url": "https://github.com/TinyDragon/world-validator",
  "manifest": "https://github.com/TinyDragon/world-validator/releases/latest/download/module.json",
  "download": "https://github.com/TinyDragon/world-validator/releases/download/{{version}}/world-validator.zip",
  "scripts": ["src/world-validator.js"],
  "languages": [],
  "flags": {}
}
EOF

cat > "$ROOT/LICENSE" <<'EOF'
MIT License — Copyright (c) 2026 Tiny Dragon
Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction.
EOF

cat > "$ROOT/.gitignore" <<'EOF'
node_modules/
*.zip
dist/
.DS_Store
Thumbs.db
EOF

cat > "$ROOT/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]
### Added
- Validate JSON tab: paste or import JSON, validates _id length, field paths, activity types, effect keys, damage formulas against live dnd5e schema. AI fix button sends errors + JSON to Claude and returns corrected version.
- Attribute Browser tab: searchable list of all valid system.* paths per sheet type with copy buttons for path and @attribute format. Enum values shown per type.
- Context Pack tab: generates CLAUDE.md section with live schema, valid IDs, compendium packs, active modules, effect key rules.
- Module Errors tab: intercepts console.error/warn since load, groups by source module, frequency ranking, Claude analysis button.
- WV logger with log level setting.
- Dry run setting.
EOF

cat > "$ROOT/README.md" <<'EOF'
# World Validator

Foundry VTT v13 GM module. Validates JSON against your live dnd5e install and exports a context pack for Claude Code.

## Install
```
https://github.com/TinyDragon/world-validator/releases/latest/download/module.json
```

## Tabs

| Tab | What it does |
|---|---|
| Validate JSON | Paste or import JSON. Checks _id length, field paths, activity types, effect keys, formulas. AI fix via Claude. |
| Attribute Browser | All valid system.* paths per sheet type. Copy as path or @attribute. Enum values shown. |
| Context Pack | Generates a CLAUDE.md section from your live install. Paste into Claude Code sessions. |
| Module Errors | Monitors console.error/warn, groups by module, frequency ranking, Claude analysis. |

## Settings

| Key | Default | Description |
|---|---|---|
| logLevel | warn | error/warn/info/debug |
| apiKey | — | Anthropic API key for AI fix and error analysis |
| dryRun | false | Log all actions without writing |

## License
MIT
EOF

echo "Scaffold complete."
```

```bash
chmod +x scripts/scaffold.sh && bash scripts/scaffold.sh
```

---

## Step 2 — Place source

Copy the full contents of `world-validator.js` into `src/world-validator.js` verbatim.

```
[PASTE FULL CONTENTS OF world-validator.js HERE]
```

---

## Step 3 — Release script

Create `scripts/release.sh`:

```bash
#!/usr/bin/env bash
set -e
VERSION="${1:?Usage: release.sh <version>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
sed -i "s/\"{{version}}\"/\"$VERSION\"/g" "$ROOT/module.json"
sed -i "s/{{version}}/$VERSION/g"         "$ROOT/module.json"
cd "$ROOT"
zip -r "world-validator.zip" module.json src/ languages/ LICENSE README.md CHANGELOG.md
echo "Done. Run: git add -A && git commit -m \"Release $VERSION\" && git tag $VERSION && git push origin main --tags"
```

```bash
chmod +x scripts/release.sh
```

---

## Step 4 — GitHub Actions

Create `.github/workflows/release.yml`:

```yaml
name: Release
on:
  push:
    tags: ['[0-9]+.[0-9]+.[0-9]+']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: sed -i "s/{{version}}/${GITHUB_REF_NAME}/g" module.json
      - run: zip -r world-validator.zip module.json src/ languages/ LICENSE README.md CHANGELOG.md
      - uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ github.ref_name }}
          name: ${{ github.ref_name }}
          body: |
            **Manifest:** `https://github.com/${{ github.repository }}/releases/download/${{ github.ref_name }}/module.json`
          files: |
            world-validator.zip
            module.json
```

---

## Step 5 — Create repo and push

```bash
cd /path/to/world-validator

git init
git add -A
git commit -m "Initial commit"
git branch -M main

gh repo create world-validator \
  --public \
  --description "Foundry VTT v13 JSON validator, attribute browser, Claude Code context pack generator, module error monitor" \
  --source . \
  --remote origin \
  --push
```

---

## Step 6 — First release

```bash
bash scripts/release.sh 1.0.0
git add -A && git commit -m "Release 1.0.0" && git tag 1.0.0 && git push origin main --tags
```

---

## File tree when done

```
world-validator/
├── .github/workflows/release.yml
├── scripts/
│   ├── scaffold.sh
│   └── release.sh
├── src/
│   └── world-validator.js
├── languages/
├── .gitignore
├── CHANGELOG.md
├── LICENSE
├── module.json
└── README.md
```

---

## Rules

- Use scripts for any operation touching more than one file.
- All logs via `WV.log()`. Never `console.log` directly.
- Never log the API key.
- Append to CHANGELOG.md after every code change.
- Do not re-read files you just wrote.
- Do not summarize between steps unless a step fails.
- If a command fails, print the error and fix. Do not retry blindly.
- When done, print only: `Done. Tag a release with: bash scripts/release.sh 1.0.0`

# World Validator

Foundry VTT v13 GM module. Validates JSON against your live dnd5e install and exports a context pack for Claude Code.

## Install
```
https://github.com/TinyDragonEgg/world-validator/releases/latest/download/module.json
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

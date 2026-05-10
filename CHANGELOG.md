# Changelog

## [Unreleased]
### Added
- Validate JSON tab: paste or import JSON, validates _id length, field paths, activity types, effect keys, damage formulas against live dnd5e schema. AI fix button sends errors + JSON to Claude and returns corrected version.
- Attribute Browser tab: searchable list of all valid system.* paths per sheet type with copy buttons for path and @attribute format. Enum values shown per type.
- Context Pack tab: generates CLAUDE.md section with live schema, valid IDs, compendium packs, active modules, effect key rules.
- Module Errors tab: intercepts console.error/warn since load, groups by source module, frequency ranking, Claude analysis button.
- WV logger with log level setting.
- Dry run setting.

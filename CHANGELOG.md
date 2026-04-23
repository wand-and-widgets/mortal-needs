# Changelog

All notable changes to Mortal Needs will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-04-23

### Added
- **Dashboard sidebar**: command rail with crisis queue, quick action buttons (Broadcast, Flash), and next decay schedule on the main panel
- **Crisis Queue**: displays the 5 most urgent needs (sorted by severity) with actor portraits and consequence progress ticks for quick visual triage
- **Live status header**: tracked count, crisis count, average severity, active decay timers, and last-change timestamp at a glance
- **Batch stress/relief multi-need**: apply stress or relief to multiple needs per actor in a single action (previously one need at a time)
- **Live preview panel** in batch dialog: running tally of selected targets, needs, and total changes before applying
- **All/None selection buttons** in batch dialogs for targets and needs
- **Broadcast and Flash quick-action buttons** on the main panel
- **Need cards with status indicators**: critical/at-risk severity badges, consequence count, decay status
- **History dialog enhancements**: filtering by character and need, full-text search, relative timestamps, activity summary, refresh & export actions
- **Configuration redesign**: searchable needs list with inline enabled toggles, live preview of selected need, expanded preset library view
- **Preset cards**: category breakdown, enabled need count, decay configuration summary
- **Critical threshold preview** in config: live preview showing how needs render at the chosen threshold
- **Actor selection dialog overhaul**: tabbed interface for Foundry and Exalted Scenes actors, search, and selection count

### Changed
- **Main panel layout**: expanded from 340px to 1000px with hero header; dense layout mode for 4+ tracked actors
- **Need bar rendering**: localized labels, percentage display, severity labels, consequence/decay indicators
- **Batch operations window**: resized to 860px for side-by-side layout (was 380px); category badges in visual hierarchy
- **Configuration dialog**: expanded to 1240px with tabbed navigation (Needs, Presets, Import/Export)
- **History dialog**: resized to 880px; date separators, relative time formatting, detailed entry summaries
- **Actor selection dialog**: widened to 640px; improved tab design and selection persistence
- **UX rework stylesheet**: comprehensive style overhaul via new `styles/rework.css` — updated button styles, panel spacing, dialog layouts, component theming
- **Need configuration validation**: enhanced validation for custom need IDs, range constraints, and duplicate detection with inline error messages

### Fixed
- **Numeric safety**: hardened value normalization and ratio calculations against malformed actor data
- **Threshold evaluation**: correct event source tracking so stress vs. relieve actions are properly attributed in history
- **Source attribution**: batch operations now correctly record operation source in history ledger
- **Search responsiveness**: actor, need, and history searches now provide immediate visual feedback with row visibility toggling

## [1.2.1] - 2024-12-24

### Fixed
- Fixed "Add Custom Need" dialog not working in Foundry v13 (DialogV2 API compatibility)

## [1.2.0] - 2024-12-23

### Added
- **Custom System Builder support**: Full compatibility with CSB-based systems
- **Universal system compatibility**: Module now works with ANY game system, not just D&D 5e
- Intelligent fallback labels for non-D&D systems

### Changed
- Removed system restriction - module now appears in module list for all systems
- Improved generic adapter with better attribute detection
- Updated punishment system with graceful fallbacks for systems without built-in conditions
- Better console logging for system adapter selection

### Fixed
- Module now appears correctly in Foundry's module list for all game systems
- Condition and damage type labels now display correctly in non-D&D systems

## [1.0.0] - 2024-12-03

### Added
- Initial release
- Compact floating panel with player portraits and need bars
- 13 built-in need types: Hunger, Thirst, Exhaustion, Cold, Heat, Comfort, Sanity, Morale, Pain, Radiation, Corruption, Fatigue, Environmental Stress
- Custom needs support - add your own survival mechanics
- Constitution modifier system for character resilience
- Individual and bulk need management controls
- Click-to-set and drag-to-adjust bar interactions
- Multi-select actors for bulk operations
- Punishment system with automatic effects at critical thresholds
- Chat cards for critical state announcements
- Real-time multiplayer synchronization via WebSocket
- Full localization support (English, Portuguese BR)
- Multi-system support: D&D 5e, Pathfinder 2e, Savage Worlds, WFRP 4e
- Generic fallback for unsupported systems
- Comprehensive API for macros and module integration
- Custom hooks for third-party module integration
- Draggable and collapsible UI panel
- Configurable visibility settings for players
- Modern ApplicationV2 architecture for Foundry v13

### Technical
- Built with Foundry VTT v13 ApplicationV2 API
- Efficient flag-based data storage
- Socket-based real-time synchronization
- Modular system adapter architecture

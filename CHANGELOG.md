# Changelog

All notable changes to Mortal Needs will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

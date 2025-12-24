# Mortal Needs

![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v11--v13-informational)
![Version](https://img.shields.io/badge/Version-1.2.0-blue)
[![Patreon](https://img.shields.io/badge/Patreon-Wand%20%26%20Widgets-orange)](https://patreon.com/wandandwidgets)

A survival needs management module for Foundry VTT. Track hunger, thirst, exhaustion, temperature, and other mortal necessities for your players with a beautiful, compact floating panel.

## Features

### Compact Widget
- Floating panel showing player portraits with their need bars
- Drag to reposition anywhere on screen
- Collapsible for minimal screen usage
- Real-time updates across all connected clients

### Multiple Need Types
Track up to 13 different survival needs:
- **Basic**: Hunger, Thirst, Exhaustion
- **Environmental**: Cold, Heat, Radiation
- **Mental**: Sanity, Morale, Comfort
- **Physical**: Pain, Fatigue, Corruption
- **Custom**: Add your own needs!

### Constitution Modifier
Stress amounts are modified by character Constitution - tougher characters are more resilient to hardship.

### GM Controls
- Stress or relieve needs individually or in bulk
- Click bars to set exact values
- Drag bars for smooth adjustment
- Quick +/- buttons for fast changes
- Multi-select actors for bulk operations

### Punishment System
- Automatic effects when needs reach critical thresholds
- Configurable penalties and notifications
- Chat cards announcing critical states

### Multi-System Support
Works with **any game system**! The module includes optimized adapters for:
- D&D 5e (fully supported with exhaustion, conditions, damage)
- Pathfinder 2e (fatigue and drained conditions)
- Savage Worlds (fatigue system)
- WFRP 4e (fatigue system)
- **Custom System Builder** (fully compatible!)
- Generic adapter for all other systems

**Note for non-D&D systems**: Core features (tracking needs, UI, notifications) work perfectly. Some advanced punishment effects (like auto-applying conditions or exhaustion) may need to be applied manually depending on your system.

### Localization
- English
- Português (Brasil)

## Installation

Foundry Module Browser
Search for "Mortal Needs" in the Foundry VTT module browser.

### Manual Installation
Use the following manifest URL:
```
https://github.com/wand-and-widgets/mortal-needs/releases/latest/download/module.json
```

## Usage

### Opening the Panel
1. As GM, click on the **Token Controls** (the token icon in the left sidebar)
2. Click the **heartbeat icon** to toggle the Mortal Needs panel

### Managing Needs
- **Click a portrait** to select that actor (Ctrl+Click for multi-select)
- **Click on a bar** to set the value directly
- **Drag on a bar** to adjust the value smoothly
- Use the **+/-** buttons next to each bar for quick adjustments
- Use the **bulk controls** at the bottom to affect all selected (or all) actors

### Configuration
Go to **Module Settings > Mortal Needs** to configure:
- Default stress amount
- Constitution modifier toggle
- Player visibility settings
- Critical threshold notifications
- Enable/disable specific needs
- Add custom needs

## API

The module exposes an API for macros and other modules:

```javascript
// Get the API
const api = game.modules.get('mortal-needs').api;

// Toggle the UI
api.toggleUI();

// Stress a specific need for an actor
await api.stressNeed(actorId, 'hunger', 20);

// Relieve a need
await api.relieveNeed(actorId, 'thirst', 15);

// Stress all actors
await api.stressAll('exhaustion', 10);

// Get an actor's need value
const hunger = api.getNeedValue(actorId, 'hunger');

// Get all needs for an actor
const needs = api.getActorNeeds(actorId);
```

## Hooks

The module fires hooks that other modules can listen to:

```javascript
// Fired when a need reaches a threshold
Hooks.on('mortalNeedsThreshold', (data) => {
  console.log(`${data.actorId}'s ${data.needId} is at ${data.percentage}% (${data.severity})`);
});
```

## Compatibility

| Foundry VTT Version | Status |
|---------------------|--------|
| v11                 | Compatible |
| v12                 | Compatible |
| v13                 | Verified |

| Game System | Status | Notes |
|-------------|--------|-------|
| D&D 5e 4.0+ | Fully Supported | All features including exhaustion, conditions, damage |
| Pathfinder 2e | Supported | Fatigue/drained conditions |
| Savage Worlds | Supported | Fatigue system integration |
| WFRP 4e | Supported | Fatigue system integration |
| Custom System Builder | Supported | Full UI, manual punishment application |
| Other Systems | Compatible | Generic adapter, core features work |

## Support

- **Issues & Bugs**: [GitHub Issues](https://github.com/wand-and-widgets/mortal-needs/issues)
- **Discord**: Coming soon
- **Patreon**: [Wand & Widgets](https://patreon.com/wandandwidgets)

## License

This module is premium content. See [LICENSE](LICENSE) for details.

Copyright (c) 2024 Wand & Widgets. All rights reserved.

---

Made with care by **Wand & Widgets**

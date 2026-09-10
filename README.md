# Mortal Needs

![Foundry VTT](https://img.shields.io/badge/Foundry%20VTT-v12--v14-informational)
![Version](https://img.shields.io/badge/Version-3.0.0-blue)
[![Patreon](https://img.shields.io/badge/Patreon-Wand%20%26%20Widgets-orange)](https://www.patreon.com/WandAndWidgets)

Bring everyday needs into the story. Mortal Needs helps you track hunger, thirst, cold, fear, comfort, and other pressures in Foundry VTT, with a small interface that leaves room for the game itself.

**Free to install and use. No purchase or Patreon subscription is required.**

## What's new in 3.0

- A compact, movable GM dock with original SVG icons and readable states.
- Need meters you can drag as the scene unfolds, with exact values and keyboard controls when you need them.
- A smaller personal view for players, with visibility and editing controlled by the GM.
- Named consequences, descriptions, and recovery guidance that are easier to inspect.
- One-click consequence recommendations where your game system provides them.
- A feather button beside each portrait to bring the character's worst visible condition into chat.
- More reliable temporary penalties, shared conditions, and recovery.
- Fear as an optional built-in need, disabled until you choose to use it.

Read the [full 3.0.0 changelog](CHANGELOG-3.0.0.md).

## Installation

In Foundry's setup screen, open **Add-on Modules**, choose **Install Module**, and search for **Mortal Needs**. Then enable it in your world's **Manage Modules** window.

For an existing installation, use **Update** beside Mortal Needs in the setup screen.

You can also install using this manifest URL:

```text
https://github.com/wand-and-widgets/mortal-needs/releases/latest/download/module.json
```

## Using the dock

Open Mortal Needs from the heartbeat control in Foundry's token tools. Use the dock's character selection and configuration controls to choose who and what to track.

Drag the header to move the dock. Collapse it between scenes. Each user's position and collapse choice are remembered for that world.

Drag a meter left or right to adjust a need. Hold Shift for finer movement, release to save, or press Escape to cancel. Click its icon to inspect the state, enter an exact value, or use the plus and minus buttons. A focused meter also accepts arrow keys, with Shift for larger steps.

Players see their own tracked character. Players with multiple available characters can choose which one to follow. The GM decides what they can see and whether they may change values.

## Consequences and narration

Configure consequences for the needs that matter to your campaign. When a recommendation is available, **Use recommendation** adds it in one click. **Edit rule** lets you adjust it afterward. Recommendations do not change existing campaign rules unless you choose to use them.

Supported temporary penalties appear as named effects on the character. Open a need's details to inspect its applied consequences and recovery. The world setting controls whether recovery removes penalties automatically, asks the GM, or leaves removal to the GM.

Click the feather beside a portrait to send that character's worst visible condition to chat. Automatic narration can also respond as conditions change. GM-only needs stay out of public narration.

## More ways to use needs

Choose from 14 built-in needs or add your own. Group adjustments, optional Constitution modifiers, time-based changes, and movement-based advancement support different approaches to travel and survival. A separate broadcast display offers additional density and visibility options.

English and Brazilian Portuguese translations are included. Fonts load locally without an external font service.

## Compatibility

The manifest allows Foundry VTT 12 through 14. Live testing for this update covers **Foundry 14.360 with D&D 5e 5.3.3**, including GM and player sessions. Older Foundry versions have not received the same live testing for 3.0.

Adapters are included for D&D 5e, Pathfinder 2e, Savage Worlds, and WFRP 4e, with a generic adapter for other systems. Available consequences depend on the system. Other adapters and the optional SessionFlow and Exalted Scenes integrations still need separate live validation for this update.

Existing tracked characters, values, custom needs, and rules are retained. Older direct attribute penalties may need manual review because previous versions did not record their original changes. The module does not guess those missing amounts.

## Support

- [Report an issue](https://github.com/wand-and-widgets/mortal-needs/issues)
- [Join the Discord](https://discord.com/invite/HABajQuZ6J)
- [Support Wand & Widgets on Patreon](https://www.patreon.com/WandAndWidgets)
- [Official Foundry package page](https://foundryvtt.com/packages/mortal-needs)

## License

Mortal Needs is free to install and use. See [LICENSE](LICENSE) for the usage terms. Bundled fonts include their SIL Open Font License notices.

Copyright (c) 2024 Wand & Widgets. All rights reserved.

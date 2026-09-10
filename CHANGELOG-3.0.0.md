# Mortal Needs 3.0.0

This update brings a smaller interface and clearer conditions to Mortal Needs. The aim is to make hunger, thirst, cold, fear, and comfort easier to bring into a scene, while leaving room on the screen for the game itself.

## A smaller place for the whole company

The GM's dock shows each tracked character with their portrait, need icons, and most concerning state. Drag the header to place it where it feels comfortable. Collapse it between scenes and open it when the company needs attention. Your position and collapse choice are remembered for each world.

## Adjust a need as the scene unfolds

Drag a meter a little to the right or left to raise or lower its value. Hold Shift for finer movement. The value is saved when you release it, so moving the pointer does not fill chat with repeated updates. Press Escape to cancel a drag.

Click a need icon to open its details. You can enter an exact value or use the plus and minus buttons. Arrow keys also work on a focused meter, with Shift allowing larger steps. Needs that become dangerous as their value falls explain that direction in the details.

## A personal view for players

Players have a smaller dock for their own tracked character. Players with more than one available character can choose which one to follow. The GM controls what is visible and whether players may adjust their own values. Each player's dock position is independent.

## A new visual style

The interface uses dark surfaces, warm metal accents, and a clearer hierarchy of text. Original SVG icons give each built-in need its own shape and color. Need details, configuration windows, chat cards, and shared displays follow the same visual direction. Fonts are included with the module.

Fear is now available as an optional built-in need. It starts disabled so it can be introduced when it suits the campaign.

## Conditions that explain themselves

Open a need's details to see its current state, configured consequences, which ones are applied, and how recovery is handled. Supported temporary penalties appear as named effects on the character, with an icon and a description that can also be inspected from the sheet.

Attribute consequences use readable names such as "Exhaustion +1" and "Current hit points -5". The inspector refreshes older technical labels and shows the total amount of a repeated attribute penalty.

New temporary effects stay at their configured strength unless the GM chooses to add the penalty again on each repeat. If an effect cannot be applied, the module reports the problem instead of treating it as a successful penalty. Available effect behavior still depends on the game system.

## More reliable recovery

Repeated attribute penalties keep track of the amount they actually changed. Removing a reversible penalty restores that amount while keeping other changes to the character.

When two needs require the same condition, it remains until both sources have recovered. A condition that was already present from another source remains in that source's care. Saved effects retain their recovery information when a consequence rule is edited or removed.

The world setting still chooses whether recovery removes an effect automatically, asks the GM, or leaves removal to the GM.

## Quicker consequence setup

Select a need in configuration to see any recommendation available for your game system. The card explains the effect, its trigger, and recovery. Choose **Use recommendation** to save that rule in one click. It begins applying when a character crosses the shown threshold.

Once the rule is configured, **Edit rule** opens it directly. Repeated clicks do not add copies, and an existing attribute rule keeps its chosen strength and threshold. The same shortcut is available in the need editor. Adding a recommendation leaves other unfinished settings in place so you can continue editing.

## Give a condition a moment in the story

The feather beside a portrait lets the GM send a description of that character's worst visible condition to chat. It is a way to draw attention to someone who needs water, rest, warmth, or reassurance, even when automatic messages are turned off.

Automatic narration follows changes in condition. Rapid changes are grouped, and ordinary messages have a short pause between them. Entering or leaving the configured critical range can still receive attention during that pause. Needs marked for the GM remain out of public narration.

## More dependable updates during play

Quick adjustments are saved in order and shared through Foundry. Failed saves return the display to its previous value. One active GM handles automatic consequences and narration, helping avoid duplicates when several GMs are connected.

Existing tracked characters, values, custom needs, and campaign rules are retained. The new appearance does not choose new penalties for the group.

## Compatibility and existing campaigns

This update has been exercised in a separate Foundry 14.360 world using D&D 5e 5.3.3, including a GM and player session. Penalty application and recovery, direct adjustments, player control, narration, and configuration saves have been checked. Local regression checks accompany the build.

Other game systems, optional integrations, and older Foundry versions have not received the same live testing for this update. Available consequences depend on your game system.

Older direct attribute penalties created before this update may need manual review because their original changes were not recorded. The module does not guess those missing amounts.

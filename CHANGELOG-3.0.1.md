# Mortal Needs 3.0.1

This maintenance update corrects several consequence issues found during a post-release check of D&D 5e and Pathfinder 2e.

- Repeated stress checks continue at the maximum need value. For inverted needs, they continue at the minimum. The configured number of checks still controls when a consequence repeats. These checks do not add unchanged values to history or repeat condition narration.
- Temporary penalties accept the short attribute paths offered by the configuration picker. D&D skill penalties use the system's skill check bonus, so the penalty affects actual rolls.
- Existing Mortal Needs effects with these older paths are repaired when the responsible GM loads a tracked actor. Their strength is preserved.
- Consequence configuration offers appropriate writable fields. Pathfinder ability modifiers remain available for scaling stress; direct penalties offer current HP, and conditions continue to use native Pathfinder condition Items.
- Editing a Pathfinder condition no longer offers unsupported Active Effects. Existing legacy Active Effect rules remain editable. The condition field now uses its translated label.
- Player stress checks at the cap reach the responsible GM through Foundry's normal document updates, with ownership and player-control checks.

D&D uses the world's selected 2014 or 2024 rules. Mortal Needs does not choose the ruleset or install survival penalties automatically.

Validation includes 57 automated tests, D&D 2014 and 2024 rules on Foundry 13 and 14, separate GM and player sessions, and Pathfinder 2e 8.1.2 on Foundry 14. The packaged update also passed a fresh-installation check. See the [compatibility notes](https://github.com/wand-and-widgets/mortal-needs/blob/v3.0.1/README.md#compatibility) for exact tested versions and remaining limits.

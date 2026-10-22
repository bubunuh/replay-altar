# Changelog

What changes for players in each version. Work happens on `dev`; a version is made from `main`
(see README, "Branches and builds"). Research scripts, experiments and the data they use are not
part of a version: an installer ships only the app, the simulation engine and the published pro
statistics (`data/`).

## Unreleased (next version)

**Ready on `dev`:**
- **More accurate army value and losses.** A replay records no deaths, so they are reconstructed. They now also use what the replay does record: whenever a player switches selection, the game writes down which units were really selected, and dead units are already missing. Before, the opponent's new units could count as lost the moment they were trained, and units lost in a fight could stay alive. Checked against Warcraft III's own unit counts on 50 recorded player-games, the army value error fell by about 29% (by far the most for players the simulation followed poorly). Losses, trades and fight results in the report and on the map use the same counting, and so does the pro comparison.
- **Undead:** an Obsidian Statue is no longer valued as a Destroyer before it transforms, and ghouls gathering lumber no longer count as dead.
- **More games simulate to the end:** two fixes to WC3V (reviving a hero that used a Town Portal; training from a building WC3V hadn't seen being built). On the pro games, 16 of 518 were cut short before. The pro comparison now uses 513 games.
- **Some replays that could not be imported now can** (a hero the replay reader reports without a type).

**To do for this version:**
- **Win-chance curve** in the report: your chance to win over the game, and the moments that swung it. The model is being tested on 3,000 tournament games from 2022 to today.
- **A note in the app** that army value, losses and fight results are estimates, with how they are measured.
- **Linux AppImage**, alongside the Windows installer.

## Later

- **More languages:** German, Ukrainian, Russian, Chinese and Korean (needs a text format that scales past four languages, and fonts for Cyrillic, Chinese and Korean).
- **Code signing:** SignPath turned the project down for now (too new, no reputation); try again later.

## 0.1.3 and earlier

See the [GitHub releases](https://github.com/bubunuh/replay-altar/releases).

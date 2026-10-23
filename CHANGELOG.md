# Changelog

What changes for players in each version. Work happens on `dev`; a version is made from `main`
(see README, "Branches and builds"). Research scripts, experiments and the data they use are not
part of a version: an installer ships only the app, the simulation engine and the published pro
statistics (`data/`).

## Unreleased (next version)

**Ready on `dev`:**
- **More accurate army value and losses.** A replay records no deaths, so they are reconstructed. They now also use what the replay does record: whenever a player switches selection, the game writes down which units were really selected, and dead units are already missing. Before, the opponent's new units could count as lost the moment they were trained, and units lost in a fight could stay alive. Checked against Warcraft III's own unit counts on 50 recorded player-games, the army value error fell by about 29% (by far the most for players the simulation followed poorly). Losses, trades and fight results in the report and on the map use the same counting, and so does the pro comparison.
- **Undead:** an Obsidian Statue is no longer valued as a Destroyer before it transforms.
- **More games simulate to the end:** two fixes to WC3V (reviving a hero that used a Town Portal; training from a building WC3V hadn't seen being built). On the pro games, 16 of 518 were cut short before. The pro comparison now uses 513 games.
- **Some replays that could not be imported now can** (a hero the replay reader reports without a type).
- **Evaluation curve** on each game's page, drawn like a chess evaluation graph (blue while you were ahead, red while your opponent was): how often a pro in your position went on to win, moment by moment, with the three moments that swung it most, what moved them (losses, hero experience, workers, army, expansions, heroes alive, upgrades) and what happened then. Learned from 513 pro games and checked on 2,998 tournament games from 2022 to 2026 it never saw; the method is in [docs/win-chance/report.pdf](docs/win-chance/report.pdf).
- **A note on the game's charts** that army value, losses and fight results are estimates, with how far off they typically are and how that was measured.
- **Linux AppImage**, alongside the Windows installer: one file, no Node, git or podman needed. On first start it sets up the background collector (a systemd user service), the `replay-altar` command and a menu entry, reads the game data with a built-in read-only extractor, and updates itself in place like the Windows version.
- **Linux: Battle.net is found in more places:** Lutris folders under `~/Games`, `~/.wine`, Steam's Proton prefixes and Bottles, for both the replays and the game data.

## Later

- **More languages:** German, Ukrainian, Russian, Chinese and Korean (needs a text format that scales past four languages, and fonts for Cyrillic, Chinese and Korean).
- **Code signing:** SignPath turned the project down for now (too new, no reputation); try again later.

## 0.1.3 and earlier

See the [GitHub releases](https://github.com/bubunuh/replay-altar/releases).

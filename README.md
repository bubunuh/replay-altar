# W3Stats

Local Warcraft III replay archive and stats. A background service saves every replay the moment a game ends, before `LastReplay.w3g` is overwritten. It analyzes 1v1 games against humans: Battle.net ladder, W3Champions, and custom lobbies on melee maps. About a minute later, a simulation of the game ([WC3V](https://github.com/jblanchette/wc3v)) adds economy numbers. A desktop app shows each match and your overall performance. Nothing leaves this PC.

## Commands

| Command | What it does |
|---|---|
| `node ~/Projects/w3stats/apps/collector/src/cli.ts install` | First-time setup: service, `w3stats` command, desktop icon. Imports existing replays. |
| `w3stats status` | Is the collector running, plus your last 10 games |
| `w3stats suspend` | Stop the collector and keep it from starting at login |
| `w3stats resume` | Start it again (it catches up on saved replays) |
| `w3stats uninstall` | Remove the service, launchers and icons. Keeps your archive and stats. |
| `w3stats uninstall --purge` | Same, and also delete the archive, stats and settings |
| `w3stats scan` | Import every replay in the game folder now |
| `w3stats override <game> win\|loss` | Fix a wrong result (`<game>` = first characters of the game key, or `latest`) |
| `w3stats reingest` | Rebuild all stats from the archived replays (after an update or settings change) |
| `w3stats export --jsonl` / `--md latest` | Data for an LLM or script |
| `w3stats setup-sim` | One-time setup for the economy simulation (WC3V engine, its packages, unit costs from your WC3 install) |
| `w3stats sim` | Simulation status; `--backfill`, `--retry-failed`, `--rerun`, `--resummarize` |
| `w3stats official` | Fetch the game's own end-of-game stats from W3Champions for W3C games that lack them (the collector does this by itself for new games) |
| `w3stats ref` | Pro reference games: status. `ref refresh [--target N]` downloads more now, `ref profile` rebuilds the statistics |

To remove everything, run `w3stats uninstall --purge` (this also deletes the `localhost/w3stats-casc` podman image), then delete `~/Projects/w3stats`.

## Where everything lives

| What | Path |
|---|---|
| Source code | `~/Projects/w3stats` |
| Archived replays (originals, never modified) | `~/.local/share/w3stats/archive/YYYY/MM/` |
| One JSON record per game | `~/.local/share/w3stats/games/` |
| Raw parser output per game | `~/.local/share/w3stats/raw/` |
| Database (rebuildable) | `~/.local/share/w3stats/w3stats.sqlite` |
| Ingest log | `~/.local/share/w3stats/events.jsonl` |
| Simulation output per game | `~/.local/share/w3stats/sim/out/` |
| Unit/item costs from your install (per game version) | `~/.local/share/w3stats/sim/gamedata/<version>/` |
| Simulation engine and its map data | `~/Projects/w3stats/vendor/wc3v` (`mapdata/`, `client/maps/`, `helpers/UnitBalance.json` are generated there) |
| Pro reference games (W3Champions downloads, own database, `profile.json`) | `~/.local/share/w3stats/reference/pros/` |
| Game-data extractor | podman image `localhost/w3stats-casc` (reads your install through a throwaway overlay; never writes to it) |
| Settings | `~/.config/w3stats/config.json` |
| Background service | `~/.config/systemd/user/w3stats-collector.service` (logs: `journalctl --user -u w3stats-collector`) |
| Commands | `~/.local/bin/w3stats`, `~/.local/bin/w3stats-desktop` |
| Icons | `~/Desktop/w3stats.desktop`, `~/.local/share/applications/w3stats.desktop`, `~/.local/share/icons/hicolor/scalable/apps/w3stats.svg` |
| Folder it watches (read-only) | `~/Games/battlenet/drive_c/users/steamuser/Documents/Warcraft III/BattleNet/*/Replays` |

## Behaviour

- **When Warcraft III starts:** the window opens behind the game without taking focus.
- **After each analyzed game:** a notification appears; click it to open the report.
- **Turning both off:** Settings in the app (this restarts the collector).
- **Kept but not counted:** custom maps, games against AI, team games and games you only observed are archived and listed under **Skipped**.
- **A known game saved again:** saving a replay under a name ("Macro_loss") links it to the game that is already archived. The name becomes that game's label.

## Pro comparison

The collector downloads public replays of Human players rated 2400+ MMR from W3Champions and analyzes them locally with the same pipeline.

- **Download pace:** one replay every 10 s, at most 15 per run, and it stops at the first "slow down" answer.
- **Schedule:** it tops up every 6 hours until it has 50 games, then refreshes weekly. It never downloads while Warcraft III is running.
- **Patch:** only games from your current patch (replay build) are kept.
- **In the app:** charts show the pros' median and middle 50% in grey, and tables show where you stand.

Matchup-specific numbers are used when the pros have 10 or more games of that matchup; otherwise all matchups are combined.

## Which metrics matter

Metrics are split into three sections:

| Section | What it holds | Verdicts |
|---|---|---|
| **Core** | Metrics that separated winners from losers in pro games and yours: workers, hero experience and level timing, creeping by 6:00, gold collected, units killed, trades, unused supply, base defenses, hero deaths, expansions | Green/yellow/red |
| **Mechanics** | APM, hotkeys and control groups. These show skill level, but don't decide single games. | None |
| **Details** | Everything else | Collapsed by default |

W3Champions games also get the game's own end-of-game stats (gold and lumber collected, experience, units killed, upkeep lost, …), marked "official". These replace our estimates.

## Limits

A replay records *commands*, not game state. So:

- Build times are when the order was given, cancelled orders included.
- Heroes are timed by their first learned skill.
- Results come from leave records. Each result shows its confidence, and you can override it.
- **Economy rows are reconstructed by simulation.** How reliable each one is:
  - **Spending:** your orders priced with the game's own costs (cancelled orders still count).
  - **Workers, supply, camps, hero levels:** from the simulation.
  - **Losses and trades:** marked **≈**, because deaths are inferred.
  - **Mined income and unspent resources:** marked **≈**. They come from a mining model calibrated on your games and are shown for the first 10 minutes only.
- **After a game patch:** run `scripts/extract-gamedata.sh` so costs match the new balance.

## Development

`npm test` · `npm run typecheck` · `npm run build` (desktop app) · data format: [docs/DATA.md](docs/DATA.md).
Test fixtures are your own replays in `fixtures/replays/` (git-ignored).

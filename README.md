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
| `w3stats ref` | Pro reference games: status. `ref refresh [--target N]` updates them (same as "Update pro games"), `ref profile` rebuilds the statistics |
| `w3stats ai <game\|latest>` | AI analysis of one game with the local model (same as the button in a match). `--facts` prints what the model would get |

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
| Pro reference games (own database, `profile.json`), one folder per race | `~/.local/share/w3stats/reference/pros/` (Human), `pros-orc/`, `pros-undead/`, `pros-nightelf/` |
| Maps downloaded for tournament games | `~/.local/share/w3stats/maps/` |
| Game-data extractor | podman image `localhost/w3stats-casc` (reads your install through a throwaway overlay; never writes to it) |
| AI analyses (review + everything the model was given) | `~/.local/share/w3stats/ai/<game>.json`, model server log `ai/server.log` |
| Local model (not part of W3Stats) | `~/models/unsloth/gemma-4-26B-A4B-it-GGUF/` (model, MTP drafter, chat template), run by `~/.local/bin/llama-server` |
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

Your numbers are compared with 50 games per race of tournament players, analyzed locally with the same pipeline.

- **Updating:** only when you ask, with **Update pro games** in Settings or `w3stats ref refresh`. Nothing downloads in the background.
- **Source:** [warcraft3.info](https://warcraft3.info/replays/), a community archive of tournament replays. A game counts when it's 1v1, at least 3 minutes long, and the player has a curated profile on the site (tournament players) and played your race. At most 5 games per player, so one pro doesn't dominate. The first 43 Human games came from the W3Champions ladder (2400+ MMR) before the switch.
- **Download pace:** one replay every 3 s, at most 120 looked at per update. It stops at the first "slow down" answer.
- **Maps:** tournaments often play map versions you don't have. These are downloaded from warcraft3.info, checked against the checksum in the replay, and stored in `~/.local/share/w3stats/maps/`, never in your game folder.
- **Patch:** only games from your current patch (replay build) are kept; older ones are dropped at the next update.
- **In the app:** charts show the pros' median and middle 50% in grey, and tables show where you stand.
- **Your race:** you're compared with pros of the race you played. Orc, Undead and Night Elf pro games are only downloaded once you've played that race.

Matchup-specific numbers are used when the pros have 10 or more games of that matchup; otherwise all matchups are combined.

## AI analysis

Each match has an **Analyze with AI** button. It runs on demand only, because it uses most of the graphics card for about 30 seconds.

- **Who decides what:** W3Stats' rules decide what mattered in the game, by comparing with pros and spotting windows the opponent left open. They also write the opponent's plan from their orders. The local model only writes the review around those findings.
- **Why it works this way:** tested on its own, Gemma 4 26B restated facts correctly but couldn't tell what decided a game, and it gets unit facts wrong.
- **Checking:** every number in the review is checked against the data the model was given. Each finding shows its evidence.
- **Model:** set in the `ai` section of the settings file: `llama-server` path, model, MTP drafter, chat template, port 8089, extra arguments. W3Stats starts the server when needed and stops it after 10 idle minutes or when the window closes. A server you started yourself with the same model on that port is reused.
- **While Warcraft III runs:** the button warns you, since the model takes most of the graphics card's memory.

## Which metrics matter

Metric tables have four parts:

| Section | What it holds | Verdicts |
|---|---|---|
| **Core** | Workers, hero experience and level timing, 2nd and 3rd hero, Keep and Castle timing (named by your race), creeping by 6:00, gold collected, units killed, trades, unused supply, base defenses, hero deaths, expansions | Green/yellow/red where a direction is clearly better. Timings that depend on strategy (heroes, tiers) are compared without a colour. |
| **Upgrades** | Your race's attack and armor upgrades level by level, then other research. For each: your timing, the pros' median timing, and the share of pro games that research it. | None |
| **Mechanics** | APM, effective APM, useful actions, hotkeys, control groups, supply blocked | Green/yellow/red |
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

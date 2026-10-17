# W3Stats

Local Warcraft III replay archive and stats. A background service saves every replay the moment a game ends, before `LastReplay.w3g` is overwritten. It analyzes 1v1 games against humans: Battle.net ladder, W3Champions, and custom lobbies on melee maps. A desktop app shows each match and your overall performance. Nothing leaves this PC.

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

To remove everything, run `w3stats uninstall --purge`, then delete `~/Projects/w3stats`.

## Where everything lives

| What | Path |
|---|---|
| Source code | `~/Projects/w3stats` |
| Archived replays (originals, never modified) | `~/.local/share/w3stats/archive/YYYY/MM/` |
| One JSON record per game | `~/.local/share/w3stats/games/` |
| Raw parser output per game | `~/.local/share/w3stats/raw/` |
| Database (rebuildable) | `~/.local/share/w3stats/w3stats.sqlite` |
| Ingest log | `~/.local/share/w3stats/events.jsonl` |
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

## Limits

A replay records *commands*, not game state. So:

- There is no gold, lumber, kill or army-value data.
- Build times are when the order was given, cancelled orders included.
- Heroes are timed by their first learned skill.
- Results come from leave records. Each result shows its confidence, and you can override it.

## Development

`npm test` · `npm run typecheck` · `npm run build` (desktop app) · data format: [docs/DATA.md](docs/DATA.md).
Test fixtures are your own replays in `fixtures/replays/` (git-ignored).

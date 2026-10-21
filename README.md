<p align="center"><img src="apps/desktop/assets/icons/128.png" width="128" height="128" alt="Replay Altar icon"></p>

<h1 align="center">Replay Altar</h1>

Replay Altar is a Warcraft III: Reforged replay analyzer for 1v1 players. It runs on your own computer, keeps every game you play, and after each one tells you what decided it and what to do differently next time, compared with tournament players of your race.

[Download](https://github.com/bubunuh/replay-altar/releases)

- **Every replay kept.** A small background program saves each replay the moment a game ends, before the game overwrites `LastReplay.w3g`. Battle.net ladder, W3Champions and custom melee games are all picked up.
- **The game reconstructed.** Each 1v1 is simulated from its replay with [WC3V](https://github.com/jblanchette/wc3v): workers, army value, supply, creep camps, hero levels and fights over time.
- **Compared with pros.** Your numbers are set against about 200 recent tournament games per race, played on your current patch and analyzed on your computer the same way.
- **A report per game.** Rules drawn from well-known guides (Grubby, Liquipedia, Warcraft 3 Gym, Vortix and others) point out the main problems, the facts behind them, the fight that turned the game, your strengths and the opponent's plan. Each finding comes with concrete advice.
- **Your progress.** Win rates by matchup, map and game length; problems that keep coming back; how you play in wins against losses; any number over time.
- **English and Brazilian Portuguese.**

![The report of a game: result, heroes, the main numbers against the opponent, the map, and the findings with advice](docs/images/report.png)

Your games stay on your computer. The only thing Replay Altar fetches from the internet is the game's own end-of-game statistics for your W3Champions games. The pro statistics come with the app.

> Replay Altar is a fan project. It is not affiliated with, endorsed by or connected to Blizzard Entertainment. Warcraft is a trademark of Blizzard Entertainment, Inc. The game's data and pictures (unit costs, race crests, hero portraits, the game's font) are read from your own Warcraft III installation, never modified there, and never distributed with this project; the screenshots on this page only show them as the app displays them.

## Install

### Windows 10 or 11

1. Download `ReplayAltar-Setup-<version>.exe` from the [Releases](../../releases) page.
2. Run it. Windows will probably warn that it protected your PC, because the installer isn't digitally signed yet: click **More info**, then **Run anyway**.
3. The installer needs no administrator rights and asks nothing. It installs for your user, adds a Start menu and desktop shortcut, and opens the app.

On the first start, in the background, Replay Altar reads the data it needs from your Warcraft III installation, finds your battletag from your replays and imports the replays you already have. The list of games fills in by itself after a few minutes. From then on it starts with Windows and picks up each game as it ends.

- **Replays somewhere else?** It finds the game's `Documents\Warcraft III` folder by itself, OneDrive included. If yours is elsewhere, use **Settings → Replay folders → Choose folder…**.
- **Something wrong?** The log is in `%LOCALAPPDATA%\replay-altar\logs\collector.log`.
- **Uninstall:** Settings → Apps → Replay Altar. Your games and statistics stay in `%LOCALAPPDATA%\replay-altar`; delete that folder to remove everything.

### Linux (Battle.net under Wine or Lutris)

Replay Altar runs from a checkout of this repository. You need [Node.js](https://nodejs.org) 26 or newer, git and [podman](https://podman.io) (the game's data is read inside a container, through a throwaway overlay, so the game folder is never written to).

```sh
git clone --recurse-submodules https://github.com/bubunuh/replay-altar.git ~/Projects/replay-altar
cd ~/Projects/replay-altar
npm install
npm run build
node apps/collector/src/cli.ts setup-sim   # simulation engine and game data from your install
node apps/collector/src/cli.ts install     # background service, `replay-altar` command, desktop icon
```

`install` sets up a systemd user service that starts at login, adds `replay-altar` and `replay-altar-desktop` to `~/.local/bin`, creates a desktop icon and imports your existing replays.

The default game location is the Lutris Battle.net prefix in `~/Games/battlenet`. For another location, pass the Warcraft III folder to `node scripts/extract-gamedata.ts <folder>` and add your replay folder in Settings.

## Using it

- **Matches:** every analyzed game, with its main problem. Open one for its report, charts, key numbers against pros, the build orders and a map of the fights and each player's creeping.
- **Performance:** your win rates, recurring problems with the one to work on now, and your numbers in wins, losses and against pros.
- **Settings:** your battletags, language, replay folders, notifications, and which pro games your numbers are compared with.

Custom maps, games against the computer, team games and games you only observed are kept in the archive but not counted.

Player names in these screenshots are replaced with placeholders.

**Matches**

![The list of games with result, matchup, opponent, map, length, APM, source and main problem](docs/images/matches.png)

**A game over time:** army value, hero levels, resources, workers, supply and APM, against the pro median.

![Charts of one game over time, both players against the pro median](docs/images/charts.png)

**Performance**

![Win rate, recurring problems and win rates by matchup, map and game length](docs/images/performance.png)

**Settings**

![Settings: battletags, language, replay folders, behaviour and pro games](docs/images/settings.png)

When Warcraft III starts, the window opens behind the game without taking focus, and a notification after each game opens its report. Both can be turned off in Settings.

### Commands (Linux, or a Windows checkout)

| Command | What it does |
|---|---|
| `replay-altar status` | Is the collector running, plus your last 10 games |
| `replay-altar suspend` / `resume` | Stop the collector and keep it from starting at login / start it again (it catches up on saved replays) |
| `replay-altar scan` | Import every replay in the game folders now |
| `replay-altar override <game> win\|loss` | Fix a wrong result (`<game>`: the first characters of the game key, or `latest`) |
| `replay-altar reingest` | Rebuild all statistics from the archived replays (after an update or a settings change) |
| `replay-altar report <game\|latest>` | The report of one game; `--facts` prints every number behind it |
| `replay-altar export --jsonl` / `--md latest` | Your data for a script or a spreadsheet |
| `replay-altar sim` | Simulation status; `--backfill`, `--retry-failed`, `--rerun`, `--resummarize` |
| `replay-altar official` | Fetch W3Champions' end-of-game statistics for games that lack them |
| `replay-altar uninstall [--purge]` | Remove the service, commands and icons; `--purge` also deletes your archive, statistics and settings |

### Where things are

| What | Linux | Windows |
|---|---|---|
| Archived replays (originals, never modified), game records, database, simulations | `~/.local/share/replay-altar/` | `%LOCALAPPDATA%\replay-altar\` |
| Settings | `~/.config/replay-altar/config.json` | `%APPDATA%\replay-altar\config.json` |
| Background service | systemd user unit `replay-altar-collector.service` | started at login from `HKCU\…\CurrentVersion\Run` (`ReplayAltarCollector`) |
| Collector log | `journalctl --user -u replay-altar-collector` | `%LOCALAPPDATA%\replay-altar\logs\collector.log` |
| Pro games (one folder per race) | `…/replay-altar/reference/` | `…\replay-altar\reference\` |

## How the analysis works

- **From the replay:** a replay records commands, not the game's state. Build times are when an order was given (cancelled orders included), and heroes are timed by their first learned skill. Results come from leave records; each shows its confidence and can be corrected by hand.
- **From the simulation:** workers, supply, army value, creep camps and fights come from WC3V's reconstruction of the game. Values marked ≈ are estimates: losses and trades (deaths are inferred), and the mined-income model, shown for the first 10 minutes only.
- **Official numbers:** for W3Champions games, the game's own end-of-game statistics (gold and lumber collected, experience, units killed, upkeep lost) replace the estimates and are marked "official".
- **Pro games:** about 200 recent tournament games per race from [warcraft3.info](https://warcraft3.info/replays/), collected by the maintainers rather than by each copy of the app, so the site gets one slow download per game instead of one per user. They are 1v1 games of at least 3 minutes by players with a curated profile, on the current patch, at most 20 per player, downloaded one every 3 seconds and analyzed the same way as yours. Only the resulting statistics are published, in `data/reference/`, and they are updated with new versions of Replay Altar.
- **Verdicts:** the main numbers get a colour: green at or above the pro median, yellow when at least as good as your opponent, red below both. Timings that depend on strategy (tier, heroes, expansions) are compared without a better or worse.
- **Findings:** [docs/RULES.md](docs/RULES.md) lists every rule, where it comes from and how well it separates pro losses from pro wins. [docs/PRINCIPLES.md](docs/PRINCIPLES.md) holds the milestones mined from the pro games; [docs/DATA.md](docs/DATA.md) describes the data format.

After a game patch, run `node scripts/extract-gamedata.ts` and `node scripts/extract-combat.ts` (Linux checkout) so unit costs and combat data follow the new balance, then update the pro games. The Windows version reads the game data again by itself.

## Development

```sh
npm test               # vitest
npm run typecheck
npm run build          # the desktop app (apps/desktop/out)
npm start -w @replay-altar/desktop
node apps/desktop/package-windows.ts   # Windows installer (built on Linux; needs wine on PATH)
```

The code is TypeScript run directly by Node (type stripping), in npm workspaces:

| Package | What it holds |
|---|---|
| `packages/core` | Replay parsing ([w3gjs](https://github.com/PBug90/w3gjs)), classification, metrics, the database, settings, languages |
| `packages/sim` | The WC3V simulation and the economy model |
| `packages/reference` | Pro games: download, profiles, comparisons |
| `packages/rules` | Findings, advice, the report, build-order matching |
| `apps/collector` | The background collector and the `replay-altar` command |
| `apps/desktop` | The Electron app |

`fixtures/replays/` holds real replays used by the tests. Texts are written in place as `tr("English", "Português")` pairs (`packages/core/src/i18n.ts`).

### Updating the pro statistics (maintainers)

From a Linux checkout with the simulation set up, not while playing:

```sh
replay-altar ref refresh --all     # download and simulate current-patch tournament games, slowly
node scripts/mine-principles.ts    # milestones and builds mined from them
replay-altar ref publish           # copy each race's profile.json and principles.json into data/reference
```

Then commit `data/reference/` and build a new installer. `replay-altar ref` shows the status of each race.

## Credits and sources

Replay Altar stands on other people's work, all of it freely available.

**Software**

- [WC3V](https://github.com/jblanchette/wc3v) by jblanchette: the game simulation (GPL-3.0), included as a git submodule.
- [w3gjs](https://github.com/PBug90/w3gjs) by PBug90: replay parsing (MIT).
- [CascLib](https://github.com/ladislav-zezula/CascLib) by Ladislav Zezula: reading the game's data files (MIT).
- [Electron](https://www.electronjs.org), [React](https://react.dev), [Apache ECharts](https://echarts.apache.org), [Vite](https://vite.dev), [esbuild](https://esbuild.github.io), [electron-builder](https://www.electron.build).
- [UnifrakturCook](https://fonts.google.com/specimen/UnifrakturCook) font by j. 'mach' wust and Peter Wiegel (SIL Open Font License, `apps/desktop/src/renderer/fonts/`).

**Data**

- Tournament replays and maps: [warcraft3.info](https://warcraft3.info). Only statistics computed from them are published; the replays and maps are never redistributed.
- End-of-game statistics: [W3Champions](https://w3champions.com).

**Guides and build orders.** The findings and advice follow these guides, and `data/builds/` holds build orders transcribed from them (food counts and steps, with a link to each source):

- [Liquipedia Warcraft](https://liquipedia.net/warcraft): build-order pages, and the pages on experience, creeps, upkeep and races. Liquipedia's text is licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/); the transcribed build orders in `data/builds/liquipedia.json` are shared under the same terms.
- [Warcraft 3 Gym](https://warcraft-gym.com): guides and build orders by GotQuail, Gym Coaches, AllSupGoToHeaven, Kaiser, randombadgamer, HoT and others.
- Grubby (GrubbyTalks on YouTube, [followgrubby.com](https://followgrubby.com)): the beginner series and race guides, and the build orders shared on his Discord.
- [Vortix](https://www.youtube.com/channel/UC4MGzV7ahAN1khnzdjp3rkw): commented games and general tips.
- carsoNNN's creeping guides, Back2Warcraft, warcraft3.info's "How To Basic" race guides, StrategyWiki, and Blizzard's Warcraft III basics pages.

## License

Replay Altar is free software under the [GNU General Public License v3.0](LICENSE), the license of WC3V, which it includes. The build orders transcribed from Liquipedia are under CC BY-SA 3.0, as above.

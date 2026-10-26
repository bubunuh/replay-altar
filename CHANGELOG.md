# Changelog

What changes for players in each version. Work happens on `dev`; a version is made from `main`
(see README, "Branches and builds"). Research scripts, experiments and the data they use are not
part of a version: an installer ships only the app, the simulation engine and the published pro
statistics (`data/`).

## Unreleased (next version, 0.2.2)

Nothing done yet. Planned:

- **More accurate simulation (our improved WC3V):** WC3V now reads the replay's own selection lists,
  so it knows which units really exist and when they die; a train click with several buildings
  selected trains in each of them. Measured against Warcraft III's own unit counts on 15 games it
  was not developed on, the army value error fell from 181 to 103 (Replay Altar today: 158). Comes
  with re-simulating every game (yours on the update, the pro and tournament games before the
  release), republishing the pro statistics, and refitting the evaluation curve's model on the new
  numbers so the curve and your games are measured the same way (the full review is for 0.2.3).
  Before merging: check whether Replay Altar's own death correction (`deaths.ts`) still helps on
  top, and look at the two hidden games that got worse (batch3-11, batch3-06 Ventus).
- **Nothing is imported until you ask** (tester feedback after 0.2.1): on the first start, if
  replays are found, the match list offers *Import 50 replays* and *Import all replays (N)*, and
  nothing loads by itself.
- **Choose whether Replay Altar keeps running after you close it** (tester feedback): a setting,
  off by default. When off, closing the window stops the background collector, and new games are
  picked up the next time you open the app (the game keeps them in Replays and Replays/Autosaved;
  only an overwritten `LastReplay.w3g` is missed).

### To check for 0.2.2 (untested)

Suggestions from SaulApeMan's replay project (via Discord, 2026-10-25). None of these is verified
in Replay Altar yet except where noted; each goes into 0.2.2 only if a test on our replays shows
it matters.

- **Broken W3Champions/FLO replays:** since the 19 Oct 2026 patch some FLO replays lack the players'
  first selections (the first orders come before any selection) and desync in the game from the
  start, so every number from them is wrong. Proposed check: a player's first order before their
  first selection → mark the game broken and skip it; also W3C files with header build 7000 dated
  after 19 Oct 2026. *Partly checked:* on 30 ladder/tournament replays the check flagged exactly the
  2 that played broken in the game, and no others.
- **Hero levels after a Tome of Retraining:** `heroxp.ts` may drop real skill picks (players
  re-spend 4–6 points within a second, sometimes the same skill twice). Proposed: picks between two
  openings of the skill menu are one session.
- **Units per selected building:** one train click queues a unit in every selected building of
  that type, so units ordered, production and the spending priced from orders may be undercounted.
  The WC3V lab found and fixed the same thing inside WC3V; Replay Altar's own counts from w3gjs
  orders still count one per click. Also merge variant codes of one unit (hmtt/hrtt, ohun/otbk,
  hpea/hmil, edoc/edcm, edot/edtm, ucry/ucrm, ugar/ugrm, ospw/ospm, Nalc/Nalm/Nal2, Edem/Edmm).
- **Cancelled altar orders:** a hero ordered and cancelled within its training time never existed,
  but may shift hero timings, the hero count and the one-hero rule.
- **Lobby password:** tournament replays may carry a password after the game name, which could
  misalign the lobby records if w3gjs doesn't read it.
- **Truncated last record** (FloTV recordings end mid-record): tolerate it instead of failing the
  import.
- Already fine, nothing to do: hero revives (the hero timelines already use the revive order);
  "selections via hotkey" already compares group recalls with mouse selections, the only
  distinction the replay allows.

## 0.2.1 (2026-10-23)

- **Big replay folders:** the first start imports only your newest 50 replays, so your latest games show up within seconds. At the end of the match list, *Import 50 more replays* and *Import all replays* bring in the older ones. Replays are read one at a time (they were all read at once, which filled the memory), and a scan no longer reads replays it already imported.
- **The window stays usable while games are imported:** it refreshes the lists at most every 3 seconds instead of after every game, an open report reloads only when its own game changed, and the findings of the match list are worked out once per game instead of all again after every import (500 games took 8 seconds each time; the pro statistics are now read once instead of for every game).
- **No more blank window:** a page that hits an error shows a message with *Report a bug*, and the error goes to `window.log` next to the collector's log; a crashed window is written down there and reloaded.
- Findings show large numbers rounded (a pros median of 1160.5 XP now reads 1161).

## 0.2.0 (2026-10-23)

- **Windows: the simulation works.** The Windows builds up to 0.1.3 shipped a Linux part of the map reader, so no map could be prepared and every simulation failed (no army, fights, map picture or evaluation curve). Games that failed this way are simulated again by themselves after the update.
- **Updates keep the game data:** after an update Replay Altar puts back the unit table it had already read from your game, instead of reading the game again.
- **Clearer failures:** a simulation that fails now records the actual error, not the command that was run.
- **Updates are easier to see:** a banner at the top of the window says when a new version is out (before, only a small "!" on the Settings tab), and while the update installs the window says what happens and the installer shows its progress, instead of the app vanishing for a minute.
- **First start:** until you confirm your battletag, the match list says how many replays are waiting for it; choosing "No, I'll type mine" opens Settings with the battletag field ready to type in (Enter saves).
- **Small windows:** the report's heading switches to one column when the report is narrow, so the map is no longer cut off at the right.
- **Small fixes:** after you change your battletag, reports no longer show the old side's findings until reopened; "your heroes levelled faster than theirs" is only said when the timed numbers agree; the pros' band on time charts stops where your game ended (short games are no longer squeezed into a 40-minute axis); each page opens at its top; "1 game analyzed"; on Windows, Settings explains how to uninstall instead of showing commands.
- **More accurate army value and losses.** A replay records no deaths, so they are reconstructed. They now also use what the replay does record: whenever a player switches selection, the game writes down which units were really selected, and dead units are already missing. Before, the opponent's new units could count as lost the moment they were trained, and units lost in a fight could stay alive. Checked against Warcraft III's own unit counts on 50 recorded player-games, the army value error fell by about 29% (by far the most for players the simulation followed poorly). Losses, trades and fight results in the report and on the map use the same counting, and so does the pro comparison.
- **Undead:** an Obsidian Statue is no longer valued as a Destroyer before it transforms.
- **More games simulate to the end:** two fixes to WC3V (reviving a hero that used a Town Portal; training from a building WC3V hadn't seen being built). On the pro games, 16 of 518 were cut short before. The pro comparison now uses 513 games.
- **Some replays that could not be imported now can** (a hero the replay reader reports without a type).
- **Evaluation curve** on each game's page, drawn like a chess evaluation graph (blue while you were ahead, red while your opponent was): how often a pro in your position went on to win, moment by moment, with the three moments that swung it most, what moved them (losses, hero experience, workers, army, expansions, heroes alive, upgrades) and what happened then. Learned from 513 pro games and checked on 2,998 tournament games from 2022 to 2026 it never saw; the method is in [docs/win-chance/report.pdf](docs/win-chance/report.pdf).
- **Comparisons with pros on about eight times more games:** about 1,700 player-games per race instead of about 200. The current patch's pro games are pooled with about 3,000 tournament games from 2022 to 2026 (older patches, players from semi-pro to the very top). The findings' thresholds and the mined principles use the same pool, and every rule was scored again on it, held out, with the WC3V fixes and the new army counting (docs/RULES.md).
- **Findings you can trust more:** the Findings card now shows only the rules that, tested on 3,388 player-games they were not tuned on, fire clearly more often in losses than in wins (11 rules). The others are hidden for now.
- **Control groups and hotkeys:** the old "speed and hotkeys" finding is replaced by a check that appears whenever you played without control groups or hotkeys, win or lose, with a first habit to start with.
- **Your battletag is never guessed:** on the first start Replay Altar looks for the battletag in most of your replays and asks you to confirm it (or to pick between two, when a frequent opponent shows up as often), or to type yours in Settings. Before, it set the guess silently, and a frequent opponent could be taken for you. Changing your battletag in Settings now sorts your games again by itself (no command needed).
- **A note on the game's charts** that army value, losses and fight results are estimates, with how far off they typically are and how that was measured.
- **Linux AppImage**, alongside the Windows installer: one file, no Node, git or podman needed. On first start it sets up the background collector (a systemd user service), the `replay-altar` command and a menu entry, reads the game data with a built-in read-only extractor, and updates itself in place like the Windows version.
- **Linux: Battle.net is found in more places:** Lutris folders under `~/Games`, `~/.wine`, Steam's Proton prefixes and Bottles, for both the replays and the game data.

## Planned for 0.2.3

- **Gold and lumber in WC3V:** the biggest error left in the new WC3V is train orders the game
  refused for lack of gold, lumber or food, which WC3V still turns into units (worst with Night Elf
  Druid spam). A gold and lumber model inside the simulation would tell them apart. The observer
  recordings already hold gold, lumber, gold mined and lumber harvested at every snapshot, so they
  serve as ground truth; more recordings (more races, expansions, long games) as needed.
- **Review the evaluation curve and the coaching rules on the better data:** refit the win-chance
  model on the ~500 current-patch pro games and validate it on the ~3,000 tournament games, as for
  0.2.0; re-score every rule held out (docs/RULES.md) and revisit which are shown.

## Later

- **macOS:** woodmanhu's plan (docs/MACOS_SUPPORT_PLAN.md, PR #2) and first code step (PR #3, data
  folders and replay discovery) are merged into `dev` (2026-10-26); they change nothing on Windows
  or Linux and are untested on a Mac. A Mac build needs the rest of the plan (game process detection, start at login, a macOS game data
  extractor, packaging, unsigned) and someone with a Mac to test each step.

- **Re-simulate every game with WC3V's merged fixes:** once the WC3V author has merged the revised fixes (#19, #21), switch Replay Altar's patches to the merged code and simulate all pro, tournament and your games again (about half an hour at full CPU). Measured beforehand: findings unchanged, the evaluation curve moves by more than half a point in 4% of games (6 points at most).
- **Findings by skill level:** download ladder games across skill levels (W3Champions, by MMR) and choose and tune the findings for the level detected for each player, so beginner checks (upkeep, supply, towers…) show where they matter and stay hidden for strong players.
- **More languages:** German, Ukrainian, Russian, Chinese and Korean (needs a text format that scales past four languages, and fonts for Cyrillic, Chinese and Korean).
- **Code signing:** SignPath turned the project down for now (too new, no reputation); try again later.

## 0.1.3 and earlier

See the [GitHub releases](https://github.com/bubunuh/replay-altar/releases).

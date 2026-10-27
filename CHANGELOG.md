# Changelog

What changes for players in each version. Work happens on `dev`; a version is made from `main`
(see README, "Branches and builds"). Research scripts, experiments and the data they use are not
part of a version: an installer ships only the app, the simulation engine and the published pro
statistics (`data/`).

## Unreleased (next version, 0.2.2)

- **Nothing is imported until you ask** (tester feedback after 0.2.1): on the first start, if
  replays are found, the match list offers *Import 50 replays* and *Import all replays (N)*, and
  nothing loads by itself. The games you play from then on are added as before.
- **Your games are imported again after the update, when you ask:** 0.2.2 reads and simulates
  games differently (new numbers, the replay checks below, the new simulation), so instead of
  reading every game again by itself, the match list starts empty, as on a new install, with
  *Import 50 replays* and *Import all replays (N)*. N counts every replay Replay Altar can find:
  the ones in your replay folders and the copies it keeps of every game it imported, which for
  games whose `LastReplay.w3g` was overwritten are the only ones left (and of replays an older
  version couldn't read, which this one may); a copy of a replay that is still in your folders
  counts once. Games imported again keep their date, a result you corrected
  by hand and their W3Champions statistics (not asked for again). Your settings, battletag, game
  data and maps stay; the previous database stays in one backup file
  (`replay-altar.previous.sqlite` in the data folder). The games you play after the update are
  added by themselves. Later versions that change the analysis will do the same.
- **The match list in pages of 100:** with thousands of games the list took one to two seconds
  to redraw at every change (a filter, a search, each game imported), and the "Main problem"
  column took about a minute to fill in. Now it shows 100 games per page, newest first, with page
  buttons above and below; the filters, the search, the problem counts and the number of games
  still take every game, a filter goes back to the first page, and new games coming in don't move
  you off your page. On 5,000 games, a change now redraws in about 16 ms and the "Main problem"
  column fills in about 2.5 s.
- **W3Champions statistics are looked for again at start:** a game whose end-of-game statistics
  weren't on W3Champions yet is tried again 10 minutes and 1 hour later, but those tries were lost
  when Replay Altar went back to waiting or was closed. Now, when it starts, the games of the last
  three days still without them get their remaining tries, one game at a time and a few seconds
  apart as before, with a long pause if W3Champions asks to slow down.
- **Choose when Replay Altar runs in the background** (tester feedback): Settings → Behaviour has
  three choices. *Only while Warcraft III is running*, the new default (also when you update): a
  light program starts when you log in and only waits for the game; while you play it saves each
  replay as the match ends, and once you close the game it simulates the new games, then goes
  back to waiting. *Always*: awake all the time, as before. In every mode the simulations now wait
  until you close the game, so they no longer slow down your next match. *Off*: nothing starts
  when you log in and closing the window stops Replay Altar; new games are picked up the next time
  you open it (the game keeps them in Replays and Replays/Autosaved; only an overwritten
  `LastReplay.w3g` can be missed), and Settings warns about that when you choose it.
- **Damaged W3Champions replays are pointed out:** some W3Champions (FLO) replays lack the players' first selection at the start of the game, and Warcraft III plays them back wrong from the start, so rewatching one shows a different game. The report of such a game now says so. Its numbers stay: Replay Altar reads the players' orders, which are all there (on the two such games with W3Champions' own end-of-game numbers, hero levels matched exactly and the estimates were as close as usual).
- **Hero levels after a Tome of Retraining:** a hero retrained with a tome could end up to four levels too high or too low (30% of the games with a tome), which threw off hero levels, hero experience and the findings about them. Replay Altar now reads the retraining from when the skill menu was opened and the tome bought: on games with W3Champions' own hero levels, 27 of 28 retrained players' heroes now match (25 before).
- **Second and third heroes count in the resources spent:** the gold and lumber spent left out every hero after the first (which is free), so it read about 7% low against the game's own numbers; now 2% (on 176 W3Champions player-games). This also moves the gold collected estimated for Battle.net games.
- **More accurate army value, losses and fights (our improved WC3V):** the simulation now reads the replay's own selection lists, so it knows which units really exist and when they die, and a train click with several buildings selected trains in each of them. Measured against Warcraft III's own unit counts on 14 recorded games it was not developed on, the army value is off by 84 on average over a game instead of 143, typically by about 20% instead of 37%, and in fights in which a side lost 300 or more, the side that lost more is named wrongly in 18% of them instead of 31%. A unit seen in another form (a Druid of the Claw in bear form, a burrowed Crypt Fiend, a Berserker) counts as the unit trained, train orders the game refused no longer count as units lost, and Militia no longer count as army. Replay Altar's own correction of the deaths, which did part of this after the simulation, is no longer needed and was removed.
- **Hero timelines:** a hero cancelled at the altar and ordered again later no longer appears on the hero chart, and in the build-order comparison, at the time of the cancelled order (and a Demon Hunter or Alchemist the simulation last saw transformed is found again).
- **Cut-short replays can be imported:** a replay file that ends in the middle of the game (FloTV recordings, or a copy made while the game was still running) often couldn't be imported at all. It now is, up to where it ends, and its report says the rest is missing.

Planned:

- **Every game simulated again with the new simulation:** yours as you import them again after
  the update, the pro and tournament games before the release, with the pro statistics republished
  and the evaluation curve's model refitted on the new numbers, so the curve and your games are
  measured the same way (the full review is for 0.2.3). Before the release: the simulation stops
  reading one of the 15 held-out recorded games at 9:24 (batch3-11: a selection the game lists
  right after a deselect is not taken, then an upgrade from an empty selection fails); the fix is
  in the WC3V lab, to come back as one more patch. Also from the lab: games on 60 maps (mostly the
  copies hosted under hashed names, plus a few ATR maps) stopped at 0:01 because their start
  positions were misread (91 of our tournament and ladder replays); the fix needs the patch plus
  the map entries read again, in the installer and in players' saved entries.

### Checked for 0.2.2

Suggestions from SaulApeMan's replay project (via Discord, 2026-10-25), each tested on our replays
(518 pro, 3,370 tournament, 55 review and 101 of your games, and the 176 player-games with
W3Champions' official numbers); what helped is in the list above.

- **Broken W3Champions/FLO replays:** *done* (above). The check as proposed (any order before the
  first selection) also flags normal games, where a player trains a worker from the hall that is
  selected at the start before selecting anything (3 of 518 pro games, 23 tournament
  games); limited to orders in the first 0.5 s it flagged exactly the 4 of 48 recorded replays that
  played wrong (batch 2: 10, 12; batch 3: 16, 17), 5 of 3,370 tournament replays (builds 6117 to
  7003, so not only since the 19 Oct patch), and no pro or review game. "Every number is wrong" does
  not hold for Replay Altar: the orders are complete, so such games stay analyzed, with a note. The
  second check (W3Champions files with header build 7000 dated after 19 Oct 2026) matched no
  replay we have (the 4 broken ones are build 7003), so it wasn't added.
- **Hero levels after a Tome of Retraining:** *done* (above). The problem was w3gjs's retraining
  mark (levels changed in 30% of the 587 player-games with a tome), plus refused extra clicks in
  the re-spend; "the same skill twice" was already handled by the rank rules. The skill menu's
  openings (action 0x66) do bound the sessions, as suggested.
- **Units per selected building:** *not applied, moved to the gold and lumber model (0.2.3).* It
  exists: 9.6% of train clicks (176 W3Champions player-games) had 2 or more buildings of the type
  selected (types from the replay's own subgroup names). But the game refuses the copies it can't
  pay for or feed, and the replay doesn't say which: counted in full, spending − 500 went over the
  official gold collected in 62% of player-games (40% without), up to +54% (21 clicks with 4
  Workshops selected = 84 Siege Engines); capped at 2 per click, still 62%. Measuring it showed
  that heroes were missing from the spending (*done*, above). Variant codes: in Replay Altar's own
  counts only hrtt, otbk and ospm appear in orders, priced and named like their base unit; the
  others come from in-game transformations, which mattered in the death matching (*done*, above).
  The simulation (our improved WC3V, above) does train in each selected building; the copies the
  game refused are its largest remaining error (a Night Elf with two Ancients of Lore, 103 → 302
  per player-game on one held-out game), which the gold and lumber model should fix too.
- **Cancelled altar orders:** the hero count, hero timings and the one-hero rule were never
  affected: they come from skill picks, which a cancelled hero never makes (60 cancels in 47 of
  8,049 player-games, none counted). WC3V, though, makes a hero for every cancelled order (all 44
  checked), and Replay Altar took the first one as the hero: 56 heroes appeared too early, by up
  to 9 minutes (*fixed*, above, with 43 heroes it couldn't find in a transformed form). For the
  WC3V lab: those phantom heroes may also hold 5 food each in WC3V's supply.
- **Lobby password:** *doesn't apply.* w3gjs reads the string after the game name (its
  `privateString`) and skips it. 58 of our 4,024 replays carry one (all "wuyue" tournament lobbies,
  passwords 1011 to 1018), and all 58 read correctly: no metadata warning, both players named,
  map and checksum read, and 56 simulated (one lacks its map, one was never simulated).
- **Truncated last record** (FloTV recordings end mid-record): *done* (above). w3gjs failed on 15%
  of cut points (294 of 1,993 cuts of our 5 test replays), in its last game data record or a block
  header; the others parsed but kept the header's full length. None of our 4,024 replays is cut.
  Unrelated but found on the way: WC3V reports "parse truncated" for 105 complete replays (97
  tournament, 8 review), which is why they have no simulation; w3gjs reads all of them to the end,
  so it's WC3V's own parser (for the WC3V lab).
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
  serve as ground truth; more recordings (more races, expansions, long games) as needed. The same
  model would let Replay Altar's own counts (units ordered, spending, build order) count a train
  click once per selected building, which they can't do safely yet (see 0.2.2's checks).
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

# Data format (for audits and scripts)

All data lives in `~/.local/share/replay-altar/`. The trust order is:

1. `archive/` holds the original `.w3g` files.
2. `raw/` holds the parser output.
3. `games/` holds the derived records.
4. The SQLite DB is a projection of the records.

Each layer can be rebuilt from the one above it with `replay-altar reingest`. The exception is the `annotations` table, which holds human or LLM input and is never rebuilt.

## Per game

`games/<game_key>.json` is defined by the `GameRecord` type in `packages/core/src/record.ts`.

- **`gameKey`:** w3gjs id, `sha256(randomSeed + player names + gameName)`. It is the same for `LastReplay.w3g` and any copy you save of it.
- **`game`:**
  - `playedAt`, `endedAt` and `timeSource`. Replays carry no timestamp. `w3c_filename` is exact (UTC). `lastreplay_mtime` is the game's end time. `saved_file_mtime` is when you saved the copy, which can be later.
  - Also: `durationMs`, map, version and lobby settings.
- **`classification`:** `source`, `category`, `analyzed`, `skipReason`, the seats, `replayProblem` and `rules[]`. Each rule records the check, whether it passed, and the evidence it used.
  - **`replayProblem`:** `missing_first_selections` when a player's orders at the very start (first 0.5 s) come before any selection of theirs. Each client selects its units at the start and sends them their first orders; some W3Champions/FLO replays lost the selection and kept the orders, and Warcraft III then plays them back wrong from the start. Of 48 recorded replays (observer batches 2 and 3) it flagged exactly the 4 that played wrong; it also flags 5 of 3,370 tournament replays and none of 518 pro games or 55 review games. The orders themselves are complete: on the two with official stats, hero levels matched exactly and gold, largest army and units killed were off by no more than on other games, so the game stays analyzed and the report says the replay is damaged. A player whose first order (a worker from the hall that is selected at the start) comes before their first selection, but later than 0.5 s, is normal.
  - **`replayProblem: truncated`:** the file is cut short (FloTV recordings end in the middle of a record, and so does a copy made while the game was still writing it). w3gjs failed on 15% of cut points (it reads past the end of its last record); Replay Altar stops at the last complete record instead, and the game's length becomes where the data ends (the header keeps the whole game's). The data of a complete replay never ends before its header's length (4,024 of our replays), so data ending more than 1 s earlier also counts as cut. None of our replays is cut. The report says where the file ends.
- **`result`:** the winning team and your result. `method` is one of:
  - `leave_victory` (high confidence)
  - `leave_game_over` (high)
  - `first_leaver_lost` (medium)
  - `none`

  The record also keeps the raw leave codes as evidence.
- **`players[]`:** you first, then your opponent. Each player has `metrics`, `apmPerMinute`, `heroes[]` (skill order with times), `build[]` (every order with its time), action counts and control groups.
- **`provenance`:** every file this game was seen as (path, sha256, mtime), the archive path, the parser version, the classifier and metrics versions, and the first ingest time.
- **`sim`** (once simulated): `status` `ok` or `failed` (with a `reason`). When `ok` it also has:
  - **Run details:** WC3V `engine.commit` (the submodule's commit; the changes in `patches/wc3v/` come on top of it), `gameData` (version and manifest hash), `model` (income-model version and constants), and `outputPath`, the full WC3V output kept for audit.
  - **`warnings`:** model checks, such as spending more than the model says was mined in the first 10 minutes.
  - **`players[]`:** each with `parseConfidence`, `validationWarnings`, `metrics`, and `series[]`, sampled every 10 s:

    | Field | Meaning |
    |---|---|
    | `t` | Game time in ms |
    | `goldSpent`, `lumberSpent` | Cumulative spending |
    | `goldLost`, `lumberLost` | Cumulative value lost (deaths are inferred) |
    | `foodUsed`, `foodMax` | Food used and food cap |
    | `workers` | Workers alive |
    | `estGoldMined`, `estLumberMined` | Estimated income so far (income model) |
    | `estGoldBank`, `estLumberBank` | Estimated unspent resources (income model) |

## Metrics

Defined once in `packages/core/src/metrics.ts` (`METRICS`). The same definitions are in the DB table `metric_defs` and in every export. Values are `null` when the event never happened (for example tier 3 not reached) or when the game has no simulation.

Each metric's `source` says how much to trust it:

| `source` | Where it comes from | Shown as |
|---|---|---|
| `replay` | Counted from the replay's commands. Times are when the order was issued. | plain value |
| `simulation` | WC3V's reconstruction of the game: workers alive, food, tier completion, camps, hero levels. Spending is our pricing of the replay's orders. | plain value |
| `estimate` | Inferred deaths (losses, trades) or the income model. | **≈** prefix |

## Hero experience (replay)

- **Repeated building orders:** re-issuing a build order re-places the same building, so the same building ordered again within 5 s counts once (build lists and building metrics; checked against the buildings the simulation placed). Training clicks are not merged: each one queues at least one unit (one in each selected building of that type; see Spending).
- **Level-ups:** each level gives one skill point, so skill-pick times are the level-up times. The replay also keeps clicks the game refused (e.g. clicking a skill 12 times), so a pick only counts if the hero could learn that rank: ranks 1/2/3 at hero level 1/3/5, ultimates once at level 6. Against official XP on 58 player-games: correlation 0.95, median error 121 XP.
- **Retraining (Tome of Retraining):** the re-picks are not level-ups. The replay records each opening of a hero's skill menu, and picks come in these sessions; a retraining is the first session after a tome's purchase (within 5 minutes) in which one hero picks 2 or more skills. Up to the hero's level of its picks in the next minute are re-picks, and further clicks in that same session were refused (no points left). w3gjs's own retraining mark gave wrong levels in 30% of the 587 player-games with a tome: inserted before real level-ups (26% of marks) or missing (50 player-games), which gave heroes up to 4 levels too many or too few. On the 13 such player-games with W3Champions' per-hero levels, 27 of 28 heroes now match (25 before), and the XP error fell from 286 to 186 on average.
- **XP per level:** game data, 200/500/900/1,400/2,000/… up to 5,400 for level 10.
- **XP at time t (charts, metrics):** linear between level-ups, and exact at each one. After the last level-up it grows to half the next level by the end of the game. This looks ahead (to the next level-up and the end of the game), so the win-chance model uses only the XP of the levels reached so far.
- **Validation:** against W3Champions' official XP on 56 pro player-games, correlation 0.96, median ratio 1.01, mean error about 230 XP.
- **Official override:** W3Champions games use the official total instead (`metricSources`).

## Army, heroes and kills (`packages/sim/src/army.ts`)

- **Food used** (`series[].foodUsed`; upkeep, food charts, army food, largest army, 3-3-60, the income model's upkeep tax; `packages/sim/src/food.ts`): counted from the simulation's units the way the game counts it: a unit from the start of its training (finish minus build time) until it dies, a Wisp until it becomes a building, a hero from its order on, dead or alive (it can be revived); trained units the game never made are left out (Losses, below). Until 0.2.2 it was WC3V's own counter, which only adds (a unit counts once trained and keeps counting after it dies), so it climbed to 100 over a game whatever the fights. Against the game's food used on the 51 observer games (102 player-games, snapshots from 3:00): off by 3.1 food on average and 0.5 high, instead of 12.6 and 10.4 high (20 high above 50 food); time above 80 food 8 s per player-game against 1 s real, instead of 113 s. On 184 player-games with W3Champions score sheets, the income model's gold lost to upkeep came to 1,248 on average against the official 764, instead of 2,895 (correlation 0.71 instead of 0.52). Food max is still WC3V's (about 12 high on the same games: it misses lost and unfinished farms), raised to the food used where it is lower, so supply blocked and unused supply stay unreliable.
- **Army food:** food used minus workers minus heroes (5 each).
- **Largest army:** the game's "largest army" (W3Champions score sheets) is its highest food used, workers and heroes included: our highest food used matched it at 1.00× on median (correlation 0.92, mean error 4 food, 184 player-games; on the 86 pro player-games after the reference data was simulated again, 1.00×, correlation 0.97, mean error 3). Until 0.2.2 it was our highest army food on WC3V's counter (1.06×, correlation 0.74, mean error 12): two errors that cancelled out on median.
- **Army value (estimate):** what the army units alive at that moment cost (gold + lumber), a unit valued as the form it had then (an Obsidian Statue before it became a Destroyer). Alive means finished training and not yet dead by the losses rule below. Militia are workers (Peasants called to arms for 45 s, which the simulation often never sees go back to work), so they don't count (before 0.2.2 they did, as army bought at a Peasant's price). Stored as `series[].armyValue`; the pro curve is `armyValue`.
- **Hero timelines** (`sim.players[].heroes`):
  - **Appearance:** WC3V's training-finished time. WC3V makes a hero for every train order, also one cancelled at the altar, so the hero's unit is the last one trained before its first skill (before 0.2.2 the first one: a hero cancelled and ordered again later appeared at the cancelled order's time). Heroes themselves, their number and their timings come from skill picks, which a cancelled hero never makes (0.6% of player-games cancel a hero; none of them was counted).
  - **Levels:** from the replay (exact).
  - **Deaths (approximate):** the last movement before each revive order. A dead hero can't be ordered around.
  - **Revives:** the revive order plus the game's revive time, `min(150 s, build × level × 0.6, build × 2)`. This was checked against a hero's path: it moved again within 1 s of the formula.
  - **Never revived:** a hero WC3V marks `lost` at the end counts as dead from then on.
- **Units killed:** the game's count includes creeps. Without official stats it's estimated as (enemy units the simulation saw die + creeps in camps your side cleared) × `unitsKilledFactor`, fitted to official numbers (1.29, correlation 0.94 on 86 pro player-games, 0.2.2 simulation; 1.48 before).

## How accurate the estimates are

A replay records the players' commands, never the game's state: no unit dies in it. Army value, losses, trades and fight results are reconstructed by simulating the game (WC3V with the changes in `patches/wc3v/`, which read the selection lists the replay does record; Losses, below), so they are estimates.

Measured against Warcraft III's own unit counts, read from the game's observer data while it played each replay (`scripts/observer/`), on the report's own 10-second series, from minute 3 on. The games: the WC3V lab's 36 development games and the 15 held-out games it never saw, from pro tournaments, ladder games of every level and the author's own; 102 player-games, measured with the whole pipeline as released (0.2.2: WC3V with patches 0001–0025, refused train orders left out, Militia counted as workers). 0.2.1's simulation measured the same way on the same games is in brackets.

- **Army value:** typically off by about 300 on an average army of about 1,300 (23%, root mean square; 425, 32%), and about 37 too high on average (41 too low). Averaged per player-game over whole games: 94 (156). On the 15 held-out games alone: typically 276 on 1,175 (24%; 440, 37%), 97 per player-game (158). The hardest of them is batch3-11 (a 22-minute HvU at about 1,600 MMR, which WC3V read only up to 9:24 before patch 0025): 269 per player-game; the other 14 average 85.
- **Who has the bigger army:** the estimated difference between the two players correlates 0.90 with the real one (0.69); 0.82 on the held-out games (0.60).
- **Fights:** in fights in which a side really lost 300 or more, the side that lost more is named wrongly in 27% of them on the development games and 19% on the held-out ones (38% and 32%). What each side lost in a fight is off by about 100 per player (91 held out; 107 and 107).
- **Why it is off:** a death shows in the selection lists only once the player selects the unit's group again, so its time is known within a window (exactly when the unit died while selected). Train orders the game refused for lack of gold or food are still units in the simulation; with several buildings selected each trains a copy, and a refused one can take the selection-list handle of a unit trained later, so it counts too early (one held-out game, a Night Elf with two Ancients of Lore, had up to three Druids of the Claw while one was alive: 103 → 302 per player-game). Units never selected in replays without the game's full selection lists (before build 6116) are missed, and a unit trained in the last two minutes and never selected counts until the end.

The evaluation curve (`docs/win-chance/`) uses the army value as one input among seven; perfecting it would change the curve little (the report has the test).

## Official end-of-game stats (`record.official`)

- **Source:** the game's score sheet as W3Champions stores it (`api/matches/{id}` → `playerScores`). It has units produced/killed, largest army, heroes killed, items obtained, mercenaries, XP gained, gold and lumber collected, and gold lost to upkeep.
- **Finding the match:**
  - Reference games: by their W3C match id.
  - Your W3C games: through `api/matches/search` by opponent, within 10 minutes of the replay's start time.
- **Status:** `missing` with attempts while not found. The collector retries after 90 s, 10 min and 1 h.
- **Effect:** `mergeOfficial()` writes the numbers into the metrics, marks them in `metricSources`, and recomputes hero XP share and per-minute XP. The numbers survive reingest and new simulations.

## Metric sections

Each metric has a `section`:

- **core:** separated winners from losers in roughly 70%+ of 38 games (28 pro, 10 yours), or is a resource the game counts.
  - It also holds the 2nd and 3rd hero timing and tier 2/3 started, by request. These are strategy-dependent (`better: null`), so they get no colour.
  - Tier metrics carry `raceLabels` (Keep/Castle, Stronghold/Fortress, …).
- **mechanics:** APM, effective APM, useful actions, hotkeys, control groups, supply blocked. These get green/yellow/red like core.
- **Typicality labels:** metrics without a better direction (2nd/3rd hero, tier timings, expansions) are labelled by how typical they are for pros. Green "Like pros" means inside their middle 50%, yellow "Unusual" means inside the middle 80%, and red "Far from pros" means outside that.
- **details:** everything else.

**Upgrades section** (not metrics):
- **Research levels:** come from the replay's research orders (`researchLevels()` in `gamedata.ts`). The n-th distinct order of an upgrade is level n, capped at its maximum level. A repeat within 30 s is a cancel-and-requeue.
- **Attack and armor upgrades** per race (`CORE_UPGRADES`): the upgrades the game data classes as melee, ranged or armor, Masonry excluded.
- **Pro data:** the profile's `matchups[x].upgrades["code:level"]` holds the pro median time, the share of pro games that research it, and the sorted times.

## Economy model (`packages/sim`)

- **Maps** (`packages/sim/src/maps.ts`): WC3V needs each game's map. It is extracted from the user's own copy (the Maps folder of each Warcraft III folder, plus `mapFolders` in the settings; maps that come with the game, such as Blizzard's melee maps in custom games, are copied read-only out of the game's CASC storage) by WC3V's data-tool into WC3V's `mapdata/` and `client/maps/` folders, and copied to `sim/maps/<map>/` in the data folder with the map's entries of WC3V's shared files (`entries.json`). The collector copies them back at start when an update replaced WC3V's folder, and the copy is refreshed after each simulation (WC3V writes a map's placed units only when it first simulates a game there). A simulation in which WC3V followed no units counts as failed. Nothing extracted from a map is shipped.
- **Spending:** every order in the replay, priced from the game data extracted from your install (`sim/gamedata/<version>/`, with a sha256 manifest):
  - Heroes: w3gjs leaves hero train orders out, so each hero the player had (it learned a skill; a cancelled hero never does) is priced when its train order was given. The first hero is free. Before 0.2.2 heroes were left out, and spending − 500 was 7.5% below the official gold collected on median (176 W3Champions player-games); with them it is 2.3% below (mean error 11.7% → 9.5%).
  - Tier and tower upgrades cost only the step; the table stores cumulative costs.
  - Research level *n* costs `base + mod × (n−1)`.
  - Items are priced from the item table.
  - Cancelled orders still count.
  - One train click with several buildings of that type selected queues a unit in each of them (9.6% of train clicks on those 176 player-games). This isn't counted: the game refuses the copies it can't pay for or feed, and the replay doesn't say which. Counted in full, spending went over the official gold in 62% of player-games instead of 40% (one player clicked 21 times with 4 Workshops selected: 84 Siege Engines), so it waits for a gold and lumber model.
- **Losses:** units WC3V marks `lost` or `possiblyLost`, heroes excluded. Since 0.2.2 WC3V reads the replay's selection lists itself (`patches/wc3v/`: SelectionLedger, HandleBinder, SelectionEvidence): when a player switches selection or recalls a group, the game lists the units really selected, the dead ones already missing, so a unit that stops appearing in the lists died in between (the game's own deselect of a unit that dies while selected gives the exact time); a unit the lists name by another form (a Druid of the Claw in bear form, a burrowed Crypt Fiend, a Berserker) is the unit trained; and the lists tie the units WC3V never followed to their orders. A trained unit the lists never show is an order the game refused or cancelled: WC3V marks it possibly lost from its training (source `unlisted`) and Replay Altar leaves it out everywhere, army value, losses, fights and units killed (`packages/sim/src/deaths.ts`; counting it as lost made the losses so far 202 off per player-game instead of 136, and the losses per fight 121 instead of 102). Before 0.2.2 Replay Altar matched the selection lists to WC3V's units itself; on top of the WC3V that reads them, that made the army value worse (100 → 150 per player-game on the lab's development games, 88 → 136 held out), so it was removed. Measured against Warcraft III's own unit counts (observer data, `scripts/observer/`, above): average army value error per player-game 152 → 90.
- **Income (estimate):** simulated second by second.
  - Workers alive (from WC3V) go to mines, at most 5 per active mine.
  - Mines: the starting mine plus each expansion once it's built. Undead count Haunted Gold Mines only. Each mine holds 12,500 gold.
  - Gold is taxed by upkeep: 30% above 50 food, 60% above 80 (engine defaults; the 3.0 game data doesn't override them).
  - The remaining workers chop lumber. Undead lumber comes from ghouls.
- **Gold rate:** set in `packages/sim/src/economy-constants.json` by `scripts/calibrate-economy.ts`.
  - **How it's fitted:** so the median end-of-game estimate equals the official gold collected (86 pro player-games with W3Champions score sheets, 0.2.2 simulation with food used counted from the units). The result is 1.801 gold per worker-second, against a prior of 2.0 from the game's harvest data (1.973 with WC3V's food counter, which put players in upkeep far too long, so the rate made up for gold the tax wrongly took; 1.96 in 0.2.1).
  - **Accuracy:** typical error 6% (12% before). Games under 15 minutes read about 2% high, longer ones about 2% low (8% high and 14% low before). Gold lost to upkeep on the same games: 1,069 on average against the official 614 (correlation 0.86).
  - **Fallback:** with fewer than 20 official samples it uses the "bank can't go negative" method.
  - **Re-running:** re-run it as games accumulate, then run `replay-altar reingest` and `replay-altar sim --resummarize`.
- **Lumber:** the estimate correlated only 0.60 with official lumber, so it isn't reported. Unspent resources are gold only.
- **Gold collected (non-W3C games):** gold spent minus the 500 starting gold, 2.3% below official on median.
- **Horizon:** income estimates are reported for the first 10 minutes only. Past that the model drifts, in multi-mine games and for Night Elves, whose wisps WC3V under-counts.

## SQLite

| Table | Contents |
|---|---|
| `games` | One row per game; `result_detected`, `analyzed`, matchup from your side, `sim_status` / `sim_reason` |
| `game_players` | Both players, team, race, result, APM |
| `player_metrics` | Long format: `(game_key, player_id, metric, value)` |
| `build_events`, `heroes`, `hero_skills`, `apm_minutes`, `chat` | Timelines |
| `files` | Every copy of each replay that was seen |
| `classification_reasons` | The rules behind each classification |
| `sim_series` | `record.sim` series per player (10 s samples; `est_*` columns are estimates) |
| `annotations` | Additions made by people or LLMs (see below) |

| View | Contents |
|---|---|
| `v_games` | `games` plus the effective `result` (latest override, otherwise the detected result) |
| `v_analyzed` | Games that count in stats |
| `v_my_metrics` | Your metrics joined to result, matchup, map and date. The base for "how I play". |
| `v_matchup_winrates`, `v_map_winrates`, `v_opponents` | Win-rate summaries |

## Annotations

`annotations(game_key, kind, source, author, model, prompt_hash, body JSON, created_at)`:

- **`kind`:** `result_override` (`{"result":"win"|"loss"|null}`), `note`, `coach_report` or `audit_finding`.
- **`source`:** `user`, `llm` or `rule`.
- **`model`, `prompt_hash`:** left from the language-model analysis, removed on 2026-10-20; unused.
- **`game_key`:** `NULL` means the annotation is about your whole history.

## The rules' report (`replay-altar report`, the Findings card)

Built on demand, never stored (`packages/rules/src/book.ts`). Older installs may still have an `ai/` folder of language-model write-ups; nothing reads it anymore.

- **`findings`:** what mattered, decided by rules in `packages/rules/src/rules/` (run and ranked by `packages/rules/src/findings.ts`). Each has an `id`, a `severity` (0–1), `evidence` lines, `because` (facts that explain it) and `advice`. Every rule, its source and its score on pro games are listed in [RULES.md](RULES.md).
- **`strengths`:** core metrics at pro level.
- **Openings** (`packages/rules/src/openings.ts`): each player's opening named after Liquipedia's build-order pages: fast altar (standard), tavern hero, Barracks/Crypt before the altar, fast Riflemen/Headhunters/Huntresses, Fiend or Ghoul opening, fast expand (hall by 4:30), fast tech (tier 2 by 3:30, with its supply count), early towers, no army in the first 5 minutes. Tower positions aren't known, so "tower rush" is never claimed. Shown in the fact sheet and the opponent's plan.
- **`facts`:** the fact sheet: heroes, builds, trends, a table every 2 minutes, fights, key numbers with the app's verdicts.

## Build-order library (`data/builds/`) and mined principles

- **Library:** 66 builds as food-keyed steps (`[food, action, name]`): 40 from Grubby's build-order images (his Discord), 16 from Warcraft 3 Gym, 10 from Liquipedia, each with its source. Names resolve to game codes (`packages/rules/src/builds.ts`; generic upgrade names per race).
- **Matcher:** a player's key events (non-supply buildings, tier upgrades, expansions, heroes, first unit of each type, research, items, with the food in use at each) are paired with each build's steps by food count. The score is the F1 of "how much of the guide you followed" and "how much of your opening the guide explains", judged over at least 40 food.
- **Food:** the food used as the game counts it (units in training included, like the guides; see Army, heroes and kills).
- **Mined (`reference/<group>/principles.json`, `docs/PRINCIPLES.md`):** `node scripts/mine-principles.ts` reduces every pro player-game to milestones (time and food at tier 2/3, heroes and their levels, expansion, upgrades, 50/60 food, 3-3-60; workers, time in each upkeep tier, creep camps, items, towers, hero deaths…). Output per race: the distribution of each, wins vs losses, whether it holds across openings, each library build as pros play it (median food per step, win rate), and the plans pros play (order of heroes, tiers and expansions).
- **Rules** read their "unusual" thresholds from these distributions (pros' 90th percentile per race). `node scripts/eval-findings.ts --holdout` mines from half the games and scores on the other half.

## Exports


- `replay-altar export --jsonl`: one compact digest per analyzed game, containing metrics, heroes, the first 40 build orders, caveats and provenance.
- `replay-altar export --md <game>`: one game as Markdown, with a metric definition next to each value.

## Reference groups (`reference/<group>/`)

- **One group per race:** Human pros (`pros`), plus Orc, Undead and Night Elf groups that only download once you have played that race (`onlyIfPlayed`).
- **Matching:** pages and exports compare you with the group for the race you played.
- **Source and updates:** tournament replays from warcraft3.info, downloaded by the maintainers (`replay-altar ref refresh --all`), never by the app. Their statistics are published in `data/reference/<group>/` (`replay-altar ref publish`), which is what the app reads. See the README for the rules. Older games in the Human group came from the W3Champions ladder; they keep their official stats.
- **Maps:** map versions you don't have are fetched by the SHA-1 in the replay header and stored in `maps/` in your data folder.

- **Layout:** the same files as your data (`archive/`, `games/`, `raw/`, `sim/out/`), plus `reference.sqlite`. Records are "observed", so both players have metrics.
- **Tables:**
  - `ref_matches`: source id (a W3Champions match id, or `w3info:<replay id>` for warcraft3.info), the subject player (the one compared with you; MMR only for W3Champions games), opponent and race, result, replay build.
  - `ref_skipped`: matches not kept, with the reason.
  - `ref_metric_stats`: per matchup (`HvO`…, `all`), each metric's n and p10/p25/p50/p75/p90.
- **`profile.json`:** the same statistics, plus the sorted values used for percentiles and per-minute curves (p25/p50/p75; at least 5 games per minute) for APM, workers, spending, food and army food.
- **"Where you stand":** the mid-rank percentile of your value among the pro games.
  - **Whole-game totals** (`scalesWithLength`: resources spent/lost/killed, units, items, fights, hero deaths, seconds supply-blocked…) are compared per 10 minutes. Each of your games is normalized first, then averaged.
  - **Labels**, for metrics with a `better` direction:

    | Label | Colour | Rule |
    |---|---|---|
    | Pro level | green | at or above the pro median (as good as at least half the pro games; ties count half) |
    | Above opponents | yellow | not pro level, but at least as good as your opponent(s) on the raw value |
    | Below opponents | red | neither |

  - **Neutral metrics** (strategy timings) get only "earlier/later than X%".
- **Not a metric:** WC3V's dominance score (`sim_series.dominance`). It only counts units someone selected, so the player who clicks more looks ahead.

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
- **`result`:** the winning team and your result. `method` is one of:
  - `leave_victory` (high confidence)
  - `leave_game_over` (high)
  - `first_leaver_lost` (medium)
  - `none`

  The record also keeps the raw leave codes as evidence.
- **`players[]`:** you first, then your opponent. Each player has `metrics`, `apmPerMinute`, `heroes[]` (skill order with times), `build[]` (every order with its time), action counts and control groups.
- **`provenance`:** every file this game was seen as (path, sha256, mtime), the archive path, the parser version, the classifier and metrics versions, and the first ingest time.
- **`sim`** (once simulated): `status` `ok` or `failed` (with a `reason`). When `ok` it also has:
  - **Run details:** WC3V `engine.commit`, `gameData` (version and manifest hash), `model` (income-model version and constants), and `outputPath`, the full WC3V output kept for audit.
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

- **Repeated building orders:** re-issuing a build order re-places the same building, so the same building ordered again within 5 s counts once (build lists and building metrics; checked against the buildings the simulation placed). Training clicks are not merged: each one queues a unit.
- **Level-ups:** each level gives one skill point, so skill-pick times are the level-up times. Retraining re-picks don't count. The replay also keeps clicks the game refused (e.g. clicking a skill 12 times), so a pick only counts if the hero could learn that rank: ranks 1/2/3 at hero level 1/3/5, ultimates once at level 6. Against official XP on 58 player-games: correlation 0.95, median error 121 XP.
- **XP per level:** game data, 200/500/900/1,400/2,000/… up to 5,400 for level 10.
- **XP at time t (charts, metrics):** linear between level-ups, and exact at each one. After the last level-up it grows to half the next level by the end of the game. This looks ahead (to the next level-up and the end of the game), so the win-chance model uses only the XP of the levels reached so far.
- **Validation:** against W3Champions' official XP on 56 pro player-games, correlation 0.96, median ratio 1.01, mean error about 230 XP.
- **Official override:** W3Champions games use the official total instead (`metricSources`).

## Army, heroes and kills (`packages/sim/src/army.ts`)

- **Army food:** food used minus workers minus heroes (5 each), from the simulated supply. The game's "largest army" is counted in food: our maximum, heroes included, matched it at 0.95× (correlation 0.90).
- **Army value (estimate):** what the army units alive at that moment cost (gold + lumber), a unit valued as the form it had then (an Obsidian Statue before it became a Destroyer). Alive means finished training and not yet dead by the losses rule below. Stored as `series[].armyValue`; the pro curve is `armyValue`.
- **Hero timelines** (`sim.players[].heroes`):
  - **Appearance:** WC3V's training-finished time.
  - **Levels:** from the replay (exact).
  - **Deaths (approximate):** the last movement before each revive order. A dead hero can't be ordered around.
  - **Revives:** the revive order plus the game's revive time, `min(150 s, build × level × 0.6, build × 2)`. This was checked against a hero's path: it moved again within 1 s of the formula.
  - **Never revived:** a hero WC3V marks `lost` at the end counts as dead from then on.
- **Units killed:** the game's count includes creeps. Without official stats it's estimated as (enemy units the simulation saw die + creeps in camps your side cleared) × `unitsKilledFactor`, fitted to official numbers (1.48, correlation 0.90).

## How accurate the estimates are

A replay records the players' commands, never the game's state: no unit dies in it. Army value, losses, trades and fight results are reconstructed by simulating the game (WC3V) and corrected with the selection lists the replay does record (Losses, below), so they are estimates.

Measured against Warcraft III's own unit counts, read from the game's observer data while it played each replay (`scripts/observer/`), on 50 player-games (32 from pro tournaments, 18 from ladder games), from minute 3 on:

- **Army value:** typically off by about 370 on an average army of about 1,220 (about 30%), and about 100 too high on average. Averaged per player-game over whole games: 183 (257 before the selection-list correction; `army-value-error.png`).
- **Who has the bigger army:** the estimated difference between the two players correlates 0.70 with the real one, so the direction is usually right and the size is rough.
- **Why it is off:** a death only shows in the selection lists once the player selects that group again, so its time is known within a window; units the simulation never tied to their orders get their deaths only from the lists; Undead ghouls are left to the simulation alone (they leave the army to gather lumber, which looks like dying).

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
  - The first hero is free.
  - Tier and tower upgrades cost only the step; the table stores cumulative costs.
  - Research level *n* costs `base + mod × (n−1)`.
  - Items are priced from the item table.
  - Cancelled orders still count.
- **Losses:** units WC3V marks `lost` or `possiblyLost`, heroes excluded, corrected with the replay's selection lists (`packages/sim/src/deaths.ts`): when a player switches selection the replay lists what was really selected, dead units already missing, so a unit that stops appearing in later lists of its group died in between. Units WC3V never saw move after training (it calls them lost at once) count as alive unless the lists show a death; units it followed die when the lists show them gone, if that is earlier. Ghouls are left to WC3V (they leave the army to gather lumber). Measured against Warcraft III's own unit counts (observer data, `scripts/observer/`) on 50 player-games: average army value error 257 → 183 (`army-value-error.png`).
- **Income (estimate):** simulated second by second.
  - Workers alive (from WC3V) go to mines, at most 5 per active mine.
  - Mines: the starting mine plus each expansion once it's built. Undead count Haunted Gold Mines only. Each mine holds 12,500 gold.
  - Gold is taxed by upkeep: 30% above 50 food, 60% above 80 (engine defaults; the 3.0 game data doesn't override them).
  - The remaining workers chop lumber. Undead lumber comes from ghouls.
- **Gold rate:** set in `packages/sim/src/economy-constants.json` by `scripts/calibrate-economy.ts`.
  - **How it's fitted:** so the median end-of-game estimate equals the official gold collected (58 player-games). The result is 1.96 gold per worker-second, against a prior of 2.0 from the game's harvest data.
  - **Accuracy:** typical error 11%. Games under 15 minutes read about 10% high, longer ones about 12% low.
  - **Fallback:** with fewer than 20 official samples it uses the "bank can't go negative" method.
  - **Re-running:** re-run it as games accumulate, then run `replay-altar reingest` and `replay-altar sim --resummarize`.
- **Lumber:** the estimate correlated only 0.60 with official lumber, so it isn't reported. Unspent resources are gold only.
- **Gold collected (non-W3C games):** gold spent minus the 500 starting gold, within about 3% of official on median.
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
- **Food:** counts finished units; the game's counter (and the guides) also count units in training, so guide numbers run higher early on. Compare with pros, measured the same way.
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

# Data format (for audits, scripts and LLMs)

All data lives in `~/.local/share/w3stats/`. The trust order is:

1. `archive/` holds the original `.w3g` files.
2. `raw/` holds the parser output.
3. `games/` holds the derived records.
4. The SQLite DB is a projection of the records.

Each layer can be rebuilt from the one above it with `w3stats reingest`. The exception is the `annotations` table, which holds human or LLM input and is never rebuilt.

## Per game

`games/<game_key>.json` is defined by the `GameRecord` type in `packages/core/src/record.ts`.

- **`gameKey`:** w3gjs id, `sha256(randomSeed + player names + gameName)`. It is the same for `LastReplay.w3g` and any copy you save of it.
- **`game`:**
  - `playedAt`, `endedAt` and `timeSource`. Replays carry no timestamp. `w3c_filename` is exact (UTC). `lastreplay_mtime` is the game's end time. `saved_file_mtime` is when you saved the copy, which can be later.
  - Also: `durationMs`, map, version and lobby settings.
- **`classification`:** `source`, `category`, `analyzed`, `skipReason`, the seats, and `rules[]`. Each rule records the check, whether it passed, and the evidence it used.
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

## Economy model (`packages/sim`)

- **Spending:** every order in the replay, priced from the game data extracted from your install (`sim/gamedata/<version>/`, with a sha256 manifest):
  - The first hero is free.
  - Tier and tower upgrades cost only the step; the table stores cumulative costs.
  - Research level *n* costs `base + mod × (n−1)`.
  - Items are priced from the item table.
  - Cancelled orders still count.
- **Losses:** units WC3V marks `lost` or `possiblyLost`, heroes excluded.
- **Income (estimate):** simulated second by second.
  - Workers alive (from WC3V) go to mines, at most 5 per active mine.
  - Mines: the starting mine plus each expansion once it's built. Undead count Haunted Gold Mines only. Each mine holds 12,500 gold.
  - Gold is taxed by upkeep: 30% above 50 food, 60% above 80 (engine defaults; the 3.0 game data doesn't override them).
  - The remaining workers chop lumber. Undead lumber comes from ghouls.
- **Rates** are in `packages/sim/src/economy-constants.json`, calibrated by `scripts/calibrate-economy.ts`:
  - For each player-game, it finds the smallest rate that keeps `start + mined − spent ≥ 0`.
  - It takes the median across games, clamped to 0.6–1.6× of priors derived from the harvest data.
  - Re-run it as games accumulate, then run `w3stats sim --resummarize`.
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

## Annotations (reserved for the LLM phase)

`annotations(game_key, kind, source, author, model, prompt_hash, body JSON, created_at)`:

- **`kind`:** `result_override` (`{"result":"win"|"loss"|null}`), `note`, `coach_report` or `audit_finding`.
- **`source`:** `user`, `llm` or `rule`.
- **Identifying an LLM run:** an LLM writes `model` and `prompt_hash`, so every generated claim can be traced back to the model and prompt that produced it.
- **`game_key`:** `NULL` means the annotation is about your whole history.

## Exports

- `w3stats export --jsonl`: one compact digest per analyzed game, containing metrics, heroes, the first 40 build orders, caveats and provenance.
- `w3stats export --md <game>`: one game as Markdown, with a metric definition next to each value.

## Reference groups (`reference/<group>/`)

- **Layout:** the same files as your data (`archive/`, `games/`, `raw/`, `sim/out/`), plus `reference.sqlite`. Records are "observed", so both players have metrics.
- **Tables:**
  - `ref_matches`: W3Champions match id, the subject player (the Human compared with you) with MMR, opponent and race, replay build.
  - `ref_skipped`: matches not kept, with the reason.
  - `ref_metric_stats`: per matchup (`HvO`…, `all`), each metric's n and p10/p25/p50/p75/p90.
- **`profile.json`:** the same statistics, plus the sorted values used for percentiles and per-minute curves (p25/p50/p75; at least 5 games per minute) for APM, workers, spending, food and army food.
- **"Where you stand":** the mid-rank percentile of your value among the pro games, worded by the metric's `better` direction.
- **Not a metric:** WC3V's dominance score (`sim_series.dominance`). It only counts units someone selected, so the player who clicks more looks ahead.

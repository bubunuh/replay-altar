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

## Metrics

Defined once in `packages/core/src/metrics.ts` (`METRICS`). The same definitions are in the DB table `metric_defs` and in every export. Times are in ms and are when the **order was issued**. Values are `null` when the event never happened, for example tier 3 not reached.

## SQLite

| Table | Contents |
|---|---|
| `games` | One row per game; `result_detected`, `analyzed`, matchup from your side |
| `game_players` | Both players, team, race, result, APM |
| `player_metrics` | Long format: `(game_key, player_id, metric, value)` |
| `build_events`, `heroes`, `hero_skills`, `apm_minutes`, `chat` | Timelines |
| `files` | Every copy of each replay that was seen |
| `classification_reasons` | The rules behind each classification |
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

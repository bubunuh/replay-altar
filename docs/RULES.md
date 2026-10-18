# AI analysis rules

What the "AI analysis" looks for. Rules decide what mattered; the local model only writes it up
(see `packages/ai/src/findings.ts`). Each rule is scored on the pro games by
`node scripts/eval-findings.ts --holdout`: thresholds are mined from half of the pro games and the
rules scored on the other half, from every pro's side: how often each rule fires in their wins and
in their losses. A useful rule fires more often in losses ("lift" above 1). Numbers below: 405
held-out pro perspectives over the four races (202 wins, 203 losses; about 100 per race), from
the 2026-10-18 corpus (200 current-patch tournament games per race, 173 for Orc: warcraft3.info
had no more). Per-race lifts rest on a handful of games each, so read them as rough.

**Calibration (2026-10-18):** thresholds follow the pros of your race where a rule depends on
style: the basics use the pros' 90th percentile (first creep, high upkeep, towers per base,
workers lost) with the guide values as floors, and the worker rule fires only below both the
guide target and 9 in 10 pros (Orc pros sit at ~12 workers even on two bases, Undead at ~7).
Shared principles and how pros play each library build: [PRINCIPLES.md](PRINCIPLES.md).

Shown per game (top 3): 1.45 findings in pro wins, 2.16 in pro losses.

## Main findings

| Rule | Fires when | Source | Pro wins / losses | Lift (H O U N) |
|---|---|---|---|---|
| `heroes` | hero XP by 6:00/10:00 worse than 75% of pros, or under 45% of both players' XP | metric research on W3C score sheets | 26% / 65% | 2.5 (2.1 3.9 2.3 2.5) |
| `fights` | you lost 1.5x more than the opponent in detected fights (and at least 800) | metric research | 15% / 29% | 2.0 (1.9 3.4 1.7 1.7) |
| `hero_deaths` | your heroes died more often than theirs (2+) | Blizzard hero basics: keep heroes alive, carry a Town Portal | 5% / 14% | 2.5 (1.2 5.0 3.6 2.5) |
| `economy` | workers at 6:00 / 10:00 below what your bases need (5 on gold per base + lumber crew: Human 9, two bases 12; Orc 7 / 9; Night Elf 9 / 12) by 3 / 2, and below 9 in 10 pros of your race | Grubby, Beginner's Guide #3 (Economy) and Human guides; pro data | 3% / 7% | 2.0 (2.1 – – 2.1) |
| `expansion` | no expansion in a 20+ minute game while the opponent expanded | Liquipedia: expand early when safe | 3% / 8% | 2.4 |
| `upkeep` | above 80 food with fewer than 2 expansions for longer than 9 in 10 pros of your race (2+ minutes) | Blizzard's upkeep page; Grubby #3: "only if you intend to fight very soon" | 12% / 16% | 1.3 (0.8 1.5 2.4 0.2) |
| `supply` | supply blocked longer than 75% of pros | metric research | 22% / 28% | 1.3 |
| `no_heroes` | you fought while all your heroes were dead (lost 300+) | Blizzard hero basics: retreat when all heroes are dead | 0% / 1% | rare |
| `window` | the opponent had no army for 4+ minutes and you neither expanded, made them lose 400+, nor out-levelled pros | Replay Altar (punishing greedy play; Warcraft3.info Human guide) | never in pros | – |
| `exposed` | you had no army for 4+ minutes while they had one | Replay Altar | 1% / 1% | rare |
| `mechanics` | APM and hotkey use far below pros, shown only when little else stands out | metric research | 2% / 0% | for beginners only |

## Basics (beginner mistakes, ranked below the main findings)

Thresholds sit outside what the pro games show, so they rarely fire for good players; a lift
near 1 here means "pros rarely do this either way", not that the advice is wrong.

| Rule | Fires when | Source | Pro wins / losses | Lift |
|---|---|---|---|---|
| `upgrades` | no attack or armor upgrade by 15:00 | pro data (first attack upgrade ~9:00); Grubby: one attack upgrade around 50 food | 14% / 25% | 1.8 |
| `mine_dry` | ≈ 11,500+ gold collected from one base and no expansion | Warcraft 3 Gym (Pit Lord guide): expand when your gold mine runs out (a mine holds 12,500) | 5% / 9% | 1.7 |
| `goal_3360` | first hero level 3, second hero level 3 and 60 food later than 3 in 4 pros, or never in a long game | Grubby, Beginner's Guide #6: the "3360 rule" | 15% / 24% | 1.6 |
| `first_creep` | longer than 9 in 10 pros (and 90+ s) from first hero to first creep fight (pros: ~10 s) | Liquipedia build orders (all races): creep as soon as the hero leaves the altar | 8% / 13% | 1.5 |
| `floating` | ≈ unspent gold in the first 10 minutes above the pros' 90th percentile | pro data | 4% / 6% | 1.3 |
| `unused_spike` | 4 minutes after first reaching 50 food: no fight started against the opponent, no expansion, no tier 3 | Warcraft 3 Gym (all races): "reach 50 supply with level 3 on both heroes", then attack, expand or tech; Grubby's 3360 | 1% / 2% | 1.3 |
| `build_drift` | a confident library-build match with large deviations from how pros play it | build library (below) | 1% / 2% | 1.3 |
| `upkeep_before_upgrades` | went over 50 food with no attack/armor upgrade, no expansion and no tier 3 yet | Warcraft 3 Gym (Orc auras guide): don't go over 50 before upgrades unless you have an expansion; Grubby #3 | 10% / 10% | 1.0 |
| `one_hero` | one hero all game (15+ min) against two or more | Grubby #6: two heroes usually beat one | 1% / 1% | 1.0 |
| `just_over_50` | 2+ minutes at 51-54 food without fighting | Grubby #3: 51 food is "almost no benefit for maximum disadvantage" | 0% / 1% | rare |
| `no_items` | no shop purchase in 12+ minutes | Blizzard hero basics (potions, scrolls, Town Portal) | never in pros | – |
| `towers` | more tower build/upgrade orders per base than 9 in 10 pros (and more than 6) | Grubby, Human guide 2026: an arcane tower and maybe a guard tower per base | 3% / 2% | 0.8 |
| `unanswered_expansion` | the opponent expanded while your army was bigger and you didn't fight for 4 minutes | StrategyWiki: attack expansions before they finish | 2% / 1% | 0.7 |
| `workers_lost` | ≈ 5+ workers lost by 12:00 (and more than 9 in 10 pros) | Grubby, Human guide: losing ~5 peasants while expanding puts you far behind | 5% / 3% | 0.7 (worker deaths are inferred and undercounted) |

## Also from the sources

- **Opening labels** (`openings.ts`): each player's opening named after Liquipedia's build-order pages.
- **Tested and dropped:** "late expansion vs pros" (fired for half the pros, wins and losses alike), "turtling" (fired only for pros who won), "unanswered expansion vs pros" as a main rule (pros leave expansions alone half the time either way), "creeping with level 5+ heroes" (creeps give them no XP, but pros do it for items and gold: it fired more in their wins, lift 0.5).
- **Changed after the 4-race corpus:** the worker rule used only the guide targets and fired in a third of pro games, mostly Orc and Undead (lift 0.9); with the pro floor it fires in 3% / 7% (lift 2.0). "Over 50 food before upgrades" now accepts tier 3 as the investment (it fired in 27% of pro wins).
- **Build library** (`data/builds/`, `packages/ai/src/builds.ts`): 66 food-keyed builds from Grubby, Warcraft 3 Gym and Liquipedia. Each player's opening is matched against them; the match page and the fact sheet show the closest build and where you differ from how pros play it.
- **Not measurable from a replay:** creep-camp micro (aggro pulls, purge, ensnare), spell and mana use, positioning, unit counters by armor type (possible later from game data).

## Sources

- Grubby, "10-Part Complete Beginner's Guide for WC3 in 2026" (parts 1-6), GrubbyTalks on YouTube; "NEW Human BEGINNER's Guide", "Ultimate HUMAN guide: Beginner & Intermediate", "The EASIEST beginner build", "Never played Warcraft 3? WATCH THIS!".
- carsoNNN, "A guide to creeping in Wc3", parts I-III (creep micro; not measurable).
- Back2Warcraft, "5 Best Tips & Tricks for Beginners".
- Blizzard Warcraft III basics pages: creeping, hero control, upkeep (classic.battle.net).
- Liquipedia Warcraft: Experience, Creeps, Upkeep, Militia, race and hero pages, build-order pages (read through its API).
- Warcraft3.info "How To Basic" race guides.
- StrategyWiki, Blizzard forums (upkeep discussion).
- Warcraft 3 Gym guides and build orders (57 pages, all races; authors include GotQuail, Gym Coaches, AllSupGoToHeaven, Kaiser, randombadgamer, HoT), saved by hand: their site blocks automated access.

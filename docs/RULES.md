# AI analysis rules

What the "AI analysis" looks for. Rules decide what mattered; the local model only writes it up
(see `packages/ai/src/findings.ts`). Each rule is scored on the pro games by
`node scripts/eval-findings.ts --holdout`: thresholds are mined from half of the pro games and the
rules scored on the other half, from every pro's side: how often each rule fires in their wins and
in their losses. A useful rule fires more often in losses ("lift" above 1). Numbers below: 370
held-out pro perspectives over the four races (186 wins, 184 losses), from the 2026-10-18 corpus
(warcraft3.info tournament games, current patch; games whose replay the simulation could not
read to the end are left out: 7-10% per race). Per-race lifts rest on a handful of games each.

**Calibration:** thresholds follow the pros of your race where a rule depends on style (pros'
90th percentile with guide values as floors; the worker rule fires only below both the guide
target and 9 in 10 pros). Expansions come from the simulation's standing halls. Hand reviews of
games of every race and level, and what they changed: [REVIEWS.md](REVIEWS.md). Shared principles
and how pros play each library build: [PRINCIPLES.md](PRINCIPLES.md).

Shown per game (top 3): 1.50 findings in pro wins, 2.23 in pro losses.

## Main findings

| Rule | Fires when | Source | Pro wins / losses | Lift (H O U N) |
|---|---|---|---|---|
| `heroes` | hero XP by 6:00/10:00 worse than 75% of pros, or under 45% of both players' XP ("their heroes out-levelled yours" when your own pace was at pro level) | metric research on W3C score sheets | 30% / 68% | 2.3 (2.1 3.4 2.3 2.1) |
| `fights` | you lost 1.3x more than the opponent in fights (detected, or inferred from loss bursts; 800+), unless your whole-game trade beats the pro median. Overlapping fights split the losses (they used to count them twice: 1.5x then gave 2.2) | metric research | 18% / 33% | 1.8 (2.0 3.3 2.3 1.1) |
| `hero_deaths` | your heroes died more often than theirs (2+) | Blizzard hero basics: keep heroes alive, carry a Town Portal | 5% / 14% | 2.6 (1.2 4.0 7.2 2.2) |
| `expansion` | no expansion in a 20+ minute game while the opponent expanded | Liquipedia: expand early when safe | 3% / 8% | 2.5 |
| `out_expanded` | they had more bases standing than you for 4+ minutes before 20:00 | reviews (REVIEWS.md); Grubby #3 (economy) | 12% / 21% | 1.8 (1.0 1.6 2.0 2.6) |
| `economy` | workers at 6:00 / 10:00 below what your bases need (5 on gold per base + lumber crew) by 3 / 2, and below 9 in 10 pros of your race | Grubby, Beginner's Guide #3 and Human guides; pro data | 4% / 7% | 1.7 |
| `army_mismatch` | your recent units did ≤80% damage on average against their armor and your race had units doing 40+ points better | game data (`data/gamedata/combat.json`) | 2% / 5% | 2.5 |
| `supply` | supply blocked longer than 75% of pros (and 30+ s) | metric research | 19% / 26% | 1.4 |
| `unused_lead` | army 1.5x theirs (600+ more) and at least as many workers for 4+ minutes, with no attack, expansion or 300+ of their losses in the first 4 | reviews (REVIEWS.md) | never in pros | – |
| `window` | the opponent had no army for 4+ minutes and you neither expanded, made them lose 400+, nor out-levelled pros | Replay Altar; Warcraft3.info Human guide | 1% / 0% | rare |
| `exposed` | you had no army for 4+ minutes while they had one | Replay Altar | 1% / 2% | rare |
| `no_heroes` | you fought while all your heroes were dead (lost 300+; not counting their attacks on your towers or base) | Blizzard hero basics | 0% / 1% | rare |
| `no_anti_air` | 40%+ of their recent army flew (1,200+ value) and under 25% of yours could attack air | game data | 1% / 2% | rare |
| `mechanics` | APM and hotkey use far below pros, shown only when little else stands out | metric research | 3% / 1% | for beginners only |

## Basics (beginner mistakes, ranked below the main findings)

Thresholds sit outside what the pro games show, so they rarely fire for good players; a lift
near 1 here means "pros rarely do this either way", not that the advice is wrong.

| Rule | Fires when | Source | Pro wins / losses | Lift |
|---|---|---|---|---|
| `unused_spike` | 4 minutes after first reaching 50 food: no fight started, no expansion, no tier 3 | Warcraft 3 Gym; Grubby's 3360 | 1% / 3% | 2.5 |
| `build_drift` | a confident library-build match with tier/expansion steps 8+ food later than pros on that build | build library | 1% / 2% | 2.0 |
| `upgrades` | no attack or armor upgrade by 15:00 | pro data; Grubby: one attack upgrade around 50 food | 14% / 24% | 1.7 |
| `mine_dry` | ≈ 11,500+ gold collected from one base and no expansion | Warcraft 3 Gym (Pit Lord guide) | 9% / 14% | 1.6 |
| `goal_3360` | first hero level 3, second hero level 3 and 60 food later than 3 in 4 pros, or never in a long game | Grubby, Beginner's Guide #6 | 14% / 20% | 1.4 |
| `floating` | ≈ unspent gold in the first 10 minutes above the pros' 90th percentile | pro data | 5% / 7% | 1.2 |
| `upkeep_before_upgrades` | went over 50 food with no attack/armor upgrade or caster training (ordered within 30 s), no expansion and no tier 3 | Warcraft 3 Gym (Orc auras guide); Grubby #3 | 8% / 8% | 1.0 |
| `upkeep` | above 80 food with fewer than 2 expansions for longer than 9 in 10 pros (2+ minutes); a basic since 2026-10-18 (food counts in long games are uncertain) | Blizzard's upkeep page; Grubby #3 | 10% / 10% | 1.0 |
| `no_sustain` | a hero died after 6:00 with no potion, healing scroll or Town Portal bought before it | Blizzard hero basics; Grubby | 6% / 7% | 1.0 |
| `one_hero` | one hero all game (15+ min) against two or more | Grubby #6 | 1% / 1% | 1.0 |
| `towers` | more tower orders per base than 9 in 10 pros (and more than 6) | Grubby, Human guide 2026 | 3% / 3% | 1.0 |
| `unanswered_expansion` | they expanded while your army was bigger and you didn't fight for 4 minutes | StrategyWiki | 1% / 1% | 1.0 |
| `workers_lost` | ≈ 5+ workers lost by 12:00 (and more than 9 in 10 pros) | Grubby, Human guide | 5% / 4% | 0.7 (deaths are inferred) |
| `just_over_50` | 2+ minutes at 51-54 food without fighting | Grubby #3 | rare | – |
| `no_items` | no shop purchase in 12+ minutes | Blizzard hero basics | never in pros | – |
| `no_scout` | your first unit on their side of the map after 9 in 10 pros (and after 5:00) | pro data; Grubby, Liquipedia | never in pros | – |

## Around the findings (no model needed)

`packages/ai/src/report.ts`, `advice.ts`, and `becauseFor` in `findings.ts`:

- **Next time:** hand-written advice per rule, with the race's own buildings and units and the pros' numbers (`advice.ts`). The composition, items and scouting rules write theirs from the game (the units that would do more damage, the units that shoot air).
- **Why:** facts from elsewhere in the game that explain a finding: few creep camps or an idle first hero or early hero deaths behind "heroes fell behind"; items bought, hero levels and upgrades at the costliest fight, and fights under towers behind "fights"; the opponent's tech behind "window".
- **Recap:** result, the main problem and its first cause, the second problem.
- **Turning point:** the fight with the biggest swing for the side that lost (500+), with the army values going in and a time to rewatch it.
- **One thing for next game:** the top finding's advice.

## Also from the sources

- **Opening labels** (`openings.ts`): each player's opening named after Liquipedia's build-order pages.
- **Tested and dropped:** "late expansion vs pros" (fired for half the pros, wins and losses alike), "turtling" (fired only for pros who won), "unanswered expansion vs pros" as a main rule (pros leave expansions alone half the time either way), "creeping with level 5+ heroes" (creeps give them no XP, but pros do it for items and gold: it fired more in their wins, lift 0.5).
- **Tested and dropped (2026-10-18, from the reviews):** a separate "hero stall" rule (lift 0.7: pros' second heroes often idle at levels 4+), "late second hero" (lift 1.0), "first creep came late" as its own finding (0.5 once the heroes finding names it as a cause), battle-summary loss estimates in fights (lowered the fights lift 1.9 → 1.5). See REVIEWS.md.
- **Tested and dropped (2026-10-18):** "production stood still with gold in the bank" (the longest stretch to 10:00 with ≈300+ gold, supply room and no army unit trained): pros of every race do it about as often in wins as in losses (lift 0.9), partly because the bank is an estimate. The measure stays in PRINCIPLES.md.
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

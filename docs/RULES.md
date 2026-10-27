# Rules

What the Findings card looks for: rules decide what mattered in a game, no language model involved
(see `packages/rules/src/rules/`: `core.ts`, `basics.ts`, `army.ts`; ranked in `findings.ts`). Each rule is scored by
`node scripts/eval-findings.ts --holdout --pool validation`: thresholds are mined from half of the
games and the rules scored on the other half, from every player's side: how often each rule fires
in their wins and in their losses. A useful rule fires more often in losses ("lift" above 1).
Numbers below: 3,532 held-out player-games over the four races (1,765 wins, 1,767 losses), from
the curated current-patch pro games (warcraft3.info tournaments and W3Champions 2400+) pooled with
the validation set's tournament games from 2022 to 2026 (older patches, players from semi-pro to
the very top), all read and simulated again with 0.2.2's reading and simulation (2026-10-27:
WC3V with patches 0001–0026, no death correction afterwards, food used counted from the units;
140 more validation games simulate than on 2026-10-23). On the current-patch pro games alone (408 held-out player-games) the main
rules score: heroes 2.2, fights 3.7, hero deaths 2.3, expansion 2.4, out-expanded 1.7.

**Calibration:** thresholds follow the pros of your race where a rule depends on style (pros'
90th percentile with guide values as floors; the worker rule fires only below both the guide
target and 9 in 10 pros). Expansions come from the simulation's standing halls. Hand reviews of
games of every race and level, and what they changed: [REVIEWS.md](REVIEWS.md). Shared principles
and how pros play each library build: [PRINCIPLES.md](PRINCIPLES.md).

**Shown in the app** (since 2026-10-27, 0.2.2): only the rules whose whole 95% range of lift (games
resampled 400 times) lies above 1: fights, heroes, hero deaths, expansion, out-expanded, workers
lost, no sustain, mine dry, upgrades and 3-3-60 (`goal_3360`) (`SHOWN_RULES` in `findings.ts`).
`no_items` also passes but fires in under 1% of games (0.3%), so it stays hidden. The
others still run and are scored here, but stay hidden until they can be tuned per skill level:
several matter more for beginners than for tournament players. The hotkeys check (`mechanics`)
is shown whenever it fires, win or lose, on top of the three main findings.

**Re-scored on 0.2.2's simulation (2026-10-27):** by the same criterion `floating` (95% range
0.92–1.88) and `supply` (0.89–1.31) are hidden (0.2.0 to 0.2.1 showed them) and `goal_3360`
(1.12–1.37) is shown. `upkeep` passed on WC3V's food counter (1.08–1.39), which never took the
dead off and put pros above 80 food for minutes; with food counted from the units it fires in 7%
of wins and 6% of losses (0.72–1.11) and is hidden again. `floating` likely
dropped because the second and third heroes now count in spending and the income model runs short
early, so the unspent gold is mostly 0 (to be revisited with the gold and lumber model, 0.2.3). `fights` still passes clearly, with a lower lift than on 0.2.1's
simulation (2.1 instead of 3.1: it fires in 17% of wins instead of 13%; raising its 1.3x to 1.5x
gave 2.3, 12% / 28%, on the first 0.2.2 scoring).

Shown per game (top 3 of the shown rules): 1.04 findings in wins, 1.84 in losses.

## Main findings

| Rule | Fires when | Source | Pro wins / losses | Lift (H O U N) |
|---|---|---|---|---|
| `heroes` | hero XP by 6:00/10:00 worse than 75% of pros, or under 45% of both players' XP ("their heroes out-levelled yours" when your own pace was at pro level) | metric research on W3C score sheets | 24% / 67% | 2.8 (2.5 3.0 3.0 2.9) |
| `fights` | you lost 1.3x more than the opponent in fights (detected, or inferred from loss bursts; 800+), unless your whole-game trade beats the pro median. Overlapping fights split the losses (they used to count them twice: 1.5x then gave 2.2) | metric research | 17% / 37% | 2.1 (1.9 2.2 2.2 2.4) |
| `hero_deaths` | your heroes died more often than theirs (2+) | Blizzard hero basics: keep heroes alive, carry a Town Portal | 6% / 14% | 2.4 (2.0 2.3 3.0 2.4) |
| `expansion` | no expansion in a 20+ minute game while the opponent expanded | Liquipedia: expand early when safe | 3% / 7% | 2.1 (2.1 1.5 2.5 3.1) |
| `out_expanded` | they had more bases standing than you for 4+ minutes (whole game; was before 20:00 only: 12% / 21%) | reviews (REVIEWS.md); Grubby #3 (economy) | 13% / 21% | 1.6 (2.0 1.6 1.2 2.0) |
| `economy` | workers at 6:00 / 10:00 below what your bases need (5 on gold per base + lumber crew) by 3 / 2, and below 9 in 10 pros of your race | Grubby, Beginner's Guide #3 and Human guides; pro data | 5% / 6% | 1.2 (1.2 inf - 1.5) |
| `army_mismatch` | your recent units did ≤80% damage on average against their armor and your race had units doing 40+ points better | game data (`data/gamedata/combat.json`) | 3% / 3% | 1.1 (0.8 1.3 0.9 1.2) |
| `supply` | supply blocked longer than 75% of pros (and 30+ s) | metric research | 11% / 12% | 1.1 (0.9 1.2 1.1 1.8) |
| `unused_lead` | army 1.5x theirs (600+ more) and at least as many workers for 4+ minutes, with no attack, expansion or 300+ of their losses in the first 4 | reviews (REVIEWS.md) | under 1% / under 1% | rare |
| `window` | the opponent had no army for 4+ minutes and you neither expanded, made them lose 400+, nor out-levelled pros | Replay Altar; Warcraft3.info Human guide | 1% / 1% | 1.1 (inf 2.1 0.9 0.0) |
| `exposed` | you had no army for 4+ minutes while they had one | Replay Altar | 1% / 2% | 1.3 (1.4 1.1 - 3.0) |
| `no_heroes` | you fought while all your heroes were dead (lost 300+; not counting their attacks on your towers or base) | Blizzard hero basics | 0% / 1% | 1.4 (1.6 inf 1.4 0.4) |
| `no_anti_air` | 40%+ of their recent army flew (1,200+ value) and under 25% of yours could attack air | game data | 0% / 1% | 1.6 (0.5 2.1 1.8 1.8) |
| `mechanics` | no control groups (at most 1 group, or under 5 recalls a minute) or under 15% of selections by hotkey: limits below 99 in 100 tournament player-games; shown whenever it fires | tournament data (8,294 player-games) | 0% / 1% | 4.7 (shown whatever the lift) |

## Basics (beginner mistakes, ranked below the main findings)

Thresholds sit outside what the pro games show, so they rarely fire for good players; a lift
near 1 here means "pros rarely do this either way", not that the advice is wrong.

| Rule | Fires when | Source | Pro wins / losses | Lift |
|---|---|---|---|---|
| `unused_spike` | 4 minutes after first reaching 50 food: no fight started, no expansion, no tier 3 | Warcraft 3 Gym; Grubby's 3360 | 1% / 1% | 1.5 |
| `build_drift` | a confident library-build match with tier/expansion steps 8+ food later than pros on that build | build library | 2% / 3% | 1.2 |
| `upgrades` | no attack or armor upgrade by 15:00 | pro data; Grubby: one attack upgrade around 50 food | 17% / 21% | 1.3 |
| `mine_dry` | ≈ 11,500+ gold collected from one base and no expansion | Warcraft 3 Gym (Pit Lord guide) | 9% / 13% | 1.4 |
| `goal_3360` | first hero level 3, second hero level 3 and 60 food later than 3 in 4 pros, or never in a long game | Grubby, Beginner's Guide #6 | 16% / 20% | 1.2 |
| `floating` | ≈ unspent gold in the first 10 minutes above the pros' 90th percentile | pro data | 3% / 3% | 1.3 |
| `upkeep_before_upgrades` | went over 50 food with no attack/armor upgrade or caster training (ordered within 30 s), no expansion and no tier 3 | Warcraft 3 Gym (Orc auras guide); Grubby #3 | 2% / 2% | 0.9 |
| `upkeep` | above 80 food with fewer than 2 expansions for longer than 9 in 10 pros (2+ minutes); a basic since 2026-10-18 (food counts in long games are uncertain) | Blizzard's upkeep page; Grubby #3 | 7% / 6% | 0.9 |
| `no_sustain` | a hero died after 6:00 with no potion, healing scroll or Town Portal bought before it | Blizzard hero basics; Grubby | 4% / 6% | 1.6 |
| `one_hero` | one hero all game (15+ min) against two or more | Grubby #6 | 2% / 2% | 1.0 |
| `towers` | more tower orders per base than 9 in 10 pros (and more than 6) | Grubby, Human guide 2026 | 3% / 4% | 1.0 |
| `unanswered_expansion` | they expanded while your army was bigger and you didn't fight for 4 minutes | StrategyWiki | under 1% / under 1% | rare |
| `workers_lost` | ≈ 5+ workers lost by 12:00 (and more than 9 in 10 pros) | Grubby, Human guide | 3% / 5% | 1.6 |
| `just_over_50` | 2+ minutes at 51-54 food without fighting | Grubby #3 | under 1% / under 1% | rare |
| `no_items` | no shop purchase in 12+ minutes | Blizzard hero basics | 0% / 1% | 3.0 |
| `no_scout` | your first unit on their side of the map after 9 in 10 pros (and after 5:00) | pro data; Grubby, Liquipedia | never in pros | – |

## On ladder games

`node scripts/scan-reports.ts` also scores the rules on the ladder sample (the "review" group,
94 perspectives at 1000-2300 MMR: too few for small rules, but a different population than
pros). The main rules separate losses from wins even better there: heroes 5.7 (72% of losses),
fights 3.3, hero deaths 30% of losses and 0% of wins, upgrades 1.8, out_expanded 1.4. Into upkeep
before upgrades, flat on pros (1.0), scores 6.0 on ladder (13% of losses, 2% of wins), so it
stays. Mechanics fires mostly in wins (lift 0.2) by design: it is only shown when fewer than two
other findings fire.

The same script flags suspect reports for review: losses with no finding or only minor ones,
strengths that contradict a shown finding (now removed from the strengths), and losses where
you led in army all game.

## Around the findings (no model needed)

`packages/rules/src/report.ts`, `advice.ts`, and `becauseFor` in `findings.ts`:

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
- **Build library** (`data/builds/`, `packages/rules/src/builds.ts`): 66 food-keyed builds from Grubby, Warcraft 3 Gym and Liquipedia. Each player's opening is matched against them; the match page and the fact sheet show the closest build and where you differ from how pros play it.
- **Vortix's general-concepts video (2026-10-20)** (Spanish; a former top-2 W3Champions player): tested on 856 pro and 94 ladder perspectives.
  - **Became "Why" lines, not findings:**
    - "They cleared 2+ camps on your side of the map by 10:00" under "heroes fell behind": pros 16% of losses, 9% of wins, lift 1.8; on ladder it didn't separate (0.6, small sample). The side of the map comes from the distance to each start (`camps` in the simulation summary).
    - "They bought 3+ more Scrolls of Healing and invulnerability potions" under "fights" in games of 15+ minutes: lift 1.2 on pros, 3.5 on ladder (68 perspectives).
  - **Dropped as findings:** contested middle camps taken by the opponent (lift 0.9), Boots of Speed by 8:00 (1.2 on pros, 0.8 on ladder), Circlet of Nobility by 10:00 (1.3 and 1.0).
  - **Advice updated:**
    - Fights: hit the army; switch to a hero only when it's exposed or its healer just spent the heal, and not while it has an invulnerability potion. This replaces "focus their heroes".
    - Upkeep: when you go over 50, go in one step toward 70-80 with about 1000 gold banked. Above 80 is almost never worth it in 1v1.
    - Creeping between fights: contest the camps between the bases and take the hardest camp you can safely reach.
    - Items: the neutral shop's contested items.
    - Mechanics: heroes on F1-F3, Tab, a grid layout and two item keys.
  - **Matches what we have:** 5 workers per gold mine and about 8 on lumber (Undead about 3 ghouls with Crypt Fiends).
  - **Not measurable:** who your units target in a fight, body-blocking and surrounds, creeping at night while camps sleep.
- **Not measurable from a replay:** creep-camp micro (aggro pulls, purge, ensnare), spell and mana use, positioning, unit counters by armor type (possible later from game data).

## Sources

- Grubby, "10-Part Complete Beginner's Guide for WC3 in 2026" (parts 1-6), GrubbyTalks on YouTube; "NEW Human BEGINNER's Guide", "Ultimate HUMAN guide: Beginner & Intermediate", "The EASIEST beginner build", "Never played Warcraft 3? WATCH THIS!".
- carsoNNN, "A guide to creeping in Wc3", parts I-III (creep micro; not measurable).
- Back2Warcraft, "5 Best Tips & Tricks for Beginners".
- Blizzard Warcraft III basics pages: creeping, hero control, upkeep (classic.battle.net).
- Liquipedia Warcraft: Experience, Creeps, Upkeep, Militia, race and hero pages, build-order pages (read through its API).
- Warcraft3.info "How To Basic" race guides.
- StrategyWiki, Blizzard forums (upkeep discussion).
- Vortix (YouTube): commented games and the general-concepts video.
- Warcraft 3 Gym guides and build orders (57 pages, all races; authors include GotQuail, Gym Coaches, AllSupGoToHeaven, Kaiser, randombadgamer, HoT), saved by hand: their site blocks automated access.

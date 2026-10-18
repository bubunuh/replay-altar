# AI analysis rules

What the "AI analysis" looks for. Rules decide what mattered; the local model only writes it up
(see `packages/ai/src/findings.ts`). Each rule is scored on the pro games by
`node scripts/eval-findings.ts`: from every pro's side, how often it fires in their wins and in
their losses. A useful rule fires more often in losses ("lift" above 1). Numbers below are from
56 Human pro perspectives (37 wins, 19 losses); small samples, so treat them as rough.

## Main findings

| Rule | Fires when | Source | Pro wins / losses |
|---|---|---|---|
| `heroes` | hero XP by 6:00/10:00 worse than 75% of pros, or under 45% of both players' XP | metric research on W3C score sheets | 27% / 63% |
| `fights` | you lost 1.5x more than the opponent in detected fights (and at least 800) | metric research | 16% / 42% |
| `window` | the opponent had no army for 4+ minutes and you neither expanded, made them lose 400+, nor out-levelled pros | W3Stats (punishing greedy play; Warcraft3.info Human guide: use your power spike to expand, creep or attack) | never |
| `exposed` | you had no army for 4+ minutes while they had one | W3Stats | never |
| `economy` | workers below what your bases need (5 on gold per base + lumber crew: Human 9, two bases 12; Orc 7; Night Elf 9) by 3 at 6:00 or by 2 at 10:00 | Grubby, Beginner's Guide #3 (Economy) and Human guides | 14% / 21% |
| `upkeep` | above 80 food for 2+ minutes with fewer than 2 expansions | Blizzard's upkeep page; Grubby #3: "only if you intend to fight very soon" | 22% / 37% |
| `hero_deaths` | your heroes died more often than theirs (2+) | Blizzard hero basics: keep heroes alive, carry a Town Portal | 11% / 16% |
| `no_heroes` | you fought while all your heroes were dead (lost 300+) | Blizzard hero basics: retreat when all heroes are dead | 3% / 0% |
| `supply` | supply blocked longer than 75% of pros | metric research | 24% / 21% |
| `expansion` | no expansion in a 20+ minute game while the opponent expanded | Liquipedia: Human expands early and safely | 3% / 5% |
| `creeping` | creep fights after all your heroes reached level 5 | Blizzard creeping basics; Liquipedia Experience (creep XP 80/70/60/50/0% by level) | 3% / 5% |
| `mechanics` | APM and hotkey use far below pros, shown only when little else stands out | metric research | rare |

## Basics (beginner mistakes, ranked below the main findings)

Thresholds sit outside what the pro games show, so they rarely fire for good players.

| Rule | Fires when | Source |
|---|---|---|
| `first_creep` | 90+ s from first hero to first creep fight (pros: ~10 s) | Liquipedia build orders (all races): creep as soon as the hero leaves the altar |
| `goal_3360` | first hero level 3, second hero level 3 and 60 food reached later than 3 in 4 pros (median 12:20), or never in a long game | Grubby, Beginner's Guide #6: the "3360 rule" |
| `upgrades` | no attack or armor upgrade by 15:00 | pro data (first attack upgrade ~9:00); Grubby: one attack upgrade around 50 food |
| `one_hero` | one hero all game (15+ min) against two or more | Grubby #6: two heroes usually beat one |
| `no_items` | no shop purchase in 12+ minutes | Blizzard hero basics (potions, scrolls, Town Portal) |
| `floating` | ≈ unspent gold in the first 10 minutes above the pros' 90th percentile | pro data |
| `unanswered_expansion` | the opponent expanded while your army was bigger and you didn't fight for 4 minutes | StrategyWiki: attack expansions before they finish |
| `just_over_50` | 2+ minutes at 51-54 food without fighting | Grubby #3: 51 food is "almost no benefit for maximum disadvantage" |
| `towers` | more than 6 tower build/upgrade orders per base | Grubby, Human guide 2026: an arcane tower and maybe a guard tower per base |
| `workers_lost` | 5+ workers lost by 12:00 | Grubby, Human guide: losing ~5 peasants while expanding puts you far behind |

## Also from the sources

- **Opening labels** (`openings.ts`): each player's opening named after Liquipedia's build-order pages.
- **Tested and dropped:** "late expansion vs pros" (fired for half the pros, wins and losses alike), "turtling" (fired only for pros who won), "unanswered expansion vs pros" as a main rule (pros leave expansions alone half the time either way).
- **Not measurable from a replay:** creep-camp micro (aggro pulls, purge, ensnare), spell and mana use, positioning, unit counters by armor type (possible later from game data).

## Sources

- Grubby, "10-Part Complete Beginner's Guide for WC3 in 2026" (parts 1-6), GrubbyTalks on YouTube; "NEW Human BEGINNER's Guide", "Ultimate HUMAN guide: Beginner & Intermediate", "The EASIEST beginner build", "Never played Warcraft 3? WATCH THIS!".
- carsoNNN, "A guide to creeping in Wc3", parts I-III (creep micro; not measurable).
- Back2Warcraft, "5 Best Tips & Tricks for Beginners".
- Blizzard Warcraft III basics pages: creeping, hero control, upkeep (classic.battle.net).
- Liquipedia Warcraft: Experience, Creeps, Upkeep, Militia, race and hero pages, build-order pages (read through its API).
- Warcraft3.info "How To Basic" race guides.
- StrategyWiki, Blizzard forums (upkeep discussion).

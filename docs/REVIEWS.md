# Rule reviews: the app's report vs a reading of the replay

Each game is read by hand from its dossier (`node scripts/review-game.ts <group|me> <key>`:
the rules' report, then the fact sheet: hero timelines, builds, army/workers every 2 minutes,
fights) and compared with what the app says. Reference for tuning the rules: what they get
right, what they miss, and what they get wrong. Players are named by role and MMR only.

Community games come from W3Champions ladder (season 25, `scripts/review-sample.ts`): low
1000-1300 MMR, average 1500-1700, high 2000-2300; pros are the warcraft3.info tournament corpus.
Verdicts: **good** (the top findings are what decided the game), **partial** (right problems,
wrong emphasis or advice), **miss** (the decisive problem is absent or the report misleads).

Rules version: commit after 92968df (2026-10-18).

## Patterns so far

(updated as reviews accumulate; see the per-game notes below)

## My games (the user, Human, ~1500 MMR Battle.net ladder)

### fdf40de7 · HvU loss, 20:15, Echo Isles
- **App:** fights cost far more (why: ≈1275 of recent orders in Siege Engines, which only hit buildings); heroes fell behind (advice: early creeping was good, gap opened after 7:06, keep creeping mid-game); late 3-3-60. Turning point 17:40, an inferred fight, lost ≈1660 vs 0.
- **Replay:** ahead 0-14 min (4 camps by 6:00, workers 15-16 vs 7, army ~2x at 8-10 min). Archmage level 3 from 7:06 to 17:09; opponent teched to Frost Wyrms/Statues. Army lost ~17:40-17:55 (units stop appearing; re-trained right after), Archmage killed in the 19:35 fight; left at 20:15.
- **Verdict: good** (after this round's fixes; before them it missed the decisive fight and gave early-creeping advice). Still missing: items 1 vs 6 (no potions) doesn't reach the threshold of the fights "why" (opponent 8+ items).

### 2bab3856 · HvH loss, 24:25, Tidehunters
- **App:** heroes fell behind (2 camps by 6:00, level 3 at 11:59); fights (2 items vs 21; fights under towers); window 4:00-10:00 (opponent: 7 towers and fast Castle, no army until 10:03). Turning point 17:41.
- **Replay:** opponent turtled with towers and teched to Gryphon Riders + 3 heroes with 21 items; your Riflemen were the right counter (piercing vs light armor) but your heroes were 2-4 levels behind from 15:00 and the fights were lost to hero levels and items.
- **Verdict: good.** Fixed here: the hero-stall line counted their newly trained heroes' first skill point as levels ("went from level 1 to 1").

### f8d4b7a0 · HvO loss, 17:22, Terenas Stand
- **App:** heroes fell behind (level 3 at 12:30, pros 6:18); window 4:00-6:00 (Stronghold 2:05, Fortress 4:38, no army until 6:44); fights (15:09 pitched battle ≈1250 vs 0, their heroes 8 levels vs your 6).
- **Replay:** you led in army all game (2640 vs 1120 at 14:00) and in workers, but their three heroes (Far Seer, Tauren Chieftain, Shadow Hunter) out-levelled yours and Tauren + casters won the 15:09 fight.
- **Verdict: good.** Not flagged and arguable: Castle only at 15:36 while they had Fortress at 4:38.

### 276f7a1a · HvU loss, 18:38, Twisted Meadows
- **App:** fights (0 items vs 13); never used the shop. Turning point 15:24 (≈850 vs 0, going in 2685 vs 505).
- **Replay:** the opponent took 3 extra bases (3:44, 9:41, 10:30) and passed you in workers at 12:00 (15 vs 13, then 18 vs 15) while you stayed on one base until 13:41. You had 2-20x their army from 8:00 to 16:00 and attacked their bases (11:00-13:15) but traded evenly; their Crypt Lord reached level 6 and Frost Wyrms came from 13:46.
- **Verdict: partial.** Items and the 15:24 fight are right, but the main story (they out-expanded you while you had the army to stop it) is absent: no rule compares bases. Candidate rule: "they had 2+ more bases than you for 4+ minutes before 15:00".

### 5de4023f · HvN win, 26:12, Northern Isles
- **App:** high upkeep 852 s on one base; heroes died 4 times (Paladin 3x), no Town Portal; late 3-3-60 (Paladin level 3 at 22:38).
- **Replay:** you led in army from 4:00 to the end (Riflemen + Priests vs Archers/Dryads/Bears); the tavern Paladin never levelled (level 2 at 13:49, 3 at 22:38) and kept dying; 100/100 food from 16:00 on one base and a half.
- **Verdict: good.**

### 14a186b4 · HvH win, 17:27, Twisted Meadows
- **App:** fights cost more (2 items vs 11); supply blocked 81 s.
- **Replay:** the opponent opened Barracks first with fast Riflemen and many upgrades; you lost the early fights (4:15-5:13, 7:59) but out-teched (Castle 6:22) and out-produced them; second hero only at 9:30 and level 2.
- **Verdict: good** for a win; the second hero (level 2 at the end) could have been mentioned.

### 4a53642d · HvN win, 15:00, Last Refuge
- **App:** heroes fell behind; never used the shop. Turning point 10:20 (inferred fight, ≈545 vs 1250).
- **Replay:** right; Mountain King level 1 until 12:11 (the stall line shows it).
- **Verdict: good.** Fixed: "you cleared 2 camps by 6:00 (pros: 2): too little creeping" (a cause at the pro median).

### 364dadcf · HvN win, 20:03, Northern Isles
- **App:** fights (2 items vs 21); late 3-3-60; no healing or Town Portal at the first hero death (10:36, no items yet).
- **Verdict: good.**

### 2aec1d42 · HvO win, 14:11, Autumn Leaves (W3C)
- **App:** reached 50 food and waited (8:00-12:00); mechanics. Turning point 9:47 (you ≈505, they ≈1120; their Far Seer died).
- **Replay:** steady win against mass Headhunters; the second hero came at 10:40 and stayed level 1. "Waited at 50" is fair: the 9:47 fight was started by them.
- **Verdict: good.**

### 760c2a8e · HvN win, 11:30 · 0245f864 · HvO win, 8:13
- **App:** only "into upkeep before any upgrade" (the first upgrade came 4-10 s after crossing 50 food), plus mechanics.
- **Verdict: weak finding.** Crossing 50 food a few seconds before the upgrade order is noise; give it a grace period (e.g. upgrade ordered within 30 s counts).

### 2a215f30 · HvH loss, 6:39, Last Refuge (labelled "hero_rush")
- **App:** heroes fell behind; window 4:00-6:39 (no army, 9 towers, expansion 4:23); floating.
- **Replay:** the opponent never built an army: Archmage at 1:22, towers at home and at their 4:23 expansion (positions checked in the simulation: none near your base). You left at 6:39.
- **Verdict: good** (the window is the point: their expansion was defended only by towers). "Heroes fell behind" at 6 minutes is weak.

### ce3bd669 · HvO loss, 3:26
- Too short for anything but mechanics; fine.

## Community games

### Human

#### Low (1000-1300)

**332b08db · win, MMR 1131 vs 1093, HvH, 14:21.** App: supply blocked 108 s; floating ≈707. Replay: fast expansion at 3:01 and 24 items (potions everywhere) outlasted a one-base fast-Keep opponent; both heroes ahead from 8:00. **Good**: the two habits flagged are real and typical at this level.

**3bf2a2ef · loss, 1272 vs 1248, HvO, 16:18.** App: fights (≈2865 vs 1205); heroes fell behind (1 camp by 6:00). Turning point 9:54 (≈705 vs 150). Replay: fast Keep 3:18 on 13 workers, never expanded; the Orc expanded 8:57, Far Seer reached 5 and they bought 18 items; a mixed Rifle/Breaker/Sorceress army lost every fight from 9:54. **Good.** Also fixed: "1 creep camps".

**fd15fa98 · win, 1096 vs 1103, HvO, 15:17.** App: supply blocked 66 s only. Replay: fast Keep 2:18 and Castle 6:24 into Priests/Knights/Breakers beat Grunts/Raiders/Shamans; the army lead from 2:00 decided it. **Good** (thin, but it was a clean win).

#### Average (1500-1700)

**ce797eda · win, 1528 vs 1570, HvH, 21:53.** App: no clear problem; best: 5 camps by 6:00. Replay: fast expansion 4:14 and 20 workers vs 14 carried it; but the second hero came at 10:19 (pros 6:29) and their heroes led in levels all game, and they had the bigger army at the end. **Partial**: a late second hero isn't a rule of its own (only through 3-3-60, which stayed under its threshold).

**e6644bd9 · win, 1611 vs 1649, HvH, 18:23.** App: floating ≈671; mechanics. Turning point 16:04 (≈0 vs 940, their Paladin and Archmage died). Replay: Keep 2:25, Castle 4:47, Knights + Gryphons + Flying Machines crushed a caster army (trade 94%). **Good.**

**ac863c28 · win, 1560 vs 1549, HvO, 20:28.** App: late 3-3-60 (second hero 9:38); mechanics. Turning point 16:15. Replay: Archmage level 3 at 3:50 (better than every pro game), fast expansion 4:02, a 1045 loss at 10:03 in a base defense, then Gryphons + Knights won. **Good.** Fixed: "a engagement".

#### High (2000-2300)

**8f712f3f · win, 2071 vs 1930, HvO, 15:50.** App: supply blocked 56 s; no attack/armor upgrades in 15 minutes; floating ≈639. Replay: one-base caster army (Priests, Sorceresses, Breakers) with Priest/Sorceress training instead of Blacksmith upgrades; Archmage + Beastmaster ahead in levels all game. **Partial**: "no upgrades" is weak for a caster army whose research went into caster training; the rule could count caster training as investment (to test on pros).

**8e4380b6 · win, 2202 vs 2238, HvN, 15:09.** App: fights cost more (≈1735 vs 810, 30% vs pros 39%); supply blocked 62 s. Replay: lost the 7:01 fight to Archers and Bears, then out-levelled them (Archmage 5) and expanded 6:54. **Good** (for a win: the early lost fights were real).

**292d76e7 · win, 2103 vs 2045, HvU, 18:58.** App: no clear problem. Replay: fast expansion 4:55 and 28 Peasants vs a multi-base Undead (Haunted Gold Mine orders at 2:36, 3:23, 5:06, 6:52, 7:53 — some are surely cancelled or repeated orders); Footmen then Knights. **Good.** Data note: Undead expansions counted from Haunted Gold Mine orders look inflated; check cancels before relying on base counts.

#### Pros (warcraft3.info tournaments)

**3f45d3c6 · win, 2551 vs 2320, HvU, 5:13.** App: supply blocked 13 s (worse than 76% of pros). **Wrong**: per-10-minute scaling made 13 s in a 5-minute game look like 26 s. Fixed: supply needs 30+ s blocked.

**08c1cc36 · loss, HvN, 31:47.** App: high upkeep 760 s from 14:00 on one base (expanded 16:04); hero waited 170 s before creeping (fast Keep 2:21); floating ≈658. Turning point 28:54 (≈1675 vs 205; Archmage, Mountain King and Firelord died). Replay: the Night Elf out-expanded (Trees of Life from 6:42 on, more workers from 10:00) and won the long game with Dryads, Bears and 13 Zeppelins. **Partial**: upkeep and floating are real, but "they had more bases" is the story and no rule says it (second game with this gap).

**9a7df917 · loss, HvN, 15:16.** App: "heroes fell behind" because your share of hero XP was 44%; advice to creep from the altar. **Wrong**: your XP was better than 91% of pros at 6:00; the opponent had one hero (Warden) who took all their XP and reached level 6. First fix (a low share only counts when you were also behind pros) cost the heroes rule most of its value on pro games (68% → 47% of losses), so instead the finding now says "Their heroes out-levelled yours" with advice about denying experience when your own pace was at pro level. The game was lost in two fights at 12:52-13:33 (≈1175 vs 0) against Bears and a level-6 Warden.

### Orc

#### Low (1000-1300)

**a930364d · win, 1187 vs 1168, OvU, 15:09.** App: heroes fell behind (1 camp by 6:00; Far Seer level 2 from 4:25 to 13:40); supply blocked 41 s. Replay: Fortress at 5:16 on 12 workers, three heroes all under level 3 until 12:00; the Undead also barely creeped, and the Orc won on trades (64%) with Headhunters, Raiders and Ensnare. **Good.**

**a5be27fc · win, 1197 vs 1222, OvN, 22:21.** App: supply blocked 72 s; late 3-3-60 (Tauren Chieftain level 3 at 14:53). Turning point 17:04 (≈1015 vs 2120, Keeper died). Replay: heavy item use (18 Clarity, 13 Salves, 7 Town Portals), expansion 10:38, the 17:04 fight won it. **Good.**

**c9f84681 · win, 1187 vs 1196, OvO, 13:21.** App: floating ≈430 (Orc pros' p90 ≈319); mechanics. Replay: Blademaster + Shadow Hunter ahead from 8:00; Raiders + Spirit Walkers won the 10:37-11:16 fights. **Good.**

#### Average (1500-1700)

**d8108cda · win, 1539 vs 1502, OvU, 14:58.** App: no army 4:00-6:00 while they had one; floating ≈720. Replay: Stronghold 1:51, Fortress 4:17 straight into Wind Riders (first at 5:27) — a deliberate all-in tech; the Undead didn't punish it. **Good** (the risk is real even though it worked).

**537625b3 · win, 1616 vs 1561, OvO, 8:05.** App: heroes fell behind (Far Seer level 1 the whole game; waited 101 s before creeping). **Good.**

**4bb3b7e4 · win, 1520 vs 1494, OvU, 17:14.** App: never reached 3-3-60 (60 food never reached). Replay: three heroes ahead (Blademaster 5) with a small army of casters, Batriders and Wind Riders against Frost Wyrms. The simulation detected **no fights at all** in 17 minutes (losses 0 vs 0), so fights, turning point and trades are blind here. **Partial**: 3-3-60's food part is a poor fit for a hero-heavy Orc; and a game with zero detected fights should be flagged as low-confidence rather than silently reported.

#### High (2000-2300)

**66cb4afb · win, 2007 vs 2055, OvU, 17:03.** App: late 3-3-60 (60 food only at 14:50). Replay: Headhunters + Shamans held off a Fiend/Statue army that led in value all game; three heroes, the Tauren Chieftain late. **Good** (nothing bigger to say for a win).

**d407f30a · win, 2259 vs 2248, OvN, 27:48.** App: high upkeep 749 s on one expansion; into upkeep before upgrades (first upgrade 12:16). Turning point 20:28 (≈360 vs 1395, their Pit Lord died). Replay: Raiders/Spirit Walkers/Kodos vs Bears and Dryads; long game decided by expansion fights from 16:50. **Good.**

**60ea5039 · loss, 2096 vs 1985, OvU, 25:31.** App: hero deaths (3 vs 0, 1 Town Portal vs 4); hero waited 375 s before creeping; late 3-3-60. Turning point 14:28 (≈925 vs 0). Replay: Stronghold 1:49 and Fortress 4:22 into Wind Riders, so the first creep came late by design; then Undead Ghouls + 13 Necromancers + Gargoyles won from 14:00. **Partial**: "hero waited before creeping" is the build, not a mistake (a fast-tech opening with Headhunters only at 3:10); the Undead's skeleton army and the lost 14:28/18:53 fights are the story.

**Data quality (found here):** game 4bb3b7e4 had no fights because WC3V stopped reading the replay at 4:33 of 17:14 (`PARSE_TRUNCATED`, "Cannot read properties of null (reading 'timerEvent')"). The same happened in 7-10% of the pro corpus (H 7, O 20, U 13, N 20 games) and 2 review games. Those simulations were still marked ok and fed the pro baselines. Fixed: more than 30 s missing now fails the simulation; profiles, principles and scores rebuilt (370 held-out perspectives).

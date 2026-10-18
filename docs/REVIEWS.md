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

Updated as reviews accumulate (per-game notes below).

**What works.** In most games the top findings match what a reading of the replay says decided
it: hero levels and creeping, fights lost (with items and hero levels as causes), windows the
opponent left open, supply blocks and floating gold at lower levels, high upkeep in long games.
Turning points land on the decisive fight, including fights the simulation only infers from
units disappearing.

**Fixed along the way** (each found in a specific game below):
- Truncated simulations (WC3V stopped reading the replay) were treated as complete: 7-10% of
  the pro corpus; now they fail and are left out.
- Losses inferred late (units stop appearing after a battle) were missed by fight attribution;
  army value counted dead units (the simulation's supply rarely drops).
- Advice that contradicted the game: early-creeping advice for players whose gap opened
  mid-game; "creep from the altar" when the opponent's single hero simply took all their XP;
  "too little creeping" at the pro median; "hero waited" for fast-tech openings whose hero kept
  pro pace by harassing.
- Small-sample artifacts: 13 s of supply block in a 5-minute game scaled to "26 s per 10 min";
  upgrades ordered seconds after passing 50 food.
- Repetition: the late first creep reported twice; wording ("1 camps", "a engagement").
- Fight losses counted twice when WC3V reported overlapping battles (e0898513); a turning point
  that only finished an existing lead (024039ee); battle-summary hero deaths filed under the
  wrong side (244499b5); Crypt Fiends with Web counted as unable to hit air (bb0d8935);
  "kept fighting with all heroes dead" for defending your own base (e1f508dc); "carry a Town
  Portal" to players who had one (9c73463f).

**Open (not fixed yet):**
- *They out-expanded you* was the story of several losses (276f7a1a, 08c1cc36). **Done:** the
  `out_expanded` rule (more bases standing for 4+ minutes before 20:00) scores 1.8 on held-out
  pros (Human 1.0, Orc 1.6, Undead 2.0, Night Elf 2.6) and fires in both games. Base counts now come from the
  simulation's standing halls, one per site 2500+ from the start (an Undead expansion is a
  Necropolis *and* a Haunted Gold Mine; a Night Elf can walk its Tree of Life over without an
  order; Tree of Life orders get cancelled and re-placed). On the pro corpus orders and
  simulation agree for most players; the disagreements are mostly those cases. Changing the
  source moved some scores (upkeep 1.3 → 1.0, upkeep before upgrades 1.1 → 1.0; mine dry fires
  more, same lift), so those rules need another look with the better counts.
- Items gap below the 8-item threshold (1 vs 6) went unmentioned: the fights "why" now needs 5+ items and 3x yours.
- Fixed after more pro reviews: "your fights cost far more" next to a whole-game trade better than pros (d8946bf3, b3244d52); upkeep demoted to a basic (lift 1.0 with accurate bases).
- A late second hero has no rule of its own (only through 3-3-60). Tested a basic ("second hero later than 9 in 10 pros of the matchup, or none in 12+ minutes"): 8% of pro wins and 8% of losses (lift 1.0; Night Elf 0.4 — solo-hero builds), so not added.
- "No attack/armor upgrades" fires for caster armies and Orc builds whose research went
  elsewhere. **Tested:** caster training now counts for "into upkeep before upgrades"
  (5c1b123e), but not for the upgrades rule: excusing it kept the lift (1.7) and only made the
  rule rarer.
- Games with no detected fights at all should carry a low-confidence note. **Done:** the recap
  says when the replay couldn't be simulated or a 10+ minute game had no detected fights.
- Food counts late in long games are uncertain both ways: the simulation's supply counter keeps
  dead units (pros "at 100 food" after losing half their army), while counting only units it
  hasn't marked lost undercounts badly (units that sit without orders get "possibly lost": one
  pro at 35 food at 24 minutes). Tried for the upkeep rule and reverted; upkeep evidence in long
  games should be read with that in mind. Army value uses living units (the same caveat).

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

**Extra low Human games (sampled twice by mistake):**

**a96b1a6d · loss, 1084 vs 1078, HvU, 21:44.** App: too few workers (8 at 6:00 of 14; 15 at 10:00 of 22 on two bases); supply blocked 89 s; no upgrades. Turning point 17:35 (≈770 vs 0, Paladin died). Replay: Archmage level 3 at 3:56 (better than 92% of pros) but a thin economy; 12 Flying Machines answered their 8 Gargoyles; lost the 17:17-19:51 fights to Ghouls, Statues/Destroyers and Abominations with Unholy upgrades. **Good.** Odd evidence line: "main hall idle 70 s (worse than 18% of pros)" sits under a too-few-workers finding — a good number shown as if it explained the problem; show the idle line only when it is worse than the pro median.

**6edf0b1a · loss, 1086 vs 1067, HvU, 12:52.** App: fights (≈990 vs 480; two creep fights lost at 8:54 and 9:32, Blood Mage died 10:49); supply blocked 39 s. Replay: you led in army and workers from 6:00 but lost units on creeps and the 10:24 fight; their three heroes caught up by 12:00. **Good.**

**069784cd · win, 1201 vs 1263, HvH, 46:16.** Report said "never reached 3-3-60" and showed only ≈235 lost in fights in 46 minutes. The simulation had read only part of the replay (truncated); the review group wasn't covered by the truncation fix until `sim --resummarize` included it. Now failed. **Invalid sample.**

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

**7b53cabe · loss, 2411 vs 2721, HvN, 14:12.** App: hero deaths (Paladin twice, no Town Portal); their heroes out-levelled yours (your pace at pro level, share 38%, Archmage level 3 from 5:50 to 12:36); fights (5 items vs 21, their heroes 7 levels vs 5 at 10:51). Turning point 10:51 (≈700 vs 0). Replay: fast expansion 4:15 and 22 Peasants vs a Night Elf fast expansion with 34 Wisps, three heroes and 10 Orbs of Venom. **Good.**

**73f5d018 · loss, HvO, 27:25.** App: hero deaths (4 vs 1); their heroes out-levelled yours (Far Seer 6; your Paladin level 3 from 9:28 to 20:54); fights ≈12900 vs 6075 with three tower dives. Turning point 12:19 (≈1440 vs 300, Paladin died). Replay: you out-mined them (20505 gold vs 13315) and led in army most of the game, but kept attacking into their base and lost the units. **Good.**

**e0898513 · win, HvN, 26:41.** App: no attack or armor upgrade until 18:16; high upkeep 822 s on one expansion; 16 tower orders for 2 bases. Turning point 23:36. Replay: a tower-heavy Human (9 Scout, 3 Arcane, 4 Guard Towers) with 45 Peasants into Riflemen, Priests and Spell Breakers against Huntresses, Dryads and Druids of the Claw; won from 18:00. **Good**, but the fight totals were inflated: WC3V reported two battles at 23:36 and 23:39 and each counted the same ≈1790 of losses (the opponent's total read ≈10150). Fixed: overlapping fights now split the losses (a fight's window starts where the previous one ended); totals here are now ≈6700 vs ≈7140. The fights rule was re-tuned on the honest numbers (1.3× instead of 1.5×: lift 1.8, fires in 33% of pro losses).

**5c1b123e · win, HvO, 14:32.** App: they had more bases from 10:00 (their expansion 7:22); into upkeep before upgrades. Replay: a caster build (Priests, Sorceresses, 11 Spell Breakers, with Priest and Sorceress Training) against Raiders, Shamans and Kodos. **Partial**: caster training is this build's investment at 50 food. Fixed: caster training (any race) now counts for "into upkeep before upgrades". It doesn't excuse "no attack or armor upgrades for 15 minutes": counting it there kept the same lift (1.7) and only made the rule rarer, so caster players without upgrades still lose more often.

**16b90693 · win, HvU, 16:11 (MMR 2555 vs 2316).** App: heroes fell behind (Archmage level 3 from 4:59 to 14:09); hero deaths (Mountain King 2x, no Town Portal); supply blocked 78 s. Turning point 14:35 (≈0 vs 640). Replay: towers and Footmen, then Flying Machines and Knights with 2/2 upgrades against Fiends and Statues that led in army from 8:00; the Human won at the end. **Good.**

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

#### Pros

**40d3187b · win, OvH, 15:34.** App: fights cost more (11:45 ≈1180 vs 175); no attack/armor upgrade in 15 minutes. Replay: Far Seer + Tauren Chieftain ahead in levels, Raiders/Shamans/Kodos; the Human had more army at the end. **Good** for a win. The upgrades evidence said "pros: around 9:00" for every race; Orc pros' median is ~12:00 — fixed to show the matchup's pro median.

**21e6e0d9 · loss, OvN, 17:09.** App: mine ran dry with no expansion; no upgrades; reached 50 food at 10:00 and waited. Replay: one-base Raiders/Spirit Walkers vs 24 Wisps, Dryads and Bears; both heroes behind from 4:00; lost two creep-fight ambushes at 14:48 and 15:06 (≈735 each, inferred). **Good.**

**b5150703 · loss, OvH, 18:47.** App: heroes fell behind (0 camps by 6:00; first hero waited 377 s); no upgrades; and the same late creep again as a separate basic. **Good** content, **repetitive** form: the first-creep basic now stays out when the heroes finding fires (it already names the late first creep). Fixed "1 camps".

**9bd71eb9 · loss, OvH, 14:04.** App: only "into upkeep before upgrades". Replay: you led in army at the end (3300 vs 2075) after winning the 11:50 fight (≈300 vs 1155); the replay doesn't show why the game ended. **Thin, nothing better to say.**

**26652a59 · loss, OvN, 28:50.** App: heroes fell behind (1 camp by 6:00); never expanded; no army 4:00-6:00. Turning point 9:27 (≈800 vs 0). Replay: a one-hero Far Seer build with 19 Batriders and 7 Watch Towers on one base against a two-hero Night Elf who expanded at 9:59 and switched to Hippogryphs. **Good**, except the advice told a one-hero player to "bring the second hero creeping" — fixed (only with two heroes).

**cf4440d4 · loss, OvH, 11:33.** App: heroes fell behind. Replay: you led in army (2750 vs 1920 at the end) and trades (82%) when the game ended at 11:33 — a leave or disconnect, not a lost game on the map. **Misleading**: the recap now says when a loss ended with your army clearly bigger ("if you didn't leave on purpose, it may have been a disconnect").

**b77adad4 · loss, OvU, 31:59.** App: heroes fell behind; never expanded; never reached 3-3-60. The replay could not be simulated, which the report didn't say. Replay: Stronghold at 1:47 with no army for 5 minutes, into Wind Riders and later Spirit Walkers and Tauren, on one base against an Undead who expanded at 4:36 and built 9 Necromancers and 18 Fiends. **Good** as far as it goes. Fixed: the recap now says when the replay couldn't be simulated ("fights and army sizes aren't judged") and when a 10+ minute game had no detected fights.

**28678b57 · win, OvU, 26:14.** App: heroes fell behind (Blademaster level 3 only at 12:31); fights cost more (≈2550 vs 965, one under their towers at 19:40); never expanded. Turning point 17:00 (≈160 vs 770). Replay: an air opening (Wind Riders at 5:53) that did little, then Headhunters and Kodos; the Undead led in army all game and the game ended in the Orc's favour, probably a leave. **Fine** for a strange game.

**423b2ca3 · win, OvH, 11:46.** App: nothing stood out; strengths 14 workers at 10:00, gold 8370 vs 5750. Replay: Grunts, Raiders with Ensnare and Shamans broke a Rifleman/Priest/Sorceress Human at 8:56 (≈220 vs 400 there, ≈1120 in total). **Good.**

**d2dc5ccd · loss, OvN, 27:54.** App: fights cost far more (≈5710 vs 3450; at 23:57 your heroes had 8 levels, theirs 10); their heroes out-levelled yours (34% of the XP although your own pace was far above pros'); never expanded. Turning point 23:57 (≈1600 vs 280). Replay: one base, 8 Watch Towers and 10 Demolishers against 38 Archers and 45 Wisps on two bases. **Good**, except the "why" said "3 of your losing fights were under their towers": the Night Elf had no towers; those were their attacks into the Orc's own Watch Towers. Fixed: the tower cause only counts dives you started into a base that had towers (WC3V also calls attacks on Night Elf ancients tower dives).

**908ce93b · loss, OvN, 30:54.** App: high upkeep 774 s with no expansion; late 3-3-60. Replay: Grunts, Raiders and Spirit Walkers led in army from 6:00 and won the trades (≈5225 vs 9405), but stayed on one base (an expansion at 10:04 never stood) while the Night Elf took bases at 16:10, 19:03 and 23:19 with Druids of the Claw and Dryads. **Missed the story**: "they had more bases" didn't fire because it only looked before 20:00, and the Night Elf's second base finished at about 18:10. Fixed: the rule now looks at the whole game (same lift 1.8; 26% of pro losses instead of 21%), and here it is the top finding (4 bases vs 2 at the end).

**12ba05d2 · loss, OvU, 10:40.** Not simulated (the recap says so). App: heroes fell behind (XP by 10:00 978, pros 1332). Replay: Headhunters into Raiders against a fast-expanding Ghoul Undead (expansion 3:03, 16 Ghouls); the Orc had more hero XP (54%). **Thin**, nothing better to say without the simulation.

### Undead

#### Low (1000-1300)

**bb0d8935 · win, 1108 vs 1128, UvO, 13:08.** App: heroes fell behind (1 camp by 6:00; Crypt Lord first hero waited 82 s); army mismatch (52% damage against their armor); into upkeep before upgrades. Replay: a Crypt Lord first, Crypt Fiends with Web (7:17) and two Statues against 8 Wind Riders; both players creeped equally little (XP share 50%). **Wrong** on the mismatch: Crypt Fiends were counted as unable to hit air, but Web brings air units down for them, and piercing does 200% to the Wind Riders' light armor. Fixed: Web (Crypt Fiend) and Ensnare (Raider) now make the unit count as anti-air once researched. The creep advice also named "the Death Knight or Dreadlord" to a Crypt Lord player; it now names your actual first hero.

**cadefd0e · win, 1274 vs 1260, UvH, 20:45.** App: supply blocked 35 s. Turning point 13:54 (≈0 vs 845, Blood Mage died). Strengths: 3 camps by 6:00, gold 15075 vs 8655. Replay: fast expansion at 3:25, mass Ghouls with 3/3 upgrades and a Pandaren, later Frost Wyrms, against Riflemen and Knights; the Human never expanded. **Good.**

**024039ee · win, 1207 vs 1239, UvH, 17:22.** App: no attack or armor upgrades for 15 minutes. Turning point 13:49 (≈310 vs 940), army going in 2980 vs 850. Replay: fast Halls (2:34) and Black Citadel (5:04) into Statues/Destroyers and Abominations; the lead came from a string of fights from 8:00 on (an expansion fight and creep-site fights where the Human lost ≈1600). **Partial**: a fight with a 3.5× army going in finishes a lead rather than turns the game. Fixed: when the winner already had 2× the army and +1000 going in, the turning point adds "you were already far ahead going in: your army had been bigger since 7:00".

#### Average (1500-1700)

**e1f508dc · loss, 1700 vs 1651, UvO, 21:02.** App: hero deaths (3 vs 0; no Town Portal, 0 potions vs 10); kept fighting with all heroes dead; heroes fell behind (31% of the XP; Lich level 3 from 11:51 while the Far Seer went 4 to 6). Turning point 15:02 (≈925 vs 400, Death Knight and Lich died). Replay: Gargoyles and Statues against 11 Wind Riders and Batriders; the Orc expanded at 12:24 and won the 15:02 fight at the Undead's towers, then pushed in with Demolishers. **Good**, except "kept fighting with all heroes dead" counted fights the Orc started at the Undead's own towers (≈1160 of the ≈1235), where retreating isn't an option. Fixed: fights they start into your towers or base no longer count; the rule now fires in 0% of pro wins and 1% of losses.

**9fbf80de · win, 1528 vs 1516, UvH, 15:02.** App: no attack or armor upgrades (neither player got one); they had more bases from 6:00 to 12:00 (their expansion 3:22, yours 11:46). Strengths: 3 camps by 6:00, 64% of the hero XP. Replay: fast tech into Statues/Destroyers against a fast-expanding tower Human; the Undead's hero lead carried it. **Good.**

**9fd60b64 · win, 1564 vs 1540, UvH, 15:03.** App: they had more bases from 8:00 (expansion at 5:33, none of yours); mechanics (130 APM, 29% hotkey selections). Turning point 7:19 (≈255 vs 1015). Strengths: 74% of the hero XP, 71% trades. Replay: one-base Fiends into 7 Statues/Destroyers broke a Footman/Shadow Priest army with 27 Peasants and 9 towers. **Good.**

#### High (2000-2300)

**a3de68d6 · loss, 2008 vs 2011, UvO, 11:16.** App: supply blocked 111 s; fights cost more (≈1335 vs 915; one under their towers at 6:10, Lich died ≈8:07). Strengths: 65% of the hero XP. Replay: Ghouls into 5 Crypt Fiends with no research at all, against Headhunters, 5 Watch Towers and Demolishers; the Undead attacked into the towers at 6:10 and lost the trade and the Lich. **Good.**

**21de9bf5 · loss, 2030 vs 2069, UvO, 14:56.** App: the recap flags a probable disconnect (your army 3150 vs 925 at the end); hero deaths (Death Knight and Lich, no Town Portal). Strengths: 3-3-60 at 11:40. Replay: Crypt Fiends with Web against a Wind Rider fast tech that had no army for 5 minutes; the Undead won the only big fight (11:36, ≈255 vs 1440) and led in army from 4:00. **Good**: the disconnect note is the right headline.

**5a941295 · loss, 2006 vs 1950, UvU, 21:20.** App: hero deaths (Forsaken Paladin 2x, no Town Portal); their heroes out-levelled yours (44% of the XP; two level-5 heroes against 4, 4 and 2); fights cost more (two lost fights under their towers, 14:12 and 19:08). Turning point 19:08 (≈1650 vs 0). Replay: Ghouls and 13 Gargoyles against 16 Crypt Fiends with Web and Statues; the opponent led in army from 10:00. **Good**, with two weak spots, both fixed: the fact sheet's "hero levels (sum)" trend said you led from 8:00 because three heroes sum higher than two (it now trends the experience those levels stand for: you led 8:00–14:00, they led from 16:00); and "workers by 6:00: 9 vs 2, better than 100% of pros" was listed as a strength, though for Undead more early Acolytes mean an expansion, not better play (no longer a strength for Undead).

#### Pros

**d9617f59 · loss, UvO, 4:15.** App: nothing stood out (game over at 4:15, ahead in army). Probably a disconnect or an early leave; nothing to judge. **Fine.**

**3b6fd9fa · loss, UvO, 26:04.** App: heroes (Death Knight level 3 from 15:09 to 25:08; mid-game advice since early creeping was good); hero deaths (Death Knight 3x, Lich 1x; 4 potions vs 17); fights (their heroes 14 levels vs 10 at 21:01). Turning point 21:01 (≈880 vs 0, Death Knight died). Replay: a long game where Blademaster and Shadow Hunter reached level 6 by killing the Death Knight repeatedly; you led in army and workers. **Good.**

**e289a1ab · loss, UvH, 10:14.** App: heroes fell behind (0 camps by 6:00, Lich waited 312 s, level 2 from 4:01); fights (three losing fights at 4:44-6:41, one under their towers). Replay: an 18-Ghoul push into a fast-expanding Human that held with Footmen and towers while their Archmage reached level 4; no creeping at all. **Good.**

**8558ab14 · loss, UvN, 16:59.** App: supply blocked 79 s (worse than 99% of pros); their heroes out-levelled yours; no upgrades. Turning point 14:58 (≈950 vs 335; Lich and Naga died). Replay: one-base Fiend/Statue army against Bears and Dryads; the Demon Hunter reached 5. **Good**, but the heroes finding mixed messages ("your pace was at pro level" plus "too little creeping"): creeping causes now only accompany "your heroes fell behind".

**d8946bf3 · loss, UvO, 18:37.** App: "your fights cost far more" with a whole-game trade of 57% (pros' median 45%) in the same evidence. **Contradictory**: the detected fights (2360 vs 1490) and the whole-game trade disagree. Fixed: the fights finding stays out when the overall trade is at or above the pro median (holdout lift 2.0 → 2.2). Replay: Ghouls + Statues vs 29 Headhunters and Raiders; lost the army lead from 12:00 to Orc upgrades (Ranged 2) while having none.

**b3244d52 · win, UvH, 12:16.** App: fights (trade 54% vs pros 53% — now silenced by the same fix); ≈5 workers lost; into upkeep before upgrades. Replay: fast expansion 2:35 and 25 Ghouls; Death Knight only at 11:01. **Partial** before the fix.

**4db678b4 · loss, UvO, 23:14.** App: the recap says the game ended with your army far bigger (4565 vs 1535), so maybe a disconnect; their heroes out-levelled yours (37% of the XP although your own creeping was at pro pace); hero deaths (Lich 2x; 5 potions vs 21); supply blocked 53 s. Replay: 34 Ghouls and 8 Statues with 2/2 upgrades led in army from 2:00 to the end and won almost every fight. **Good**: the disconnect note fits, and the levelling gap is real.

**9c73463f · loss, UvN, 28:15.** App: hero deaths (Death Knight and Crypt Lord at 23:31 and 23:44); heroes fell behind after 6:01; into upkeep before upgrades. Turning point 19:45 (≈1845 vs 0). Strengths: gold 22525 vs 14990. Replay: Fiends, Statues, Abominations and late Gargoyles against Dryads and 15 Druids with 3/2 upgrades; the 19:45 fight lost the army, the 23:02 fight won back ≈2110 but cost both heroes. **Good**, except the advice told a player with 2 Town Portals and 17 potions to "carry a Town Portal". Fixed: with a Town Portal bought, the advice says to use it, or a potion, as soon as a fight turns.

**244499b5 · loss, UvO, 29:32.** App: heroes fell behind (0 camps by 6:00; first hero waited 256 s); mine ran dry with no second base (≈14270 gold from one base); high upkeep 893 s with no expansion. Turning point 19:08 (≈2020 vs 465). Replay: one-base Ghouls/Statues with three heroes (Dark Ranger third) against Headhunters, Kodos and Wind Riders; the Orc out-mined it all game. **Good**, except the turning point said "your Shadow Hunter and their Shadow Hunter died": WC3V's battle summary filed the Orc's hero under the Undead too. Fixed: hero deaths from the battle summary only count heroes the player trained.

### Night Elf

#### Low (1000-1300)

**054e0963 · loss, 1187 vs 1228, NvU, 27:28.** App: fights cost far more (≈4045 vs 1380; a dive into their towers at 23:26, Naga Sea Witch died); too few workers (9 Wisps at 6:00 and 10:00; Tree of Life idle 94 s); supply blocked 114 s. Turning point 22:18 (expansion fight, ≈860 vs 255). Strengths: 3-3-60 at 9:49, hero XP. Replay: the Night Elf's heroes led until 24:00, but Archers, Hippogryphs, Dryads and 2 Mountain Giants lost fight after fight to Fiends and Abominations on a small economy. **Good.**

**f2faab3a · loss, 1025 vs 972, NvH, 11:15.** App: fights cost far more (≈810 vs 0; a dive at 9:27 lost ≈670 with both heroes); mechanics (70 APM). Turning point 9:27. Strengths: 4 camps by 6:00, hero level 3 at 5:04. Replay: 6 Archers and 4 Druids of the Claw attacked a Rifleman/Priest Human under its Arcane Tower with half the army value (475 vs 1275). **Good.** Two small fixes: the fight evidence listed a 0-vs-0 fight among "your losing fights" (now only fights you lost more in), and "your Demon Hunter and your Naga Sea Witch and their Blood Mage died" now reads "A, B and C".

**22073328 · loss, 1096 vs 1075, NvU, 25:17.** App: too few workers (9 at 10:00); hero deaths (Keeper 2x, with 2 Town Portals: the advice says to use them); their heroes out-levelled yours (35%; Forsaken Paladin level 3 from 9:47 to the end while their Lich went 2 to 5). Replay: Dryads, Druids of the Claw and late Hippogryphs against Fiends, Statues and Abominations that led in army all game; the fights traded evenly (≈1870 each), so economy and hero levels are the story. **Good.**

#### Pros

**057ae56c · loss, NvH, 25:50.** App: their heroes out-levelled yours (your own pace at pro level; their Archmage reached 6); no attack/armor upgrades by 15:00. Turning point 16:48 (≈1880 vs 860, going in 3230 vs 1755). Replay: fast expansion 2:36, Bears + Dryads against Knights, Mortars and casters with Swords 2 by 9:00; the 16:48 attack with the bigger army was lost. **Good.** Note: the Night Elf "expansions" list (2:36, 4:04, 5:26, 13:53) counts every Tree of Life order; counts of bases from orders are unreliable for Night Elf and Undead.

**64fbe88a · loss, NvH, 26:14.** App: supply blocked 32 s; no upgrades by 15:00 (they had Gunpowder 2, Plating 2, Swords 2). Turning point 13:58 (base defense, ≈1675 vs 565). Replay: Bears/Dryads with no Hunter's Hall upgrades against a fully upgraded, potion-heavy Human (27 healing items). **Good**: the upgrade gap is the story; the items gap (yours 12, mostly not healing) isn't mentioned.

**875003a8 · result unknown, NvO, 10:06.** App: nothing stood out (you ahead in hero XP and workers). **Fine.**

**c48833de · win, NvH, 13:19.** App: supply blocked 55 s. Turning point 10:20 (≈615 vs 1675; their Archmage and Mountain King died). Replay: tavern Beastmaster first, Dryads; the 10:20 tower dive killed both their heroes. **Good.**

**364b43fe · win, NvO, 26:47.** App: heroes fell behind (share 43%; mid-game advice: the gap opened after 15:36); late 3-3-60 (Pit Lord level 3 at 17:40). Replay: fast expansion 2:40 and 35 Wisps, Bears from 10:00; their Shadow Hunter reached 7 while your tavern Pit Lord levelled slowly. **Good.**

**b9d19af7 · win, NvO, 11:30.** App: too few workers (10 at 6:00, 9 at 10:00; target 14). Replay: one-base fast Tree of Ages into Bears; Night Elf Wisps are consumed by buildings, and the worker floor already uses the Night Elf pros' 10th percentile (≈10.6), so this is a borderline call. **Fine.**

**bdb923f9 · loss, NvH, 16:11.** App: heroes fell behind (1 camp by 6:00; Demon Hunter level 2 from 2:56 to 11:03); no upgrades (they had attack and armor at 10:38). Turning point 14:02 (≈1390 vs 0). **Good.**

**550333c4 · loss, NvO, 12:18.** App: fights (5 items vs 16); heroes fell behind (level 3 at 8:39; share 31%). Replay: Bears against Grunts/Spirit Walkers/Kodos; both Orc heroes reached 4. **Good.**

**e81e985d · loss, NvO, 39:12.** App: hero deaths; heroes (Demon Hunter level 3 from 18:04 to 33:36, mid-game advice); high upkeep on one base from 16:00 (expanded only at 26:59). Turning point 13:29. Replay: 39 minutes of Archers + Dryads (no tier 3 ever) against Wind Riders, out-mined by the Orc from 6:00 to 30:00. **Good**; "never teched in 39 minutes" isn't a rule and probably shouldn't be (some builds stay on tier 2).

**b5741d4e · loss, NvH, 19:04.** App: heroes fell behind (0 camps by 6:00; tavern Beastmaster level 3 only at 11:23); hero deaths (2 vs 0, no Town Portal); supply blocked 31 s. Turning point 15:39 (≈1650 vs 1095). Replay: 23 Archers and 5 Druids of the Claw against a tower Human (11 tower orders) with Riflemen, Priests and Sorceresses whose Archmage reached level 5. **Good.**

**60f477c6 · win, NvO, 9:03.** App: nothing stood out; strengths 70% of the hero XP, 74% trades. Replay: Archers and a fast Tree of Eternity; the Orc had 5 Grunts and left at 9:03. **Good.**

**8e6cc82d · loss, NvH, 27:01.** App: fights cost far more (≈4180 vs 2705; 6 items vs 19; their 2 upgrade levels vs 0); their heroes out-levelled yours (38%); floating ≈1094 in the first 10 minutes. Turning point 12:47 (≈1005 vs 145, Priestess of the Moon died). Replay: a fast-expanding Druid of the Claw / Faerie Dragon / Hippogryph Night Elf against Knights, Priests and then 10 Flying Machines with 3/3 melee and 2 armor upgrades; the Human led in army from 4:00. **Good.**

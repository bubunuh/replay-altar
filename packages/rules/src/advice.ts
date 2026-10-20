// "Next time" for each rule: what to do differently, written by hand from the same guides the
// rules come from (Grubby's beginner series and race guides, Warcraft 3 Gym, Liquipedia), with
// the race's own buildings and units and the pros' numbers where the rule has them.
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { RACES, type RaceCode } from "@replay-altar/core/gamedata";
import { nameOf } from "@replay-altar/core/names";
import { tr, trTable } from "@replay-altar/core/i18n";
import type { FactsRef } from "./facts.ts";
import { mmss } from "./series.ts";
import { heroStall } from "./rules/core.ts";

export type AdviceCtx = { r: GameRecord; me: PlayerRecord; opp: PlayerRecord; ref: FactsRef | null };

const SHOP: Record<RaceCode, string> = { H: "hvlt", O: "ovln", U: "utom", N: "eden" };
const SMITH: Record<RaceCode, string> = { H: "hbla", O: "ofor", U: "ugrv", N: "edob" };
/** What a race creeps with in the first minutes (Liquipedia build orders). */
const FIRST_CREEP: Record<RaceCode, string> = trTable({
  H: ["your first hero, Militia and the first Footmen", "seu primeiro herói, a Militia e os primeiros Footmen"],
  O: ["your first hero and the first Grunts or Headhunters", "seu primeiro herói e os primeiros Grunts ou Headhunters"],
  U: ["your first hero and your first Ghouls", "seu primeiro herói e os seus primeiros Ghouls"],
  N: ["your first hero and the first Archers, healing at the Moon Wells", "seu primeiro herói e as primeiras Archers, curando nos Moon Wells"],
});
/** The first-creep party, naming the hero you actually trained first. */
const firstCreep = (c: AdviceCtx, R: RaceCode) => {
  const hero = c.me.heroes[0]?.name;
  return hero ? FIRST_CREEP[R].replace(tr("your first hero", "seu primeiro herói"), tr(`your ${hero}`, `seu ${hero}`)) : FIRST_CREEP[R];
};
/** How a race answers worker harassment (Grubby's race guides). */
const HARASS_ANSWER: Record<RaceCode, string> = trTable({
  H: ["ring Call to Arms (Militia) or pull Peasants away", "toque o Call to Arms (Militia) ou tire os Peasants de lá"],
  O: ["put Peons in the Burrows (Battle Stations)", "coloque os Peons nas Burrows (Battle Stations)"],
  U: ["pull Acolytes away and bring Ghouls home", "tire os Acolytes de lá e traga os Ghouls para casa"],
  N: ["pull Wisps away; Ancient Protectors and Moon Wells defend", "tire os Wisps de lá; Ancient Protectors e Moon Wells defendem"],
});

const pro = (c: AdviceCtx, key: string) => c.ref?.mp.metrics[key]?.p50 ?? null;
const race = (c: AdviceCtx) => (c.me.race as RaceCode) in RACES ? (c.me.race as RaceCode) : "H";

const midGame = () =>
  tr(
    "Between fights, keep both heroes creeping: clear the camps on your side, then contest the ones between the bases (each one you take is one they can't), and take the hardest camp you can safely reach; give the second hero the last hits so it levels too. A hero that stands in base for minutes falls behind theirs.",
    "Entre as lutas, mantenha os dois heróis creepando: limpe os acampamentos do seu lado, depois dispute os que ficam entre as bases (cada um que você pega é um a menos para eles), e pegue o acampamento mais difícil que você alcança com segurança; deixe o último golpe para o segundo herói para ele upar também. Um herói parado na base por minutos fica para trás dos deles.",
  );

/** The advice for a finding, or null when the rule has none. */
export function adviceFor(id: string, c: AdviceCtx): string | null {
  const R = race(c);
  const m = c.me.metrics;
  switch (id) {
    case "heroes": {
      // Good early creeping and a stall later: the gap is mid-game, so is the advice.
      const stall = heroStall(c);
      const goodEarly = (m.creep_camps_6m ?? 0) >= (pro(c, "creep_camps_6m") ?? 2);
      if (goodEarly && stall && stall.to - stall.from >= 6 * 60_000 && stall.from >= 6 * 60_000) return tr(`Your early creeping was good; the gap opened after ${mmss(stall.from)}. `, `Seu creep no começo foi bom; a diferença abriu depois de ${mmss(stall.from)}. `) + midGame();
      const l3 = pro(c, "hero_level3_ms");
      const camps = pro(c, "creep_camps_6m");
      const fewCamps = camps !== null && (m.creep_camps_6m ?? 0) < camps;
      return tr(
        `Creep from the moment your hero leaves the altar, with ${firstCreep(c, R)}, and go straight from one camp to the next; pros reach hero level 3 by ${mmss(l3)}${fewCamps ? ` and clear ${camps} camp${camps === 1 ? "" : "s"} by 6:00` : ""}. ${c.me.heroes.length >= 2 ? "Bring the second hero creeping too, and buy" : "Buy"} a healing item so you can keep creeping instead of walking home.`,
        `Comece a creepar assim que o herói sair do altar, com ${firstCreep(c, R)}, e vá direto de um acampamento para o próximo; os pros chegam com o herói no nível 3 até ${mmss(l3)}${fewCamps ? ` e limpam ${camps} ${camps === 1 ? "acampamento" : "acampamentos"} até 6:00` : ""}. ${c.me.heroes.length >= 2 ? "Leve o segundo herói para creepar também, e compre" : "Compre"} um item de cura para continuar creepando em vez de voltar para a base.`,
      );
    }
    case "fights": {
      const items = [m.items_bought ?? 0, c.opp.metrics.items_bought ?? 0];
      const fewItems = items[1] >= 5 && items[1] >= 3 * Math.max(1, items[0]);
      return tr(
        `Take fights only where you are stronger: with your heroes alive and at least as high level, after an upgrade, never under their towers. ${fewItems ? `Bring potions and a Town Portal (${nameOf(SHOP[R])}) before the fight. ` : ""}Hit their army; switch to a hero only when it is exposed or their healer has just spent its heal (Holy Light, Death Coil), and not while it can drink an invulnerability potion. Pull back wounded units and heroes instead of losing them: each one gives their heroes experience.`,
        `Só aceite lutas em que você é mais forte: com seus heróis vivos e pelo menos no mesmo nível, depois de um upgrade, nunca debaixo das torres deles. ${fewItems ? `Leve poções e um Town Portal (${nameOf(SHOP[R])}) antes da luta. ` : ""}Bata no exército deles; troque o foco para um herói só quando ele estiver exposto ou o curandeiro deles acabou de gastar a cura (Holy Light, Death Coil), e não enquanto ele puder tomar uma poção de invulnerabilidade. Recue unidades e heróis feridos em vez de perdê-los: cada um dá experiência aos heróis deles.`,
      );
    }
    case "window":
      return tr("When the opponent has no army for minutes (fast tech or towers), take an expansion right away, or go hit their creeping hero and their expansion: every minute of that window is free.", "Quando o oponente fica sem exército por minutos (fast tech ou torres), pegue uma expansão na hora, ou vá atacar o herói creepando e a expansão dele: cada minuto dessa brecha é de graça.");
    case "exposed":
      return tr("Keep some army from the first minutes; a lone hero can't creep safely or defend. Train units from your first production building non-stop until about 30 food.", "Tenha algum exército desde os primeiros minutos; um herói sozinho não consegue creepar com segurança nem defender. Treine unidades no seu primeiro prédio de produção sem parar até uns 30 de food.");
    case "economy":
      return R === "U"
        ? tr("Keep the Necropolis training Acolytes until 5 are on each gold mine; Ghouls cut the lumber. Queue one Acolyte at a time so gold isn't locked.", "Mantenha a Necropolis treinando Acolytes até ter 5 em cada mina de ouro; os Ghouls cortam a madeira. Coloque um Acolyte de cada vez na fila para não travar ouro.")
        : tr(`Keep the ${nameOf(RACES[R].townHalls[0])} training workers non-stop (one in the queue at a time) until each gold mine has 5 and the lumber crew is full; train more before you expand so the new base starts full.`, `Mantenha o ${nameOf(RACES[R].townHalls[0])} treinando trabalhadores sem parar (um na fila de cada vez) até cada mina de ouro ter 5 e a equipe da madeira estar completa; treine mais antes de expandir para a nova base já começar cheia.`);
    case "supply":
      return tr(`Start the next ${nameOf(RACES[R].supply)} when you are 6-8 food below the cap, not when you hit it; before a big round of production, start two.`, `Comece o próximo ${nameOf(RACES[R].supply)} quando estiver 6-8 de food abaixo do limite, não quando chegar nele; antes de uma rodada grande de produção, comece dois.`);
    case "hero_deaths":
      if ((m.tp_bought ?? 0) > 0) return tr("You had a Town Portal: use it, or a potion, as soon as a fight turns, and pull a hero back once it drops under a third of its health instead of chasing; a dead hero costs gold and time to revive and gives their heroes experience.", "Você tinha um Town Portal: use ele, ou uma poção, assim que a luta virar, e recue o herói quando ele ficar abaixo de um terço da vida em vez de perseguir; um herói morto custa ouro e tempo para reviver e dá experiência aos heróis deles.");
      return tr(`Carry a Scroll of Town Portal (${nameOf(SHOP[R])}) and pull a hero back once it drops under a third of its health: a dead hero costs gold and time to revive and gives their heroes experience.`, `Leve um Scroll of Town Portal (${nameOf(SHOP[R])}) e recue o herói quando ele ficar abaixo de um terço da vida: um herói morto custa ouro e tempo para reviver e dá experiência aos heróis deles.`);
    case "no_heroes":
      return tr("When all your heroes are dead, retreat and wait for the revive: units without heroes lose fights and feed experience to theirs.", "Quando todos os seus heróis estiverem mortos, recue e espere eles reviverem: unidades sem heróis perdem lutas e dão experiência aos heróis deles.");
    case "upkeep":
      return tr("Above 80 food you keep only 40% of what your workers mine; in 1v1 even pros almost never go there. Stay at 80 or less unless you are about to fight, and put the extra gold into an expansion, upgrades or items.", "Acima de 80 de food você fica com só 40% do que seus trabalhadores mineram; no 1v1 até os pros quase nunca chegam lá. Fique em 80 ou menos, a não ser que esteja prestes a lutar, e coloque o ouro extra numa expansão, em upgrades ou itens.");
    case "expansion":
      return tr(`Take an expansion when it is safe: after you win a fight, while their army is away, or when they tech. Pros who expanded did it by about ${mmss(pro(c, "expansion_ms"))}.`, `Pegue uma expansão quando for seguro: depois de ganhar uma luta, enquanto o exército deles está longe, ou quando eles sobem de tier. Os pros que expandiram fizeram isso por volta de ${mmss(pro(c, "expansion_ms"))}.`);
    case "first_creep":
      return tr(`Start creeping as soon as the hero leaves the altar, with ${firstCreep(c, R)}; pros start within about 10 seconds.`, `Comece a creepar assim que o herói sair do altar, com ${firstCreep(c, R)}; os pros começam em uns 10 segundos.`);
    case "upgrades":
      return tr(`Start your first attack or armor upgrade at the ${nameOf(SMITH[R])} around 50 food; pros start their first attack upgrade by about ${mmss(pro(c, "first_attack_upgrade_ms"))}.`, `Comece seu primeiro upgrade de ataque ou armadura no ${nameOf(SMITH[R])} por volta de 50 de food; os pros começam o primeiro upgrade de ataque por volta de ${mmss(pro(c, "first_attack_upgrade_ms"))}.`);
    case "one_hero":
      return tr("Get a second hero around tier 2 (pros: around 38 food); Grubby: two heroes usually beat one, and the second one creeps too.", "Pegue um segundo herói por volta do tier 2 (pros: por volta de 38 de food); Grubby: dois heróis normalmente ganham de um, e o segundo também creepa.");
    case "no_items":
      return tr(`Visit the ${nameOf(SHOP[R])} or a neutral shop: a Potion of Healing and a Scroll of Town Portal save heroes, and items from creeps should be used, not kept. At the neutral shop, Scrolls of Healing and invulnerability potions decide late fights, and Boots of Speed or the Circlet of Nobility go to whoever buys them first.`, `Visite o ${nameOf(SHOP[R])} ou uma loja neutra: uma Potion of Healing e um Scroll of Town Portal salvam heróis, e itens dropados por creeps são para usar, não guardar. Na loja neutra, Scrolls of Healing e poções de invulnerabilidade decidem as lutas do fim do jogo, e Boots of Speed ou o Circlet of Nobility ficam com quem comprar primeiro.`);
    case "floating":
      return tr("When gold piles up above about 500, spend it: another production building, an upgrade, or units. Pros spend nearly everything they mine in the first 10 minutes.", "Quando o ouro acumular acima de uns 500, gaste: outro prédio de produção, um upgrade ou unidades. Os pros gastam quase tudo o que mineram nos primeiros 10 minutos.");
    case "unanswered_expansion":
      return tr("When they start an expansion and your army is bigger, attack it before the town hall finishes (about two minutes): it is their weakest moment.", "Quando eles começarem uma expansão e o seu exército for maior, ataque antes da base terminar (uns dois minutos): é o momento mais fraco deles.");
    case "just_over_50":
      return tr("Stay at 50 food and bank or invest (upgrades, shop items); when you go over, go in one step toward 70-80 food with about 1000 gold banked, right before a fight, instead of one unit at a time.", "Fique em 50 de food e guarde ou invista (upgrades, itens da loja); quando passar, vá de uma vez para 70-80 de food com uns 1000 de ouro guardados, logo antes de uma luta, em vez de uma unidade por vez.");
    case "towers":
      return tr("Stop at an arcane or guard tower per base and put the rest into units: kills by towers give your heroes no experience.", "Pare numa arcane tower ou guard tower por base e coloque o resto em unidades: abates de torres não dão experiência aos seus heróis.");
    case "workers_lost":
      return tr(`When they harass your workers, ${HARASS_ANSWER[R]}, and add a tower at an exposed expansion.`, `Quando eles fizerem harass nos seus trabalhadores, ${HARASS_ANSWER[R]}, e coloque uma torre numa expansão exposta.`);
    case "goal_3360":
      return tr("Aim for 3-3-60: first hero level 3, second hero level 3 and 60 food; then look for a fight. Creep with both heroes to get there.", "Mire no 3-3-60: primeiro herói nível 3, segundo herói nível 3 e 60 de food; aí procure uma luta. Creepe com os dois heróis para chegar lá.");
    case "unused_spike":
      return tr("At 50 food with level 3 heroes, do one of three within a minute or two: attack, expand, or start tier 3. Waiting gives the opponent time to catch up.", "Com 50 de food e heróis nível 3, faça uma de três coisas em um ou dois minutos: ataque, expanda ou comece o tier 3. Esperar dá tempo para o oponente alcançar.");
    case "upkeep_before_upgrades":
      return tr(`Before going over 50 food, invest: an attack or armor upgrade at the ${nameOf(SMITH[R])}, items, or an expansion.`, `Antes de passar de 50 de food, invista: um upgrade de ataque ou armadura no ${nameOf(SMITH[R])}, itens, ou uma expansão.`);
    case "mine_dry":
      return tr("Take a second base well before your main mine runs out (it holds 12,500 gold: about 20 minutes with 5 workers).", "Pegue uma segunda base bem antes da sua mina principal acabar (ela tem 12.500 de ouro: uns 20 minutos com 5 trabalhadores).");
    case "build_drift":
      return tr("Follow your build's timings: start the tier upgrade and the expansion at the food counts the pros on that build use (shown above), and add other buildings around them.", "Siga os tempos da sua build: comece o upgrade de tier e a expansão com o food que os pros usam nessa build (mostrado acima), e encaixe as outras construções em volta disso.");
    case "mechanics":
      return tr("Put the army on control groups 1-3 and production buildings on 4-6, heroes on F1-F3, and select with keys instead of clicking; use Tab to switch between unit types in a group, a grid layout for abilities (QWER, ASDF, ZXCV), and two item keys (invulnerability potion, Town Portal). It frees time for the map.", "Coloque o exército nos grupos de controle 1-3 e os prédios de produção no 4-6, os heróis no F1-F3, e selecione pelo teclado em vez de clicar; use Tab para trocar entre os tipos de unidade de um grupo, um layout em grade para as habilidades (QWER, ASDF, ZXCV) e duas teclas de item (poção de invulnerabilidade, Town Portal). Isso libera tempo para olhar o mapa.");
    case "unused_lead":
    case "army_mismatch":
    case "no_anti_air":
    case "no_sustain":
    case "no_scout":
      return null; // these write their own advice (it depends on the game)
    default:
      return null;
  }
}

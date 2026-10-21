import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BuildEvent, GameDetail, GameRecord, MetricDef, PlayerRecord, SimSample } from "@replay-altar/core/ui";
import { per10Minutes } from "@replay-altar/core/metrics";
import { heroesXpAt } from "@replay-altar/core/heroxp";
import { api, type RefGroupInfo } from "../api.ts";
import { MIN_GAME_MS } from "@replay-altar/rules/findings";
import { deviationsFromPros, matchBuilds } from "@replay-altar/rules/builds";
import { proBuildOf, type Principles } from "@replay-altar/rules/principles";
import { RulesCard } from "../RulesCard.tsx";
import { MapView } from "../MapView.tsx";
import { Tip } from "../Tip.tsx";
import { RaceIcon } from "../RaceIcon.tsx";
import { HeroIcons } from "../HeroIcons.tsx";
import { Share } from "../Share.tsx";
import { ScorePanel } from "../ScorePanel.tsx";
import { Chart, heroLevelsChart, timeLines, type Band, type HeroLine, type Tokens } from "../Chart.tsx";
import { assess, describeRef, groupForRace, pickProfile } from "@replay-altar/reference/compare";
import { ProMedian, Standing } from "../Standing.tsx";
import { groupDetails, SECTION_INFO, splitMetrics } from "../sections.ts";
import { proText, researchTimes, upgradeRows, upgradeStanding } from "../upgrades.ts";
import type { RaceCode } from "@replay-altar/core/gamedata";
import type { CurvePoint, MatchupProfile } from "@replay-altar/reference/types";
import { dateTime, GROUP_LABEL, groupLabel, metricValue, mmss, RACE, shortName, SOURCE } from "../format.ts";
import { decimal, tr } from "@replay-altar/core/i18n";

/** Build-order entry kinds, in the window's language. */
const KIND: Record<string, [one: string, many: string]> = {
  building: [tr("building", "construção", "edificio", "bâtiment"), tr("buildings", "construções", "edificios", "bâtiments")],
  unit: [tr("unit", "unidade", "unidad", "unité"), tr("units", "unidades", "unidades", "unités")],
  upgrade: ["upgrade", "upgrades"],
  item: [tr("item", "item", "objeto", "objet"), tr("items", "itens", "objetos", "objets")],
  hero: [tr("hero", "herói", "héroe", "héros"), tr("heroes", "heróis", "héroes", "héros")],
};

const WORKERS = new Set(["hpea", "opeo", "uaco", "ewsp"]);

/** Collapse runs of the same order issued close together: "Peasant ×3". */
function compress(events: BuildEvent[]) {
  const out: (BuildEvent & { count: number })[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (last && last.code === e.code && e.ms - last.ms < 15_000) last.count++;
    else out.push({ ...e, count: 1 });
  }
  return out;
}

function BuildList({ p, hideWorkers, kinds }: { p: PlayerRecord; hideWorkers: boolean; kinds: Set<string> }) {
  const events = compress(p.build.filter((b) => kinds.has(b.kind) && !(hideWorkers && WORKERS.has(b.code))));
  return (
    <div>
      <h2><span className={`key ${p.isMe ? "me" : "opp"}`} />{shortName(p.name)} <span className="muted small">{RACE[p.race]}</span></h2>
      <ol>
        {events.map((e, i) => (
          <li key={i}>
            <span className="muted">{mmss(e.ms)}</span>
            <span>{e.name}{e.count > 1 ? ` ×${e.count}` : ""}</span>
            <span className="tag">{KIND[e.kind]?.[0] ?? e.kind}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Heroes({ p }: { p: PlayerRecord }) {
  return (
    <div>
      <h2><span className={`key ${p.isMe ? "me" : "opp"}`} />{shortName(p.name)}</h2>
      {p.heroes.length === 0 && <p className="muted">{tr("No hero skilled.", "Nenhum herói aprendeu habilidades.", "Ningún héroe aprendió habilidades.", "Aucune compétence apprise.")}</p>}
      {p.heroes.map((h) => (
        <div key={h.order}>
          <div><b>{h.name}</b> <span className="muted small">{tr("level", "nível", "nivel", "niveau")} {h.level}{h.retrainings ? tr(` · retrained ${h.retrainings}×`, ` · retreinado ${h.retrainings}×`, ` · reentrenado ${h.retrainings}×`, ` · réentraîné ${h.retrainings}×`) : ""}</span></div>
          <div className="skills">
            {h.skills.map((s, i) => (
              <span key={i} className="tag" title={tr(`learned at ${mmss(s.ms)}`, `aprendida às ${mmss(s.ms)}`, `aprendida a ${mmss(s.ms)}`, `apprise à ${mmss(s.ms)}`)}>{i + 1}. {s.name} <span className="muted">{mmss(s.ms)}</span></span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

type SimOk = Extract<NonNullable<GameRecord["sim"]>, { status: "ok" }>;

const bandOf = (curve: CurvePoint[] | undefined, label: string): Band | null =>
  curve && curve.length ? { label, points: curve.map((c) => [c.minute * 60_000, c.p25, c.p50, c.p75]) } : null;

function GameCharts({ record, refMp, refLabel }: { record: GameRecord; refMp: MatchupProfile | null; refLabel: string }) {
  const sim = record.sim;
  const me = record.players.find((p) => p.isMe);
  const opp = record.players.find((p) => p.playerId === record.classification.opponentId);
  const ok = sim?.status === "ok" ? (sim as SimOk) : null;
  const simOf = (p?: PlayerRecord) => ok?.players.find((x) => x.playerId === p?.playerId);
  const mine = simOf(me)?.series ?? [];
  const theirs = simOf(opp)?.series ?? [];
  const end = record.game.durationMs;
  const both = (pick: (s: SimSample) => number) => (t: Tokens) => [
    { name: shortName(me?.name ?? tr("You", "Você", "Tú", "Vous")), color: t.series1, points: mine.map((s) => [s.t, pick(s)] as [number, number]) },
    { name: shortName(opp?.name ?? tr("Opponent", "Oponente", "Rival", "Adversaire")), color: t.series2, points: theirs.map((s) => [s.t, pick(s)] as [number, number]) },
  ];
  const army = useMemo(() => timeLines(both((s) => s.armyValue ?? 0), undefined, bandOf(refMp?.curves.armyValue, refLabel)), [mine, theirs, refMp]);
  const spent = useMemo(() => timeLines(both((s) => s.goldSpent + s.lumberSpent), undefined, bandOf(refMp?.curves.spent, refLabel)), [mine, theirs, refMp]);
  const workers = useMemo(() => timeLines(both((s) => s.workers), undefined, bandOf(refMp?.curves.workers, refLabel)), [mine, theirs, refMp]);
  const supplyFor = (series: SimSample[], mineColor: boolean, band: Band | null = null) =>
    timeLines((t) => [
      { name: tr("food used", "food usado", "food usado", "food utilisée"), color: mineColor ? t.series1 : t.series2, points: series.map((s) => [s.t, s.foodUsed] as [number, number]), step: true },
      // Cap in the main text colour so it stays distinct from the grey pro reference.
      { name: tr("food cap", "limite de food", "límite de food", "limite de food"), color: t.ink, points: series.map((s) => [s.t, Math.min(100, s.foodMax)] as [number, number]), step: true, muted: true },
    ], undefined, band);
  const mySupply = useMemo(() => supplyFor(mine, true, bandOf(refMp?.curves.food, tr(`${refLabel} food used`, `${refLabel}: food usado`, `food usado: ${refLabel}`, `food utilisée : ${refLabel}`))), [mine, refMp]);
  const oppSupply = useMemo(() => supplyFor(theirs, false), [theirs]);
  const apm = useMemo(
    () =>
      timeLines(
        (t) =>
          [me, opp]
            .filter((p): p is PlayerRecord => !!p)
            .map((p) => ({ name: shortName(p.name), color: p.isMe ? t.series1 : t.series2, points: p.apmPerMinute.map((v, i) => [(i + 1) * 60_000, v] as [number, number]) })),
        undefined,
        bandOf(refMp?.curves.apm, refLabel),
      ),
    [me, opp, refMp],
  );
  // Heroes: from the simulation when there is one (appearance, deaths, revives); otherwise the
  // replay's level-ups alone.
  const heroLines = useMemo(() => {
    const lines: HeroLine[] = [];
    for (const [p, side] of [[me, "me"], [opp, "opp"]] as const) {
      if (!p) continue;
      const timelines = simOf(p)?.heroes ?? p.heroes.map((h) => ({ code: h.code, name: h.name, appearAt: h.levelUps?.[0] ?? null, levelUps: h.levelUps ?? [], deaths: [] }));
      timelines.forEach((h, i) => lines.push({ name: `${h.name} (${shortName(p.name)})`, side, order: i + 1, appearAt: h.appearAt, levelUps: h.levelUps, deaths: h.deaths }));
    }
    return lines;
  }, [record]);
  const heroes = useMemo(() => heroLevelsChart(heroLines, end), [heroLines, end]);

  const note = !sim
    ? tr("Not simulated yet: army, resources, workers and supply appear about a minute after a game ends (older games: replay-altar sim --backfill).", "Ainda não simulada: exército, recursos, trabalhadores e food aparecem cerca de um minuto depois que a partida acaba.", "Todavía sin simular: el ejército, los recursos, los trabajadores y el food aparecen un minuto después de que termine la partida (partidas antiguas: replay-altar sim --backfill).", "Pas encore simulée : l'armée, les ressources, les ouvriers et la food apparaissent environ une minute après la fin d'une partie (anciennes parties : replay-altar sim --backfill).")
    : !ok
      ? tr(`Simulation failed: ${(sim as { reason: string }).reason}`, `A simulação falhou: ${(sim as { reason: string }).reason}`, `La simulación falló: ${(sim as { reason: string }).reason}`, `La simulation a échoué : ${(sim as { reason: string }).reason}`)
      : null;
  return (
    <div className="card">
      <h2>
        {tr("Game over time", "A partida ao longo do tempo", "La partida en el tiempo", "La partie dans le temps")}{" "}
        <Tip
          text={tr(
            `You in blue, your opponent in orange${refMp ? `; grey: ${refLabel.toLowerCase()} (median and middle 50%)` : ""}. Army and resources are reconstructed by simulating the replay (WC3V); army value is an estimate.`,
            `Você em azul, o oponente em laranja${refMp ? `; cinza: ${refLabel.toLowerCase()} (mediana e os 50% do meio)` : ""}. Exército e recursos são reconstruídos simulando o replay (WC3V); o valor do exército é uma estimativa.`,
            `Tú en azul, tu rival en naranja${refMp ? `; gris: ${refLabel.toLowerCase()} (mediana y 50% central)` : ""}. El ejército y los recursos se reconstruyen simulando el replay (WC3V); el valor del ejército es una estimación.`,
            `Vous en bleu, votre adversaire en orange${refMp ? ` ; gris : ${refLabel.toLowerCase()} (médiane et 50 % central)` : ""}. L'armée et les ressources sont reconstituées en simulant le replay (WC3V) ; la valeur de l'armée est une estimation.`,
          )}
        />
      </h2>
      {note && <p className="sub">{note}</p>}
      {ok && (
        <>
          <h3 className="chart-title" data-tip={tr("Gold and lumber in living army units, heroes excluded; estimated by the simulation.", "Ouro e madeira nas unidades de exército vivas, sem heróis; estimado pela simulação.", "Oro y madera en unidades de ejército vivas, sin contar los héroes; estimado por la simulación.", "Or et bois dans les unités d'armée vivantes, héros exclus ; estimé par la simulation.")}>≈ {tr("Army value", "Valor do exército", "Valor del ejército", "Valeur de l'armée")}</h3>
          <Chart option={army} height={240} label={tr("Estimated army value over time for both players", "Valor estimado do exército dos dois jogadores ao longo do tempo", "Valor estimado del ejército a lo largo del tiempo para ambos jugadores", "Valeur estimée de l'armée au fil du temps pour les deux joueurs")} />
        </>
      )}
      <h3 className="chart-title" data-tip={tr("✕ died, ○ back after revive; death times are approximate.", "✕ morreu, ○ voltou depois de reviver; os horários das mortes são aproximados.", "✕ murió, ○ volvió tras revivir; los momentos de muerte son aproximados.", "✕ mort, ○ revenu après résurrection ; les moments des morts sont approximatifs.")}>{tr("Hero levels", "Níveis dos heróis", "Niveles de los héroes", "Niveaux des héros")}</h3>
      <Chart option={heroes} height={260} label={tr("Hero levels over time for both players, with deaths and revives", "Níveis dos heróis dos dois jogadores ao longo do tempo, com mortes e revives", "Niveles de los héroes a lo largo del tiempo para ambos jugadores, con muertes y resurrecciones", "Niveaux des héros au fil du temps pour les deux joueurs, avec morts et résurrections")} />
      {ok && (
        <div className="grid-2">
          <div>
            <h3 className="chart-title" data-tip={tr("Gold plus lumber spent, cumulative.", "Ouro mais madeira gastos, acumulado.", "Oro más madera gastados, acumulado.", "Or plus bois dépensés, en cumulé.")}>{tr("Resources spent", "Recursos gastos", "Recursos gastados", "Ressources dépensées")}</h3>
            <Chart option={spent} height={200} label={tr("Cumulative gold plus lumber spent by both players", "Ouro mais madeira gastos pelos dois jogadores, acumulado", "Oro más madera gastados por ambos jugadores, acumulado", "Or plus bois dépensés par les deux joueurs, en cumulé")} />
          </div>
          <div>
            <h3 className="chart-title">{tr("Workers alive", "Trabalhadores vivos", "Trabajadores vivos", "Ouvriers en vie")}</h3>
            <Chart option={workers} height={200} label={tr("Workers alive over time for both players", "Trabalhadores vivos dos dois jogadores ao longo do tempo", "Trabajadores vivos a lo largo del tiempo para ambos jugadores", "Ouvriers en vie au fil du temps pour les deux joueurs")} />
          </div>
          <div>
            <h3 className="chart-title">{tr("Supply", "Food", "Food", "Food")}: {shortName(me?.name ?? tr("You", "Você", "Tú", "Vous"))}</h3>
            <Chart option={mySupply} height={200} label={tr("Your food used against food cap", "Seu food usado contra o limite de food", "Tu food usado contra tu límite de food", "Votre food utilisée par rapport à votre limite de food")} />
          </div>
          {opp && (
            <div>
              <h3 className="chart-title">{tr("Supply", "Food", "Food", "Food")}: {shortName(opp.name)}</h3>
              <Chart option={oppSupply} height={200} label={tr("Opponent food used against food cap", "Food usado do oponente contra o limite de food", "Food usado del rival contra su límite de food", "Food utilisée de l'adversaire par rapport à sa limite de food")} />
            </div>
          )}
        </div>
      )}
      <h3 className="chart-title">{tr("Actions per minute", "Ações por minuto", "Acciones por minuto", "Actions par minute")}</h3>
      <Chart option={apm} height={220} label={tr("Actions per minute for both players over the game", "Ações por minuto dos dois jogadores ao longo da partida", "Acciones por minuto de ambos jugadores durante la partida", "Actions par minute des deux joueurs au cours de la partie")} />
    </div>
  );
}

/** Closest library build, and how the pros who played it did. */
function BuildLine({ record, player, who, principles }: { record: GameRecord; player: PlayerRecord; who: string; principles: Principles | null | undefined }) {
  const best = useMemo(() => matchBuilds(record, player)[0], [record, player]);
  if (!best) return null;
  const pro = proBuildOf(principles, best);
  const dev = pro ? deviationsFromPros(best, pro).filter((d) => ["tech", "expand", "hero"].includes(d.action)) : [];
  const source = best.build.source.author ?? best.build.source.where ?? tr("guide", "guia", "guía", "guide");
  const details = [
    tr(`Closest build-order guide: "${best.build.name}" (${source}).`, `Guia de build mais próximo: "${best.build.name}" (${source}).`, `Guía de build más parecida: "${best.build.name}" (${source}).`, `Guide de build le plus proche : « ${best.build.name} » (${source}).`),
    pro ? tr(`${pro.players} pros played it, ${Math.round(pro.winRate * 100)}% won.`, `${pro.players} pros jogaram ela, ${Math.round(pro.winRate * 100)}% venceram.`, `${pro.players} pros la jugaron, el ${Math.round(pro.winRate * 100)}% ganó.`, `${pro.players} pros l'ont jouée, ${Math.round(pro.winRate * 100)} % ont gagné.`) : "",
    dev.length
      ? tr(
          `Compared with those pros: ${dev.map((d) => (d.yours === null ? `no ${d.label}` : `${d.label} at ${d.yours} food (pros ${d.pros})`)).join(", ")}.`,
          `Comparado com esses pros: ${dev.map((d) => (d.yours === null ? `sem ${d.label}` : `${d.label} com ${d.yours} de food (pros ${d.pros})`)).join(", ")}.`,
          `Comparado con esos pros: ${dev.map((d) => (d.yours === null ? `sin ${d.label}` : `${d.label} con ${d.yours} de food (pros ${d.pros})`)).join(", ")}.`,
          `Par rapport à ces pros : ${dev.map((d) => (d.yours === null ? `pas de ${d.label}` : `${d.label} à ${d.yours} de food (pros ${d.pros})`)).join(", ")}.`,
        )
      : "",
  ].filter(Boolean).join(" ");
  return (
    <p className="sub" style={{ margin: "4px 0 0" }} data-tip={details}>
      <b>{who}:</b> {best.build.name}
    </p>
  );
}

export function Match({ gameKey, metrics, refs, onBack }: { gameKey: string; metrics: MetricDef[]; refs: RefGroupInfo[]; onBack: () => void }) {
  const [detail, setDetail] = useState<GameDetail | undefined>();
  const [hideWorkers, setHideWorkers] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [hideNames, setHideNames] = useState(true);
  const shareRef = useRef<HTMLDivElement>(null);
  const [kinds, setKinds] = useState(new Set(["building", "unit", "upgrade", "item"]));
  const load = useCallback(() => api.getGame(gameKey).then(setDetail), [gameKey]);
  useEffect(() => {
    load();
  }, [load]);

  const r = detail?.record;
  const me = r?.players.find((p) => p.isMe);
  const opp = r?.players.find((p) => p.playerId === r.classification.opponentId);
  const pros = groupForRace(refs, me?.race);
  const ref = me && opp ? pickProfile(pros?.profile, `${me.race}v${opp.race}`) : null;

  const xpOption = useMemo(() => {
    if (!r) return null;
    const end = r.game.durationMs;
    const curve = (p: PlayerRecord) => {
      const levels = p.heroes.map((h) => h.levelUps ?? []);
      const pts: [number, number][] = [];
      for (let t = 0; t <= end; t += 30_000) pts.push([t, Math.round(heroesXpAt(levels, t, end))]);
      return pts;
    };
    return timeLines(
      (t) =>
        [me, opp]
          .filter((p): p is PlayerRecord => !!p)
          .map((p) => ({ name: shortName(p.name), color: p.isMe ? t.series1 : t.series2, points: curve(p) })),
      undefined,
      bandOf(ref?.mp.curves.heroXp, "Pros"),
    );
  }, [r, me, opp, ref]);

  if (detail === undefined) return <div className="page"><div className="empty">{tr("Loading…", "Carregando…", "Cargando…", "Chargement…")}</div></div>;
  if (detail === null || !r) return <div className="page"><div className="empty">{tr("Game not found.", "Partida não encontrada.", "Partida no encontrada.", "Partie introuvable.")}</div></div>;
  const { row } = detail;
  const overridden = row.result !== row.result_detected;

  return (
    <div className="page">
      <div><button className="btn" onClick={onBack}>← {tr("All matches", "Todas as partidas", "Todas las partidas", "Toutes les parties")}</button></div>
      <div ref={shareRef} className="share-area">
        <div className="card match-card">
          <div className="match-side">{me && opp && <ScorePanel record={r} me={me} opp={opp} metrics={metrics} mp={ref?.mp ?? null} />}</div>
          <div className="match-head">
            <div className={`big ${row.result}`}>{row.result === "win" ? tr("Victory", "Vitória", "Victoria", "Victoire") : row.result === "loss" ? tr("Defeat", "Derrota", "Derrota", "Défaite") : tr("Result unknown", "Resultado desconhecido", "Resultado desconocido", "Résultat inconnu")}</div>
            <div className="versus">
              <div className="versus-side me">
                <div className="versus-name">
                  <b>{tr("You", "Você", "Tú", "Vous")}</b>
                  <RaceIcon race={me?.race} />
                </div>
                {me && <HeroIcons p={me} record={r} />}
              </div>
              <span className="muted versus-vs">vs</span>
              <div className="versus-side opp">
                <div className="versus-name">
                  <RaceIcon race={opp?.race} />
                  <b>{sharing && hideNames ? tr("Opponent", "Oponente", "Rival", "Adversaire") : opp?.name}</b>
                </div>
                {opp && <HeroIcons p={opp} record={r} />}
              </div>
            </div>
            <p className="sub" data-tip={`${r.game.map.file} · ${SOURCE[r.classification.source]}`}>
              {mmss(r.game.durationMs)} · {dateTime(r.game.playedAt)}
              {r.userLabel && !(sharing && hideNames) ? ` · “${r.userLabel}”` : ""}
            </p>
            <div className="filters no-share">
              <label data-tip={tr("Correct the result if it was detected wrong.", "Corrija o resultado se ele foi detectado errado.", "Corrige el resultado si se detectó mal.", "Corrigez le résultat s'il a été mal détecté.")}>
                {tr("Result", "Resultado", "Resultado", "Résultat")}
                <select
                  value={overridden ? row.result : "detected"}
                  onChange={async (e) => {
                    await api.overrideResult(r.gameKey, e.target.value === "detected" ? null : (e.target.value as "win" | "loss"));
                    load();
                  }}
                >
                  <option value="detected">{tr("Detected", "Detectado", "Detectado", "Détecté")}: {({ win: tr("win", "vitória", "victoria", "victoire"), loss: tr("loss", "derrota", "derrota", "défaite") } as Record<string, string>)[row.result_detected] ?? row.result_detected}</option>
                  <option value="win">{tr("Win (manual)", "Vitória (manual)", "Victoria (manual)", "Victoire (manuel)")}</option>
                  <option value="loss">{tr("Loss (manual)", "Derrota (manual)", "Derrota (manual)", "Défaite (manuel)")}</option>
                </select>
              </label>
              <button className="btn" onClick={() => api.showFile(r.provenance.archivePath)} data-tip={r.provenance.archivePath}>{tr("Replay file", "Arquivo do replay", "Archivo del replay", "Fichier du replay")}</button>
              {me && opp && (
                <button className="btn" onClick={() => setSharing(!sharing)} aria-expanded={sharing}>
                  {tr("Share", "Compartilhar", "Compartir", "Partager")}
                </button>
              )}
            </div>
            {sharing && me && opp && <Share record={r} me={me} opp={opp} result={row.result} target={shareRef} hideNames={hideNames} setHideNames={setHideNames} />}
            {r.sim?.status === "ok" && me && opp && (
              <div className="build-lines small">
                <BuildLine record={r} player={me} who={tr("Your build", "Sua build", "Tu build", "Votre build")} principles={pros?.principles} />
                <BuildLine record={r} player={opp} who={tr("Opponent's build", "Build do oponente", "Build del rival", "Build de l'adversaire")} principles={groupForRace(refs, opp.race)?.principles} />
              </div>
            )}
          </div>
          <div className="match-side no-share">
            <MapView mapFile={r.game.map.file} gameKey={r.gameKey} />
          </div>
        </div>

        {row.analyzed === 1 && me && opp && r.game.durationMs >= MIN_GAME_MS && (
          <RulesCard key={`rules-${r.gameKey}`} gameKey={r.gameKey} />
        )}
        <p className="share-credit muted small">{tr("Analyzed with Replay Altar", "Analisado com o Replay Altar", "Analizado con Replay Altar", "Analysé avec Replay Altar")} · github.com/bubunuh/replay-altar</p>
      </div>

      <GameCharts record={r} refMp={ref?.mp ?? null} refLabel="Pros" />

      <div className="card">
        <h2>
          {tr("Key numbers", "Números principais", "Números clave", "Chiffres clés")}{" "}
          <Tip
            text={tr(
              `Order times are when the order was issued (cancels included). Economy and supply rows come from the simulation; ≈ marks estimates.${
                ref
                  ? ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Green = pro level (at or above the pro median), yellow = at least as good as your opponent, red = below both; for timings with no better direction (heroes, tiers, expansions): green = like pros, yellow = unusual, red = far from pros. Whole-game totals are compared per 10 minutes.`
                  : ""
              } Hover a metric for its definition.`,
              `Os horários das ordens são de quando a ordem foi dada (cancelamentos incluídos). As linhas de economia e food vêm da simulação; ≈ marca estimativas.${
                ref
                  ? ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Verde = nível pro (na mediana dos pros ou acima), amarelo = pelo menos tão bom quanto o seu oponente, vermelho = abaixo dos dois; para tempos sem direção melhor (heróis, tiers, expansões): verde = como os pros, amarelo = incomum, vermelho = longe dos pros. Totais da partida inteira são comparados a cada 10 minutos.`
                  : ""
              } Passe o mouse num número para ver a definição.`,
              `Los tiempos de las órdenes son cuando se dio la orden (cancelaciones incluidas). Las filas de economía y food vienen de la simulación; ≈ marca estimaciones.${
                ref
                  ? ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Verde = nivel pro (en la mediana de los pros o por encima), amarillo = al menos tan bueno como tu rival, rojo = por debajo de ambos; para tiempos sin una dirección mejor (héroes, tiers, expansiones): verde = como los pros, amarillo = poco habitual, rojo = lejos de los pros. Los totales de toda la partida se comparan cada 10 minutos.`
                  : ""
              } Pasa el cursor por una métrica para ver su definición.`,
              `Les temps des ordres sont ceux où l'ordre a été donné (annulations comprises). Les lignes d'économie et de food viennent de la simulation ; ≈ indique une estimation.${
                ref
                  ? ` Pros : ${groupLabel(pros!.group)}, ${describeRef(ref)}. Vert = niveau pro (à la médiane des pros ou au-dessus), jaune = au moins aussi bon que votre adversaire, rouge = en dessous des deux ; pour les timings sans meilleure direction (héros, tiers, expansions) : vert = comme les pros, jaune = inhabituel, rouge = loin des pros. Les totaux de toute la partie sont comparés par tranche de 10 minutes.`
                  : ""
              } Survolez une mesure pour voir sa définition.`,
            )}
          />
        </h2>
        {(() => {
          const cols = ref ? 5 : 3;
          const race = (me?.race ?? "") as RaceCode;
          const row = (metric: MetricDef, verdict: boolean) => {
            // An official number is not an estimate: drop the ≈ for it.
            const m: MetricDef = r.metricSources?.[metric.key] === "official" ? { ...metric, source: "official" } : metric;
            const mine = me?.metrics[m.key];
            const a = assess(m, ref?.mp ?? null, { value: mine, per10: typeof mine === "number" ? per10Minutes(mine, r.game.durationMs) : null }, opp?.metrics[m.key]);
            const shown = verdict ? a : { ...a, tier: null };
            return (
              <tr key={m.key} title={m.description} className={ref && shown.tier ? `tier-row-${shown.tier}` : undefined}>
                <td>
                  {m.raceLabels?.[race] ?? m.label}
                  {r.metricSources?.[m.key] === "official" && <span className="tag" style={{ marginLeft: 8 }} title={tr("The game's own end-of-game number (from W3Champions)", "O número do próprio jogo no fim da partida (do W3Champions)", "El número del propio juego al final de la partida (de W3Champions)", "Le chiffre de fin de partie du jeu lui-même (de W3Champions)")}>{tr("official", "oficial", "oficial", "officiel")}</span>}
                </td>
                <td className="num">{metricValue(m, mine)}</td>
                <td className="num">{metricValue(m, opp?.metrics[m.key])}</td>
                {ref && <td className="num muted"><ProMedian def={m} a={a} /></td>}
                {ref && <td><Standing a={shown} /></td>}
              </tr>
            );
          };
          const head = (
            <thead>
              <tr>
                <th>{tr("Metric", "Número", "Métrica", "Mesure")}</th>
                <th className="num"><span className="key me" />{shortName(me?.name ?? tr("You", "Você", "Tú", "Vous"))}</th>
                <th className="num"><span className="key opp" />{shortName(opp?.name ?? tr("Opponent", "Oponente", "Rival", "Adversaire"))}</th>
                {ref && <th className="num">{tr("Pros (median)", "Pros (mediana)", "Pros (mediana)", "Pros (médiane)")}</th>}
                {ref && <th>{tr("This game vs pros", "Esta partida vs pros", "Esta partida frente a los pros", "Cette partie face aux pros")}</th>}
              </tr>
            </thead>
          );
          const sectionRow = (id: keyof typeof SECTION_INFO) => (
            <tr key={`s-${id}`} className="section-row">
              <td colSpan={cols}><b>{SECTION_INFO[id].title}</b> <Tip text={SECTION_INFO[id].note} /></td>
            </tr>
          );
          const { core, mechanics, details } = splitMetrics(metrics);
          // Upgrades: compare with pros only when they play your race.
          const myTimes = me ? researchTimes(me.build) : new Map<string, number>();
          const oppTimes = opp ? researchTimes(opp.build) : new Map<string, number>();
          const upMp = ref && pros?.profile?.group.race === race ? ref.mp : null;
          const ups = me && ["H", "O", "U", "N"].includes(race) ? upgradeRows(race, new Set(myTimes.keys()), upMp) : { core: [], other: [] };
          const subRow = (label: string) => (
            <tr key={`sub-${label}`}><td colSpan={cols} className="muted small" style={{ paddingTop: 12 }}>{label}</td></tr>
          );
          const upRow = (u: (typeof ups.core)[number]) => (
            <tr key={u.key}>
              <td>
                  {u.label}
                  {u.detail && <span className="muted small"> {u.detail}</span>}
                </td>
              <td className="num">{mmss(myTimes.get(u.key))}</td>
              <td className="num">{mmss(oppTimes.get(u.key))}</td>
              {ref && <td className="num muted small">{upMp ? proText(u.pro) : "—"}</td>}
              {ref && <td className="small muted">{upMp ? upgradeStanding(u.pro, myTimes.get(u.key) ?? null) : "—"}</td>}
            </tr>
          );
          return (
            <>
              <table>
                {head}
                <tbody>
                  {sectionRow("core")}
                  {core.map((m) => row(m, true))}
                  {sectionRow("upgrades")}
                  {subRow(tr("Attack and armor", "Ataque e armadura", "Ataque y armadura", "Attaque et armure"))}
                  {ups.core.map(upRow)}
                  {ups.other.length > 0 && subRow(tr("Other upgrades", "Outros upgrades", "Otras mejoras", "Autres améliorations"))}
                  {ups.other.map(upRow)}
                  {sectionRow("mechanics")}
                  {mechanics.map((m) => row(m, true))}
                </tbody>
              </table>
              <details className="more-metrics">
                <summary data-tip={SECTION_INFO.details.note}>{tr(`${details.length} more metrics`, `mais ${details.length} números`, `${details.length} métricas más`, `${details.length} mesures de plus`)}</summary>
                <table>
                  {head}
                  <tbody>
                    {groupDetails(details).flatMap(([grp, list]) => [
                      <tr key={grp}><td colSpan={cols} className="muted small" style={{ paddingTop: 14 }}>{GROUP_LABEL[grp]}</td></tr>,
                      ...list.map((m) => row(m, false)),
                    ])}
                  </tbody>
                </table>
              </details>
            </>
          );
        })()}
      </div>

      <div className="card">
        <h2>
          {tr("Heroes", "Heróis", "Héroes", "Héros")}{" "}
          <Tip
            text={tr(
              `Hero experience over time (all heroes), from level-up times; levels are exact, the XP between them is interpolated. Creeps give no experience to a hero of level 5 or more.${ref ? " Grey: pros." : ""} Below: skill order; a hero's first skill marks roughly when it arrived.`,
              `Experiência dos heróis ao longo do tempo (todos os heróis), pelos horários de subida de nível; os níveis são exatos, o XP entre eles é interpolado. Creeps não dão experiência a heróis de nível 5 ou mais.${ref ? " Cinza: pros." : ""} Abaixo: ordem das habilidades; a primeira habilidade de um herói marca mais ou menos quando ele chegou.`,
              `Experiencia de los héroes a lo largo del tiempo (todos los héroes), a partir de los momentos en que suben de nivel; los niveles son exactos y la XP entre ellos se interpola. Los creeps no dan experiencia a un héroe de nivel 5 o más.${ref ? " Gris: pros." : ""} Abajo: orden de habilidades; la primera habilidad de un héroe marca más o menos cuándo llegó.`,
              `Expérience des héros au fil du temps (tous les héros), d'après les moments où ils montent de niveau ; les niveaux sont exacts, l'XP entre eux est interpolée. Les creeps ne donnent pas d'expérience à un héros de niveau 5 ou plus.${ref ? " Gris : pros." : ""} En dessous : ordre des compétences ; la première compétence d'un héros indique à peu près quand il est arrivé.`,
            )}
          />
        </h2>
        {xpOption && <Chart option={xpOption} height={220} label={tr("Hero experience over time for both players", "Experiência dos heróis dos dois jogadores ao longo do tempo", "Experiencia de los héroes a lo largo del tiempo para ambos jugadores", "Expérience des héros au fil du temps pour les deux joueurs")} />}
        <div className="grid-2">
          {me && <Heroes p={me} />}
          {opp && <Heroes p={opp} />}
        </div>
      </div>

      <div className="card">
        <h2>{tr("Build order", "Ordem de construção", "Orden de construcción", "Ordre de construction")}</h2>
        <div className="filters" style={{ margin: "4px 0 12px" }}>
          {["building", "unit", "upgrade", "item"].map((k) => (
            <label key={k}>
              <input
                type="checkbox"
                checked={kinds.has(k)}
                onChange={(e) => {
                  const next = new Set(kinds);
                  if (e.target.checked) next.add(k);
                  else next.delete(k);
                  setKinds(next);
                }}
              />
              {KIND[k][1]}
            </label>
          ))}
          <label><input type="checkbox" checked={hideWorkers} onChange={(e) => setHideWorkers(e.target.checked)} />{tr("hide workers", "esconder trabalhadores", "ocultar trabajadores", "masquer les ouvriers")}</label>
        </div>
        <div className="build">
          {me && <BuildList p={me} hideWorkers={hideWorkers} kinds={kinds} />}
          {opp && <BuildList p={opp} hideWorkers={hideWorkers} kinds={kinds} />}
        </div>
      </div>

      {r.chat.length > 0 && (
        <div className="card">
          <h2>Chat</h2>
          <table>
            <tbody>
              {r.chat.map((c, i) => (
                <tr key={i}>
                  <td className="muted" style={{ width: 60 }}>{mmss(c.ms)}</td>
                  <td style={{ width: 180 }}>{shortName(c.player)}</td>
                  <td>{c.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        <details>
          <summary>{tr("Data sources", "Fontes dos dados", "Fuentes de datos", "Sources des données")}</summary>
          <table style={{ marginTop: 10 }}>
            <tbody>
              {r.classification.rules.map((x, i) => (
                <tr key={i}>
                  <td className={x.passed ? "" : "rule-fail"} style={{ width: 220 }}>{x.passed ? "✓" : "✗"} {x.rule}</td>
                  <td className="small">{x.evidence}</td>
                </tr>
              ))}
              <tr><td>{tr("result", "resultado", "resultado", "résultat")}</td><td className="small">{r.result.method} ({r.result.confidence}) — {r.result.evidence}</td></tr>
              <tr><td>{tr("game key", "chave da partida", "clave de la partida", "clé de la partie")}</td><td><code>{r.gameKey}</code></td></tr>
              <tr><td>{tr("archived replay", "replay arquivado", "replay archivado", "replay archivé")}</td><td><code>{r.provenance.archivePath}</code></td></tr>
              {r.provenance.files.map((f, i) => (
                <tr key={i}><td>{i === 0 ? tr("seen as", "visto como", "visto como", "vu comme") : ""}</td><td className="small"><code>{f.path}</code> <span className="muted">({f.timeSource})</span></td></tr>
              ))}
              <tr><td>parser</td><td className="small">{r.provenance.parser.name}@{r.provenance.parser.version}, {tr("classifier", "classificador", "clasificador", "classificateur")} v{r.provenance.classifierVersion}, {tr("metrics", "números", "métricas", "mesures")} v{r.provenance.metricsVersion}</td></tr>
              {r.sim?.status === "ok" && (
                <>
                  <tr><td>{tr("simulation", "simulação", "simulación", "simulation")}</td><td className="small">WC3V {r.sim.engine.commit}, {tr("game data", "dados do jogo", "datos del juego", "données du jeu")} {r.sim.gameData.version}, {tr("income model", "modelo de renda", "modelo de ingresos", "modèle de revenus")} v{r.sim.model.version}, {tr("ran in", "rodou em", "tardó", "durée")} {decimal(r.sim.runMs / 1000)} s</td></tr>
                  {r.sim.players.map((p) => (
                    <tr key={p.playerId}><td /><td className="small">{shortName(r.players.find((x) => x.playerId === p.playerId)?.name ?? String(p.playerId))}: {tr("parse confidence", "confiança da leitura", "confianza de la lectura", "fiabilité de la lecture")} {Math.round(p.parseConfidence * 100)}%{p.validationWarnings.length ? tr(`, ${p.validationWarnings.length} validator note(s)`, `, ${p.validationWarnings.length} nota(s) do validador`, `, ${p.validationWarnings.length} nota(s) del validador`, `, ${p.validationWarnings.length} note(s) du validateur`) : ""}</td></tr>
                  ))}
                  {r.sim.warnings.map((w, i) => <tr key={`w${i}`}><td className="rule-fail">{tr("model check", "verificação do modelo", "comprobación del modelo", "vérification du modèle")}</td><td className="small">{w}</td></tr>)}
                  <tr><td>{tr("simulation output", "saída da simulação", "salida de la simulación", "sortie de la simulation")}</td><td><code>{r.sim.outputPath}</code></td></tr>
                </>
              )}
              {r.sim?.status === "failed" && <tr><td className="rule-fail">{tr("simulation", "simulação", "simulación", "simulation")}</td><td className="small">{tr("failed", "falhou", "falló", "échec")}: {r.sim.reason}</td></tr>}
              {r.official?.status === "ok" && (
                <tr><td>{tr("official stats", "estatísticas oficiais", "estadísticas oficiales", "statistiques officielles")}</td><td className="small">{tr("W3Champions match", "Partida do W3Champions", "partida de W3Champions", "partie W3Champions")} {r.official.matchId}, {tr("fetched", "obtida em", "obtenidas", "récupérées")} {dateTime(r.official.fetchedAt)}</td></tr>
              )}
              {r.official?.status === "missing" && <tr><td>{tr("official stats", "estatísticas oficiais", "estadísticas oficiales", "statistiques officielles")}</td><td className="small">{tr("not available", "não disponível", "no disponible", "non disponible")}: {r.official.reason}</td></tr>}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

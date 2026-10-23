import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { MetricDef, PerfGame } from "@replay-altar/core/ui";
import { per10Minutes } from "@replay-altar/core/metrics";
import { base, Chart, esc, winrateBars, type Tokens } from "../Chart.tsx";
import { assess, describeRef, groupForRace, pickProfile } from "@replay-altar/reference/compare";
import { ProMedian, Standing } from "../Standing.tsx";
import { groupDetails, SECTION_INFO, splitMetrics } from "../sections.ts";
import { proText, researchTimes, upgradeRows, upgradeStanding } from "../upgrades.ts";
import type { RaceCode } from "@replay-altar/core/gamedata";
import type { RefGroupInfo } from "../api.ts";
import { Recurring } from "../Recurring.tsx";
import { dateTime, GROUP_LABEL, groupLabel, mean, metricValue, mmss, pct, RACE, shortName, SOURCE } from "../format.ts";
import { locale, tr } from "@replay-altar/core/i18n";

type Group = { label: string; wins: number; losses: number };

function groupBy(games: PerfGame[], keyOf: (g: PerfGame) => string | null, order?: string[]): Group[] {
  const m = new Map<string, Group>();
  for (const g of games) {
    const k = keyOf(g);
    if (!k || (g.result !== "win" && g.result !== "loss")) continue;
    const row = m.get(k) ?? { label: k, wins: 0, losses: 0 };
    if (g.result === "win") row.wins++;
    else row.losses++;
    m.set(k, row);
  }
  const rows = [...m.values()];
  return order
    ? rows.sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label))
    : rows.sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || a.label.localeCompare(b.label));
}

const LENGTHS = [tr("Under 10 min", "Menos de 10 min", "Menos de 10 min", "Moins de 10 min"), "10–20 min", tr("Over 20 min", "Mais de 20 min", "Más de 20 min", "Plus de 20 min")];
const lengthBucket = (ms: number) => (ms < 600_000 ? LENGTHS[0] : ms <= 1_200_000 ? LENGTHS[1] : LENGTHS[2]);

function BarCard({ title, sub, rows }: { title: string; sub: string; rows: Group[] }) {
  const option = useMemo(() => winrateBars(rows), [rows]);
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      {rows.length === 0 ? <div className="empty">{tr("No games", "Nenhuma partida", "Sin partidas", "Aucune partie")}</div> : <Chart option={option} height={Math.max(60, rows.length * 34 + 8)} label={`${title}: ${rows.map((r) => tr(`${r.label} ${r.wins} wins ${r.losses} losses`, `${r.label} ${r.wins} vitórias ${r.losses} derrotas`, `${r.label} ${r.wins} victorias ${r.losses} derrotas`, `${r.label} ${r.wins} victoires ${r.losses} défaites`)).join("; ")}`} />}
    </div>
  );
}

/** Round up to a clean axis value: 291 -> 300, 212000 -> 250000. */
const niceCeil = (x: number) => {
  if (x <= 0) return 1;
  const step = 10 ** Math.floor(Math.log10(x)) / 2;
  return Math.ceil(x / step) * step;
};

function lineOption(
  points: { label: string; value: number | null; note: string }[],
  format: (v: number) => string,
  yMax?: number,
  ref?: { label: string; p25: number; p50: number; p75: number } | null,
) {
  return (t: Tokens): EChartsOption => {
    const b = base(t);
    return {
      ...b,
      grid: { left: 8, right: 16, top: 12, bottom: 8, containLabel: true },
      tooltip: {
        ...(b.tooltip as object),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps: unknown) => {
          const p = (ps as { dataIndex: number }[])[0];
          const pt = points[p.dataIndex];
          return `<b>${pt.value === null ? "—" : format(pt.value)}</b><br/><span style="color:${t.ink2}">${esc(pt.note)}</span>`;
        },
      },
      xAxis: { ...(b.xAxis as object), type: "category", data: points.map((p) => p.label), splitLine: { show: false } },
      yAxis: {
        ...(b.yAxis as object),
        type: "value",
        min: 0,
        // Stretch to the reference band too, or it can sit entirely off-scale.
        max: yMax ?? (ref ? (v: { max: number }) => niceCeil(Math.max(v.max, ref.p75) * 1.05) : undefined),
        axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => format(v) },
      },
      series: [
        {
          type: "line",
          data: points.map((p) => p.value),
          connectNulls: true,
          color: t.series1,
          lineStyle: { width: 2, cap: "round", join: "round" },
          symbol: "circle",
          symbolSize: 8,
          itemStyle: { borderColor: t.surface, borderWidth: 2 },
          // Reference: pros' middle 50% shaded, their median as a muted line.
          markArea: ref
            ? { silent: true, itemStyle: { color: t.ink2, opacity: 0.12 }, data: [[{ yAxis: ref.p25 }, { yAxis: ref.p75 }]] }
            : undefined,
          markLine: ref
            ? {
                silent: true,
                symbol: "none",
                lineStyle: { color: t.ink2, width: 1.5, type: "solid", opacity: 0.7 },
                label: { formatter: tr(`${ref.label} median`, `mediana dos ${ref.label}`, `mediana de ${ref.label}`, `médiane : ${ref.label}`), color: t.ink2, fontSize: 11, position: "insideEndTop" },
                data: [{ yAxis: ref.p50 }],
              }
            : undefined,
        },
      ],
    };
  };
}

/** Mean of the games where the metric exists, with the count when some games lack it (e.g. never reached tier 3). */
function Avg({ def, values }: { def: MetricDef; values: (number | null | undefined)[] }) {
  const present = values.filter((v) => typeof v === "number").length;
  return (
    <>
      {metricValue(def, mean(values))}
      {present > 0 && present < values.length && <span className="muted small"> ({present}/{values.length})</span>}
    </>
  );
}

/** A mean in seconds, or a dash without the unit when no game has it. */
const seconds = (v: number | null) => (v === null || v === undefined ? "—" : `${metricValue({ unit: "count" }, v)} s`);

export function Performance({ games: all, metrics, refs, onOpen }: { games: PerfGame[]; metrics: MetricDef[]; refs: RefGroupInfo[]; onOpen: (key: string) => void }) {
  const [period, setPeriod] = useState("all");
  const [source, setSource] = useState("all");
  const [oppRace, setOppRace] = useState("all");
  const [trendMetric, setTrendMetric] = useState("hero_xp_10m");

  const games = useMemo(() => {
    const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
    return all
      .filter((g) => Date.parse(g.played_at) >= since && (source === "all" || g.source === source) && (oppRace === "all" || g.opp_race === oppRace))
      .sort((a, b) => a.played_at.localeCompare(b.played_at));
  }, [all, period, source, oppRace]);

  // Pros of your race (the one you played most in view); the matchup in view when it is a
  // single one, else all of their games.
  const raceCount = new Map<string, number>();
  for (const g of games) if (g.me_race) raceCount.set(g.me_race, (raceCount.get(g.me_race) ?? 0) + 1);
  const race = ([...raceCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "") as RaceCode;
  const pros = groupForRace(refs, race);
  const matchups = [...new Set(games.map((g) => g.matchup).filter(Boolean))] as string[];
  const ref = pickProfile(pros?.profile, matchups.length === 1 ? matchups[0] : null);

  const decided = games.filter((g) => g.result === "win" || g.result === "loss");
  const wins = decided.filter((g) => g.result === "win");
  const losses = decided.filter((g) => g.result === "loss");
  const winrate = decided.length ? wins.length / decided.length : null;

  const byMatchup = useMemo(() => groupBy(games, (g) => g.matchup), [games]);
  const byMap = useMemo(() => groupBy(games, (g) => g.map_name), [games]);
  const byLength = useMemo(() => groupBy(games, (g) => lengthBucket(g.duration_ms), LENGTHS), [games]);

  const formOption = useMemo(() => {
    const pts = decided.map((g, i) => {
      const window = decided.slice(Math.max(0, i - 9), i + 1);
      return {
        label: new Date(g.played_at).toLocaleDateString(locale(), { month: "short", day: "numeric" }),
        value: window.filter((x) => x.result === "win").length / window.length,
        note: tr(
          `after ${dateTime(g.played_at)} vs ${shortName(g.opp_name)} (${g.result}) · last ${window.length} games`,
          `depois de ${dateTime(g.played_at)} contra ${shortName(g.opp_name)} (${g.result === "win" ? "vitória" : "derrota"}) · últimas ${window.length} partidas`,
          `después de ${dateTime(g.played_at)} contra ${shortName(g.opp_name)} (${g.result}) · últimas ${window.length} partidas`,
          `après ${dateTime(g.played_at)} contre ${shortName(g.opp_name)} (${g.result}) · ${window.length} dernières parties`,
        ),
      };
    });
    return lineOption(pts, (v) => `${Math.round(v * 100)}%`, 1);
  }, [decided]);

  // Undefined until the data has loaded (the first render gets no metrics).
  const trendDef = metrics.find((m) => m.key === trendMetric);
  const trendOption = useMemo(() => {
    // Whole-game totals are plotted per 10 minutes, so games (and the pros) of any length compare.
    if (!trendDef) return null;
    const scaled = trendDef.scalesWithLength;
    const pts = games.map((g) => {
      const v = g.me[trendMetric];
      return {
        label: new Date(g.played_at).toLocaleDateString(locale(), { month: "short", day: "numeric" }),
        value: typeof v === "number" ? (scaled ? per10Minutes(v, g.duration_ms) : v) : null,
        note: tr(
          `${dateTime(g.played_at)} · ${g.result} vs ${shortName(g.opp_name)} on ${g.map_name}${scaled ? " · per 10 min" : ""}`,
          `${dateTime(g.played_at)} · ${g.result === "win" ? "vitória" : g.result === "loss" ? "derrota" : g.result} contra ${shortName(g.opp_name)} em ${g.map_name}${scaled ? " · a cada 10 min" : ""}`,
          `${dateTime(g.played_at)} · ${g.result} contra ${shortName(g.opp_name)} en ${g.map_name}${scaled ? " · cada 10 min" : ""}`,
          `${dateTime(g.played_at)} · ${g.result} contre ${shortName(g.opp_name)} sur ${g.map_name}${scaled ? " · par tranche de 10 min" : ""}`,
        ),
      };
    });
    const entry = ref?.mp.metrics[trendMetric];
    const st = scaled ? entry?.per10 : entry;
    return lineOption(pts, (v) => metricValue({ unit: trendDef.unit }, v), undefined, st ? { label: "Pros", p25: st.p25, p50: st.p50, p75: st.p75 } : null);
  }, [games, trendMetric, trendDef, ref]);

  const heroes = useMemo(() => groupBy(games, (g) => g.first_hero), [games]);
  const opponents = useMemo(() => {
    const m = new Map<string, { name: string; race: string; wins: number; losses: number; last: PerfGame }>();
    for (const g of games) {
      const k = g.opp_name ?? "?";
      const row = m.get(k) ?? { name: k, race: g.opp_race ?? "", wins: 0, losses: 0, last: g };
      if (g.result === "win") row.wins++;
      if (g.result === "loss") row.losses++;
      if (g.played_at > row.last.played_at) row.last = g;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.wins + b.losses - (a.wins + a.losses) || b.last.played_at.localeCompare(a.last.played_at));
  }, [games]);

  if (all.length === 0 || !trendDef || !trendOption) return <div className="page"><div className="empty">{tr("No analyzed games yet.", "Nenhuma partida analisada ainda.", "Todavía no hay partidas analizadas.", "Aucune partie analysée pour l'instant.")}</div></div>;

  return (
    <div className="page">
      <div className="filters">
        <label>
          {tr("Period", "Período", "Periodo", "Période")}
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">{tr("All time", "Desde o início", "Todo", "Depuis toujours")}</option>
            <option value="90">{tr("Last 90 days", "Últimos 90 dias", "Últimos 90 días", "90 derniers jours")}</option>
            <option value="30">{tr("Last 30 days", "Últimos 30 dias", "Últimos 30 días", "30 derniers jours")}</option>
            <option value="7">{tr("Last 7 days", "Últimos 7 dias", "Últimos 7 días", "7 derniers jours")}</option>
          </select>
        </label>
        <label>
          {tr("Source", "Origem", "Origen", "Origine")}
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          {tr("Opponent race", "Raça do oponente", "Raza del rival", "Race de l'adversaire")}
          <select value={oppRace} onChange={(e) => setOppRace(e.target.value)}>
            <option value="all">{tr("All", "Todas", "Todos", "Toutes")}</option>
            {["H", "O", "U", "N"].map((r) => <option key={r} value={r}>{RACE[r]}</option>)}
          </select>
        </label>
        <span className="muted small">{tr(`${games.length} games`, `${games.length} partidas`, `${games.length} partidas`, `${games.length} parties`)}</span>
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="label">{tr("Win rate", "Taxa de vitórias", "% de victorias", "Taux de victoire")}</div>
          <div className="value hero">{pct(winrate)}</div>
          <div className="note">{tr(`${wins.length} wins · ${losses.length} losses`, `${wins.length} vitórias · ${losses.length} derrotas`, `${wins.length} victorias · ${losses.length} derrotas`, `${wins.length} victoires · ${losses.length} défaites`)}</div>
        </div>
        <div className="card tile">
          <div className="label">{tr("Average APM", "APM médio", "APM medio", "APM moyen")}</div>
          <div className="value">{metricValue({ unit: "apm" }, mean(games.map((g) => g.me.apm)))}</div>
          <div className="note">{tr("opponents", "oponentes", "rivales", "adversaires")} {metricValue({ unit: "apm" }, mean(games.map((g) => g.opp.apm)))}</div>
        </div>
        <div className="card tile">
          <div className="label">{tr("Average game length", "Duração média das partidas", "Duración media de las partidas", "Durée moyenne des parties")}</div>
          <div className="value">{mmss(mean(games.map((g) => g.duration_ms)))}</div>
          <div className="note">{tr("wins", "vitórias", "victorias", "victoires")} {mmss(mean(wins.map((g) => g.duration_ms)))} · {tr("losses", "derrotas", "derrotas", "défaites")} {mmss(mean(losses.map((g) => g.duration_ms)))}</div>
        </div>
        <div className="card tile">
          <div className="label">{tr("Supply blocked per game", "Travado no food por partida", "Bloqueo de food por partida", "Blocage de food par partie")}</div>
          <div className="value">{seconds(mean(games.map((g) => g.me.supply_blocked_s)))}</div>
          <div className="note">{tr("opponents", "oponentes", "rivales", "adversaires")} {seconds(mean(games.map((g) => g.opp.supply_blocked_s)))} · {tr("from the simulation", "pela simulação", "de la simulación", "d'après la simulation")}</div>
        </div>
        <div className="card tile">
          <div className="label">{tr("Tier 2 started", "Tier 2 iniciado", "Tier 2 empezado", "Tier 2 lancé")}</div>
          <div className="value">{mmss(mean(games.map((g) => g.me.tier2_ms)))}</div>
          <div className="note">{tr("opponents", "oponentes", "rivales", "adversaires")} {mmss(mean(games.map((g) => g.opp.tier2_ms)))}</div>
        </div>
      </div>

      <Recurring games={games} onOpen={onOpen} />

      <div className="grid-3">
        <BarCard title={tr("Win rate by matchup", "Vitórias por confronto", "% de victorias por enfrentamiento", "Taux de victoire par matchup")} sub={tr("Your race first.", "Sua raça primeiro.", "Tu raza primero.", "Votre race en premier.")} rows={byMatchup} />
        <BarCard title={tr("Win rate by map", "Vitórias por mapa", "% de victorias por mapa", "Taux de victoire par carte")} sub={tr("Wins–losses at the bar end.", "Vitórias–derrotas no fim da barra.", "Victorias–derrotas al final de la barra.", "Victoires–défaites au bout de la barre.")} rows={byMap} />
        <BarCard title={tr("Win rate by game length", "Vitórias por duração", "% de victorias por duración", "Taux de victoire par durée de partie")} sub={tr("Do you win short or long games?", "Você ganha partidas curtas ou longas?", "¿Ganas las partidas cortas o las largas?", "Gagnez-vous les parties courtes ou longues ?")} rows={byLength} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>{tr("Form", "Fase", "Racha", "Forme")}</h2>
          <p className="sub">{tr("Win rate over your last 10 games, after each game.", "Taxa de vitórias nas suas últimas 10 partidas, depois de cada partida.", "% de victorias en tus últimas 10 partidas, después de cada partida.", "Taux de victoire sur vos 10 dernières parties, après chaque partie.")}</p>
          {decided.length < 2 ? <div className="empty">{tr("Needs at least 2 games", "Precisa de pelo menos 2 partidas", "Necesita al menos 2 partidas", "Il faut au moins 2 parties")}</div> : <Chart option={formOption} height={220} label={tr("Rolling win rate over the last 10 games", "Taxa de vitórias nas últimas 10 partidas", "% de victorias móvil en las últimas 10 partidas", "Taux de victoire glissant sur les 10 dernières parties")} />}
        </div>
        <div className="card">
          <h2>
            <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} aria-label={tr("Metric to plot", "Número no gráfico", "Métrica a mostrar", "Mesure à afficher")}>
              {(["core", "mechanics", "details"] as const).map((sec) => (
                <optgroup key={sec} label={SECTION_INFO[sec].title}>
                  {splitMetrics(metrics)[sec].map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>{" "}
            {tr("over time", "ao longo do tempo", "a lo largo del tiempo", "au fil du temps")}
          </h2>
          <p className="sub">
            {trendDef.description}
            {trendDef.scalesWithLength ? tr(" Shown per 10 minutes of game time.", " Mostrado a cada 10 minutos de jogo.", " Mostrado cada 10 minutos de partida.", " Affiché par tranche de 10 minutes de jeu.") : ""}
            {ref?.mp.metrics[trendMetric] ? tr(` Grey: pros (${describeRef(ref)}), median and middle 50%.`, ` Cinza: pros (${describeRef(ref)}), mediana e os 50% do meio.`, ` Gris: pros (${describeRef(ref)}), mediana y 50% central.`, ` Gris : pros (${describeRef(ref)}), médiane et 50 % central.`) : ""}
          </p>
          <Chart option={trendOption} height={220} label={tr(`${trendDef.label} per game over time`, `${trendDef.label} por partida ao longo do tempo`, `${trendDef.label} por partida a lo largo del tiempo`, `${trendDef.label} par partie au fil du temps`)} />
        </div>
      </div>

      <div className="card">
        <h2>{tr("How you play in wins vs losses", "Como você joga nas vitórias e nas derrotas", "Cómo juegas en victorias y en derrotas", "Comment vous jouez dans vos victoires et vos défaites")}</h2>
        <p className="sub">
          {tr("Averages over the filtered games; (3/6) means only 3 of 6 games had that event. The opponents column is everyone you faced.", "Médias das partidas filtradas; (3/6) significa que só 3 de 6 partidas tiveram aquele evento. A coluna dos oponentes reúne todos que você enfrentou.", "Medias de las partidas filtradas; (3/6) significa que solo 3 de 6 partidas tuvieron ese evento. La columna de rivales reúne a todos a los que te enfrentaste.", "Moyennes des parties filtrées ; (3/6) signifie que seules 3 parties sur 6 ont eu cet événement. La colonne des adversaires regroupe tous ceux que vous avez affrontés.")}
          {ref
            ? tr(
                ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Core and Mechanics get a verdict: green = pro level (at or above the pro median), yellow = not yet but at least as good as your opponents, red = below both; for timings with no better direction (heroes, tiers, expansions): green = like pros (their middle 50%), yellow = unusual, red = far from pros. Whole-game totals are compared per 10 minutes.`,
                ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Essencial e Mecânica recebem um veredito: verde = nível pro (na mediana dos pros ou acima), amarelo = ainda não, mas pelo menos tão bom quanto os seus oponentes, vermelho = abaixo dos dois; para tempos sem direção melhor (heróis, tiers, expansões): verde = como os pros (os 50% do meio deles), amarelo = incomum, vermelho = longe dos pros. Totais da partida inteira são comparados a cada 10 minutos.`,
                ` Pros: ${groupLabel(pros!.group)}, ${describeRef(ref)}. Lo esencial y la mecánica reciben un veredicto: verde = nivel pro (en la mediana de los pros o por encima), amarillo = todavía no, pero al menos tan bueno como tus rivales, rojo = por debajo de ambos; para tiempos sin una dirección mejor (héroes, tiers, expansiones): verde = como los pros (su 50% central), amarillo = poco habitual, rojo = lejos de los pros. Los totales de toda la partida se comparan cada 10 minutos.`,
                ` Pros : ${groupLabel(pros!.group)}, ${describeRef(ref)}. L'essentiel et la mécanique reçoivent un verdict : vert = niveau pro (à la médiane des pros ou au-dessus), jaune = pas encore, mais au moins aussi bon que vos adversaires, rouge = en dessous des deux ; pour les timings sans meilleure direction (héros, tiers, expansions) : vert = comme les pros (leurs 50 % centraux), jaune = inhabituel, rouge = loin des pros. Les totaux de toute la partie sont comparés par tranche de 10 minutes.`,
              )
            : tr(" This version has no pro statistics for your race, so there is no pro comparison.", " Esta versão não tem estatísticas de pros para a sua raça, então não há comparação com os pros.", " Esta versión no tiene estadísticas de pros para tu raza, así que no hay comparación con los pros.", " Cette version n'a pas de statistiques de pros pour votre race : il n'y a donc pas de comparaison avec les pros.")}
          {" "}{tr("Hover a metric for its definition.", "Passe o mouse num número para ver a definição.", "Pasa el cursor por una métrica para ver su definición.", "Survolez une mesure pour voir sa définition.")}
        </p>
        {(() => {
          const cols = ref ? 7 : 5;
          const row = (m: MetricDef, verdict: boolean) => {
            const a = assess(
              m,
              ref?.mp ?? null,
              {
                value: mean(games.map((g) => g.me[m.key])),
                // Normalize each game before averaging: your games and the pros' differ in length.
                per10: mean(games.map((g) => (typeof g.me[m.key] === "number" ? per10Minutes(g.me[m.key]!, g.duration_ms) : null))),
              },
              mean(games.map((g) => g.opp[m.key])),
            );
            const shown = verdict ? a : { ...a, tier: null };
            return (
              <tr key={m.key} title={m.description} className={ref && shown.tier ? `tier-row-${shown.tier}` : undefined}>
                <td>{m.raceLabels?.[race] ?? m.label}</td>
                <td className="num"><Avg def={m} values={wins.map((g) => g.me[m.key])} /></td>
                <td className="num"><Avg def={m} values={losses.map((g) => g.me[m.key])} /></td>
                <td className="num"><Avg def={m} values={games.map((g) => g.me[m.key])} /></td>
                <td className="num muted"><Avg def={m} values={games.map((g) => g.opp[m.key])} /></td>
                {ref && <td className="num muted"><ProMedian def={m} a={a} /></td>}
                {ref && <td><Standing a={shown} /></td>}
              </tr>
            );
          };
          const head = (
            <thead>
              <tr>
                <th>{tr("Metric", "Número", "Métrica", "Mesure")}</th>
                <th className="num">{tr(`In your wins (${wins.length})`, `Nas suas vitórias (${wins.length})`, `En tus victorias (${wins.length})`, `Dans vos victoires (${wins.length})`)}</th>
                <th className="num">{tr(`In your losses (${losses.length})`, `Nas suas derrotas (${losses.length})`, `En tus derrotas (${losses.length})`, `Dans vos défaites (${losses.length})`)}</th>
                <th className="num">{tr("All your games", "Todas as suas partidas", "Todas tus partidas", "Toutes vos parties")}</th>
                <th className="num">{tr("Your opponents", "Seus oponentes", "Tus rivales", "Vos adversaires")}</th>
                {ref && <th className="num">{tr("Pros (median)", "Pros (mediana)", "Pros (mediana)", "Pros (médiane)")}</th>}
                {ref && <th>{tr("Where you stand", "Onde você está", "Dónde estás", "Où vous en êtes")}</th>}
              </tr>
            </thead>
          );
          const sectionRow = (id: keyof typeof SECTION_INFO) => (
            <tr key={`s-${id}`} className="section-row">
              <td colSpan={cols}><b>{SECTION_INFO[id].title}</b> <span className="muted small">{SECTION_INFO[id].note}</span></td>
            </tr>
          );
          const { core, mechanics, details } = splitMetrics(metrics);
          // Upgrades: per game research times; compared with pros only when they play your race.
          const timesByGame = new Map(games.map((g) => [g.game_key, researchTimes(g.upgrades.map((u) => ({ kind: "upgrade", code: u.code, ms: u.ms })))]));
          const yourKeys = new Set([...timesByGame.values()].flatMap((m) => [...m.keys()]));
          const upMp = ref && pros?.profile?.group.race === race ? ref.mp : null;
          const ups = ["H", "O", "U", "N"].includes(race) ? upgradeRows(race, yourKeys, upMp) : { core: [], other: [] };
          const avgTime = (list: PerfGame[], key: string) => {
            const t = list.map((g) => timesByGame.get(g.game_key)?.get(key)).filter((x): x is number => x !== undefined);
            return t.length ? (
              <>
                {mmss(mean(t))}
                {t.length < list.length && <span className="muted small"> ({t.length}/{list.length})</span>}
              </>
            ) : (
              "—"
            );
          };
          const subRow = (label: string) => (
            <tr key={`sub-${label}`}><td colSpan={cols} className="muted small" style={{ paddingTop: 12 }}>{label}</td></tr>
          );
          const upRow = (u: (typeof ups.core)[number]) => {
            const yours = games.map((g) => timesByGame.get(g.game_key)?.get(u.key)).filter((x): x is number => x !== undefined);
            return (
              <tr key={u.key}>
                <td>
                  {u.label}
                  {u.detail && <span className="muted small"> {u.detail}</span>}
                </td>
                <td className="num">{avgTime(wins, u.key)}</td>
                <td className="num">{avgTime(losses, u.key)}</td>
                <td className="num">{avgTime(games, u.key)}</td>
                <td className="num muted">—</td>
                {ref && <td className="num muted small">{upMp ? proText(u.pro) : "—"}</td>}
                {ref && <td className="small muted">{upMp ? upgradeStanding(u.pro, yours.length ? mean(yours) : null) : "—"}</td>}
              </tr>
            );
          };
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
                <summary>{SECTION_INFO.details.title}: {tr(`${details.length} more metrics.`, `mais ${details.length} números.`, `${details.length} métricas más.`, `${details.length} mesures de plus.`)} {SECTION_INFO.details.note}</summary>
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

      <div className="grid-2">
        <div className="card">
          <h2>{tr("First hero", "Primeiro herói", "Primer héroe", "Premier héros")}</h2>
          <p className="sub">{tr("The hero you skilled first.", "O herói em que você aprendeu a primeira habilidade.", "El héroe al que le asignaste habilidad primero.", "Le héros dont vous avez appris une compétence en premier.")}</p>
          <table>
            <thead><tr><th>{tr("Hero", "Herói", "Héroe", "Héros")}</th><th className="num">{tr("Games", "Partidas", "Partidas", "Parties")}</th><th className="num">{tr("Win rate", "Vitórias", "% de victorias", "Taux de victoire")}</th></tr></thead>
            <tbody>
              {heroes.map((h) => (
                <tr key={h.label}><td>{h.label}</td><td className="num">{h.wins + h.losses}</td><td className="num">{pct(h.wins / Math.max(1, h.wins + h.losses))} <span className="muted">{h.wins}–{h.losses}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>{tr("Opponents", "Oponentes", "Rivales", "Adversaires")}</h2>
          <p className="sub">{tr("Head-to-head; click to open the last game against them.", "Confronto direto; clique para abrir a última partida contra eles.", "Cara a cara; haz clic para abrir la última partida contra ese rival.", "Face-à-face ; cliquez pour ouvrir la dernière partie contre lui.")}</p>
          <table>
            <thead><tr><th>{tr("Opponent", "Oponente", "Rival", "Adversaire")}</th><th>{tr("Race", "Raça", "Raza", "Race")}</th><th className="num">{tr("Record", "Placar", "Balance", "Bilan")}</th><th>{tr("Last played", "Última partida", "Última partida", "Dernière partie")}</th></tr></thead>
            <tbody>
              {opponents.map((o) => (
                <tr key={o.name} className="click" onClick={() => onOpen(o.last.game_key)}>
                  <td title={o.name}>{shortName(o.name)}</td>
                  <td className="muted">{RACE[o.race]}</td>
                  <td className="num">{o.wins}–{o.losses}</td>
                  <td className="muted">{dateTime(o.last.played_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

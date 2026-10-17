import { useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { MetricDef, PerfGame } from "@w3stats/core/ui";
import { base, Chart, esc, winrateBars, type Tokens } from "../Chart.tsx";
import { describeRef, pickProfile, standing } from "../compare.ts";
import type { RefGroupInfo } from "../api.ts";
import { dateTime, GROUP_LABEL, mean, metricValue, mmss, pct, RACE, shortName, SOURCE } from "../format.ts";

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

const LENGTHS = ["Under 10 min", "10–20 min", "Over 20 min"];
const lengthBucket = (ms: number) => (ms < 600_000 ? LENGTHS[0] : ms <= 1_200_000 ? LENGTHS[1] : LENGTHS[2]);

function BarCard({ title, sub, rows }: { title: string; sub: string; rows: Group[] }) {
  const option = useMemo(() => winrateBars(rows), [rows]);
  return (
    <div className="card">
      <h2>{title}</h2>
      <p className="sub">{sub}</p>
      {rows.length === 0 ? <div className="empty">No games</div> : <Chart option={option} height={Math.max(60, rows.length * 34 + 8)} label={`${title}: ${rows.map((r) => `${r.label} ${r.wins} wins ${r.losses} losses`).join("; ")}`} />}
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
                label: { formatter: `${ref.label} median`, color: t.ink2, fontSize: 11, position: "insideEndTop" },
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

export function Performance({ games: all, metrics, pros, onOpen }: { games: PerfGame[]; metrics: MetricDef[]; pros?: RefGroupInfo; onOpen: (key: string) => void }) {
  const [period, setPeriod] = useState("all");
  const [source, setSource] = useState("all");
  const [oppRace, setOppRace] = useState("all");
  const [trendMetric, setTrendMetric] = useState("apm");

  const games = useMemo(() => {
    const since = period === "all" ? 0 : Date.now() - Number(period) * 86_400_000;
    return all
      .filter((g) => Date.parse(g.played_at) >= since && (source === "all" || g.source === source) && (oppRace === "all" || g.opp_race === oppRace))
      .sort((a, b) => a.played_at.localeCompare(b.played_at));
  }, [all, period, source, oppRace]);

  // Pros to compare with: the matchup in view when it is a single one, else all of them.
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
        label: new Date(g.played_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value: window.filter((x) => x.result === "win").length / window.length,
        note: `after ${dateTime(g.played_at)} vs ${shortName(g.opp_name)} (${g.result}) · last ${window.length} games`,
      };
    });
    return lineOption(pts, (v) => `${Math.round(v * 100)}%`, 1);
  }, [decided]);

  const trendDef = metrics.find((m) => m.key === trendMetric)!;
  const trendOption = useMemo(() => {
    const pts = games.map((g) => ({
      label: new Date(g.played_at).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      value: g.me[trendMetric] ?? null,
      note: `${dateTime(g.played_at)} · ${g.result} vs ${shortName(g.opp_name)} on ${g.map_name}`,
    }));
    const st = ref?.mp.metrics[trendMetric];
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

  if (all.length === 0) return <div className="page"><div className="empty">No analyzed games yet.</div></div>;
  const groups = [...new Set(metrics.map((m) => m.group))];

  return (
    <div className="page">
      <div className="filters">
        <label>
          Period
          <select value={period} onChange={(e) => setPeriod(e.target.value)}>
            <option value="all">All time</option>
            <option value="90">Last 90 days</option>
            <option value="30">Last 30 days</option>
            <option value="7">Last 7 days</option>
          </select>
        </label>
        <label>
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All</option>
            {Object.entries(SOURCE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label>
          Opponent race
          <select value={oppRace} onChange={(e) => setOppRace(e.target.value)}>
            <option value="all">All</option>
            {["H", "O", "U", "N"].map((r) => <option key={r} value={r}>{RACE[r]}</option>)}
          </select>
        </label>
        <span className="muted small">{games.length} games</span>
      </div>

      <div className="tiles">
        <div className="card tile">
          <div className="label">Win rate</div>
          <div className="value hero">{pct(winrate)}</div>
          <div className="note">{wins.length} wins · {losses.length} losses</div>
        </div>
        <div className="card tile">
          <div className="label">Average APM</div>
          <div className="value">{metricValue({ unit: "apm" }, mean(games.map((g) => g.me.apm)))}</div>
          <div className="note">opponents {metricValue({ unit: "apm" }, mean(games.map((g) => g.opp.apm)))}</div>
        </div>
        <div className="card tile">
          <div className="label">Average game length</div>
          <div className="value">{mmss(mean(games.map((g) => g.duration_ms)))}</div>
          <div className="note">wins {mmss(mean(wins.map((g) => g.duration_ms)))} · losses {mmss(mean(losses.map((g) => g.duration_ms)))}</div>
        </div>
        <div className="card tile">
          <div className="label">Supply blocked per game</div>
          <div className="value">{metricValue({ unit: "count" }, mean(games.map((g) => g.me.supply_blocked_s)))} s</div>
          <div className="note">opponents {metricValue({ unit: "count" }, mean(games.map((g) => g.opp.supply_blocked_s)))} s · from the simulation</div>
        </div>
        <div className="card tile">
          <div className="label">Tier 2 started</div>
          <div className="value">{mmss(mean(games.map((g) => g.me.tier2_ms)))}</div>
          <div className="note">opponents {mmss(mean(games.map((g) => g.opp.tier2_ms)))}</div>
        </div>
      </div>

      <div className="grid-3">
        <BarCard title="Win rate by matchup" sub="Your race first." rows={byMatchup} />
        <BarCard title="Win rate by map" sub="Wins–losses at the bar end." rows={byMap} />
        <BarCard title="Win rate by game length" sub="Do you win short or long games?" rows={byLength} />
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>Form</h2>
          <p className="sub">Win rate over your last 10 games, after each game.</p>
          {decided.length < 2 ? <div className="empty">Needs at least 2 games</div> : <Chart option={formOption} height={220} label="Rolling win rate over the last 10 games" />}
        </div>
        <div className="card">
          <h2>
            <select value={trendMetric} onChange={(e) => setTrendMetric(e.target.value)} aria-label="Metric to plot">
              {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            </select>{" "}
            over time
          </h2>
          <p className="sub">{trendDef.description}{ref?.mp.metrics[trendMetric] ? ` Grey: pros (${describeRef(ref)}), median and middle 50%.` : ""}</p>
          <Chart option={trendOption} height={220} label={`${trendDef.label} per game over time`} />
        </div>
      </div>

      <div className="card">
        <h2>How you play in wins vs losses</h2>
        <p className="sub">
          Averages over the filtered games; (3/6) means only 3 of 6 games had that event. The opponents column is everyone you faced.
          {ref ? ` Pros: ${pros!.group.label}, ${describeRef(ref)}; "where you stand" places your average among their games.` : " Pro comparison appears once reference games are downloaded (w3stats ref refresh)."}
          {" "}Hover a metric for its definition.
        </p>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num">In your wins ({wins.length})</th>
              <th className="num">In your losses ({losses.length})</th>
              <th className="num">All your games</th>
              <th className="num">Your opponents</th>
              {ref && <th className="num">Pros (median)</th>}
              {ref && <th>Where you stand</th>}
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((grp) => [
              <tr key={grp}><td colSpan={ref ? 7 : 5} className="muted small" style={{ paddingTop: 14 }}>{GROUP_LABEL[grp]}</td></tr>,
              ...metrics
                .filter((m) => m.group === grp)
                .map((m) => (
                  <tr key={m.key} title={m.description}>
                    <td>{m.label}</td>
                    <td className="num"><Avg def={m} values={wins.map((g) => g.me[m.key])} /></td>
                    <td className="num"><Avg def={m} values={losses.map((g) => g.me[m.key])} /></td>
                    <td className="num"><Avg def={m} values={games.map((g) => g.me[m.key])} /></td>
                    <td className="num muted"><Avg def={m} values={games.map((g) => g.opp[m.key])} /></td>
                    {ref && <td className="num muted">{metricValue(m, ref.mp.metrics[m.key]?.p50)}</td>}
                    {ref && <td className="small">{standing(m, ref.mp, mean(games.map((g) => g.me[m.key])))}</td>}
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>

      <div className="grid-2">
        <div className="card">
          <h2>First hero</h2>
          <p className="sub">The hero you skilled first.</p>
          <table>
            <thead><tr><th>Hero</th><th className="num">Games</th><th className="num">Win rate</th></tr></thead>
            <tbody>
              {heroes.map((h) => (
                <tr key={h.label}><td>{h.label}</td><td className="num">{h.wins + h.losses}</td><td className="num">{pct(h.wins / Math.max(1, h.wins + h.losses))} <span className="muted">{h.wins}–{h.losses}</span></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Opponents</h2>
          <p className="sub">Head-to-head; click to open the last game against them.</p>
          <table>
            <thead><tr><th>Opponent</th><th>Race</th><th className="num">Record</th><th>Last played</th></tr></thead>
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

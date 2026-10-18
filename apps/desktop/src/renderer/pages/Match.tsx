import { useCallback, useEffect, useMemo, useState } from "react";
import type { BuildEvent, GameDetail, GameRecord, MetricDef, PlayerRecord, SimSample } from "@replay-altar/core/ui";
import { per10Minutes } from "@replay-altar/core/metrics";
import { heroesXpAt } from "@replay-altar/core/heroxp";
import { api, type RefGroupInfo } from "../api.ts";
import { MIN_GAME_MS } from "@replay-altar/ai/findings";
import { deviationsFromPros, matchBuilds } from "@replay-altar/ai/builds";
import { proBuildOf, type Principles } from "@replay-altar/ai/principles";
import { AiCard } from "../AiCard.tsx";
import { Chart, heroLevelsChart, timeLines, type Band, type HeroLine, type Tokens } from "../Chart.tsx";
import { assess, describeRef, groupForRace, pickProfile } from "@replay-altar/reference/compare";
import { ProMedian, Standing } from "../Standing.tsx";
import { groupDetails, SECTION_INFO, splitMetrics } from "../sections.ts";
import { proText, researchTimes, upgradeRows, upgradeStanding } from "../upgrades.ts";
import type { RaceCode } from "@replay-altar/core/gamedata";
import type { CurvePoint, MatchupProfile } from "@replay-altar/reference/types";
import { dateTime, GROUP_LABEL, metricValue, mmss, RACE, shortName, SOURCE } from "../format.ts";

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
            <span className="tag">{e.kind}</span>
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
      {p.heroes.length === 0 && <p className="muted">No hero skilled.</p>}
      {p.heroes.map((h) => (
        <div key={h.order}>
          <div><b>{h.name}</b> <span className="muted small">level {h.level}{h.retrainings ? ` · retrained ${h.retrainings}×` : ""}</span></div>
          <div className="skills">
            {h.skills.map((s, i) => (
              <span key={i} className="tag" title={`learned at ${mmss(s.ms)}`}>{i + 1}. {s.name} <span className="muted">{mmss(s.ms)}</span></span>
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
    { name: shortName(me?.name ?? "You"), color: t.series1, points: mine.map((s) => [s.t, pick(s)] as [number, number]) },
    { name: shortName(opp?.name ?? "Opponent"), color: t.series2, points: theirs.map((s) => [s.t, pick(s)] as [number, number]) },
  ];
  const army = useMemo(() => timeLines(both((s) => s.armyValue ?? 0), undefined, bandOf(refMp?.curves.armyValue, refLabel)), [mine, theirs, refMp]);
  const spent = useMemo(() => timeLines(both((s) => s.goldSpent + s.lumberSpent), undefined, bandOf(refMp?.curves.spent, refLabel)), [mine, theirs, refMp]);
  const workers = useMemo(() => timeLines(both((s) => s.workers), undefined, bandOf(refMp?.curves.workers, refLabel)), [mine, theirs, refMp]);
  const supplyFor = (series: SimSample[], mineColor: boolean, band: Band | null = null) =>
    timeLines((t) => [
      { name: "food used", color: mineColor ? t.series1 : t.series2, points: series.map((s) => [s.t, s.foodUsed] as [number, number]), step: true },
      // Cap in the main text colour so it stays distinct from the grey pro reference.
      { name: "food cap", color: t.ink, points: series.map((s) => [s.t, Math.min(100, s.foodMax)] as [number, number]), step: true, muted: true },
    ], undefined, band);
  const mySupply = useMemo(() => supplyFor(mine, true, bandOf(refMp?.curves.food, `${refLabel} food used`)), [mine, refMp]);
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
    ? "Not simulated yet: army, resources, workers and supply appear about a minute after a game ends (older games: replay-altar sim --backfill)."
    : !ok
      ? `Simulation failed: ${(sim as { reason: string }).reason}`
      : null;
  return (
    <div className="card">
      <h2>Game over time</h2>
      <p className="sub">
        You in blue, your opponent in orange{refMp ? `; grey: ${refLabel.toLowerCase()} (median and middle 50%)` : ""}. Army and resources are
        reconstructed by simulating the replay (WC3V); army value is an estimate.
      </p>
      {note && <p className="sub">{note}</p>}
      {ok && (
        <>
          <h3 className="chart-title">≈ Army value (resources in living army units, heroes excluded)</h3>
          <Chart option={army} height={240} label="Estimated army value over time for both players" />
        </>
      )}
      <h3 className="chart-title">Heroes: level over time (✕ died, ○ back after revive; death times are approximate)</h3>
      <Chart option={heroes} height={260} label="Hero levels over time for both players, with deaths and revives" />
      {ok && (
        <div className="grid-2">
          <div>
            <h3 className="chart-title">Resources spent (gold + lumber)</h3>
            <Chart option={spent} height={200} label="Cumulative gold plus lumber spent by both players" />
          </div>
          <div>
            <h3 className="chart-title">Workers alive</h3>
            <Chart option={workers} height={200} label="Workers alive over time for both players" />
          </div>
          <div>
            <h3 className="chart-title">Supply: {shortName(me?.name ?? "You")}</h3>
            <Chart option={mySupply} height={200} label="Your food used against food cap" />
          </div>
          {opp && (
            <div>
              <h3 className="chart-title">Supply: {shortName(opp.name)}</h3>
              <Chart option={oppSupply} height={200} label="Opponent food used against food cap" />
            </div>
          )}
        </div>
      )}
      <h3 className="chart-title">Actions per minute</h3>
      <Chart option={apm} height={220} label="Actions per minute for both players over the game" />
    </div>
  );
}

/** Closest library build, and how the pros who played it did. */
function BuildLine({ record, player, who, principles }: { record: GameRecord; player: PlayerRecord; who: string; principles: Principles | null | undefined }) {
  const best = useMemo(() => matchBuilds(record, player)[0], [record, player]);
  if (!best) return null;
  const pro = proBuildOf(principles, best);
  const dev = pro ? deviationsFromPros(best, pro).filter((d) => ["tech", "expand", "hero"].includes(d.action)) : [];
  const source = best.build.source.author ?? best.build.source.where ?? "guide";
  return (
    <p className="sub" style={{ margin: "6px 0 0" }}>
      <b>{who}:</b> closest to "{best.build.name}" ({source})
      {pro && ` · ${pro.players} pros played it, ${Math.round(pro.winRate * 100)}% won`}
      {dev.length > 0 && ` · vs those pros: ${dev.map((d) => (d.yours === null ? `no ${d.label}` : `${d.label} at ${d.yours} food (pros ${d.pros})`)).join(", ")}`}
    </p>
  );
}

export function Match({ gameKey, metrics, refs, onBack }: { gameKey: string; metrics: MetricDef[]; refs: RefGroupInfo[]; onBack: () => void }) {
  const [detail, setDetail] = useState<GameDetail | undefined>();
  const [hideWorkers, setHideWorkers] = useState(true);
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

  if (detail === undefined) return <div className="page"><div className="empty">Loading…</div></div>;
  if (detail === null || !r) return <div className="page"><div className="empty">Game not found.</div></div>;
  const { row } = detail;
  const overridden = row.result !== row.result_detected;

  return (
    <div className="page">
      <div><button className="btn" onClick={onBack}>← All matches</button></div>
      <div className="card">
        <div className="match-head">
          <span className={`big ${row.result}`}>{row.result === "win" ? "Victory" : row.result === "loss" ? "Defeat" : "Result unknown"}</span>
          <span style={{ fontSize: 18 }}>
            {RACE[me?.race ?? ""]} vs <b>{opp?.name}</b> ({RACE[opp?.race ?? ""]})
          </span>
        </div>
        <p className="sub" style={{ marginTop: 6 }}>
          {r.game.map.file} · {mmss(r.game.durationMs)} · {dateTime(r.game.playedAt)} · {SOURCE[r.classification.source]}
          {r.userLabel ? ` · “${r.userLabel}”` : ""}
        </p>
        <div className="filters">
          <label>
            Result
            <select
              value={overridden ? row.result : "detected"}
              onChange={async (e) => {
                await api.overrideResult(r.gameKey, e.target.value === "detected" ? null : (e.target.value as "win" | "loss"));
                load();
              }}
            >
              <option value="detected">Detected ({row.result_detected}, {r.result.confidence} confidence)</option>
              <option value="win">Win (manual)</option>
              <option value="loss">Loss (manual)</option>
            </select>
          </label>
          <button className="btn" onClick={() => api.showFile(r.provenance.archivePath)}>Show replay file</button>
        </div>
        {r.sim?.status === "ok" && me && opp && (
          <div className="build-lines small">
            <BuildLine record={r} player={me} who="Your build" principles={pros?.principles} />
            <BuildLine record={r} player={opp} who="Opponent's build" principles={groupForRace(refs, opp.race)?.principles} />
          </div>
        )}
      </div>

      {row.analyzed === 1 && me && opp && r.game.durationMs >= MIN_GAME_MS && <AiCard key={r.gameKey} gameKey={r.gameKey} />}

      <GameCharts record={r} refMp={ref?.mp ?? null} refLabel="Pros" />

      <div className="card">
        <h2>Key numbers</h2>
        <p className="sub">
          Order times are when the order was issued (cancels included). Economy and supply rows come from the simulation; ≈ marks estimates.
          {ref
            ? ` Pros: ${pros!.group.label}, ${describeRef(ref)}. Core and Mechanics get a verdict: green = pro level (at or above the pro median), yellow = at least as good as your opponent, red = below both; for timings with no better direction (heroes, tiers, expansions): green = like pros (their middle 50%), yellow = unusual, red = far from pros. Whole-game totals are compared per 10 minutes.`
            : ""}{" "}
          Hover a metric for its definition.
        </p>
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
                  {r.metricSources?.[m.key] === "official" && <span className="tag" style={{ marginLeft: 8 }} title="The game's own end-of-game number (from W3Champions)">official</span>}
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
                <th>Metric</th>
                <th className="num"><span className="key me" />{shortName(me?.name ?? "You")}</th>
                <th className="num"><span className="key opp" />{shortName(opp?.name ?? "Opponent")}</th>
                {ref && <th className="num">Pros (median)</th>}
                {ref && <th>This game vs pros</th>}
              </tr>
            </thead>
          );
          const sectionRow = (id: keyof typeof SECTION_INFO) => (
            <tr key={`s-${id}`} className="section-row">
              <td colSpan={cols}><b>{SECTION_INFO[id].title}</b> <span className="muted small">{SECTION_INFO[id].note}</span></td>
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
                  {subRow("Attack and armor")}
                  {ups.core.map(upRow)}
                  {ups.other.length > 0 && subRow("Other upgrades")}
                  {ups.other.map(upRow)}
                  {sectionRow("mechanics")}
                  {mechanics.map((m) => row(m, true))}
                </tbody>
              </table>
              <details className="more-metrics">
                <summary>{SECTION_INFO.details.title}: {details.length} more metrics. {SECTION_INFO.details.note}</summary>
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
        <h2>Heroes</h2>
        <p className="sub">
          Hero experience over time (all heroes), from level-up times; levels are exact, the XP between them is interpolated. Creeps give no
          experience to a hero of level 5 or more.{ref ? " Grey: pros." : ""}
        </p>
        {xpOption && <Chart option={xpOption} height={220} label="Hero experience over time for both players" />}
        <p className="sub" style={{ marginTop: 12 }}>Skill order; a hero's first skill marks roughly when it arrived.</p>
        <div className="grid-2">
          {me && <Heroes p={me} />}
          {opp && <Heroes p={opp} />}
        </div>
      </div>

      <div className="card">
        <h2>Build order</h2>
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
              {k}s
            </label>
          ))}
          <label><input type="checkbox" checked={hideWorkers} onChange={(e) => setHideWorkers(e.target.checked)} />hide workers</label>
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
          <summary>How this game was classified and where the data came from</summary>
          <table style={{ marginTop: 10 }}>
            <tbody>
              {r.classification.rules.map((x, i) => (
                <tr key={i}>
                  <td className={x.passed ? "" : "rule-fail"} style={{ width: 220 }}>{x.passed ? "✓" : "✗"} {x.rule}</td>
                  <td className="small">{x.evidence}</td>
                </tr>
              ))}
              <tr><td>result</td><td className="small">{r.result.method} ({r.result.confidence}) — {r.result.evidence}</td></tr>
              <tr><td>game key</td><td><code>{r.gameKey}</code></td></tr>
              <tr><td>archived replay</td><td><code>{r.provenance.archivePath}</code></td></tr>
              {r.provenance.files.map((f, i) => (
                <tr key={i}><td>{i === 0 ? "seen as" : ""}</td><td className="small"><code>{f.path}</code> <span className="muted">({f.timeSource})</span></td></tr>
              ))}
              <tr><td>parser</td><td className="small">{r.provenance.parser.name}@{r.provenance.parser.version}, classifier v{r.provenance.classifierVersion}, metrics v{r.provenance.metricsVersion}</td></tr>
              {r.sim?.status === "ok" && (
                <>
                  <tr><td>simulation</td><td className="small">WC3V {r.sim.engine.commit}, game data {r.sim.gameData.version}, income model v{r.sim.model.version}, ran in {(r.sim.runMs / 1000).toFixed(1)} s</td></tr>
                  {r.sim.players.map((p) => (
                    <tr key={p.playerId}><td /><td className="small">{shortName(r.players.find((x) => x.playerId === p.playerId)?.name ?? String(p.playerId))}: parse confidence {Math.round(p.parseConfidence * 100)}%{p.validationWarnings.length ? `, ${p.validationWarnings.length} validator note(s)` : ""}</td></tr>
                  ))}
                  {r.sim.warnings.map((w, i) => <tr key={`w${i}`}><td className="rule-fail">model check</td><td className="small">{w}</td></tr>)}
                  <tr><td>simulation output</td><td><code>{r.sim.outputPath}</code></td></tr>
                </>
              )}
              {r.sim?.status === "failed" && <tr><td className="rule-fail">simulation</td><td className="small">failed: {r.sim.reason}</td></tr>}
              {r.official?.status === "ok" && (
                <tr><td>official stats</td><td className="small">W3Champions match {r.official.matchId}, fetched {dateTime(r.official.fetchedAt)}</td></tr>
              )}
              {r.official?.status === "missing" && <tr><td>official stats</td><td className="small">not available: {r.official.reason}</td></tr>}
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

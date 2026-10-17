import { useCallback, useEffect, useMemo, useState } from "react";
import type { EChartsOption } from "echarts";
import type { BuildEvent, GameDetail, MetricDef, PlayerRecord } from "@w3stats/core/ui";
import { api } from "../api.ts";
import { base, Chart, esc, type Tokens } from "../Chart.tsx";
import { dateTime, metricValue, mmss, RACE, shortName, SOURCE } from "../format.ts";

const WORKERS = new Set(["hpea", "opeo", "uaco", "ewsp"]);
const GROUP_LABEL: Record<string, string> = { speed: "Speed", control: "Control", heroes: "Heroes", macro: "Macro", army: "Army", items: "Items" };

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

export function Match({ gameKey, metrics, onBack }: { gameKey: string; metrics: MetricDef[]; onBack: () => void }) {
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

  const apmOption = useMemo(
    () => (t: Tokens): EChartsOption => {
      const b = base(t);
      const series = [me, opp].filter((p): p is PlayerRecord => !!p);
      const minutes = Math.max(...series.map((p) => p.apmPerMinute.length));
      return {
        ...b,
        grid: { left: 8, right: 16, top: 30, bottom: 8, containLabel: true },
        legend: { top: 0, left: 0, textStyle: { color: t.ink2 }, icon: "rect", itemWidth: 14, itemHeight: 2, itemGap: 16 },
        tooltip: {
          ...(b.tooltip as object),
          trigger: "axis",
          axisPointer: { type: "line", lineStyle: { color: t.axis } },
          formatter: (ps: unknown) =>
            (ps as { axisValue: string; value: number; seriesName: string; color: string }[])
              .map((p, i) => `${i === 0 ? `<span style="color:${t.ink2}">minute ${p.axisValue}</span><br/>` : ""}<span style="display:inline-block;width:12px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${p.value}</b> <span style="color:${t.ink2}">${esc(p.seriesName)}</span>`)
              .join("<br/>"),
        },
        xAxis: { ...(b.xAxis as object), type: "category", boundaryGap: false, data: Array.from({ length: minutes }, (_, i) => String(i + 1)), splitLine: { show: false } },
        yAxis: { ...(b.yAxis as object), type: "value" },
        series: series.map((p) => ({
          type: "line",
          name: shortName(p.name),
          data: p.apmPerMinute,
          showSymbol: false,
          symbolSize: 8,
          lineStyle: { width: 2, cap: "round", join: "round" },
          color: p.isMe ? t.series1 : t.series2,
        })),
      };
    },
    [me, opp],
  );

  if (detail === undefined) return <div className="page"><div className="empty">Loading…</div></div>;
  if (detail === null || !r) return <div className="page"><div className="empty">Game not found.</div></div>;
  const { row } = detail;
  const overridden = row.result !== row.result_detected;
  const groups = [...new Set(metrics.map((m) => m.group))];

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
      </div>

      <div className="card">
        <h2>Actions per minute</h2>
        <p className="sub">Per minute of game time, both players.</p>
        <Chart option={apmOption} height={260} label="Actions per minute for both players over the game" />
      </div>

      <div className="card">
        <h2>Key numbers</h2>
        <p className="sub">Times are when the order was issued (cancels included). Hover a metric for its definition.</p>
        <table>
          <thead>
            <tr>
              <th>Metric</th>
              <th className="num"><span className="key me" />{shortName(me?.name ?? "You")}</th>
              <th className="num"><span className="key opp" />{shortName(opp?.name ?? "Opponent")}</th>
            </tr>
          </thead>
          <tbody>
            {groups.flatMap((g) => [
              <tr key={g}><td colSpan={3} className="muted small" style={{ paddingTop: 14 }}>{GROUP_LABEL[g]}</td></tr>,
              ...metrics
                .filter((m) => m.group === g)
                .map((m) => (
                  <tr key={m.key} title={m.description}>
                    <td>{m.label}</td>
                    <td className="num">{metricValue(m, me?.metrics[m.key])}</td>
                    <td className="num">{metricValue(m, opp?.metrics[m.key])}</td>
                  </tr>
                )),
            ])}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Heroes</h2>
        <p className="sub">Skill order; a hero's first skill marks roughly when it arrived.</p>
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
            </tbody>
          </table>
        </details>
      </div>
    </div>
  );
}

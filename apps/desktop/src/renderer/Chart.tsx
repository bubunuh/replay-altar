// ECharts wrapper that themes every chart from the CSS tokens (re-renders on light/dark change).
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";
import { tr } from "@replay-altar/core/i18n";

export type Tokens = Record<"surface" | "ink" | "ink2" | "muted" | "grid" | "axis" | "series1" | "series2" | "border" | "critical", string>;

function readTokens(): Tokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    surface: v("--surface"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    muted: v("--muted"),
    grid: v("--grid"),
    axis: v("--axis"),
    series1: v("--series-1"),
    series2: v("--series-2"),
    border: v("--border"),
    critical: v("--critical"),
  };
}

function useTokens(): Tokens {
  const [tokens, setTokens] = useState(readTokens);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTokens(readTokens());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return tokens;
}

/** Names in tooltips come from replay files; never let them become markup. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Shared chrome: recessive solid hairline grid, muted axis text, surface-coloured tooltip. */
export function base(t: Tokens): echarts.EChartsOption {
  const axis = {
    axisLine: { lineStyle: { color: t.axis } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 11 },
    splitLine: { lineStyle: { color: t.grid, type: "solid" as const, width: 1 } },
  };
  return {
    textStyle: { fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif", color: t.ink2 },
    animationDuration: 250,
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.border,
      textStyle: { color: t.ink, fontSize: 12 },
      extraCssText: "border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);",
    },
    xAxis: axis,
    yAxis: axis,
  };
}

export function Chart({ option, height, label }: { option: (t: Tokens) => echarts.EChartsOption; height: number; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const tokens = useTokens();

  useEffect(() => {
    if (!ref.current) return;
    chart.current = echarts.init(ref.current, undefined, { renderer: "svg" });
    const ro = new ResizeObserver(() => chart.current?.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      chart.current?.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option(tokens), { notMerge: true });
  }, [option, tokens]);

  return <div ref={ref} style={{ height, width: "100%" }} role="img" aria-label={label} />;
}

/** Horizontal bars of win rate per group; value and record at the bar tip. */
export function winrateBars(rows: { label: string; wins: number; losses: number }[]) {
  return (t: Tokens): echarts.EChartsOption => {
    const b = base(t);
    return {
      ...b,
      grid: { left: 8, right: 96, top: 4, bottom: 4, containLabel: true },
      xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: 100, show: false },
      yAxis: { ...(b.yAxis as object), type: "category", inverse: true, data: rows.map((r) => r.label), axisLabel: { color: t.ink2, fontSize: 12 }, axisLine: { show: false }, splitLine: { show: false } },
      tooltip: {
        ...(b.tooltip as object),
        trigger: "item",
        formatter: (p: unknown) => {
          const r = rows[(p as { dataIndex: number }).dataIndex];
          return `<b>${Math.round((100 * r.wins) / Math.max(1, r.wins + r.losses))}%</b> ${tr("win rate", "de vitórias", "% de victorias", "taux de victoire")}<br/><span style="color:${t.ink2}">${esc(r.label)} · ${r.wins}${tr("W", "V", "V", "V")} ${r.losses}${tr("L", "D", "D", "D")}</span>`;
        },
      },
      series: [
        {
          type: "bar",
          barMaxWidth: 18,
          itemStyle: { color: t.series1, borderRadius: [0, 4, 4, 0] },
          emphasis: { itemStyle: { opacity: 0.85 } },
          data: rows.map((r) => (100 * r.wins) / Math.max(1, r.wins + r.losses)),
          label: {
            show: true,
            position: "right",
            color: t.ink2,
            fontSize: 12,
            formatter: (p: unknown) => {
              const r = rows[(p as { dataIndex: number }).dataIndex];
              return `${Math.round((100 * r.wins) / Math.max(1, r.wins + r.losses))}%  ${r.wins}–${r.losses}`;
            },
          },
        },
      ],
    };
  };
}

export type TimeSeries = { name: string; color: string; points: [number, number][]; muted?: boolean; step?: boolean };

/** A reference band (e.g. pros): middle 50% shaded, median as a muted line. Points: [t, p25, p50, p75]. */
export type Band = { label: string; points: [number, number, number, number][] };

const BAND_LO = "\u2063band-lo";
const BAND_HI = "\u2063band-hi";

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Lines over game time; one tooltip lists every series at the hovered time. */
export function timeLines(series: (t: Tokens) => TimeSeries[], format: (v: number) => string = (v) => String(Math.round(v)), band?: Band | null) {
  return (t: Tokens): echarts.EChartsOption => {
    const b = base(t);
    const list = series(t);
    const medianName = band ? tr(`${band.label} median`, `mediana dos ${band.label}`, `mediana de ${band.label}`, `médiane : ${band.label}`) : "";
    const bandSeries = band && band.points.length
      ? [
          // Stacked pair: an invisible lower edge, then the band height filled in neutral grey.
          { type: "line", name: BAND_LO, data: band.points.map(([x, lo]) => [x, lo]), stack: "band", silent: true, showSymbol: false, lineStyle: { opacity: 0 }, tooltip: { show: false } },
          { type: "line", name: BAND_HI, data: band.points.map(([x, lo, , hi]) => [x, hi - lo]), stack: "band", silent: true, showSymbol: false, lineStyle: { opacity: 0 }, areaStyle: { color: t.ink2, opacity: 0.12 } },
          { type: "line", name: medianName, data: band.points.map(([x, , mid]) => [x, mid]), showSymbol: false, color: t.ink2, lineStyle: { width: 1.5, opacity: 0.7 } },
        ]
      : [];
    return {
      ...b,
      grid: { left: 8, right: 16, top: list.length > 1 || band ? 30 : 12, bottom: 8, containLabel: true },
      legend:
        list.length > 1 || band
          ? { top: 0, left: 0, textStyle: { color: t.ink2 }, icon: "rect", itemWidth: 14, itemHeight: 2, itemGap: 16, data: [...list.map((s) => s.name), ...(bandSeries.length ? [medianName] : [])] }
          : undefined,
      tooltip: {
        ...(b.tooltip as object),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps: unknown) => {
          const all = ps as { value: [number, number]; seriesName: string; color: string; dataIndex: number }[];
          const arr = all.filter((p) => p.seriesName !== BAND_LO && p.seriesName !== BAND_HI && p.seriesName !== medianName);
          if (!all.length) return "";
          const head = `<span style="color:${t.ink2}">${clock(all[0].value[0])}</span>`;
          const rows = arr.map((p) => `<span style="display:inline-block;width:12px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${format(p.value[1])}</b> <span style="color:${t.ink2}">${esc(p.seriesName)}</span>`);
          const med = all.find((p) => p.seriesName === medianName);
          if (band && med) {
            const pt = band.points[med.dataIndex];
            rows.push(`<span style="display:inline-block;width:12px;height:2px;background:${t.ink2};vertical-align:middle;margin-right:6px"></span><b>${format(pt[2])}</b> <span style="color:${t.ink2}">${esc(medianName)} (${tr("middle 50%", "50% do meio", "50% central", "50 % central")}: ${format(pt[1])}–${format(pt[3])})</span>`);
          }
          return [head, ...rows].join("<br/>");
        },
      },
      xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: "dataMax", splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => clock(v) } },
      yAxis: { ...(b.yAxis as object), type: "value", axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => format(v) } },
      series: [
        ...bandSeries,
        ...list.map((s) => ({
          type: "line",
          name: s.name,
          data: s.points,
          step: s.step ? "end" : undefined,
          showSymbol: false,
          color: s.color,
          lineStyle: { width: s.muted ? 1.5 : 2, cap: "round", join: "round", opacity: s.muted ? 0.8 : 1 },
        })),
      ],
    } as echarts.EChartsOption;
  };
}

export type HeroLine = {
  name: string;
  /** player colour key; heroes of one player share the colour, symbols tell them apart */
  side: "me" | "opp";
  order: number;
  appearAt: number | null;
  levelUps: number[];
  deaths: { diedAt: number; revivedAt: number | null }[];
};

const HERO_SYMBOLS = ["circle", "rect", "triangle", "diamond"];
const CROSS = "path://M2,0 L5,3 L8,0 L10,2 L7,5 L10,8 L8,10 L5,7 L2,10 L0,8 L3,5 L0,2 Z";

/**
 * Hero level over time: one stepped line per hero from when it appeared; a gap while dead,
 * ✕ where it died (approximate), an open circle where it came back.
 */
export function heroLevelsChart(heroes: HeroLine[], endMs: number) {
  return (t: Tokens): echarts.EChartsOption => {
    const b = base(t);
    const colour = (h: HeroLine) => (h.side === "me" ? t.series1 : t.series2);
    const levelAt = (h: HeroLine, at: number) => Math.max(1, h.levelUps.filter((x) => x <= at).length);
    const lines = heroes.map((h) => {
      const pts: ([number, number] | [number, null])[] = [];
      if (h.appearAt === null) return { h, pts };
      // Events in time order: level-ups, deaths (break the line), revives (resume it).
      const events = [
        ...h.levelUps.filter((x) => x > h.appearAt!).map((x) => ({ at: x, kind: "level" as const })),
        ...h.deaths.flatMap((d) => [{ at: d.diedAt, kind: "die" as const }, ...(d.revivedAt !== null ? [{ at: d.revivedAt, kind: "back" as const }] : [])]),
      ].sort((a, b) => a.at - b.at);
      let alive = true;
      pts.push([h.appearAt, levelAt(h, h.appearAt)]);
      for (const e of events) {
        if (e.kind === "die") {
          pts.push([e.at, levelAt(h, e.at)]);
          pts.push([e.at, null]);
          alive = false;
        } else if (e.kind === "back") {
          pts.push([e.at, levelAt(h, e.at)]);
          alive = true;
        } else if (alive) {
          pts.push([e.at, levelAt(h, e.at)]);
        }
      }
      if (alive) pts.push([endMs, levelAt(h, endMs)]);
      return { h, pts };
    });
    const tip = (lines: string[]) => lines.map((l) => esc(l)).join("<br/>");
    return {
      ...b,
      grid: { left: 8, right: 16, top: 34, bottom: 8, containLabel: true },
      // Names live in the legend (with each hero's marker shape): end labels collide when two
      // heroes finish at the same level.
      legend: { top: 0, left: 0, textStyle: { color: t.ink2 }, itemWidth: 14, itemHeight: 8, itemGap: 16, data: heroes.map((h) => h.name) },
      tooltip: { ...(b.tooltip as object), trigger: "item" },
      xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: endMs, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => clock(v) } },
      yAxis: { ...(b.yAxis as object), type: "value", min: 0, max: 10, interval: 1 },
      series: [
        ...lines.map(({ h, pts }) => ({
          type: "line" as const,
          name: h.name,
          data: pts,
          step: "end" as const,
          connectNulls: false,
          color: colour(h),
          symbol: HERO_SYMBOLS[(h.order - 1) % HERO_SYMBOLS.length],
          symbolSize: 7,
          lineStyle: { width: 2 },
          tooltip: { formatter: (p: unknown) => tip([`${h.name}`, tr(`level ${(p as { value: [number, number] }).value[1]} at ${clock((p as { value: [number, number] }).value[0])}`, `nível ${(p as { value: [number, number] }).value[1]} às ${clock((p as { value: [number, number] }).value[0])}`, `nivel ${(p as { value: [number, number] }).value[1]} a ${clock((p as { value: [number, number] }).value[0])}`, `niveau ${(p as { value: [number, number] }).value[1]} à ${clock((p as { value: [number, number] }).value[0])}`)]) },
        })),
        // Deaths and revives as separate marks so they read even where lines overlap.
        ...heroes.flatMap((h) => [
          {
            type: "scatter" as const,
            name: h.name,
            data: h.deaths.map((d) => [d.diedAt, levelAt(h, d.diedAt)]),
            symbol: CROSS,
            symbolSize: 11,
            color: colour(h),
            itemStyle: { borderColor: t.surface, borderWidth: 1 },
            z: 5,
            tooltip: { formatter: (p: unknown) => tip([tr(`${h.name} died (about ${clock((p as { value: [number, number] }).value[0])})`, `${h.name} morreu (por volta de ${clock((p as { value: [number, number] }).value[0])})`, `${h.name} murió (hacia ${clock((p as { value: [number, number] }).value[0])})`, `${h.name} est mort (vers ${clock((p as { value: [number, number] }).value[0])})`)]) },
          },
          {
            type: "scatter" as const,
            name: h.name,
            data: h.deaths.filter((d) => d.revivedAt !== null).map((d) => [d.revivedAt!, levelAt(h, d.revivedAt!)]),
            symbol: "emptyCircle",
            symbolSize: 10,
            color: colour(h),
            itemStyle: { borderWidth: 2 },
            z: 5,
            tooltip: { formatter: (p: unknown) => tip([tr(`${h.name} back at ${clock((p as { value: [number, number] }).value[0])}`, `${h.name} voltou às ${clock((p as { value: [number, number] }).value[0])}`, `${h.name} volvió a ${clock((p as { value: [number, number] }).value[0])}`, `${h.name} est revenu à ${clock((p as { value: [number, number] }).value[0])}`)]) },
          },
        ]),
      ],
    } as echarts.EChartsOption;
  };
}

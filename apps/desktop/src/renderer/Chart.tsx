// ECharts wrapper that themes every chart from the CSS tokens (re-renders on light/dark change).
import { useEffect, useRef, useState } from "react";
import * as echarts from "echarts";

export type Tokens = Record<"surface" | "ink" | "ink2" | "muted" | "grid" | "axis" | "series1" | "series2" | "border", string>;

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
          return `<b>${Math.round((100 * r.wins) / Math.max(1, r.wins + r.losses))}%</b> win rate<br/><span style="color:${t.ink2}">${esc(r.label)} · ${r.wins}W ${r.losses}L</span>`;
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

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Lines over game time; one tooltip lists every series at the hovered time. */
export function timeLines(series: (t: Tokens) => TimeSeries[], format: (v: number) => string = (v) => String(Math.round(v))) {
  return (t: Tokens): echarts.EChartsOption => {
    const b = base(t);
    const list = series(t);
    return {
      ...b,
      grid: { left: 8, right: 16, top: list.length > 1 ? 30 : 12, bottom: 8, containLabel: true },
      legend: list.length > 1 ? { top: 0, left: 0, textStyle: { color: t.ink2 }, icon: "rect", itemWidth: 14, itemHeight: 2, itemGap: 16 } : undefined,
      tooltip: {
        ...(b.tooltip as object),
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: t.axis } },
        formatter: (ps: unknown) => {
          const arr = ps as { value: [number, number]; seriesName: string; color: string }[];
          if (!arr.length) return "";
          const head = `<span style="color:${t.ink2}">${clock(arr[0].value[0])}</span>`;
          return [head, ...arr.map((p) => `<span style="display:inline-block;width:12px;height:2px;background:${p.color};vertical-align:middle;margin-right:6px"></span><b>${format(p.value[1])}</b> <span style="color:${t.ink2}">${esc(p.seriesName)}</span>`)].join("<br/>");
        },
      },
      xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: "dataMax", splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => clock(v) } },
      yAxis: { ...(b.yAxis as object), type: "value", axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => format(v) } },
      series: list.map((s) => ({
        type: "line",
        name: s.name,
        data: s.points,
        step: s.step ? "end" : undefined,
        showSymbol: false,
        color: s.color,
        lineStyle: { width: s.muted ? 1.5 : 2, cap: "round", join: "round", opacity: s.muted ? 0.8 : 1 },
      })),
    } as echarts.EChartsOption;
  };
}

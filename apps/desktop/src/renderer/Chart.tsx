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

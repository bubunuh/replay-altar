// "Evaluation": your chance to win over the game (how often pros in that position went on to win),
// drawn like a chess evaluation graph (blue above 50%, red below), with the moments that swung it
// most and what moved them (packages/rules/src/winchance.ts).
import { useEffect, useMemo, useState } from "react";
import type * as echarts from "echarts";
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { tr } from "@replay-altar/core/i18n";
import { mmss } from "@replay-altar/core/time";
import { fightLabel } from "@replay-altar/rules/series";
import { winCurve, type Driver, type SwingEvent, type WinModel } from "@replay-altar/rules/winchance";
import { api } from "./api.ts";
import { base, Chart, esc, type Tokens } from "./Chart.tsx";
import { Tip } from "./Tip.tsx";

const REPORT_URL = "https://github.com/bubunuh/replay-altar/blob/main/docs/win-chance/report.pdf";

let modelOnce: Promise<WinModel | null> | null = null;
const loadModel = () => (modelOnce ??= api.winModel().catch(() => null));

/** The differences the model can use, in words (FEATURES order). */
const featureName = (f: number) =>
  [
    tr("army value", "valor do exército", "valor del ejército", "valeur de l'armée"),
    tr("army value", "valor do exército", "valor del ejército", "valeur de l'armée"),
    tr("workers", "trabalhadores", "trabajadores", "ouvriers"),
    tr("hero experience", "experiência dos heróis", "experiencia de los héroes", "expérience des héros"),
    tr("expansions", "expansões", "expansiones", "expansions"),
    "tier",
    tr("resources spent", "recursos gastos", "recursos gastados", "ressources dépensées"),
    tr("losses", "perdas", "pérdidas", "pertes"),
    tr("food used", "food usado", "food usado", "food utilisée"),
    tr("highest hero level", "nível do herói mais alto", "nivel del héroe más alto", "niveau du meilleur héros"),
    tr("heroes alive", "heróis vivos", "héroes vivos", "héros en vie"),
    tr("hero deaths", "mortes de heróis", "muertes de héroes", "morts de héros"),
    "upgrades",
    tr("attack and armor upgrades", "upgrades de ataque e armadura", "mejoras de ataque y armadura", "améliorations d'attaque et d'armure"),
    tr("items bought", "itens comprados", "objetos comprados", "objets achetés"),
    tr("creep camps", "campos de creeps", "campamentos de creeps", "camps de creeps"),
  ][f] ?? "?";

function driverText(d: Driver): string {
  // Losses read the other way round: in your favour means they lost more.
  if (d.feature === 7)
    return d.favours === "me"
      ? tr("losses (they lost more)", "perdas (o oponente perdeu mais)", "pérdidas (el rival perdió más)", "pertes (l'adversaire a perdu plus)")
      : tr("losses (you lost more)", "perdas (você perdeu mais)", "pérdidas (perdiste más)", "pertes (vous avez perdu plus)");
  return `${featureName(d.feature)} (${d.favours === "me" ? tr("in your favour", "a seu favor", "a tu favor", "en votre faveur") : tr("in theirs", "a favor do oponente", "a favor del rival", "en sa faveur")})`;
}

function eventText(e: SwingEvent): string {
  const me = e.kind !== "fight" && e.who === "me";
  switch (e.kind) {
    case "fight":
      return tr(
        `${fightLabel(e.category)} at ${mmss(e.at)}: you lost ≈${e.myLoss}, they lost ≈${e.oppLoss}`,
        `${fightLabel(e.category)} aos ${mmss(e.at)}: você perdeu ≈${e.myLoss}, o oponente ≈${e.oppLoss}`,
        `${fightLabel(e.category)} a los ${mmss(e.at)}: perdiste ≈${e.myLoss}, el rival ≈${e.oppLoss}`,
        `${fightLabel(e.category)} à ${mmss(e.at)} : vous avez perdu ≈${e.myLoss}, l'adversaire ≈${e.oppLoss}`,
      );
    case "heroDied":
      return me
        ? tr(`your hero died (≈${mmss(e.at)})`, `seu herói morreu (≈${mmss(e.at)})`, `tu héroe murió (≈${mmss(e.at)})`, `votre héros est mort (≈${mmss(e.at)})`)
        : tr(`their hero died (≈${mmss(e.at)})`, `o herói do oponente morreu (≈${mmss(e.at)})`, `el héroe del rival murió (≈${mmss(e.at)})`, `le héros adverse est mort (≈${mmss(e.at)})`);
    case "expansionLost":
      return me
        ? tr(`your expansion fell at ${mmss(e.at)}`, `sua expansão caiu aos ${mmss(e.at)}`, `tu expansión cayó a los ${mmss(e.at)}`, `votre expansion est tombée à ${mmss(e.at)}`)
        : tr(`their expansion fell at ${mmss(e.at)}`, `a expansão do oponente caiu aos ${mmss(e.at)}`, `la expansión del rival cayó a los ${mmss(e.at)}`, `l'expansion adverse est tombée à ${mmss(e.at)}`);
    case "tier":
      return me
        ? tr(`your tier ${e.tier} finished`, `seu tier ${e.tier} ficou pronto`, `tu tier ${e.tier} terminó`, `votre tier ${e.tier} est terminé`)
        : tr(`their tier ${e.tier} finished`, `o tier ${e.tier} do oponente ficou pronto`, `el tier ${e.tier} del rival terminó`, `le tier ${e.tier} adverse est terminé`);
  }
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

export function WinChance({ record, me, opp }: { record: GameRecord; me: PlayerRecord; opp: PlayerRecord }) {
  const [model, setModel] = useState<WinModel | null>(null);
  useEffect(() => {
    loadModel().then(setModel);
  }, []);
  const curve = useMemo(() => (model ? winCurve(record, model, me, opp) : null), [model, record, me, opp]);
  const option = useMemo(
    () =>
      (t: Tokens): echarts.EChartsOption => {
        const b = base(t);
        const points = curve?.points ?? [];
        // The curve in percent, with a point added wherever it crosses 50%.
        const crossed: [number, number][] = [];
        points.forEach((p, i) => {
          const prev = points[i - 1];
          if (prev && (prev.p - 0.5) * (p.p - 0.5) < 0) crossed.push([prev.t + ((0.5 - prev.p) / (p.p - prev.p)) * (p.t - prev.t), 50]);
          crossed.push([p.t, p.p * 100]);
        });
        return {
          ...b,
          grid: { left: 8, right: 16, top: 16, bottom: 8, containLabel: true },
          tooltip: {
            ...(b.tooltip as object),
            trigger: "axis",
            axisPointer: { type: "line", lineStyle: { color: t.axis } },
            formatter: (ps: unknown) => {
              const p = (ps as { value: [number, number | null] }[]).find((x) => x.value[1] !== null);
              if (!p) return "";
              return `<span style="color:${t.ink2}">${mmss(p.value[0])}</span><br/><b>${Math.round(p.value[1]!)}%</b> <span style="color:${t.ink2}">${esc(tr("chance to win", "chance de vitória", "probabilidad de ganar", "chance de victoire"))}</span>`;
            },
          },
          xAxis: { ...(b.xAxis as object), type: "value", min: 0, max: record.game.durationMs, splitLine: { show: false }, axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => mmss(v) } },
          yAxis: {
            ...(b.yAxis as object),
            type: "value",
            min: 0,
            max: 100,
            interval: 25,
            axisLabel: { color: t.muted, fontSize: 11, formatter: (v: number) => `${v}%` },
          },
          // Like a chess evaluation graph: above the 50% line you are ahead (blue), below it your
          // opponent (red). Two series, each filled from the line, meeting where the curve crosses 50%.
          series: [
            ...([
              [t.series1, (v: number) => v >= 50],
              [t.critical, (v: number) => v <= 50],
            ] as const).map(([color, side]) => ({
              type: "line" as const,
              name: tr("Evaluation", "Avaliação", "Evaluación", "Évaluation"),
              data: crossed.map(([x, v]) => [x, side(v) ? v : null]),
              connectNulls: false,
              showSymbol: false,
              color,
              lineStyle: { width: 2, cap: "round" as const, join: "round" as const },
              areaStyle: { origin: 50, opacity: 0.3 },
            })),
            {
              // The 50% line and the swings listed below, numbered.
              type: "line",
              data: [],
              silent: true,
              markLine: { silent: true, symbol: "none", lineStyle: { color: t.axis, width: 1 }, label: { show: false }, data: [{ yAxis: 50 }] },
              markArea: {
                silent: true,
                itemStyle: { color: t.ink2, opacity: 0.08 },
                label: { color: t.ink2, fontSize: 11, position: "insideTop" },
                data: (curve?.swings ?? []).map((s, i) => [{ xAxis: s.from, name: String(i + 1) }, { xAxis: s.to }]),
              },
            },
          ],
        } as echarts.EChartsOption;
      },
    [curve, record],
  );
  if (!model || !curve) return null;
  const used = [...new Set(model.keep.map(featureName))].join(", ");
  return (
    <div className="card win-chance">
      <h2>
        {tr("Evaluation", "Avaliação", "Evaluación", "Évaluation")}{" "}
        <Tip
          text={tr(
            `Every 30 seconds, your ${used} are compared with your opponent's, and the differences are weighed the way they decided ${model.about.games} pro games (patch ${model.about.patch}). Among weaker players leads are thrown away more often, so read it as how good your position was, not as a forecast. Army value and losses are estimates.`,
            `A cada 30 segundos, seus ${used} são comparados com os do oponente, e as diferenças pesam como pesaram em ${model.about.games} partidas de pros (patch ${model.about.patch}). Abaixo do nível dos pros as vantagens se perdem mais vezes, então leia como o quanto sua posição era boa, não como uma previsão. Valor do exército e perdas são estimativas.`,
            `Cada 30 segundos, tus ${used} se comparan con los del rival, y las diferencias pesan como pesaron en ${model.about.games} partidas de pros (parche ${model.about.patch}). Por debajo del nivel pro las ventajas se pierden más a menudo, así que léelo como lo buena que era tu posición, no como una predicción. El valor del ejército y las pérdidas son estimaciones.`,
            `Toutes les 30 secondes, vos ${used} sont comparés à ceux de l'adversaire, et les écarts pèsent comme ils ont pesé dans ${model.about.games} parties de pros (patch ${model.about.patch}). En dessous du niveau pro, les avantages se perdent plus souvent : lisez-la comme la qualité de votre position, pas comme une prédiction. La valeur de l'armée et les pertes sont des estimations.`,
          )}
        />
      </h2>
      <p className="sub">
        {tr(
          "Your position, moment by moment, as how often a pro in it went on to win: above 50% you were ahead, below it your opponent was. It judges the position, not your odds against this opponent. ",
          "A sua posição, momento a momento, como a frequência com que um pro nela acabou vencendo: acima de 50% você estava na frente, abaixo o oponente. Avalia a posição, não as suas chances contra este oponente. ",
          "Tu posición, momento a momento, como la frecuencia con que un pro en ella acabó ganando: por encima del 50% ibas por delante, por debajo el rival. Juzga la posición, no tus probabilidades contra este rival. ",
          "Votre position, moment par moment, comme la fréquence à laquelle un pro dans cette position a fini par gagner : au-dessus de 50 % vous meniez, en dessous l'adversaire. Elle juge la position, pas vos chances contre cet adversaire. ",
        )}
        <button className="linklike" onClick={() => api.openUrl(REPORT_URL)}>
          {tr("How it works", "Como funciona", "Cómo funciona", "Comment ça marche")}
        </button>
      </p>
      <Chart option={option} height={200} label={tr("Evaluation over the game: your chance to win, blue above 50%, red below", "Avaliação ao longo da partida: sua chance de vitória, azul acima de 50%, vermelho abaixo", "Evaluación a lo largo de la partida: tu probabilidad de ganar, azul por encima del 50%, rojo por debajo", "Évaluation au fil de la partie : votre chance de victoire, bleu au-dessus de 50 %, rouge en dessous")} />
      {curve.swings.length > 0 && (
        <ol className="swings">
          {curve.swings.map((s, i) => (
            <li key={i}>
              <span className="swing-head">
                <b>{i + 1}.</b> {mmss(s.from)}–{mmss(s.to)}{" "}
                <span className={s.pTo > s.pFrom ? "trend better" : "trend worse"}>
                  {pct(s.pFrom)} → {pct(s.pTo)}
                </span>
              </span>
              <span className="muted">
                {" · "}
                {s.drivers.length
                  ? s.drivers.map(driverText).join(", ")
                  : tr("many small changes", "várias pequenas mudanças", "muchos cambios pequeños", "beaucoup de petits changements")}
                {s.events.length > 0 && `. ${tr("Around then", "Nesse período", "En ese momento", "À ce moment-là")}: ${s.events.map(eventText).join("; ")}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

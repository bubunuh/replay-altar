import { useEffect, useRef, useState } from "react";
import type { Progress } from "@replay-altar/core/ui";
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";

/** A progress file older than this means the collector stopped (setting up can take minutes). */
const stale = (p: Progress) => Date.now() - Date.parse(p.at) > (p.setup ? 15 * 60_000 : 30_000);

const minutes = (ms: number) => Math.max(1, Math.round(ms / 60_000));

/**
 * What the collector is busy with, above every page: mostly the first start (reading the game
 * data, importing the replays already on the computer, simulating them). `onDone`: it just
 * finished, so the lists can reload.
 */
export function CollectorProgress({ onDone }: { onDone: () => void }) {
  const [p, setP] = useState<Progress | null>(null);
  const busy = useRef(false);
  useEffect(() => {
    const poll = async () => {
      const next = await api.progress();
      const active = next && !stale(next) && (next.setup || next.import || next.sims) ? next : null;
      if (busy.current && !active) onDone();
      busy.current = active !== null;
      setP(active);
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => clearInterval(t);
  }, [onDone]);
  if (!p) return null;

  const bar = (done: number, total: number) => (
    <div className="progress" style={{ marginTop: 6 }}>
      <div style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
    </div>
  );
  const sims = p.sims;
  const left = sims ? sims.total - sims.done : 0;
  return (
    <div className="card collector-progress">
      {p.setup === "gamedata" && (
        <p style={{ margin: 0 }}>
          {tr("Setting up: reading the data it needs from your Warcraft III installation (a few minutes, only once)…", "Preparando: lendo os dados de que precisa da sua instalação do Warcraft III (alguns minutos, só uma vez)…", "Preparando: leyendo los datos que necesita de tu instalación de Warcraft III (unos minutos, solo una vez)…", "Préparation : lecture des données nécessaires depuis votre installation de Warcraft III (quelques minutes, une seule fois)…")}
        </p>
      )}
      {p.setup === "accounts" && (
        <p style={{ margin: 0 }}>
          {tr("Sorting your games with your battletag…", "Separando as suas partidas pela sua battletag…", "Ordenando tus partidas según tu battletag…", "Tri de vos parties d'après votre battletag…")}
        </p>
      )}
      {p.import && (
        <div>
          {tr(`Importing your replays: ${p.import.done} of ${p.import.total}`, `Importando os seus replays: ${p.import.done} de ${p.import.total}`, `Importando tus replays: ${p.import.done} de ${p.import.total}`, `Importation de vos replays : ${p.import.done} sur ${p.import.total}`)}
          {bar(p.import.done, p.import.total)}
        </div>
      )}
      {sims && (
        <div style={{ marginTop: p.import ? 10 : 0 }}>
          {tr(`Simulating games: ${sims.done} of ${sims.total}`, `Simulando partidas: ${sims.done} de ${sims.total}`, `Simulando partidas: ${sims.done} de ${sims.total}`, `Simulation des parties : ${sims.done} sur ${sims.total}`)}
          {sims.avgMs !== null && <span className="muted small"> · {tr(`about ${minutes(sims.avgMs * left)} min left`, `cerca de ${minutes(sims.avgMs * left)} min restantes`, `quedan unos ${minutes(sims.avgMs * left)} min`, `encore environ ${minutes(sims.avgMs * left)} min`)}</span>}
          {bar(sims.done, sims.total)}
          <p className="sub" style={{ margin: "6px 0 0" }}>
            {tr("Each report fills in when its game is simulated, newest games first. You can keep using the app.", "Cada análise se completa quando a partida é simulada, das mais recentes às mais antigas. Você pode continuar usando o app.", "Cada análisis se completa cuando se simula su partida, de las más recientes a las más antiguas. Puedes seguir usando la app.", "Chaque analyse se complète quand sa partie est simulée, des plus récentes aux plus anciennes. Vous pouvez continuer à utiliser l'application.")}
          </p>
        </div>
      )}
    </div>
  );
}

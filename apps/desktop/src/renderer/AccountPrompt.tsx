// Asks who you are while the settings have no battletag: the collector suggests the battletags in
// most of your replays (apps/collector/src/firstrun.ts), and nothing counts as yours until you
// confirm one here or type yours in Settings.
import { useEffect, useState } from "react";
import type { Config } from "@replay-altar/core/ui";
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";

export function AccountPrompt({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [config, setConfig] = useState<Config | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () => api.getConfig().then((s) => alive && setConfig(s.config));
    check();
    // The suggestion arrives a few seconds after the collector's first start.
    const timer = setInterval(check, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  if (!config || config.accounts.length) return null;
  const confirm = async (name: string) => {
    const fresh = (await api.getConfig()).config;
    await api.setConfig({ ...fresh, accounts: [name], suggestedAccounts: undefined });
    setConfig({ ...fresh, accounts: [name] });
  };
  const found = config.suggestedAccounts ?? [];
  return (
    <div className="card account-prompt">
      <h2>{tr("Which battletag is yours?", "Qual battletag é a sua?", "¿Cuál es tu battletag?", "Quel battletag est le vôtre ?")}</h2>
      {found.length > 0 ? (
        <>
          <p className="sub">
            {found.length === 1
              ? tr(`This battletag is in ${found[0].games} of your ${found[0].of} latest replays. Is it you?`, `Esta battletag está em ${found[0].games} dos seus ${found[0].of} replays mais recentes. É você?`, `Esta battletag está en ${found[0].games} de tus ${found[0].of} replays más recientes. ¿Eres tú?`, `Ce battletag apparaît dans ${found[0].games} de vos ${found[0].of} derniers replays. Est-ce vous ?`)
              : tr("These battletags are in most of your latest replays (a frequent opponent can be too). Which one is you?", "Estas battletags estão na maioria dos seus replays mais recentes (um oponente frequente também pode estar). Qual delas é você?", "Estas battletags están en la mayoría de tus replays más recientes (un rival frecuente también puede estarlo). ¿Cuál eres tú?", "Ces battletags apparaissent dans la plupart de vos derniers replays (un adversaire fréquent aussi, parfois). Lequel est le vôtre ?")}
          </p>
          <div className="filters">
            {found.map((a) => (
              <button key={a.name} className="btn" onClick={() => confirm(a.name)}>
                {found.length === 1 ? tr(`Yes, I'm ${a.name}`, `Sim, sou ${a.name}`, `Sí, soy ${a.name}`, `Oui, je suis ${a.name}`) : `${a.name} (${a.games}/${a.of})`}
              </button>
            ))}
            <button className="btn" onClick={onOpenSettings}>
              {found.length === 1 ? tr("No, I'll type mine", "Não, vou digitar a minha", "No, escribiré la mía", "Non, je saisis le mien") : tr("None of these", "Nenhuma delas", "Ninguna", "Aucun")}
            </button>
          </div>
        </>
      ) : (
        <p className="sub">
          {tr("Replay Altar needs your battletag to know which player is you; until then your games are kept but not analyzed. ", "O Replay Altar precisa da sua battletag para saber qual jogador é você; até lá, as suas partidas ficam guardadas, mas sem análise. ", "Replay Altar necesita tu battletag para saber qué jugador eres; hasta entonces tus partidas se guardan pero no se analizan. ", "Replay Altar a besoin de votre battletag pour savoir quel joueur vous êtes ; d'ici là, vos parties sont gardées mais pas analysées. ")}
          <button className="linklike" onClick={onOpenSettings}>
            {tr("Enter it in Settings", "Digite em Configurações", "Escríbela en Configuración", "Saisissez-le dans les Paramètres")}
          </button>
        </p>
      )}
    </div>
  );
}

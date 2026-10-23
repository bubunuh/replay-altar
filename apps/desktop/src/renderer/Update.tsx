// A new version, said where you'll see it: a banner at the top of every page (the Settings tab's
// "!" alone was easy to miss), and a message while the update installs, when the window closes
// and nothing else is on screen for up to a minute.
import { tr } from "@replay-altar/core/i18n";
import { api, type UpdateState } from "./api.ts";

export function UpdateBanner({ update, onSettings, onInstall, onDismiss }: { update: UpdateState; onSettings: () => void; onInstall: () => void; onDismiss: () => void }) {
  const latest = update.latest;
  if (!latest) return null;
  return (
    <div className="card update-banner">
      <p>
        <span className="tab-alert" style={{ marginLeft: 0, marginRight: 8 }}>!</span>
        <b>{tr(`Replay Altar ${latest.version} is available.`, `O Replay Altar ${latest.version} está disponível.`, `Replay Altar ${latest.version} está disponible.`, `Replay Altar ${latest.version} est disponible.`)}</b>{" "}
        <span className="muted small">{tr("Updating is optional; your games and settings are kept.", "Atualizar é opcional; as suas partidas e configurações são mantidas.", "Actualizar es opcional; tus partidas y tu configuración se conservan.", "La mise à jour est facultative ; vos parties et vos paramètres sont conservés.")}</span>
      </p>
      <div className="filters">
        <button className="btn" onClick={onSettings}>{tr("What's new", "O que há de novo", "Novedades", "Nouveautés")}</button>
        {update.installable && update.download === "idle" && <button className="btn" onClick={() => api.downloadUpdate()}>{tr("Update", "Atualizar", "Actualizar", "Mettre à jour")}</button>}
        {update.installable && update.download === "failed" && <button className="btn" onClick={() => api.downloadUpdate()}>{tr("Try again", "Tentar de novo", "Reintentar", "Réessayer")}</button>}
        {update.download === "ready" && <button className="btn" onClick={onInstall}>{tr("Restart and install", "Reiniciar e instalar", "Reiniciar e instalar", "Redémarrer et installer")}</button>}
        {update.download === "downloading" && <span className="muted small">{tr(`Downloading… ${update.percent}%`, `Baixando… ${update.percent}%`, `Descargando… ${update.percent}%`, `Téléchargement… ${update.percent} %`)}</span>}
        {update.download !== "downloading" && update.download !== "ready" && (
          <button className="linklike" onClick={onDismiss}>{tr("Not now", "Agora não", "Ahora no", "Pas maintenant")}</button>
        )}
      </div>
      {update.download === "failed" && <p className="sub">{tr(`The download failed: ${update.error}.`, `O download falhou: ${update.error}.`, `La descarga falló: ${update.error}.`, `Le téléchargement a échoué : ${update.error}.`)}</p>}
    </div>
  );
}

export function Installing({ version }: { version: string }) {
  return (
    <div className="installing" role="alertdialog" aria-live="assertive">
      <div className="card">
        <h2>{tr(`Installing Replay Altar ${version}…`, `Instalando o Replay Altar ${version}…`, `Instalando Replay Altar ${version}…`, `Installation de Replay Altar ${version}…`)}</h2>
        <p>
          {tr(
            "This window closes in a few seconds. A small installer window shows the progress, then Replay Altar opens again by itself, in about a minute. Your games and settings are kept.",
            "Esta janela fecha em alguns segundos. Uma pequena janela do instalador mostra o progresso e depois o Replay Altar abre de novo sozinho, em cerca de um minuto. As suas partidas e configurações são mantidas.",
            "Esta ventana se cierra en unos segundos. Una pequeña ventana del instalador muestra el progreso y luego Replay Altar se abre de nuevo solo, en más o menos un minuto. Tus partidas y tu configuración se conservan.",
            "Cette fenêtre se ferme dans quelques secondes. Une petite fenêtre d'installation affiche la progression, puis Replay Altar se rouvre tout seul, en une minute environ. Vos parties et vos paramètres sont conservés.",
          )}
        </p>
      </div>
    </div>
  );
}

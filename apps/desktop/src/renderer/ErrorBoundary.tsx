// A page that hits an error shows what happened instead of blanking the whole window (React
// unmounts everything on an uncaught error), and the error goes to logs/window.log.
import { Component, type ReactNode } from "react";
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";
import { openIssue } from "./feedback.ts";

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    api.logError(`page error: ${error.message}\n${error.stack ?? ""}`);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="page">
        <div className="card">
          <h2>{tr("Something went wrong on this page", "Algo deu errado nesta página", "Algo salió mal en esta página", "Un problème est survenu sur cette page")}</h2>
          <p className="sub">
            {tr(
              "The other pages still work. Please report it: the error is saved in window.log, in the same folder as the collector's log.",
              "As outras páginas continuam funcionando. Por favor, relate o problema: o erro fica salvo em window.log, na mesma pasta do log do coletor.",
              "Las otras páginas siguen funcionando. Por favor, infórmalo: el error se guarda en window.log, en la misma carpeta que el registro del recolector.",
              "Les autres pages fonctionnent toujours. Merci de le signaler : l'erreur est enregistrée dans window.log, dans le même dossier que le journal du collecteur.",
            )}
          </p>
          <pre className="notes">{error.message}</pre>
          <div className="filters">
            <button className="btn" onClick={() => openIssue("bug.yml")}>{tr("Report a bug", "Relatar um problema", "Informar de un problema", "Signaler un bug")}</button>
            <button className="btn" onClick={() => this.setState({ error: null })}>{tr("Try again", "Tentar de novo", "Reintentar", "Réessayer")}</button>
          </div>
        </div>
      </div>
    );
  }
}

// "Share": the report as text (Markdown, for Reddit or Discord) or as a picture of the result
// and the findings, copied or saved. The opponent's battletag is hidden unless you show it.
import { useState, type RefObject } from "react";
import { getFontEmbedCSS, toPng } from "html-to-image";
import type { GameRecord, PlayerRecord } from "@replay-altar/core/ui";
import { tr } from "@replay-altar/core/i18n";
import { api } from "./api.ts";
import { shareText } from "./shareText.ts";

type Props = {
  record: GameRecord;
  me: PlayerRecord;
  opp: PlayerRecord;
  result: string;
  /** What goes in the picture: the result card and the findings. */
  target: RefObject<HTMLDivElement | null>;
  hideNames: boolean;
  setHideNames: (v: boolean) => void;
};

/**
 * The page's fonts, plus the game's: that one is added at run time (FontFace), where the
 * picture can't find it by itself.
 */
async function fontCss(node: HTMLElement) {
  const url = await api.uiFont();
  return (await getFontEmbedCSS(node)) + (url ? `@font-face { font-family: "Warcraft"; src: url(${url}); }` : "");
}


/** The box under the Share button: what to share and how. */
export function Share({ record, me, opp, result, target, hideNames, setHideNames }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const done = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
  };

  const picture = async () => {
    const node = target.current;
    if (!node) return null;
    const background = getComputedStyle(document.body).backgroundColor;
    // Controls (buttons, the result selector, this box) and the map stay out of the picture:
    // hidden on the page for the moment it takes, so the picture is laid out without them.
    node.classList.add("capturing");
    try {
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return await toPng(node, { backgroundColor: background, pixelRatio: 2, fontEmbedCSS: await fontCss(node), style: { padding: "16px" }, width: node.offsetWidth + 32, height: node.offsetHeight + 32 });
    } finally {
      node.classList.remove("capturing");
    }
  };

  const copyText = async () => {
    const book = await api.rules(record.gameKey).catch(() => null);
    await api.copyText(shareText(record, me, opp, result, book));
    done(tr("Text copied", "Texto copiado"));
  };
  const copyImage = async () => {
    setStatus(tr("Making the picture…", "Gerando a imagem…"));
    const png = await picture();
    if (png) await api.copyImage(png);
    done(tr("Picture copied", "Imagem copiada"));
  };
  const saveImage = async () => {
    setStatus(tr("Making the picture…", "Gerando a imagem…"));
    const png = await picture();
    const saved = png ? await api.saveImage(png, `replay-altar-${record.game.playedAt.slice(0, 10)}-${me.race}v${opp.race}.png`) : false;
    if (saved) done(tr("Picture saved", "Imagem salva"));
    else setStatus(null);
  };

  return (
    <div className="share-box">
      <label>
        <input type="checkbox" checked={hideNames} onChange={(e) => setHideNames(e.target.checked)} />
        {tr("Hide the opponent's battletag", "Esconder a battletag do oponente")}
      </label>
      <div className="filters">
        <button className="btn" onClick={copyText}>{tr("Copy as text", "Copiar como texto")}</button>
        <button className="btn" onClick={copyImage}>{tr("Copy picture", "Copiar imagem")}</button>
        <button className="btn" onClick={saveImage}>{tr("Save picture…", "Salvar imagem…")}</button>
        {status && <span className="muted small">{status}</span>}
      </div>
      <p className="sub" style={{ margin: 0 }}>{tr("The text names no one; the picture shows the result card and the findings.", "O texto não cita ninguém; a imagem mostra o cartão do resultado e os problemas.")}</p>
    </div>
  );
}

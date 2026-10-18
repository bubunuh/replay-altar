import { useEffect, useState } from "react";
// A small "i" that explains on hover, so the page keeps to what is essential and the details are
// one hover away. Any element with a data-tip attribute shows the same tooltip (styles.css).
export function Tip({ text }: { text: string }) {
  return (
    <span className="tip" data-tip={text} tabIndex={0} aria-label={text}>
      i
    </span>
  );
}

/**
 * One tooltip for the whole app: shows the data-tip of whatever the pointer (or keyboard focus)
 * is on, kept inside the window.
 */
export function TipLayer() {
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  useEffect(() => {
    const show = (e: Event) => {
      const el = (e.target as Element | null)?.closest?.("[data-tip]") as HTMLElement | null;
      const text = el?.dataset.tip;
      if (!el || !text) return setTip(null);
      const r = el.getBoundingClientRect();
      const below = r.top < 140;
      setTip({ text, x: Math.min(Math.max(8, r.left), window.innerWidth - 348), y: below ? r.bottom + 6 : r.top - 6, below });
    };
    const hide = () => setTip(null);
    document.addEventListener("mouseover", show);
    document.addEventListener("focusin", show);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("mouseover", show);
      document.removeEventListener("focusin", show);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  if (!tip) return null;
  return (
    <div className={tip.below ? "tooltip below" : "tooltip"} style={{ left: tip.x, top: tip.y }} role="tooltip">
      {tip.text}
    </div>
  );
}

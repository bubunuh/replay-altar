// Text size from Settings: a scale on every font size in styles.css (charts keep theirs).
// Remembered in this app's own browser storage, a per-viewer convenience.
const KEY = "text-scale";
export const TEXT_SCALES = [0.9, 1, 1.1, 1.2, 1.35, 1.5];

export function textScale(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return TEXT_SCALES.includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function applyTextScale(scale = textScale()) {
  document.documentElement.style.setProperty("--text-scale", String(scale));
}

export function setTextScale(scale: number) {
  try {
    localStorage.setItem(KEY, String(scale));
  } catch {
    // storage unavailable: the size lasts until the app closes
  }
  applyTextScale(scale);
}

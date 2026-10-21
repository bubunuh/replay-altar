// The app's language: English, Brazilian Portuguese, Spanish or French. Texts are written in
// place, tr("English", "Português", "Español", "Français"), so a sentence and its translations
// stay together; tables of names (metrics, problems) carry the other languages alongside. Each
// process sets the language once from the settings (the window reloads when it changes). Game
// terms players use as they are (food, upkeep, creep, tier, APM, unit and item names) stay in
// English in every language. Browser-safe: no Node imports.

export type Language = "en" | "pt" | "es" | "fr";
export const LANGUAGES: [Language, string][] = [
  ["en", "English"],
  ["pt", "Português (Brasil)"],
  ["es", "Español"],
  ["fr", "Français"],
];
const CODES = LANGUAGES.map(([l]) => l);
const isLanguage = (v: unknown): v is Language => CODES.includes(v as Language);

// The window's preload hands over the language before any module runs, so tables built at load
// time are already in it there (the window reloads when the setting changes).
const given = (globalThis as { w3?: { language?: string } }).w3?.language;
let current: Language = isLanguage(given) ? given : "en";

export const setLanguage = (l: Language) => {
  current = l;
};
export const language = () => current;

/** The setting, or the system's language when there is none (any pt-*, es-* or fr-* locale). */
export function resolveLanguage(setting: Language | undefined, systemLocale = Intl.DateTimeFormat().resolvedOptions().locale): Language {
  if (setting && isLanguage(setting)) return setting;
  const code = systemLocale.slice(0, 2).toLowerCase();
  return isLanguage(code) ? code : "en";
}

/** The text in the current language. */
export const tr = (en: string, pt: string, es: string, fr: string) => ({ en, pt, es, fr })[current];

/** For dates and numbers. */
export const locale = () => ({ en: "en-US", pt: "pt-BR", es: "es", fr: "fr-FR" })[current];

/** A number with one decimal in the current language's style (2.5 / 2,5). */
export const decimal = (v: number, digits = 1) => {
  const s = v.toFixed(digits);
  return current === "en" ? s : s.replace(".", ",");
};

/**
 * A table of names whose values follow the language when read (for tables built at load time
 * in processes that switch language while running).
 */
export function trTable<K extends string>(names: Record<K, [en: string, pt: string, es: string, fr: string]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(names) as K[]) Object.defineProperty(out, k, { get: () => tr(names[k][0], names[k][1], names[k][2], names[k][3]), enumerable: true });
  return out;
}

/** Runs `fn` in another language (e.g. the fact sheet, kept in English), then switches back. */
export function inLanguage<T>(l: Language, fn: () => T): T {
  const before = current;
  current = l;
  try {
    return fn();
  } finally {
    current = before;
  }
}

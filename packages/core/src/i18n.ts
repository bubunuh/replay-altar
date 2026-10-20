// The app's language: English, or Brazilian Portuguese. Texts are written in place as pairs,
// tr("English", "Português"), so a sentence and its translation stay together; tables of names
// (metrics, problems) carry a Portuguese column. Each process sets the language once from the
// settings (the window reloads when it changes). Browser-safe: no Node imports.

export type Language = "en" | "pt";
export const LANGUAGES: [Language, string][] = [
  ["en", "English"],
  ["pt", "Português (Brasil)"],
];

// The window's preload hands over the language before any module runs, so tables built at load
// time are already in it there (the window reloads when the setting changes).
let current: Language = (globalThis as { w3?: { language?: string } }).w3?.language === "pt" ? "pt" : "en";

export const setLanguage = (l: Language) => {
  current = l;
};
export const language = () => current;

/** The setting, or the system's language when there is none (Portuguese for any pt-* locale). */
export function resolveLanguage(setting: Language | undefined, systemLocale = Intl.DateTimeFormat().resolvedOptions().locale): Language {
  return setting ?? (/^pt\b/i.test(systemLocale) ? "pt" : "en");
}

/** The text in the current language. */
export const tr = (en: string, pt: string) => (current === "pt" ? pt : en);

/** For dates and numbers. */
export const locale = () => (current === "pt" ? "pt-BR" : "en-US");

/** A number with one decimal in the current language's style (2.5 / 2,5). */
export const decimal = (v: number, digits = 1) => {
  const s = v.toFixed(digits);
  return current === "pt" ? s.replace(".", ",") : s;
};

/** "1 camp" / "3 camps": English and Portuguese both add -s for these words. */
export const plural = (n: number, en: string, pt: string, enMany = `${en}s`, ptMany = `${pt}s`) => tr(n === 1 ? en : enMany, n === 1 ? pt : ptMany);

/**
 * A table of names whose values follow the language when read (for tables built at load time
 * in processes that switch language while running).
 */
export function trTable<K extends string>(pairs: Record<K, [en: string, pt: string]>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(pairs) as K[]) Object.defineProperty(out, k, { get: () => tr(pairs[k][0], pairs[k][1]), enumerable: true });
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

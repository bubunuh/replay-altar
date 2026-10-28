// The match list in pages (pages/Matches.tsx): thousands of table rows made every refresh slow.

/** Games per page. */
export const PAGE_SIZE = 100;

/** The games on page `page` (from 0; past the last page: the last one), and how many pages there are. */
export function pageOf<T>(rows: T[], page: number, size = PAGE_SIZE): { page: number; pages: number; from: number; rows: T[] } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { page: at, pages, from: at * size, rows: rows.slice(at * size, at * size + size) };
}

/** The list's filters and page. */
export type ListState = { source: string; result: string; oppRace: string; q: string; problem: string; page: number };

export const NO_FILTER: ListState = { source: "all", result: "all", oppRace: "all", q: "", problem: "all", page: 0 };

/**
 * A change: a filter starts again from the first page; a page change only moves the page. A
 * refresh (games imported meanwhile) isn't a change: the list stays on its page.
 */
export function changeList(state: ListState, change: Partial<ListState>): ListState {
  const filters = Object.keys(change).some((k) => k !== "page" && change[k as keyof ListState] !== state[k as keyof ListState]);
  return { ...state, ...change, page: filters ? 0 : (change.page ?? state.page) };
}

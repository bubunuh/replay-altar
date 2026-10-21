// Reading GitHub's list of releases: which one, if any, is newer than the running version.

export type Release = { version: string; url: string; publishedAt: string; notes: string };
export type GithubRelease = { tag_name: string; html_url: string; draft: boolean; published_at: string; body: string | null };

/** "v0.1.10" → [0, 1, 10]; null for tags that aren't versions. */
export function parseVersion(tag: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(tag.trim());
  return m ? m.slice(1).map(Number) : null;
}

export function isNewer(tag: string, than: string): boolean {
  const a = parseVersion(tag);
  const b = parseVersion(than);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** The newest published (not draft) release above `current`. */
export function newestRelease(releases: GithubRelease[], current: string): Release | null {
  const newer = releases.filter((r) => !r.draft && isNewer(r.tag_name, current));
  newer.sort((x, y) => (isNewer(x.tag_name, y.tag_name) ? -1 : isNewer(y.tag_name, x.tag_name) ? 1 : 0));
  const r = newer[0];
  return r ? { version: r.tag_name.replace(/^v/, ""), url: r.html_url, publishedAt: r.published_at, notes: r.body ?? "" } : null;
}

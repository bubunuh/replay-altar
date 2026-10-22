// Problems and ideas go to the project's GitHub issues (the forms in .github/ISSUE_TEMPLATE), with
// Replay Altar's version and the system filled in. Used by Settings → Help and feedback, the
// "Report a bug" button at the top, and "Feedback" under a game's findings.
import { api, type AppInfo } from "./api.ts";

const ISSUES = "https://github.com/bubunuh/replay-altar/issues/new";
/** Addresses longer than this risk being cut by the browser or GitHub. */
const MAX_URL = 7500;

let info: Promise<AppInfo> | null = null;

/** Opens a GitHub issue form; `fields` fills more of it (title, or a field's id). */
export async function openIssue(template: "bug.yml" | "idea.yml", fields: Record<string, string> = {}) {
  info ??= api.appInfo();
  const { version, system } = await info;
  const q = new URLSearchParams({ template, version, system, ...fields });
  let url = `${ISSUES}?${q}`;
  // A long report is shortened rather than lost.
  for (const key of ["report", "what", "idea"]) {
    while (url.length > MAX_URL && (q.get(key)?.length ?? 0) > 200) {
      q.set(key, `${q.get(key)!.slice(0, Math.floor(q.get(key)!.length * 0.8))}\n…`);
      url = `${ISSUES}?${q}`;
    }
  }
  api.openUrl(url);
}

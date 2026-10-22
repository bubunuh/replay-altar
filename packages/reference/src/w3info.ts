// warcraft3.info: a community archive of tournament replays (tens of thousands, newest first),
// with players linked to curated profiles. Same API its own pages use; no account needed.
import { RateLimited, type Fetch } from "./w3c.ts";

export const W3INFO_API = "https://warcraft3.info/api/v1/";
const USER_AGENT = "replay-altar (personal replay analysis)";
const RACE: Record<string, "H" | "O" | "U" | "N"> = { Human: "H", Orc: "O", Undead: "U", Nightelf: "N", "Night Elf": "N" };

export type W3iPlayer = {
  player: string; // battletag, lower case
  race: string;
  team: number;
  /** The site's curated player profile; null for players it doesn't know. */
  stats_player: { id: number; name: string; main_race: string | null } | null;
};
export type W3iReplay = {
  id: number; type: string; duration: number; map: string; created_at: string; players: W3iPlayer[];
  /** The winning team when the site knows it (set by hand, or detected); often null. */
  winner?: number | null; detected_winner?: number | null;
};

export type W3iMapFile = { id: number; original_name: string; checksum_sha1: string };

export type W3iClient = {
  listReplays(page: number): Promise<{ replays: W3iReplay[]; lastPage: number }>;
  download(id: number): Promise<Buffer | null>;
  /** Every map file the site has, with its SHA-1 (the replay header names the map by SHA-1). */
  mapFiles(): Promise<W3iMapFile[]>;
  downloadMap(fileId: number): Promise<Buffer | null>;
};

export const w3iRace = (race: string) => RACE[race] ?? null;

export function w3infoClient(opts: { fetch?: Fetch; sleep?: (ms: number) => Promise<void> } = {}): W3iClient {
  const doFetch = opts.fetch ?? (fetch as unknown as Fetch);
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const call = async (path: string, init: { method?: string; body?: string } = {}) => {
    for (let attempt = 1; ; attempt++) {
      const res = await doFetch(W3INFO_API + path, {
        ...init,
        headers: { "User-Agent": USER_AGENT, Accept: "application/json", "Content-Type": "application/json" },
      });
      if (res.status === 429) throw new RateLimited("warcraft3.info asked us to slow down (429); stopping");
      if (res.status >= 500) {
        if (attempt >= 2) throw new RateLimited(`warcraft3.info answered ${res.status}; stopping`);
        await sleep(30_000);
        continue;
      }
      return res;
    }
  };
  return {
    async listReplays(page) {
      // The list is a POST with the filters in the body (as the site's own page does it).
      const res = await call("replays/", { method: "POST", body: JSON.stringify({ page }) });
      if (res.status !== 200) throw new Error(`warcraft3.info replay list: HTTP ${res.status}`);
      const d = (await res.json()) as { data: W3iReplay[]; last_page: number };
      return { replays: d.data ?? [], lastPage: d.last_page ?? page };
    },
    async download(id) {
      const res = await call(`replays/${id}/download`);
      if (res.status !== 200) return null;
      return Buffer.from(await res.arrayBuffer());
    },
    async mapFiles() {
      const res = await call("maps/?files=1");
      if (res.status !== 200) throw new Error(`warcraft3.info map list: HTTP ${res.status}`);
      const maps = (await res.json()) as { map_files?: W3iMapFile[] }[];
      return maps.flatMap((m) => m.map_files ?? []);
    },
    async downloadMap(fileId) {
      const res = await call(`map_files/${fileId}/download`);
      if (res.status !== 200) return null;
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

/**
 * The players worth comparing with in a replay: 1v1, played as the group's race, with a curated
 * profile on the site (tournament players). A mirror can have two.
 */
export function w3iSubjects(r: W3iReplay, race: "H" | "O" | "U" | "N"): { subject: W3iPlayer; opponent: W3iPlayer }[] {
  if (r.type !== "1on1" || r.players.length !== 2 || r.players[0].team === r.players[1].team) return [];
  return r.players
    .map((subject, i) => ({ subject, opponent: r.players[1 - i] }))
    .filter(({ subject }) => subject.stats_player !== null && w3iRace(subject.race) === race);
}

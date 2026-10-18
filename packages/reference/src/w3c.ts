// The W3Champions website's public API: match lists and replay downloads.
// Polite by design: callers wait between requests, and 429/5xx answers back off.

export const W3C_API = "https://website-backend.w3champions.com/api/";
const USER_AGENT = "w3stats/0.1 (personal replay analysis; slow, a few requests per minute)";

/** W3Champions race codes. */
export const W3C_RACE: Record<number, "H" | "O" | "N" | "U" | "R"> = { 0: "R", 1: "H", 2: "O", 4: "N", 8: "U" };

export type W3cPlayer = { battleTag: string; race: number; oldMmr: number; won: boolean };
export type W3cMatch = {
  id: string;
  map: string;
  mapName?: string;
  startTime: string;
  durationInSeconds: number;
  gateWay: number;
  season: number;
  gameMode: number;
  teams: { players: W3cPlayer[] }[];
};

export type Fetch = (url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }) => Promise<{ status: number; headers: { get(name: string): string | null }; json(): Promise<unknown>; arrayBuffer(): Promise<ArrayBuffer> }>;

export type W3cScore = {
  battleTag: string;
  unitScore: { unitsProduced: number; unitsKilled: number; largestArmy: number };
  heroScore: { heroesKilled: number; itemsObtained: number; mercsHired: number; expGained: number };
  resourceScore: { goldCollected: number; lumberCollected: number; goldUpkeepLost: number };
};

export type W3cClient = {
  currentSeason(): Promise<number>;
  /** The game's end-of-game stats for a match (null if unknown). */
  matchDetail(matchId: string): Promise<{ match: W3cMatch; playerScores: W3cScore[] } | null>;
  /** A player's 1v1 matches against one opponent in a season. */
  searchPlayerMatches(q: { playerTag: string; opponentTag: string; gateway: number; season: number }): Promise<W3cMatch[]>;
  listMatches(q: { gateway: number; season: number; minMmr: number; offset: number; pageSize: number }): Promise<{ count: number; matches: W3cMatch[] }>;
  downloadReplay(matchId: string): Promise<Buffer | null>;
};

export class RateLimited extends Error {}

export function w3cClient(opts: { fetch?: Fetch; sleep?: (ms: number) => Promise<void>; log?: (m: string) => void } = {}): W3cClient {
  const doFetch = opts.fetch ?? (fetch as unknown as Fetch);
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const log = opts.log ?? (() => {});

  /**
   * GET that respects the server: a 429 ("slow down") stops the whole run at once (the caller
   * keeps what it has and tries again hours later); 5xx errors get two retries 30 s apart.
   */
  async function get(url: string) {
    for (let attempt = 0; ; attempt++) {
      const res = await doFetch(url, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) throw new RateLimited(`W3Champions asked us to slow down (429); stopping until the next refresh`);
      if (res.status >= 500) {
        if (attempt >= 2) throw new RateLimited(`W3Champions answered ${res.status}; stopping until the next refresh`);
        log(`W3Champions answered ${res.status}; retrying in 30 s`);
        await sleep(30_000);
        continue;
      }
      return res;
    }
  }

  return {
    async currentSeason() {
      const res = await get(`${W3C_API}ladder/seasons`);
      const seasons = (await res.json()) as { id: number }[];
      return Math.max(...seasons.map((s) => s.id));
    },
    async listMatches(q) {
      const url = `${W3C_API}matches?offset=${q.offset}&gateway=${q.gateway}&pageSize=${q.pageSize}&gameMode=1&mapName=Overall&minMmr=${q.minMmr}&season=${q.season}`;
      const res = await get(url);
      if (res.status !== 200) throw new Error(`match list failed: HTTP ${res.status}`);
      return (await res.json()) as { count: number; matches: W3cMatch[] };
    },
    async matchDetail(matchId) {
      const res = await get(`${W3C_API}matches/${encodeURIComponent(matchId)}`);
      if (res.status === 404) return null;
      if (res.status !== 200) throw new Error(`match ${matchId} failed: HTTP ${res.status}`);
      return (await res.json()) as { match: W3cMatch; playerScores: W3cScore[] };
    },
    async searchPlayerMatches(q) {
      const url = `${W3C_API}matches/search?playerId=${encodeURIComponent(q.playerTag)}&gateway=${q.gateway}&offset=0&opponentId=${encodeURIComponent(q.opponentTag)}&pageSize=50&gameMode=1&season=${q.season}`;
      const res = await get(url);
      if (res.status !== 200) return [];
      return ((await res.json()) as { matches: W3cMatch[] }).matches ?? [];
    },
    async downloadReplay(matchId) {
      const res = await get(`${W3C_API}replays/${encodeURIComponent(matchId)}`);
      if (res.status === 404) return null; // replay not kept (old or failed upload)
      if (res.status !== 200) throw new Error(`replay ${matchId} failed: HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}


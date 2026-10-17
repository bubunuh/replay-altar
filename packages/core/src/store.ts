// Reading the per-game files. Kept free of the parser so the desktop app can use it.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import type { paths } from "./config.ts";
import type { RawReplay } from "./parse.ts";
import type { GameRecord } from "./record.ts";

export type Paths = ReturnType<typeof paths>;

export const rawPath = (paths: Paths, key: string) => join(paths.raw, `${key}.w3gjs.json.gz`);
export const recordPath = (paths: Paths, key: string) => join(paths.games, `${key}.json`);

export function readRecord(paths: Paths, key: string): GameRecord | null {
  const f = recordPath(paths, key);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as GameRecord) : null;
}

export function readRaw(paths: Paths, key: string): RawReplay {
  return JSON.parse(gunzipSync(readFileSync(rawPath(paths, key))).toString("utf8"));
}

/** One line in events.jsonl (the desktop app watches it to refresh). */
export function logEvent(paths: Paths, event: Record<string, unknown>) {
  mkdirSync(paths.root, { recursive: true });
  appendFileSync(paths.events, JSON.stringify({ at: new Date().toISOString(), ...event }) + "\n");
}

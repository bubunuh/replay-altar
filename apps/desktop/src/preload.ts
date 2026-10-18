// The only bridge between the page and the main process.
import { contextBridge, ipcRenderer } from "electron";

const api = {
  listGames: () => ipcRenderer.invoke("games:list"),
  getGame: (key: string) => ipcRenderer.invoke("games:get", key),
  performance: () => ipcRenderer.invoke("perf:data"),
  overrideResult: (key: string, result: "win" | "loss" | null) => ipcRenderer.invoke("games:override", key, result),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (config: unknown) => ipcRenderer.invoke("config:set", config),
  collectorStatus: () => ipcRenderer.invoke("collector:status"),
  referenceProfiles: () => ipcRenderer.invoke("ref:profiles"),
  showFile: (file: string) => ipcRenderer.invoke("shell:showFile", file),
  openPath: (dir: string) => ipcRenderer.invoke("shell:openPath", dir),
  refUpdate: () => ipcRenderer.invoke("ref:update"),
  refUpdateStatus: () => ipcRenderer.invoke("ref:updateStatus"),
  /** Lines from a running pro-games update, then its exit code; returns a function that stops listening. */
  onRefUpdate: (fn: (event: "progress" | "done", value: string | number | null) => void) => {
    const progress = (_e: unknown, line: string) => fn("progress", line);
    const done = (_e: unknown, code: number | null) => fn("done", code);
    ipcRenderer.on("ref:progress", progress);
    ipcRenderer.on("ref:done", done);
    return () => {
      ipcRenderer.removeListener("ref:progress", progress);
      ipcRenderer.removeListener("ref:done", done);
    };
  },
  aiGet: (key: string) => ipcRenderer.invoke("ai:get", key),
  rules: (key: string) => ipcRenderer.invoke("rules:get", key),
  mapImage: (mapFile: string) => ipcRenderer.invoke("map:image", mapFile),
  mapMarkers: (mapFile: string) => ipcRenderer.invoke("map:markers", mapFile),
  raceIcons: () => ipcRenderer.invoke("race:icons"),
  uiFont: () => ipcRenderer.invoke("ui:font"),
  aiStatus: () => ipcRenderer.invoke("ai:status"),
  aiRun: (key: string) => ipcRenderer.invoke("ai:run", key),
  /** Progress of AI analyses; returns a function that stops listening. */
  onAi: (fn: (event: "progress" | "done", key: string, stage?: string) => void) => {
    const progress = (_e: unknown, key: string, stage: string) => fn("progress", key, stage);
    const done = (_e: unknown, key: string) => fn("done", key);
    ipcRenderer.on("ai:progress", progress);
    ipcRenderer.on("ai:done", done);
    return () => {
      ipcRenderer.removeListener("ai:progress", progress);
      ipcRenderer.removeListener("ai:done", done);
    };
  },
  onDataChanged: (fn: () => void) => ipcRenderer.on("data:changed", () => fn()),
  onNavGame: (fn: (key: string) => void) => ipcRenderer.on("nav:game", (_e, key: string) => fn(key)),
  onNavPage: (fn: (page: string) => void) => ipcRenderer.on("nav:page", (_e, page: string) => fn(page)),
};

contextBridge.exposeInMainWorld("w3", api);

export type Api = typeof api;

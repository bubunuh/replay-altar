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
  onDataChanged: (fn: () => void) => ipcRenderer.on("data:changed", () => fn()),
  onNavGame: (fn: (key: string) => void) => ipcRenderer.on("nav:game", (_e, key: string) => fn(key)),
  onNavPage: (fn: (page: string) => void) => ipcRenderer.on("nav:page", (_e, page: string) => fn(page)),
};

contextBridge.exposeInMainWorld("w3", api);

export type Api = typeof api;

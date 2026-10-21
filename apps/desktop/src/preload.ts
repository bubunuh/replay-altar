// The only bridge between the page and the main process.
import { contextBridge, ipcRenderer } from "electron";

const api = {
  /** The window's language, known before any of the page's modules run (core/i18n reads it). */
  language: ipcRenderer.sendSync("lang:get") as string,
  listGames: () => ipcRenderer.invoke("games:list"),
  getGame: (key: string) => ipcRenderer.invoke("games:get", key),
  performance: () => ipcRenderer.invoke("perf:data"),
  overrideResult: (key: string, result: "win" | "loss" | null) => ipcRenderer.invoke("games:override", key, result),
  getConfig: () => ipcRenderer.invoke("config:get"),
  setConfig: (config: unknown) => ipcRenderer.invoke("config:set", config),
  collectorStatus: () => ipcRenderer.invoke("collector:status"),
  folders: () => ipcRenderer.invoke("folders:get"),
  addFolder: () => ipcRenderer.invoke("folders:add"),
  removeFolder: (folder: string) => ipcRenderer.invoke("folders:remove", folder),
  referenceProfiles: () => ipcRenderer.invoke("ref:profiles"),
  showFile: (file: string) => ipcRenderer.invoke("shell:showFile", file),
  openPath: (dir: string) => ipcRenderer.invoke("shell:openPath", dir),
  openUrl: (url: string) => ipcRenderer.invoke("shell:openUrl", url),
  updateState: () => ipcRenderer.invoke("update:get"),
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  appInfo: () => ipcRenderer.invoke("app:info"),
  pendingNav: () => ipcRenderer.invoke("nav:pending"),
  onUpdateState: (fn: (s: unknown) => void) => ipcRenderer.on("update:state", (_e, s) => fn(s)),
  rules: (key: string) => ipcRenderer.invoke("rules:get", key),
  mapImage: (mapFile: string) => ipcRenderer.invoke("map:image", mapFile),
  mapMarkers: (mapFile: string) => ipcRenderer.invoke("map:markers", mapFile),
  raceIcons: () => ipcRenderer.invoke("race:icons"),
  uiFont: () => ipcRenderer.invoke("ui:font"),
  heroIcons: () => ipcRenderer.invoke("hero:icons"),
  findingsSummary: () => ipcRenderer.invoke("findings:summary"),
  mapActivity: (key: string) => ipcRenderer.invoke("map:activity", key),
  onDataChanged: (fn: () => void) => ipcRenderer.on("data:changed", () => fn()),
  onNavGame: (fn: (key: string) => void) => ipcRenderer.on("nav:game", (_e, key: string) => fn(key)),
  onNavPage: (fn: (page: string) => void) => ipcRenderer.on("nav:page", (_e, page: string) => fn(page)),
};

contextBridge.exposeInMainWorld("w3", api);

export type Api = typeof api;

/**
 * Preload for the LocalMind chrome window ONLY (never for web tabs).
 * Exposes the narrow lmBrowser API the /browse surface uses to drive real
 * Chromium tabs. contextIsolation keeps page JS away from Electron innards;
 * everything crosses via invoke/send with plain-data payloads.
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lmBrowser", {
  newTab: (url) => ipcRenderer.invoke("browser:new-tab", url),
  closeTab: (id) => ipcRenderer.invoke("browser:close-tab", id),
  selectTab: (id) => ipcRenderer.invoke("browser:select-tab", id),
  navigate: (id, url) => ipcRenderer.invoke("browser:navigate", id, url),
  back: (id) => ipcRenderer.invoke("browser:back", id),
  forward: (id) => ipcRenderer.invoke("browser:forward", id),
  reload: (id) => ipcRenderer.invoke("browser:reload", id),
  setBounds: (b) => ipcRenderer.invoke("browser:set-bounds", b),
  setVisible: (v) => ipcRenderer.invoke("browser:set-visible", v),
  getState: () => ipcRenderer.invoke("browser:get-state"),
  getTargetId: (id) => ipcRenderer.invoke("browser:get-target-id", id),
  onState: (cb) => {
    const handler = (_e, state) => cb(state);
    ipcRenderer.on("browser:state", handler);
    return () => ipcRenderer.removeListener("browser:state", handler);
  },
});

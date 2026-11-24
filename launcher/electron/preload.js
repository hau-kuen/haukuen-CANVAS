"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("agent", {
    getState: () => ipcRenderer.invoke("state:get"),
    getLogs: () => ipcRenderer.invoke("logs:get"),
    start: () => ipcRenderer.invoke("service:start"),
    stop: () => ipcRenderer.invoke("service:stop"),
    restart: () => ipcRenderer.invoke("service:restart"),
    copyToken: () => ipcRenderer.invoke("token:copy"),
    copyEndpoint: () => ipcRenderer.invoke("endpoint:copy"),
    copyLink: () => ipcRenderer.invoke("link:copy"),
    openCanvas: () => ipcRenderer.invoke("canvas:open"),
    setCanvasUrl: (url) => ipcRenderer.invoke("canvas:set-url", url),
    setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
    revealConfig: () => ipcRenderer.invoke("config:reveal"),
    clearLogs: () => ipcRenderer.invoke("logs:clear"),
    onState: (cb) => ipcRenderer.on("state", (_e, data) => cb(data)),
    onLog: (cb) => ipcRenderer.on("log", (_e, data) => cb(data)),
    platform: process.platform,
});

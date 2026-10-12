'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set(['auth:expired', 'upload:progress']);

const invoke = (channel) => (...args) =>
  ipcRenderer.invoke(channel, ...args).catch((err) => {
    throw new Error(
      String(err && err.message ? err.message : err)
        .replace(/^Error invoking remote method '[^']+': /, '')
        .replace(/^Error: /, '')
    );
  });

contextBridge.exposeInMainWorld('parentBridge', {
  config: { get: invoke('config:get') },
  auth: {
    status: invoke('auth:status'),
    login: invoke('auth:login'),
    register: invoke('auth:register'),
    logout: invoke('auth:logout'),
  },
  request: invoke('api:request'),
  files: {
    pick: invoke('files:pick'),
    upload: invoke('files:upload'),
  },
  openExternal: invoke('shell:open'),
  on(event, callback) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event: ${event}`);
    const listener = (_e, payload) => callback(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});

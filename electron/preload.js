'use strict';

<<<<<<< HEAD
// Secure IPC bridge. The renderer gets only these named functions -- no ipcRenderer, no Node.
const { contextBridge, ipcRenderer } = require('electron');

const EVENTS = new Set([
  'session:state',
  'net:status',
  'sync:status',
  'content:changed',
  'site:blocked',
  'site:error',
  'site:state',
]);

const invoke = (channel) => (...args) =>
  ipcRenderer.invoke(channel, ...args).catch((err) => {
    const message = String(err && err.message ? err.message : err)
      .replace(/^Error invoking remote method '[^']+': /, '')
      .replace(/^Error: /, '');
    throw new Error(message);
  });

contextBridge.exposeInMainWorld('elib', {
  session: {
    getState: invoke('session:getState'),
  },
  children: {
    list: invoke('children:list'),
    select: invoke('children:select'),
  },
  content: {
    list: invoke('content:list'),
    search: invoke('content:search'),
    open: invoke('content:open'),
    getMediaUrl: invoke('content:getMediaUrl'),
    readPdf: invoke('content:readPdf'),
  },
  requests: {
    create: invoke('requests:create'),
  },
  site: {
    open: invoke('site:open'),
    close: invoke('site:close'),
    setBounds: invoke('site:setBounds'),
    setVisible: invoke('site:setVisible'),
    back: invoke('site:back'),
    reload: invoke('site:reload'),
  },
  setup: {
    createAdmin: invoke('setup:createAdmin'),
  },
  admin: {
    login: invoke('admin:login'),
    logout: invoke('admin:logout'),
    info: invoke('admin:info'),
    changePassword: invoke('admin:changePassword'),
    pickFile: invoke('admin:pickFile'),
    quit: invoke('admin:quit'),
    content: {
      list: invoke('admin:content:list'),
      save: invoke('admin:content:save'),
      delete: invoke('admin:content:delete'),
      reorder: invoke('admin:content:reorder'),
    },
    categories: {
      list: invoke('admin:categories:list'),
      save: invoke('admin:categories:save'),
      delete: invoke('admin:categories:delete'),
      reorder: invoke('admin:categories:reorder'),
    },
    requests: {
      list: invoke('admin:requests:list'),
      resolve: invoke('admin:requests:resolve'),
    },
    activity: {
      list: invoke('admin:activity:list'),
      clear: invoke('admin:activity:clear'),
    },
    children: {
      list: invoke('admin:children:list'),
      save: invoke('admin:children:save'),
      delete: invoke('admin:children:delete'),
      setActive: invoke('admin:children:setActive'),
    },
    settings: {
      get: invoke('admin:settings:get'),
      save: invoke('admin:settings:save'),
    },
    usage: {
      grant: invoke('admin:usage:grant'),
    },
    sync: {
      now: invoke('admin:sync:now'),
      status: invoke('admin:sync:status'),
    },
    sites: {
      clearData: invoke('admin:sites:clearData'),
    },
  },
  on(event, callback) {
    if (!EVENTS.has(event)) throw new Error(`Unknown event: ${event}`);
    const listener = (_event, payload) => callback(payload);
=======
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
>>>>>>> 9cdb3b1a4e77639efe6a102895d504764a0cff37
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});

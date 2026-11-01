'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (cb) => {
  const handler = (_event, payload) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('lh', {
  info: () => ipcRenderer.invoke('app:info'),
  platform: process.platform,

  settings: {
    load: () => ipcRenderer.invoke('settings:load'),
    save: (patch) => ipcRenderer.invoke('settings:save', patch),
    open: (tab) => ipcRenderer.invoke('settings:open', tab),
    tab: () => ipcRenderer.invoke('settings:tab')
  },

  library: {
    scan: (folder) => ipcRenderer.invoke('library:scan', folder),
    chooseFolder: () => ipcRenderer.invoke('dialog:folder'),
    openImages: () => ipcRenderer.invoke('dialog:openImages'),
    describe: (filePath) => ipcRenderer.invoke('image:describe', filePath)
  },

  image: {
    exif: (filePath) => ipcRenderer.invoke('image:exif', filePath),
    save: (payload) => ipcRenderer.invoke('image:save', payload),
    copy: (payload) => ipcRenderer.invoke('clipboard:image', payload)
  },

  file: {
    reveal: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
    openExternal: (target) => ipcRenderer.invoke('file:openExternal', target),
    trash: (paths) => ipcRenderer.invoke('file:trash', paths),
    rename: (payload) => ipcRenderer.invoke('file:rename', payload),
    pathForFile: (file) => {
      try { return webUtils.getPathForFile(file); } catch { return null; }
    }
  },

  win: {
    action: (action) => ipcRenderer.send('win:action', action),
    theme: (mode) => ipcRenderer.send('win:theme', mode),
    isMaximized: () => ipcRenderer.invoke('win:isMaximized')
  },

  accent: {
    get: () => ipcRenderer.invoke('accent:get')
  },

  events: {
    accentChanged: on('accent:changed'),
    ready: on('app:ready'),
    state: on('win:state'),
    focus: on('win:focus'),
    openFile: on('app:open-file'),
    pickFile: on('app:pick-file'),
    settingsChanged: on('settings:changed'),
    settingsTab: on('settings:tab')
  }
});

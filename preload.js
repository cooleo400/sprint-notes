const { contextBridge, ipcRenderer: i } = require('electron');
contextBridge.exposeInMainWorld('api', {
  init: () => i.invoke('init'),
  changeFolder: () => i.invoke('changeFolder'),
  read: n => i.invoke('read', n),
  write: (n, t) => i.invoke('write', n, t),
  archives: () => i.invoke('archives'),
  archiveWrite: (b, t) => i.invoke('archiveWrite', b, t),
  search: q => i.invoke('search', q),
  open: u => i.invoke('open', u),
  saveExport: (name, text) => i.invoke('saveExport', name, text),
  archiveMenu: () => i.invoke('archiveMenu'),
  archiveRename: (from, to) => i.invoke('archiveRename', from, to),
  archiveTrash: name => i.invoke('archiveTrash', name),
  getSettings: () => i.invoke('getSettings'),
  setSettings: settings => i.invoke('setSettings', settings)
});

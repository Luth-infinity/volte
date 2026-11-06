const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('volte', {
  plateforme: process.platform,
  lire: () => ipcRenderer.invoke('lire'),
  enregistrer: (config) => ipcRenderer.invoke('enregistrer', config),
  choisirPhoto: (id) => ipcRenderer.invoke('choisirPhoto', id),
  retirerPhoto: (id) => ipcRenderer.invoke('retirerPhoto', id),
  etats: () => ipcRenderer.invoke('etats'),
  connecter: (id) => ipcRenderer.invoke('connecter', id),
  surEtats: (fn) => ipcRenderer.on('etats', () => fn()),
  suspendreRaccourcis: (oui) => ipcRenderer.invoke('suspendreRaccourcis', oui),
})

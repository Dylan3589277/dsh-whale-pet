const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pet', {
  sprites: () => ipcRenderer.invoke('sprites'),
  onView: (cb) => ipcRenderer.on('view', (_e, view) => cb(view)),
  onCursor: (cb) => ipcRenderer.on('cursor', (_e, p) => cb(p)), // 全屏鼠标位置（屏幕 DIP 坐标），只在变化时来
  setIgnore: (ignore) => ipcRenderer.send('set-ignore', ignore),
  dragStart: () => ipcRenderer.send('drag-start'),
  dragMove: () => ipcRenderer.send('drag-move'),
  dragEnd: () => ipcRenderer.send('drag-end'),
  showMenu: () => ipcRenderer.send('show-menu'),
});

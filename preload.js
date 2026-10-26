// preload.js —— 唯一的桥。
// 它同时能看到 Electron 的 API 和页面的 window，但页面看不到它内部的东西。
// 规则：只暴露「白名单」函数，绝不暴露 ipcRenderer 本身。

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // 数据类：读写笔记
  getTime: () => ipcRenderer.invoke('get-time'),
  writeNote: (text) => ipcRenderer.invoke('write-note', text),
  readNote: () => ipcRenderer.invoke('read-note'),

  // 窗口类：两个窗口共用同一份 preload，按需调用
  toggleMain: () => ipcRenderer.invoke('toggle-main'),
  toggleFloating: () => ipcRenderer.invoke('toggle-floating'),

  // 拖拽：只传位移量，不传绝对坐标 —— 主进程自己算新位置更安全
  moveWindow: (dx, dy) => ipcRenderer.send('move-window', dx, dy)
})

// 错误示范（千万别这么写）：
// contextBridge.exposeInMainWorld('ipc', ipcRenderer)
// —— 等于把整把钥匙递给页面，任何注入脚本都能为所欲为

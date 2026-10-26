// main.js —— 主进程。整个应用只有这一个，跑在 Node.js 环境里。
// 它的权限最大：开窗口、进托盘、注册全局快捷键、读文件，都在这里做。

const {
  app,
  BrowserWindow,
  ipcMain,
  Tray,
  Menu,
  dialog,
  nativeImage,
  globalShortcut,
  screen
} = require('electron')
const path = require('node:path')
const fs = require('node:fs/promises')
const fsSync = require('node:fs')

// ============ 全局状态 ============
// ⚠️ 窗口和托盘对象必须存在模块级变量里。
// 写成函数里的局部变量，函数一返回就被 GC 回收，
// 托盘图标会「自己消失」—— 这是 Electron 最经典的坑之一。
let tray = null
let win = null
let floatingWin = null
let isQuitting = false

const HOTKEY_TOGGLE = 'Alt+Space'
const FLOATING_SIZE = 88 // 悬浮窗边长，比球本身大一圈留阴影空间

// 悬浮球位置记在 userData 里，下次启动回到原位
const posFile = () => path.join(app.getPath('userData'), 'floating-pos.json')

// ============ 主窗口 ============
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 640,
    title: 'Electron 最小示例',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.loadFile('index.html')

  win.once('ready-to-show', () => {
    win.show()
  })

  // 点右上角 X 时不真关，只藏起来 —— 托盘应用的标准行为
  win.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      win.hide()
    }
  })
}

// ============ 悬浮球位置的存取 ============
function getSavedPos() {
  try {
    const p = JSON.parse(fsSync.readFileSync(posFile(), 'utf8'))
    if (typeof p.x !== 'number' || typeof p.y !== 'number') return null

    // ⚠️ 必须校验：换了分辨率 / 拔了外接屏之后，旧坐标可能落在屏幕外，
    // 那样球就「启动后找不到」了。
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    const x = Math.min(Math.max(p.x, 0), width - FLOATING_SIZE)
    const y = Math.min(Math.max(p.y, 0), height - FLOATING_SIZE)
    return { x, y }
  } catch {
    return null
  }
}

let saveTimer = null
function scheduleSavePos() {
  // 拖动时 moved 事件会疯狂触发，防抖一下，别把硬盘写坏
  clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    if (!floatingWin || floatingWin.isDestroyed()) return
    const [x, y] = floatingWin.getPosition()
    try {
      await fs.writeFile(posFile(), JSON.stringify({ x, y }), 'utf8')
    } catch {
      /* 存不上就算了，不影响使用 */
    }
  }, 400)
}

// ============ 悬浮球窗口（透明 + 无边框 + 置顶）============
function createFloatingWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const saved = getSavedPos()

  floatingWin = new BrowserWindow({
    width: FLOATING_SIZE,
    height: FLOATING_SIZE,
    // 有记录就用记录的位置，没有就放右下角
    x: saved ? saved.x : width - FLOATING_SIZE - 24,
    y: saved ? saved.y : height - FLOATING_SIZE - 24,
    frame: false, // 去掉标题栏和边框，否则透明没意义
    transparent: true, // 背景透明
    resizable: false, // ⚠️ 透明窗口在 Windows 上别让它可缩放，会留黑边残影
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false, // 系统阴影对透明窗很怪，用 CSS 阴影代替
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  floatingWin.loadFile('floating.html')

  // alwaysOnTop 有层级：screen-saver 比默认的 floating 更靠前
  floatingWin.setAlwaysOnTop(true, 'screen-saver')

  floatingWin.on('moved', scheduleSavePos)

  floatingWin.on('closed', () => {
    floatingWin = null
  })
}

// ============ 显示 / 隐藏主窗口 ============
function toggleWindow() {
  if (!win) return

  // ⚠️ 窗口最小化时 isVisible() 仍然返回 true，必须额外判断 isMinimized()
  if (win.isVisible() && !win.isMinimized()) {
    win.hide()
    return
  }

  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

// ============ 显示 / 隐藏悬浮球 ============
function toggleFloating() {
  if (!floatingWin || floatingWin.isDestroyed()) {
    createFloatingWindow()
    return
  }
  if (floatingWin.isVisible()) {
    floatingWin.hide()
  } else {
    floatingWin.show()
  }
}

// ============ 托盘 ============
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'))
  tray = new Tray(icon)
  tray.setToolTip('Electron 最小示例 · 点我开关窗口')

  const menu = Menu.buildFromTemplate([
    { label: `显示 / 隐藏窗口　(${HOTKEY_TOGGLE})`, click: toggleWindow },
    { label: '显示 / 隐藏悬浮球', click: toggleFloating },
    { type: 'separator' },
    { label: '看上次写的笔记', click: showLastNote },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)

  tray.on('click', toggleWindow)
}

// ============ 全局快捷键 ============
function registerHotkeys() {
  const ok = globalShortcut.register(HOTKEY_TOGGLE, toggleWindow)

  if (!ok) {
    dialog.showMessageBox({
      type: 'warning',
      title: '快捷键注册失败',
      message: `${HOTKEY_TOGGLE} 已被其他程序占用`,
      detail:
        '托盘和窗口仍然可用，只是这个快捷键没法用。\n' +
        '可以关掉占用它的软件，或者改 main.js 里的 HOTKEY_TOGGLE 常量。'
    })
    return
  }

  console.log('[hotkey]', HOTKEY_TOGGLE, '已注册 =', globalShortcut.isRegistered(HOTKEY_TOGGLE))
}

async function showLastNote() {
  const file = path.join(app.getPath('userData'), 'notes.txt')
  try {
    const content = await fs.readFile(file, 'utf8')
    await dialog.showMessageBox({
      type: 'info',
      title: '上次写的笔记',
      message: content.trim() || '（文件是空的）'
    })
  } catch {
    await dialog.showMessageBox({
      type: 'warning',
      title: '还没写过',
      message: '先去窗口里写点什么，再点这里。'
    })
  }
}

// ============ 生命周期 ============
app.whenReady().then(() => {
  createWindow()

  try {
    createTray()
  } catch (e) {
    console.error('[startup] 托盘创建失败：', e)
  }

  try {
    createFloatingWindow()
  } catch (e) {
    console.error('[startup] 悬浮窗创建失败：', e)
  }

  try {
    registerHotkeys()
  } catch (e) {
    console.error('[startup] 快捷键注册失败：', e)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}).catch((e) => {
  console.error('[startup] whenReady 失败：', e)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ============ IPC：主进程给页面提供的能力 ============

ipcMain.handle('get-time', () => {
  return new Date().toLocaleString('zh-CN')
})

ipcMain.handle('write-note', async (_event, text) => {
  const file = path.join(app.getPath('userData'), 'notes.txt')
  await fs.appendFile(file, text + '\n', 'utf8')
  return { ok: true, file }
})

ipcMain.handle('read-note', async () => {
  const file = path.join(app.getPath('userData'), 'notes.txt')
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return ''
  }
})

ipcMain.handle('toggle-main', () => {
  toggleWindow()
})

ipcMain.handle('toggle-floating', () => {
  toggleFloating()
})

// 拖拽悬浮球：页面只发「这一帧移动了多少」，主进程按当前坐标累加。
// 这样页面永远拿不到、也不需要绝对坐标，权限最小。
ipcMain.on('move-window', (event, dx, dy) => {
  const w = BrowserWindow.fromWebContents(event.sender)
  if (!w || w.isDestroyed()) return
  // 只允许移动悬浮窗，主窗口不受影响
  if (w !== floatingWin) return
  const [x, y] = w.getPosition()
  w.setPosition(Math.round(x + dx), Math.round(y + dy))
})

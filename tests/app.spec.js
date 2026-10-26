// tests/app.spec.js —— 用 Playwright 驱动真实的 Electron 应用做端到端测试
// 跑法：npm test

const { test, expect, _electron: electron } = require('@playwright/test')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

let app
let mainPage
let floatingPage

test.beforeAll(async () => {
  // ⚠️ 这台机器的环境里可能带 ELECTRON_RUN_AS_NODE=1，
  // 带着它启动 electron 会退化成纯 node、不开窗口。必须删掉。
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE

  app = await electron.launch({
    // ⚠️ 这几个开关是给「没有显卡 / 远程会话 / CI」的环境用的：
    // 不加的话 Chromium 的 GPU 子进程会被沙箱拦住、反复崩溃，
    // 最后 FATAL「GPU process isn't usable. Goodbye.」把整个应用杀掉，
    // Playwright 只会看到「窗口自己关了」，非常难查。
    // 你自己的电脑上跑测试可以删掉，界面会更流畅。
    args: [
      '--no-sandbox',
      '--disable-gpu',
      '--disable-gpu-sandbox',
      '--disable-software-rasterizer',
      '.'
    ],
    cwd: ROOT,
    env
  })

  // ⚠️ 不能只看 windows().length，窗口对象可能已经存在但 url() 还是空。
  // 必须轮询到 URL 真的加载出来为止。
  async function findByUrl(fragment, timeout = 20_000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      const found = app.windows().find((p) => p.url().includes(fragment))
      if (found) return found
      await new Promise((r) => setTimeout(r, 200))
    }
    const urls = app.windows().map((p) => p.url() || '(空)').join(' | ')
    throw new Error(`找不到 URL 含 "${fragment}" 的窗口。当前窗口 URL：${urls}`)
  }

  mainPage = await findByUrl('index.html')
  floatingPage = await findByUrl('floating.html')

  await mainPage.waitForLoadState('domcontentloaded')
  await floatingPage.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  if (app) await app.close()
})

// ---------- 1. 窗口本身 ----------
test('主窗口标题正确', async () => {
  expect(await mainPage.title()).toContain('Electron')
})

// ---------- 2. IPC 调用主进程 ----------
test('点按钮能拿到主进程返回的时间', async () => {
  await mainPage.getByRole('button', { name: /getTime/ }).click()
  await expect(mainPage.locator('#out1')).toContainText('主进程返回：')
})

// ---------- 3. 主进程读写文件 ----------
test('写入内容后能原样读回来', async () => {
  const text = 'e2e-' + Date.now()

  await mainPage.locator('#note').fill(text)
  await mainPage.getByRole('button', { name: '写入' }).click()
  await expect(mainPage.locator('#out2')).toContainText('已写入')

  await mainPage.getByRole('button', { name: '读取笔记' }).click()
  await expect(mainPage.locator('#out3')).toContainText(text)
})

// ⚠️ 用 URL 找窗口，不要用宽度 / 标题：
// 高分屏 DPI 缩放下 getSize() 返回的数值和代码里写的不一样，按宽度找会全部落空。

// ---------- 4. 悬浮窗的窗口属性 ----------
test('悬浮球是置顶、且不可缩放的窗口', async () => {
  const info = await app.evaluate(({ BrowserWindow }) => {
    const t = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('floating.html')
    )
    if (!t) return null
    return {
      alwaysOnTop: t.isAlwaysOnTop(),
      resizable: t.isResizable(),
      frameLess: !t.isResizable() && t.getSize()[0] > 0
    }
  })

  expect(info, '没找到悬浮球窗口').toBeTruthy()
  expect(info.alwaysOnTop).toBe(true) // 置顶
  expect(info.resizable).toBe(false) // 不可缩放（否则透明窗会留黑边）
})

// ---------- 5. 单击悬浮球开关主窗口 ----------
test('单击悬浮球能隐藏 / 显示主窗口', async () => {
  const mainVisible = () =>
    app.evaluate(({ BrowserWindow }) => {
      const t = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('index.html')
      )
      return t ? t.isVisible() : null
    })

  expect(await mainVisible()).toBe(true)

  await floatingPage.locator('#ball').click()
  await expect.poll(mainVisible, { timeout: 5_000 }).toBe(false)

  await floatingPage.locator('#ball').click()
  await expect.poll(mainVisible, { timeout: 5_000 }).toBe(true)
})

// ---------- 6. 拖动悬浮球 ----------
test('拖动悬浮球会改变窗口位置', async () => {
  const floatPos = () =>
    app.evaluate(({ BrowserWindow }) => {
      const t = BrowserWindow.getAllWindows().find((w) =>
        w.webContents.getURL().includes('floating.html')
      )
      return t ? t.getPosition() : null
    })

  const before = await floatPos()
  const box = await floatingPage.locator('#ball').boundingBox()

  const startX = box.x + box.width / 2
  const startY = box.y + box.height / 2

  await floatingPage.mouse.move(startX, startY)
  await floatingPage.mouse.down()
  await floatingPage.mouse.move(startX - 70, startY - 50, { steps: 12 })
  await floatingPage.mouse.up()

  await expect
    .poll(async () => {
      const now = await floatPos()
      return now[0] !== before[0] || now[1] !== before[1]
    }, { timeout: 5_000 })
    .toBe(true)
})

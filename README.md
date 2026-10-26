# ElectronDemo

用 Electron 写的 Windows 桌面小工具，演示**多窗口架构 + 托盘常驻 + 全局快捷键 + 透明置顶悬浮球**，并自带 Playwright 端到端测试与 electron-builder 一键打包。

不依赖本地已有环境，克隆下来两条命令就能跑；打包产物是单个 exe，可直接分发。

---

## 功能

| 功能 | 说明 |
|---|---|
| 主窗口 | 演示三种 IPC 能力：取系统时间、写文件、读文件 |
| 托盘常驻 | 左键开关窗口；右键菜单含「显示/隐藏窗口」「显示/隐藏悬浮球」「看上次写的笔记」「退出」 |
| 全局快捷键 | `Alt+Space` 在任何软件下唤起 / 隐藏主窗口 |
| 透明悬浮球 | 无边框、透明、置顶；可拖动（位置自动记忆），单击开关主窗口 |
| 关闭到托盘 | 点窗口右上角 X 不退出，只隐藏；退出需走托盘菜单 |

---

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Electron 45（Chromium + Node.js） |
| 语言 | JavaScript (CommonJS) |
| 测试 | Playwright `_electron` + `@playwright/test` |
| 打包 | electron-builder（win portable / x64） |
| 图标 | Python 脚本生成 PNG/ICO（无第三方图像库） |

---

## 架构

Electron 的全部复杂度集中在**三个角色**上：

| 文件 | 角色 | 职责 | 数量 |
|---|---|---|---|
| `main.js` | 主进程 | 创建窗口、托盘、注册全局快捷键、读写文件 | 一个应用只有一个 |
| `index.html` / `floating.html` | 渲染进程 | 画界面、处理交互，就是普通网页 | 每个窗口一个 |
| `preload.js` | 桥 | 把主进程能力按**白名单**挂到 `window.api` | 每个窗口一个 |

调用链路：

```
页面 JS  →  window.api.xxx()  →  ipcRenderer.invoke
         →  ipcMain.handle('xxx')  →  主进程执行
         →  结果原路返回
```

两个窗口共用同一份 `preload.js`，通过不同的 `loadFile` 加载不同页面。

---

## 目录结构

```
electron-demo/
├── main.js                主进程：窗口 / 托盘 / 快捷键 / IPC
├── preload.js             唯一的桥，暴露白名单 API
├── index.html             主窗口页面
├── floating.html          悬浮球页面（手动拖拽）
├── playwright.config.js   测试配置（单 worker，不并行）
├── package.json           依赖 + 脚本 + electron-builder 配置
├── assets/
│   ├── tray.png           托盘图标 64×64
│   └── icon.png           窗口图标 256×256
├── build/
│   └── icon.ico           打包用图标（256×256 PNG 塞进 ICO）
└── tests/
    └── app.spec.js        6 个端到端用例
```

---

## 快速开始

```bash
npm install
npm start
```

> 国内网络若卡在下载 Electron 二进制，设置镜像后重装：
> `setx ELECTRON_MIRROR "https://npmmirror.com/mirrors/electron/"`（需重开终端）

启动后：

1. 任务栏右下角出现托盘图标
2. 屏幕右下角出现悬浮球
3. 按 `Alt+Space` 开关主窗口
4. 点悬浮球上的「打开」图标开关主窗口；按住球体可拖动

---

## 测试

```bash
npm test
```

输出：

```
Running 6 tests using 1 worker

  ok 1 主窗口标题正确
  ok 2 点按钮能拿到主进程返回的时间
  ok 3 写入内容后能原样读回来
  ok 4 悬浮球是置顶、且不可缩放的窗口
  ok 5 单击悬浮球能隐藏 / 显示主窗口
  ok 6 拖动悬浮球会改变窗口位置

  6 passed (14.6s)
```

用例覆盖的不只是「窗口能打开」，而是**行为**：例如「单击悬浮球」会在主进程侧断言 `win.isVisible()` 真的翻转了两次，属于可回归的行为测试。

生成本地 HTML 报告：`npm run test:report`

---

## 打包

```bash
npm run dist
```

产物在 `release/`：

| 文件 | 大小 | 说明 |
|---|---|---|
| `ElectronDemo-1.0.0-x64.exe` | ≈106 MB | 免安装单文件，双击即用 |
| `win-unpacked/` | ≈357 MB | 解压目录版，调试用，启动更快 |

只在本地验证不生成安装包：`npm run dist:dir`

---

## 关键技术决策

记录几个踩过的坑，都是这个项目里真实遇到的：

**1. 安全三开关全程开启**

`contextIsolation: true` + `nodeIntegration: false` + `sandbox: true`，页面拿不到 `require`，所有系统能力必须经 preload 白名单。反面写法是 `contextBridge.exposeInMainWorld('ipc', ipcRenderer)`——等于把整把钥匙递给页面。

**2. 悬浮球用手动拖拽，不用 `-webkit-app-region`**

CSS 的 `-webkit-app-region: drag` 能拖动窗口，但会把鼠标事件交给系统窗口管理，页面收不到 `click`——结果是「能拖不能点」。改成 `mousedown/mousemove/mouseup` 计算位移，通过 IPC 调 `setPosition`。位移超过 3px 判为拖动，否则判为单击。

**3. 透明窗必须 `resizable: false`**

Windows 上允许缩放透明窗口会在边框处留下黑边残影，且不会自动消失。

**4. 悬浮球位置持久化要 clamp**

位置存在 `userData/floating-pos.json`，启动时读回。但必须用 `workArea` 做边界校验——换了分辨率或拔掉外接屏后，旧坐标可能落在屏幕外，球就「启动后找不到」。

**5. 测试在无显卡 / CI 环境要关 GPU**

不加开关的话，GPU 子进程会被反复拉起又崩溃，最后 `FATAL: GPU process isn't usable. Goodbye.` 直接杀掉整个应用，Playwright 只能看到「窗口自己关了」，极难排查。

```js
args: ['--no-sandbox', '--disable-gpu', '--disable-gpu-sandbox', '--disable-software-rasterizer', '.']
```

**6. 测试里不能用窗口尺寸识别窗口**

高分屏 DPI 缩放下 `getSize()` 的返回值与代码里写的不一致，按宽度匹配会全部落空。改用 URL：

```js
w.webContents.getURL().includes('floating.html')
```

---

## 已知限制

- **未做代码签名**，Windows 首次运行会提示「未知发布者」，需点「更多信息 → 仍要运行」
- `portable` 版本每次启动需解压到临时目录，首次启动约慢 3~5 秒
- 三个主窗口功能为演示性质，不是完整的效率工具
- 仅适配 Windows（未在 macOS / Linux 上验证）

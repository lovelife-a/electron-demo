// playwright.config.js —— 只测 Electron，不需要下载浏览器内核
module.exports = {
  testDir: './tests',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,   // 桌面应用不能并行跑，会抢同一份 userData
  workers: 1,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
}

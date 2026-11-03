/* ============================================================
 * 股息流 · 桌面外壳（Electron 主进程）
 *
 * 这个文件不参与任何游戏逻辑，只做四件事：
 *   1. 开一个 1280×860、可缩放、无自带菜单栏的窗口加载 index.html；
 *   2. 记住上次的窗口位置 / 大小（userData/window-state.json）；
 *   3. 单实例：重复双击时聚焦已开窗口，而不是再开一个；
 *   4. 安全兜底：本地静态页面，禁 Node 集成，外链一律交给系统浏览器。
 *
 * 渲染与规则全在 index.html + js/ 里，改动游戏不需要动这个文件。
 * 战绩存档走页面内的 localStorage，落在 %APPDATA%\DividendFlow。
 * ============================================================ */
'use strict';

const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const APP_NAME = '股息流';

/* 允许背景音乐自动播放：绕过 Chromium「需用户手势才能播放有声媒体」的限制 */
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const DEFAULT_SIZE = { width: 1280, height: 860 };
const MIN_SIZE = { width: 980, height: 640 };

const ENTRY = path.join(__dirname, 'index.html');
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');

/* ---------- 窗口位置记忆 ---------- */
function readState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    return {
      width: Number(s.width) || DEFAULT_SIZE.width,
      height: Number(s.height) || DEFAULT_SIZE.height,
      x: Number.isFinite(s.x) ? s.x : undefined,
      y: Number.isFinite(s.y) ? s.y : undefined,
      maximized: !!s.maximized
    };
  } catch (e) {
    // 首次启动 / 文件损坏：用默认尺寸
    return { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height, maximized: false };
  }
}

function writeState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const maximized = win.isMaximized();
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized }), 'utf8');
  } catch (e) { /* 写失败不影响游戏 */ }
}

/* ---------- 主窗口 ---------- */
let win = null;

function createWindow() {
  const st = readState();

  win = new BrowserWindow({
    width: st.width,
    height: st.height,
    x: st.x,
    y: st.y,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    title: APP_NAME,
    show: false,                 // 首屏渲染完再显示，避免白闪一下
    backgroundColor: '#0b1020',  // 与 css 里的 --bg 一致
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      backgroundThrottling: false // 掷骰 / 回放动画在窗口失焦时也不掉帧
    }
  });

  // 去掉 Electron 默认菜单（File / Edit / View…），游戏用不上，按 Alt 也不再弹出
  Menu.setApplicationMenu(null);

  win.loadFile(ENTRY);

  win.once('ready-to-show', () => {
    if (st.maximized) win.maximize();
    win.show();
  });

  // 关闭前记下位置与是否最大化
  win.on('close', () => writeState(win));

  // 屏蔽 Ctrl± / Ctrl0 页面缩放：误触会把棋盘布局挤变形
  win.webContents.on('before-input-event', (e, input) => {
    if ((input.control || input.meta) && ['+', '-', '=', '_', '0'].indexOf(input.key) >= 0) {
      e.preventDefault();
    }
  });

  // 外链走系统浏览器，窗口自身不做站外导航
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

/* ---------- 生命周期 ---------- */
app.setName(APP_NAME);
// 固定英文的 userData 目录名，避免中文路径在某些环境下出问题；战绩就存在这里
app.setPath('userData', path.join(app.getPath('appData'), 'DividendFlow'));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  });

  app.whenReady().then(() => {
    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}

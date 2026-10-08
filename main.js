/**
 * Cinemate Desktop (Electron)
 *
 * Если задан REMOTE_URL или в config.js указан сервер в интернете —
 * приложение ходит в интернет, локальный server.js не нужен.
 *
 * Локальный режим (без интернета): поднимает server.js на 127.0.0.1:3847
 */

const { app, BrowserWindow, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

const LOCAL_PORT = 3847;
let mainWindow = null;
let serverProcess = null;

function readRemoteFromConfig() {
  // 1) переменная окружения при запуске: REMOTE_URL=https://xxx npm start
  if (process.env.REMOTE_URL) return process.env.REMOTE_URL.replace(/\/$/, '');

  // 2) config.js рядом с приложением
  try {
    const cfg = fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8');
    const m = cfg.match(/window\.CINEMATE_API\s*=\s*['"]([^'"]+)['"]/);
    if (m && m[1]) return m[1].replace(/\/$/, '');
  } catch (_) {}
  return '';
}

function waitForServer(url, attempts = 50) {
  return new Promise((resolve, reject) => {
    let left = attempts;
    const tryOnce = () => {
      const req = http.get(url, (res) => { res.resume(); resolve(); });
      req.on('error', () => {
        left -= 1;
        if (left <= 0) reject(new Error('Server start timeout'));
        else setTimeout(tryOnce, 100);
      });
    };
    tryOnce();
  });
}

function startLocalServer() {
  const serverPath = path.join(__dirname, 'server.js');
  const env = {
    ...process.env,
    PORT: String(LOCAL_PORT),
    HOST: '127.0.0.1'
  };

  if (app.isPackaged) {
    serverProcess = spawn(process.execPath, [serverPath], {
      cwd: __dirname,
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'ignore'
    });
  } else {
    serverProcess = spawn('node', [serverPath], {
      cwd: __dirname,
      env,
      stdio: 'ignore'
    });
  }
  serverProcess.on('error', (err) => console.error('Server error:', err.message));
}

function createWindow(startUrl) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 900,
    minHeight: 600,
    title: 'Cinemate',
    backgroundColor: '#0f0f13',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    },
    show: false
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadURL(startUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

function buildMenu() {
  const template = [
    {
      label: 'Cinemate',
      submenu: [
        { role: 'about', label: 'О программе' },
        { type: 'separator' },
        { role: 'quit', label: 'Выход' }
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' }
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Сбросить масштаб' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function stopServer() {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.kill(); } catch (_) {}
    serverProcess = null;
  }
}

app.whenReady().then(async () => {
  buildMenu();

  const remote = readRemoteFromConfig();
  let startUrl;

  if (remote) {
    // Режим: сервер в интернете
    console.log('Режим: удалённый сервер', remote);
    startUrl = remote;
  } else {
    // Режим: локальный server.js
    console.log('Режим: локальный сервер');
    startLocalServer();
    try {
      await waitForServer(`http://127.0.0.1:${LOCAL_PORT}/api/health`);
    } catch (e) {
      console.error(e);
    }
    startUrl = `http://127.0.0.1:${LOCAL_PORT}`;
  }

  createWindow(startUrl);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(startUrl);
  });
});

app.on('window-all-closed', () => {
  stopServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', stopServer);

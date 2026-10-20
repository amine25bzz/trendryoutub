const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// اختياري: ضع مفتاحك في ملف key.txt بجانب التطبيق بدل كتابته في الكود
const keyFile = path.join(path.dirname(process.execPath), 'key.txt');
if (!process.env.YOUTUBE_API_KEY && fs.existsSync(keyFile)) {
  process.env.YOUTUBE_API_KEY = fs.readFileSync(keyFile, 'utf8').trim();
}

let server;

async function start() {
  const { createServer } = await import('./server.js');
  server = createServer();
  await new Promise(res => server.listen(0, '127.0.0.1', res)); // منفذ حر تلقائياً
  const port = server.address().port;

  Menu.setApplicationMenu(null);
  const win = new BrowserWindow({
    width: 1280, height: 800,
    title: 'TrendRadar',
    autoHideMenuBar: true
  });
  win.loadURL(`http://127.0.0.1:${port}`);
  // الروابط الخارجية (فيديوهات يوتيوب) تُفتح في المتصفح لا داخل النافذة
  win.webContents.setWindowOpenHandler(({ url }) => {
    require('electron').shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(start);
app.on('window-all-closed', () => { if (server) server.close(); app.quit(); });
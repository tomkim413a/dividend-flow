/* ============================================================
 * 本地静态服务器 —— 网页版预览用（零依赖）
 * 用法：node serve.js [端口]，默认 5173，然后浏览器打开 http://localhost:5173
 * 说明：游戏本身是纯静态页面（index.html + css/ + js/），
 *       这个脚本只是把它通过 http 提供出来，方便在浏览器里试玩、热改即刷新。
 * ============================================================ */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav'
};

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const file = path.join(ROOT, rel.replace(/^[/\\]+/, ''));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('403'); return; }
  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found: ' + rel);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'          // 改完代码刷新即生效，不用清缓存
    });
    res.end(buf);
  });
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') console.log(`端口 ${PORT} 已被占用，换一个：node serve.js 5174`);
  else console.log('启动失败：' + e.message);
});

server.listen(PORT, () => console.log(`股息流 · 网页版已启动： http://localhost:${PORT}`));

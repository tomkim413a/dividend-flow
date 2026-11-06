#!/usr/bin/env node
/* ============================================================
 * gmail-token.js —— 一次性脚本：拿到 Gmail API 的 refresh_token
 *
 * 为什么需要它：Gmail API 走 HTTPS(443)，云服务器（Render 等）也能连，
 * 而且信是由 Google 发出并签名的，SPF/DKIM 天然通过，QQ/163 能正常收。
 * 但 OAuth 授权必须在有浏览器的机器上点一次"同意"，所以这个脚本跑在你电脑上。
 *
 * 用法（在项目根目录）：
 *   node tools/gmail-token.js --id <CLIENT_ID> --secret <CLIENT_SECRET>
 *
 * 得到 refresh_token 后，到 Render 填 4 个环境变量：
 *   GMAIL_USER           你的 Gmail 地址（就是下面授权时登录的那个）
 *   GMAIL_CLIENT_ID      对应 CLIENT_ID
 *   GMAIL_CLIENT_SECRET  对应 CLIENT_SECRET
 *   GMAIL_REFRESH_TOKEN  本脚本打印出来的 refresh_token
 *
 * 重要：OAuth 同意屏幕如果还停留在「测试」状态，refresh_token 7 天就会失效
 *       （日志会报 Gmail 授权失败 invalid_grant）。请点「发布应用 / PUBLISH APP」
 *       转为正式版，长期有效。
 * ============================================================ */
'use strict';
const http = require('http');
const { exec } = require('child_process');

const argv = process.argv.slice(2);
const arg = name => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? String(argv[i + 1] || '') : '';
};

const CLIENT_ID = arg('id') || process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = arg('secret') || process.env.GMAIL_CLIENT_SECRET || '';
const PORT = Number(arg('port') || 8765);
const REDIRECT = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send openid email';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('');
  console.error('用法：node tools/gmail-token.js --id <CLIENT_ID> --secret <CLIENT_SECRET>');
  console.error('（在 Google Cloud Console → API 和服务 → 凭据 → OAuth 2.0 客户端 ID 里能看到）');
  console.error('');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent',              // 强制返回 refresh_token（否则第二次授权就没有了）
  include_granted_scopes: 'true'
}).toString();

function page(title, body) {
  return `<!DOCTYPE html><meta charset="utf-8"><title>${title}</title>
  <body style="font-family:system-ui,'Microsoft YaHei';background:#0f1726;color:#e8eef7;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="max-width:560px;padding:28px;border:1px solid #34508a;border-radius:16px;background:#131c2b">
  <h2 style="margin:0 0 12px">${title}</h2><div style="line-height:1.8;font-size:14px">${body}</div></div></body>`;
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }

  const err = u.searchParams.get('error');
  const code = u.searchParams.get('code');
  if (err) return done(res, 'Authorization denied', `授权被拒绝：${err}`, false);
  if (!code) return done(res, 'No code', '没有拿到 code，请重新运行脚本。', false);

  try {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT,
        grant_type: 'authorization_code'
      })
    });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) {
      const why = j.error_description || j.error || ('HTTP ' + r.status);
      return done(res, 'Exchange failed', `换取 refresh_token 失败：${why}`, false);
    }

    let email = '(未知，请自己在 GMAIL_USER 填授权的 Gmail 地址)';
    try {
      const info = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: 'Bearer ' + j.access_token }
      }).then(x => x.json());
      if (info && info.email) email = info.email;
    } catch (e) { /* 拿不到邮箱不影响 refresh_token */ }

    console.log('');
    console.log('============================================================');
    console.log('✅ 授权成功，授权的账号：', email);
    console.log('');
    console.log('把下面 4 个变量填到 Render 的 Environment（Environment Variables）：');
    console.log('');
    console.log('GMAIL_USER=' + email);
    console.log('GMAIL_CLIENT_ID=' + CLIENT_ID);
    console.log('GMAIL_CLIENT_SECRET=' + CLIENT_SECRET);
    console.log('GMAIL_REFRESH_TOKEN=' + j.refresh_token);
    console.log('');
    console.log('提示：填完保存后会自动重新部署，日志里应出现 [mail] 通道自检通过（gmail）');
    console.log('============================================================');
    console.log('');

    done(res, '✅ 授权成功', '已经拿到 refresh_token。请回到命令行窗口查看输出的环境变量，' +
      '然后把它们填到 Render。这个页面可以关掉了。', true);
  } catch (e) {
    done(res, 'Error', '请求 Google 失败：' + (e && e.message), false);
  }
});

function done(res, title, body, ok) {
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(title, body));
  } catch (e) { /* ignore */ }
  server.close();
  if (!ok) process.exitCode = 1;
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

server.on('error', e => {
  if (e && e.code === 'EADDRINUSE') {
    console.error(`端口 ${PORT} 被占用，换一个：node tools/gmail-token.js --port 8790 ...`);
  } else {
    console.error('本地服务器启动失败：', e && e.message);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('第 1 步：在下面的地址里用你的 Gmail 登录并点「继续/允许」');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log('（已经尝试自动打开浏览器；打不开就手动复制上面这行到浏览器）');
  console.log('等待授权回调中…');

  const cmd = process.platform === 'win32' ? `start "" "${authUrl}"`
    : process.platform === 'darwin' ? `open "${authUrl}"`
      : `xdg-open "${authUrl}"`;
  exec(cmd, () => { /* 打不开就算了，用户手动复制 */ });
});

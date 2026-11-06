#!/usr/bin/env node
/* ============================================================
 * gmail-token.js —— 一次性脚本：拿到 Gmail API 的 refresh_token
 *
 * 为什么需要它：Gmail API 走 HTTPS(443)，云服务器（Render 等）也能连，
 * 而且信是由 Google 发出并签名的，SPF/DKIM 天然通过，QQ/163 能正常收。
 * 但 OAuth 授权必须在有浏览器的机器上点一次"同意"，所以这个脚本跑在你电脑上。
 *
 * 用法（在项目根目录）：
 *   node tools/gmail-token.js --id <CLIENT_ID> --secret <CLIENT_SECRET> [--user 你的@gmail.com]
 *
 * 代理说明：
 *   大陆网络下浏览器能开 Google，但 Node 的 fetch 不读系统代理，直连会超时。
 *   本脚本自动读取 Windows 注册表的系统代理（如 127.0.0.1:7890），并用 curl 发请求。
 *   也可用 --proxy http://127.0.0.1:7890 或环境变量 GMAIL_OAUTH_PROXY 手动指定；
 *   直连环境用 --proxy none 关闭。
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
const { exec, execFileSync } = require('child_process');

const argv = process.argv.slice(2);
const arg = name => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? String(argv[i + 1] || '') : '';
};

const CLIENT_ID = arg('id') || process.env.GMAIL_CLIENT_ID || '';
const CLIENT_SECRET = arg('secret') || process.env.GMAIL_CLIENT_SECRET || '';
const GMAIL_USER = arg('user') || '';
const NO_BROWSER = argv.includes('--no-browser');
const PORT = Number(arg('port') || 8765);
const REDIRECT = `http://127.0.0.1:${PORT}`;
// 只请求发信 + 邮箱地址：不要带 openid，否则 Google 会走 OIDC 流程，
// 在范围未登记时会静默把 gmail.send 丢掉，只回 email/openid。
const SCOPE = 'https://www.googleapis.com/auth/gmail.send email';

/* ---------------- 代理探测 ---------------- */
function detectProxy() {
  const manual = arg('proxy') || process.env.GMAIL_OAUTH_PROXY || '';
  if (manual) return /^(none|off|0)$/i.test(manual) ? '' : manual;
  if (process.platform === 'win32') {
    try {
      const out = execFileSync('reg', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
      ], { encoding: 'utf8', windowsHide: true });
      if (/ProxyEnable\s+REG_DWORD\s+0x1\b/.test(out)) {
        const m = out.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
        if (m) return /^https?:\/\//i.test(m[1]) ? m[1] : 'http://' + m[1];
      }
    } catch (e) { /* 某些环境禁止调用 reg.exe，走下面的端口探测 */ }
  }
  // 兜底：探测常见本地代理端口（Clash / V2Ray / SSR 等）
  for (const p of [7890, 10809, 1080, 8888, 10808, 20171]) {
    const candidate = 'http://127.0.0.1:' + p;
    try {
      execFileSync('curl', ['-sS', '-m', '3', '-x', candidate,
        'https://oauth2.googleapis.com/token'], { stdio: 'ignore', windowsHide: true });
      console.log('[proxy] 探测到可用代理：' + candidate);
      return candidate;
    } catch (e) { /* 这个端口不通，试下一个 */ }
  }
  return '';
}
const PROXY = detectProxy();

/* ---------------- 走 curl 的 HTTP 请求 ---------------- */
function curlJson(extraArgs, url) {
  const args = ['-sS', '-m', '45'];
  if (PROXY) args.push('-x', PROXY);
  args.push(...extraArgs, url);
  const out = execFileSync('curl', args, { encoding: 'utf8', windowsHide: true });
  if (!out || !out.trim()) throw new Error('curl 返回空响应（代理可能不可用）');
  return JSON.parse(out);
}

function postToken(params) {
  const extra = ['-X', 'POST'];
  for (const [k, v] of Object.entries(params)) extra.push('--data-urlencode', `${k}=${v}`);
  return curlJson(extra, 'https://oauth2.googleapis.com/token');
}

function getUserInfo(accessToken) {
  return curlJson(['-H', 'Authorization: Bearer ' + accessToken],
    'https://www.googleapis.com/oauth2/v2/userinfo');
}

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('');
  console.error('用法：node tools/gmail-token.js --id <CLIENT_ID> --secret <CLIENT_SECRET>');
  console.error('（在 Google Auth Platform → 客户端 里能看到）');
  console.error('');
  process.exit(1);
}

const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT,
  response_type: 'code',
  scope: SCOPE,
  access_type: 'offline',
  prompt: 'consent'              // 强制返回 refresh_token（否则第二次授权就没有了）
}).toString().replace(/\+/g, '%20');   // scope 分隔符用 %20，别用 + 免得被当成字面量

function page(title, body) {
  return `<!DOCTYPE html><meta charset="utf-8"><title>${title}</title>
  <body style="font-family:system-ui,'Microsoft YaHei';background:#0f1726;color:#e8eef7;
    display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="max-width:620px;padding:28px;border:1px solid #34508a;border-radius:16px;background:#131c2b">
  <h2 style="margin:0 0 12px">${title}</h2><div style="line-height:1.8;font-size:14px">${body}</div></div></body>`;
}

/* 错误/成功同时打印到控制台：后台运行时不用看浏览器页面也能查原因 */
function done(res, title, body, ok) {
  console.log((ok ? '✅ ' : '❌ ') + title + '：' + body);
  try {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(title, body));
  } catch (e) { /* ignore */ }
  server.close();
  if (!ok) process.exitCode = 1;
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (u.pathname !== '/') { res.writeHead(404); res.end(); return; }

  const err = u.searchParams.get('error');
  const code = u.searchParams.get('code');
  const returnedScope = u.searchParams.get('scope') || '';
  if (err) return done(res, 'Authorization denied', `授权被拒绝：${err}`, false);
  if (!code) return done(res, 'No code', '没有拿到 code，请重新运行脚本。', false);

  try {
    const j = postToken({
      code,
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code'
    });

    if (j.error || !j.refresh_token) {
      const why = j.error_description || j.error || '响应里没有 refresh_token';
      return done(res, 'Exchange failed', `换取 refresh_token 失败：${why}`, false);
    }

    const granted = String(j.scope || returnedScope || '');
    if (!/gmail\.send/.test(granted)) {
      return done(res, 'Scope missing',
        `授权结果里【没有 gmail.send】，实际只拿到：${granted || '(空)'}。` +
        '原因通常是 Google Auth Platform → 数据访问 里没登记该范围（或没点 Save），' +
        '或「API 和服务 → 库 → Gmail API」未启用。请补好后重新运行本脚本。', false);
    }

    let email = GMAIL_USER || '(请手动填你授权的 Gmail 地址)';
    try {
      const info = getUserInfo(j.access_token);
      if (info && info.email) email = info.email;
    } catch (e) { /* 拿不到邮箱不影响 refresh_token */ }

    console.log('');
    console.log('============================================================');
    console.log('✅ 授权成功，授权的账号：', email);
    console.log('   已授予范围：', granted);
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
    done(res, 'Error', '请求 Google 失败：' + (e && e.message) +
      (PROXY ? `（当前代理 ${PROXY}）` : '（当前直连，若需代理请加 --proxy http://127.0.0.1:7890）'), false);
  }
});

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
  console.log('代理：' + (PROXY || '(直连)'));
  console.log('⚠️ 授权前请确认：Google Auth Platform → 数据访问 → 「您的敏感范围」里');
  console.log('   已有 https://www.googleapis.com/auth/gmail.send，且 Gmail API 已启用。');
  console.log('   否则授权只会给到「邮箱地址」，拿不到发信权限。');
  console.log('');
  console.log('第 1 步：在下面的地址里用你的 Gmail 登录并点「继续/允许」');
  console.log('');
  console.log(authUrl);
  console.log('');
  console.log('（已经尝试自动打开浏览器；打不开就手动复制上面这行到浏览器）');
  console.log('等待授权回调中…');

  if (NO_BROWSER) { console.log('（--no-browser：未自动打开浏览器）'); return; }
  const cmd = process.platform === 'win32' ? `start "" "${authUrl}"`
    : process.platform === 'darwin' ? `open "${authUrl}"`
      : `xdg-open "${authUrl}"`;
  exec(cmd, () => { /* 打不开就算了，用户手动复制 */ });
});

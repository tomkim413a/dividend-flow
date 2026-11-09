/* 本地真实服务端端到端验证：静态资源 + 账号 API + 联机组件 + 安全黑名单 */
'use strict';
const BASE = 'http://127.0.0.1:3399';
let pass = 0, fail = 0;
const ck = (n, c, x) => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (x ? ' -> ' + x : '')); } };

(async () => {
  // 1. 静态资源与新版指纹
  const html = await (await fetch(BASE + '/')).text();
  ck('首页可访问且含「重试连接」按钮', html.includes('lobby-retry'));
  ck('首页引用新版脚本顺序正确', /js\/bgm\.js/.test(html) && /js\/online\.js/.test(html));

  const bgm = await (await fetch(BASE + '/js/bgm.js')).text();
  ck('线上式静态托管返回新版 bgm.js（v3 存档）', bgm.includes('cf_bgm_on_v3'));
  ck('旧状态机已彻底移除', !bgm.includes('swapToBlob') && !bgm.includes('mutedFallback') && !bgm.includes('prefetchArmed'));
  ck('保留「点击页面任意处开启背景音乐」提示', bgm.includes('点击页面任意处开启背景音乐'));

  const ol = await (await fetch(BASE + '/js/online.js')).text();
  ck('返回新版 online.js', ol.includes('setLobbyFailed'));
  ck('已移除 wakeUp / ensureReady 预热', !ol.includes('wakeUp') && !ol.includes('ensureReady'));
  ck('已移除「正在连接服务器」遮罩逻辑', !ol.includes('btnState(') && !ol.includes("'⏳ 正在连接服务器…'"));

  const sfx = await (await fetch(BASE + '/js/sfx.js')).text();
  ck('音效模块不再因 BGM 缺失而全哑', sfx.includes('!window.BGM || window.BGM.on !== false'));

  const audio = await fetch(BASE + '/BGM/bgm-setup.mp3', { headers: { Range: 'bytes=0-1023' } });
  ck('BGM 音频可访问（支持 Range 边下边播）', audio.status === 200 || audio.status === 206);

  // 2. 联机组件脚本
  const proto = await fetch(BASE + '/protocol.js');
  ck('/protocol.js 可访问', proto.status === 200 && (await proto.text()).includes('CREATE_ROOM'));
  const sio = await fetch(BASE + '/socket.io/socket.io.js');
  ck('/socket.io/socket.io.js 可访问', sio.status === 200);
  const net = await (await fetch(BASE + '/js/net.js')).text();
  ck('net.js 保留握手超时', net.includes('连接服务器超时'));

  // 3. 健康与账号 API
  const h = await (await fetch(BASE + '/api/health')).json();
  ck('/api/health 正常', h.ok === true && h.mailEnabled === false);

  const name = 't' + Date.now().toString().slice(-8);
  const reg = await (await fetch(BASE + '/api/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, email: name + '@example.com', password: '1234', secQ: '我的宠物', secA: '小猫' })
  })).json();
  ck('注册（含密保）成功', reg.ok === true, JSON.stringify(reg));

  const login = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: '1234' })
  })).json();
  ck('登录成功并返回 token', !!login.token, JSON.stringify(login));

  const me = await (await fetch(BASE + '/api/me', {
    headers: { Authorization: 'Bearer ' + login.token }
  })).json();
  ck('/api/me 可校验登录态', !!me.user && me.user.username === name);

  const q = await (await fetch(BASE + '/api/recover/question', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name })
  })).json();
  ck('密保问题可获取', q.q === '我的宠物', JSON.stringify(q));

  const rst = await (await fetch(BASE + '/api/recover/reset', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, answer: '小猫', password: '5678' })
  })).json();
  ck('密保重置密码成功', rst.ok === true, JSON.stringify(rst));

  const login2 = await (await fetch(BASE + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: name, password: '5678' })
  })).json();
  ck('新密码可登录', !!login2.token);

  // 4. 静态资源黑名单（安全）
  for (const p of ['/server/db.js', '/package.json', '/DEPLOY.md', '/.env']) {
    const r = await fetch(BASE + p);
    ck('敏感路径已拦截 ' + p, r.status === 404);
  }

  console.log('\n========================================');
  console.log(`  本地端到端：${pass} 通过 / ${fail} 失败`);
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('端到端异常：', e); process.exit(2); });

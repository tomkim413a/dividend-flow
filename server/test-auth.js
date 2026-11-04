/* 验证：注册(邮箱) → 登录 → 找回密码 → 重置 → 新密码登录 */
'use strict';
const BASE = process.env.URL || 'http://localhost:3000';

async function post(p, body) {
  const r = await fetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {})
  });
  return r.json();
}

(async () => {
  const name = 'au' + Math.random().toString(36).slice(2, 7);
  const email = name + '@example.com';

  const reg = await post('/api/register', { username: name, email, password: '123456' });
  console.log('register:', JSON.stringify(reg));
  if (reg.err) throw new Error('注册失败：' + reg.err);
  if (reg.token) throw new Error('注册不应直接返回 token（应跳转登录）');

  const dup = await post('/api/register', { username: name + 'x', email, password: '123456' });
  console.log('重复邮箱:', dup.err || '(未拦截!)');

  const lg = await post('/api/login', { username: name, password: '123456' });
  console.log('login:', lg.err ? lg.err : 'OK token=' + !!lg.token);
  if (!lg.token) throw new Error('登录失败');

  // 用户名与邮箱不匹配 → 不应发信（不返回 devLink）
  const fgBad = await post('/api/forgot', { email, username: name + 'zzz' });
  console.log('用户名不匹配:', fgBad.devLink ? '仍返回链接(异常)' : '未发信(符合预期)');

  const fg = await post('/api/forgot', { email, username: name });
  console.log('forgot:', JSON.stringify({ ok: fg.ok, warn: fg.warn, hasLink: !!fg.devLink }));
  if (!fg.devLink) throw new Error('未返回重置链接（本地应返回 devLink）');

  const link = /^https?:/i.test(fg.devLink) ? fg.devLink : BASE + fg.devLink;
  const token = new URL(link).searchParams.get('token');
  const rs = await post('/api/reset', { token, password: 'abcdef' });
  console.log('reset:', rs.err || 'OK');
  if (rs.err) throw new Error(rs.err);

  const oldLg = await post('/api/login', { username: name, password: '123456' });
  const newLg = await post('/api/login', { username: name, password: 'abcdef' });
  console.log('旧密码登录:', oldLg.err || '仍然成功(异常)');
  console.log('新密码登录:', newLg.err ? newLg.err : 'OK');

  const reuse = await post('/api/reset', { token, password: 'zzzzzz' });
  console.log('令牌复用:', reuse.err || '仍然可用(异常)');

  const ok = !oldLg.token && !!newLg.token && !!reuse.err && !!dup.err && !fgBad.devLink;
  console.log(ok ? '\n✅ 注册/登录/找回/重置 全部符合预期' : '\n❌ 有不符合预期的项');
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('异常：', e.message); process.exit(1); });

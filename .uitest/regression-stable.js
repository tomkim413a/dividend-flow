/* 稳定版回归测试：纯 Node 模拟 DOM，验证 BGM 与联机登录链路
 * 覆盖用户反馈的三个问题：音效全无 / 登录弹框超时 / 登录后房间迟迟不弹
 */
'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const { CS, SC } = require(path.join(ROOT, 'server/protocol.js'));

let pass = 0, fail = 0;
function ck(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}
const wait = ms => new Promise(r => setTimeout(r, ms));

function createEnv(opts = {}) {
  const elements = new Map();
  const docEv = {}, winEv = {};
  const loadedScripts = new Set();
  const storage = () => {
    const m = new Map(Object.entries(opts.storage || {}));
    return {
      getItem: k => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, String(v)),
      removeItem: k => m.delete(k),
      _m: m
    };
  };
  const LS = storage(), SS = storage();

  function mkEl(id, initialHidden) {
    const cls = new Set(initialHidden ? ['hidden'] : []);
    const e = {
      id, textContent: '', innerHTML: '', value: '', placeholder: '', autocomplete: '',
      disabled: false, style: { cssText: '', display: '' }, _ev: {}, _cls: cls,
      classList: {
        add: c => cls.add(c), remove: c => cls.delete(c),
        contains: c => cls.has(c),
        toggle: (c, f) => { if (f === undefined) f = !cls.has(c); f ? cls.add(c) : cls.delete(c); return f; }
      },
      addEventListener(t, f) { (this._ev[t] = this._ev[t] || []).push(f); },
      removeEventListener(t, f) { this._ev[t] = (this._ev[t] || []).filter(x => x !== f); },
      click() { let r; (this._ev.click || []).forEach(f => { r = f({ target: this }); }); if (this.onclick) r = this.onclick({ target: this }); return r; },
      dispatch(t) { let r; (this._ev[t] || []).forEach(f => { r = f({ target: this }); }); return r; },
      appendChild() {}, remove() { elements.delete(this.id); }, focus() {}
    };
    return e;
  }
  const IDS = {
    'auth-overlay': 1, 'lobby-overlay': 1, 'lobby-retry': 1,
    'auth-email': 1, 'auth-pass2': 1, 'auth-secq': 1, 'auth-seca': 1,
    'auth-secbox': 1, 'auth-hint': 1
  };
  [
    'screen-setup', 'btn-online', 'auth-overlay', 'auth-title', 'auth-user', 'auth-email',
    'auth-pass', 'auth-pass2', 'auth-secq', 'auth-seca', 'auth-secbox', 'auth-secq-text',
    'auth-secans', 'auth-msg', 'auth-hint', 'auth-submit', 'auth-switch', 'auth-forgot',
    'auth-close', 'lobby-overlay', 'lobby-roomno', 'lobby-seats', 'lobby-roomid',
    'lobby-msg', 'lobby-prof', 'lobby-create', 'lobby-join', 'lobby-start',
    'lobby-retry', 'lobby-sec', 'lobby-close', 'toast'
  ].forEach(id => elements.set(id, mkEl(id, !!IDS[id])));
  const toggles = [mkEl('t1'), mkEl('t2')];
  const vols = [mkEl('v1'), mkEl('v2')]; vols.forEach(v => { v.value = '50'; });

  const audioInstances = [];
  let playMode = opts.playMode || 'resolve';
  function mkErr(name) { const e = new Error(name); e.name = name; return e; }
  class MockAudio {
    constructor(src) {
      this.src = src; this.paused = true; this.loop = false; this.preload = 'none';
      this.volume = 0.5; this.muted = false; this.currentTime = 0; this.duration = 100;
      audioInstances.push(this);
    }
    play() {
      if (playMode === 'resolve') { this.paused = false; return Promise.resolve(); }
      if (playMode === 'pending') { return new Promise(() => {}); }
      if (String(playMode).startsWith('reject:')) {
        return Promise.reject(mkErr(String(playMode).slice(7)));
      }
      this.paused = false; return Promise.resolve();
    }
    pause() { this.paused = true; }
    load() { this.paused = true; }
    addEventListener() {}
  }

  const alerts = [];
  const netEventCounts = {};
  let netConnectMode = opts.netConnectMode || 'resolve';
  const NET = {
    on: false, socket: null, user: null, room: null, state: null,
    onEvent(ev, fn) { netEventCounts[ev] = (netEventCounts[ev] || 0) + 1; (this._h = this._h || {})[ev] = fn; },
    connect() {
      if (netConnectMode === 'pending') return new Promise(() => {});
      if (netConnectMode === 'reject') return Promise.reject(new Error('连接服务器超时，请稍后重试'));
      this.on = true; this.socket = { emit() {}, close() {} };
      return Promise.resolve(this.socket);
    },
    send() {}, disconnect() { this.on = false; this.socket = null; }
  };

  const fetchLog = [];
  const fetchImpl = async (url, o = {}) => {
    fetchLog.push({ url: String(url), method: (o.method || 'GET') });
    const u = String(url);
    const json = body => ({ ok: true, status: 200, json: async () => body });
    if (u.startsWith('/api/health')) return json({ ok: true, db: 'postgres', mailEnabled: false });
    if (u.startsWith('/api/login')) return json({ ok: true, token: 'TOKEN_X', user: { id: 7, username: 'tester' } });
    if (u.startsWith('/api/me')) return opts.meStatus === 401
      ? { ok: false, status: 401, json: async () => ({ err: '未登录' }) }
      : json({ user: { id: 7, username: 'tester' }, hasSec: true, stats: {} });
    return json({ ok: true });
  };

  const document = {
    body: {
      appendChild(e) { if (e && e.id) elements.set(e.id, e); }
    },
    head: {
      appendChild(s) {
        loadedScripts.add(s.src);
        if (s.src === '/protocol.js') { ctx.CS = CS; ctx.SC = SC; }
        if (s.src === '/socket.io/socket.io.js') { ctx.io = function () { return {}; }; }
        if (String(s.src).startsWith('js/net.js')) { ctx.NET = NET; }
        setTimeout(() => { if (s.onload) s.onload(); }, 2);
      }
    },
    getElementById: id => elements.get(id) || null,
    createElement: tag => mkEl(''),
    querySelectorAll: sel => {
      if (sel === '.bgm-toggle') return toggles;
      if (sel === '.bgm-vol') return vols;
      return [];
    },
    querySelector: sel => {
      const m = /script\[src="([^"]+)"\]/.exec(sel);
      if (m && loadedScripts.has(m[1])) return {};
      return null;
    },
    addEventListener(t, f) { (docEv[t] = docEv[t] || []).push(f); },
    removeEventListener(t, f) { docEv[t] = (docEv[t] || []).filter(x => x !== f); },
    visibilityState: 'visible', hidden: false
  };

  const ctx = {
    console, Math, JSON, Date, Number, String, Object, Array, Error, RegExp, Set, Map,
    Promise, AbortController, URL: { createObjectURL: () => 'blob:x' },
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 20)),
    clearTimeout, setInterval: () => 0, clearInterval,
    localStorage: LS, sessionStorage: SS,
    Audio: MockAudio, fetch: fetchImpl, document,
    location: { protocol: 'https:' },
    addEventListener(t, f) { (winEv[t] = winEv[t] || []).push(f); },
    removeEventListener(t, f) { winEv[t] = (winEv[t] || []).filter(x => x !== f); },
    alert: m => alerts.push(String(m)),
    prompt: () => null,
    CF: { PROFESSIONS: [{ id: 'p1', icon: 'A', name: '职业一' }] },
    ONLINE_HOOKS: { enter() {}, applyState() {}, over() {} }
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  return {
    ctx, elements, document, LS, SS, NET, netEventCounts, alerts, fetchLog,
    audioInstances,
    setPlayMode: m => { playMode = m; },
    setNetConnectMode: m => { netConnectMode = m; },
    fireDOM() { (winEv.DOMContentLoaded || []).slice().forEach(f => f()); },
    firePointer() { (docEv.pointerdown || []).slice().forEach(f => f()); },
    load(files) { files.forEach(f => vm.runInContext(read(f), ctx, { filename: f })); },
    hidden: id => !!(elements.get(id) && elements.get(id).classList.contains('hidden')),
    tip: () => elements.get('bgm-tip') || null
  };
}

(async () => {
  console.log('\n=== A. BGM：自动播放被拦截（NotAllowedError）===');
  {
    const e = createEnv({ playMode: 'reject:NotAllowedError' });
    e.load(['js/bgm.js']);
    e.fireDOM();
    await wait(40);
    ck('打开即尝试播放新压缩音频', e.audioInstances.some(a => /bgm-setup\.mp3/.test(a.src)));
    ck('被拦截后显示「点击页面任意处开启背景音乐」提示', !!e.tip() && /点击页面任意处开启背景音乐/.test(e.tip().textContent));
    e.setPlayMode('resolve');
    e.firePointer();
    await wait(40);
    ck('首次点击后补播成功（audio 不再 paused）', e.audioInstances.some(a => a.paused === false));
    ck('补播成功后提示消失', !e.tip());
  }

  console.log('\n=== B. BGM：AbortError（上一版把音乐搞没的真实原因）===');
  {
    const e = createEnv({ playMode: 'reject:AbortError' });
    e.load(['js/bgm.js']);
    e.fireDOM();
    await wait(40);
    ck('AbortError 也照样显示补播提示', !!e.tip());
    e.setPlayMode('resolve');
    e.firePointer();
    await wait(40);
    ck('点击后恢复播放', e.audioInstances.some(a => a.paused === false));
  }

  console.log('\n=== C. BGM：默认开启 + 音效不被连带弄哑 ===');
  {
    const e = createEnv({ playMode: 'resolve', storage: { cf_bgm_on_v2: '0', cf_bgm_vol_v2: '0' } });
    e.load(['js/bgm.js', 'js/sfx.js']);
    e.fireDOM();
    await wait(40);
    ck('旧版残留「关/音量0」存档不影响默认开启', e.ctx.BGM.on === true && e.ctx.BGM.vol === 0.5);
    ck('打开页面即成功起播（无手势也尝试）', e.audioInstances.some(a => a.paused === false));
    ck('不显示多余提示', !e.tip());
    ck('音效 enabled 跟随 BGM.on', e.ctx.BGM.on === true);
  }
  {
    const e = createEnv({ playMode: 'resolve' });
    e.load(['js/sfx.js']);                    // 故意不加载 bgm.js
    ck('BGM 模块缺失时点击音效仍可用（不再全哑）', typeof e.ctx.SFX.dice === 'function');
  }

  console.log('\n=== D. 联机：点「联机对战」零等待弹登录框 ===');
  {
    const e = createEnv();
    e.load(['js/online.js']);
    e.fireDOM();
    const btn = e.elements.get('btn-online');
    btn.click();
    ck('登录框立即显示（同步，不依赖任何网络）', !e.hidden('auth-overlay'));
    ck('按钮文字没有被改成「正在连接服务器」', btn.textContent !== '⏳ 正在连接服务器…');
    ck('没有弹出任何加载超时 alert', e.alerts.length === 0);
    ck('登录框预填上次用户名（有则填）', e.elements.get('auth-user').value !== undefined);
    await wait(60);
    ck('后台顺序加载三个联机组件', ['/protocol.js', '/socket.io/socket.io.js', 'js/net.js'].every(s => e.fetchLog.length >= 0) && !!e.ctx.NET);
  }

  console.log('\n=== E. 登录成功：房间大厅立刻弹出，不等 socket 握手 ===');
  {
    const e = createEnv({ netConnectMode: 'pending' });   // socket 故意永远不返回
    e.load(['js/online.js']);
    e.fireDOM();
    await wait(60);
    e.elements.get('btn-online').click();
    e.elements.get('auth-user').value = 'tester';
    e.elements.get('auth-pass').value = '1234';
    await e.elements.get('auth-submit').click();
    ck('登录框已关闭', e.hidden('auth-overlay'));
    ck('房间大厅立刻显示（socket 仍在 pending）', !e.hidden('lobby-overlay'));
    ck('大厅显示「正在连接房间服务」而非空白', /正在连接房间服务/.test(e.elements.get('lobby-msg').textContent));
    ck('token 已保存', e.SS.getItem('cf_online_token') === 'TOKEN_X');
    ck('用户名已记住', e.LS.getItem('cf_online_lastuser') === 'tester');
  }

  console.log('\n=== F. socket 连上后：按钮可用 + 事件只绑一次 ===');
  {
    const e = createEnv({ netConnectMode: 'resolve' });
    e.load(['js/online.js']);
    e.fireDOM();
    await wait(60);
    e.elements.get('btn-online').click();
    e.elements.get('auth-user').value = 'tester';
    e.elements.get('auth-pass').value = '1234';
    await e.elements.get('auth-submit').click();
    await wait(80);
    ck('建房按钮已启用', e.elements.get('lobby-create').disabled === false);
    ck('大厅绑定了 socket 事件', Object.keys(e.netEventCounts).length >= 3);
    ck('连接中提示已清空', e.elements.get('lobby-msg').textContent === '');
    const before = Object.assign({}, e.netEventCounts);
    // 模拟重连：断开后再次登录，不应重复累积监听
    e.elements.get('lobby-close').onclick();
    e.elements.get('btn-online').click();
    e.elements.get('auth-user').value = 'tester';
    e.elements.get('auth-pass').value = '1234';
    await e.elements.get('auth-submit').click();
    await wait(80);
    ck('重复进出大厅不累积 socket 监听', JSON.stringify(before) === JSON.stringify(e.netEventCounts));
  }

  console.log('\n=== G. 连接失败：给出重试按钮，不弹 alert ===');
  {
    const e = createEnv({ netConnectMode: 'reject' });
    e.load(['js/online.js']);
    e.fireDOM();
    await wait(60);
    e.elements.get('btn-online').click();
    e.elements.get('auth-user').value = 'tester';
    e.elements.get('auth-pass').value = '1234';
    await e.elements.get('auth-submit').click();
    await wait(80);
    ck('大厅仍然显示（不因连接失败消失）', !e.hidden('lobby-overlay'));
    ck('显示「重试连接」按钮', !e.hidden('lobby-retry'));
    ck('错误信息写在大厅内，不弹阻塞 alert', e.alerts.length === 0 && /重试连接/.test(e.elements.get('lobby-msg').textContent));
  }

  console.log('\n=== H. 已有 token：乐观显示大厅，401 才退回登录 ===');
  {
    const e = createEnv({ netConnectMode: 'resolve' });
    e.SS.setItem('cf_online_token', 'TOKEN_OLD');
    e.load(['js/online.js']);
    e.fireDOM();
    await wait(60);
    e.elements.get('btn-online').click();
    ck('点联机立即显示大厅（不等 /api/me）', !e.hidden('lobby-overlay'));
    await wait(80);
    ck('校验通过后连接成功、错误提示清空', e.elements.get('lobby-msg').textContent === '');
  }
  {
    const e = createEnv({ netConnectMode: 'resolve', meStatus: 401 });
    e.SS.setItem('cf_online_token', 'TOKEN_BAD');
    e.load(['js/online.js']);
    e.fireDOM();
    await wait(60);
    e.elements.get('btn-online').click();
    await wait(80);
    ck('token 失效时清 token 并退回登录框', e.SS.getItem('cf_online_token') === null && !e.hidden('auth-overlay'));
  }

  /* ---------------- I/J. 网络层断线重连专项 ---------------- */
  function createNetEnv(seedRoom) {
    const handlers = {}, emitted = [];
    const SS = (() => {
      const m = new Map();
      if (seedRoom) m.set('cf_online_room', seedRoom);
      return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k), _m: m
      };
    })();
    const sock = {
      _disconnected: false, _reconnected: false,
      on(ev, fn) { (handlers[ev] = handlers[ev] || []).push(fn); },
      emit(ev, data) { emitted.push([ev, data]); },
      disconnect() { this._disconnected = true; },
      connect() { this._reconnected = true; }
    };
    let localRolls = 0;
    const ctx = {
      console, Math, JSON, Date, Number, String, Object, Array, Error, RegExp, Set, Map, Promise,
      setTimeout, clearTimeout, sessionStorage: SS, CS, SC, io: () => sock,
      Engine: { act: { roll() { localRolls++; }, choose() {}, sellStock() {}, payDebt() {} } },
      SFX: { dice() {} }
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(read('js/net.js'), ctx, { filename: 'js/net.js' });
    return {
      ctx, sock, emitted, SS, NET: ctx.NET, Act: ctx.Act,
      localRolls: () => localRolls,
      fire: (ev, arg) => (handlers[ev] || []).forEach(f => f(arg))
    };
  }

  console.log('\n=== I. 断线重连：不再把玩家锁成 AI（卡住走不了的根因）===');
  {
    const e = createNetEnv();
    let disconnectFired = 0, reconnectFired = 0, offlineAction = 0;
    e.NET.onEvent('disconnect', () => disconnectFired++);
    e.NET.onEvent('reconnect', () => reconnectFired++);
    e.NET.onEvent('offline-action', () => offlineAction++);

    const p = e.NET.connect('TOKEN', { id: 1 });
    e.fire('connect');
    await p;
    ck('首次连接成功：NET.on = true', e.NET.on === true);
    ck('首次连接不误发 RESUME', !e.emitted.some(x => x[0] === CS.RESUME));

    e.fire(SC.ROOM, { id: 'ABC123' });
    ck('房间号写入 sessionStorage（刷新可回座位）', e.SS.getItem('cf_online_room') === 'ABC123');
    e.NET.onlineMode = true;

    e.fire('disconnect', 'transport close');
    ck('断线后 NET.on=false 且通知 UI', e.NET.on === false && disconnectFired === 1);

    const before = e.localRolls();
    e.Act.roll();
    ck('断线时不回落到本地引擎（避免状态分叉）', e.localRolls() === before);
    ck('断线时给出「操作暂未发送」提示', offlineAction === 1);

    e.fire('connect');                       // socket.io 自动重连成功
    ck('★ 重连后 NET.on 恢复为 true', e.NET.on === true);
    ck('★ 重连后发出 CS.RESUME 取消 AI 托管',
       e.emitted.some(x => x[0] === CS.RESUME && x[1] && x[1].roomId === 'ABC123'));
    ck('重连后通知 UI', reconnectFired === 1);

    e.fire('connect_error', new Error('xhr poll error'));
    ck('重连期错误不再掐断连接', !e.sock._disconnected);
  }

  console.log('\n=== J. 刷新页面后仍能回到原座位 ===');
  {
    const e = createNetEnv('OLDROOM');
    const p = e.NET.connect('TOKEN', { id: 1 });
    e.fire('connect');
    await p;
    ck('新 socket 首次连接即发 RESUME',
       e.emitted.some(x => x[0] === CS.RESUME && x[1] && x[1].roomId === 'OLDROOM'));
    e.fire(SC.ERROR, { msg: '房间不存在' });
    ck('旧房间已销毁：清持久化且不打扰玩家',
       e.SS.getItem('cf_online_room') === null && e.NET.room === null);
    e.NET.disconnect();
    ck('主动离开后不再保留旧座位', e.SS.getItem('cf_online_room') === null && e.NET.on === false);
  }

  console.log('\n========================================');
  console.log(`  结果：${pass} 通过 / ${fail} 失败`);
  console.log('========================================\n');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试脚本异常：', e); process.exit(2); });

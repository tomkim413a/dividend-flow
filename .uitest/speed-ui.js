/* ============================================================
 * speed-ui.js —— js/speed.js 的 DOM 桩回归（纯 Node，无需浏览器 / 服务端）
 *
 * 重点验证两个模式之间的隔离：
 *   · 单机：change → 改 CF.TIMING + 写 localStorage + 三处控件同步
 *   · 联机：change → 交给 online.js 的 handler，绝不写本机存档；
 *          服务端广播回来才 syncFromServer；失败 rollback；离开联机 restoreLocal
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');

let pass = 0, fail = 0;
const ck = (n, ok, d) => { ok ? pass++ : fail++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${n}${d ? '  → ' + d : ''}`); };

function mkEl(id) {
  const listeners = {};
  const el = {
    id, value: '', disabled: false, textContent: '', options: [],
    set innerHTML(html) {
      this.options = Array.from(String(html).matchAll(/value="([^"]+)"/g), m => m[1]);
      if (!this.value && this.options.length) this.value = this.options[0];
    },
    get innerHTML() { return ''; },
    addEventListener(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); },
    fire(ev) { (listeners[ev] || []).forEach(f => f()); }
  };
  return el;
}

const selects = ['setup-speed', 'game-speed', 'lobby-speed'].map(mkEl);
const hints = ['setup-speed-hint', 'game-speed-hint', 'lobby-speed-hint'].map(mkEl);
const elements = new Map([...selects, ...hints].map(e => [e.id, e]));
const data = new Map();
const localStorage = {
  getItem: k => (data.has(k) ? data.get(k) : null),
  setItem: (k, v) => data.set(k, String(v)),
  removeItem: k => data.delete(k)
};

const sandbox = {
  console, setTimeout, clearTimeout, localStorage,
  document: {
    readyState: 'complete',                         // 让 init() 立即执行
    querySelectorAll: sel => (sel === '[data-speed-select]' ? selects : []),
    getElementById: id => elements.get(id) || null,
    addEventListener() {}
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/data.js', 'js/speed.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CF = sandbox.CF, S = sandbox.SpeedUI;
const vals = () => selects.map(s => s.value).join(',');
const change = (key, idx) => { selects[idx].value = key; selects[idx].fire('change'); };

console.log('\n===== A 初始化与单机模式 =====');
ck('SpeedUI 模块已导出', !!S && !!CF.applySpeed);
ck('默认档位「舒缓」', CF.TIMING.speed === 'relaxed' && S.current() === 'relaxed', CF.TIMING.speed);
ck('三个下拉都填充了 3 档（极快已取消）', selects.every(s => s.options.length === 3), selects.map(s => s.options.length).join(','));
ck('★ 下拉里不再有 fast / 极快档', selects.every(s => !s.options.includes('fast')), selects[0].options.join(','));
ck('normal 档中文名已改为「快速」（key 保持兼容）',
  CF.SPEED_PRESETS.some(p => p.key === 'normal' && /快速/.test(p.label)) &&
  !CF.SPEED_PRESETS.some(p => /极快/.test(p.label)));
ck('三个下拉初始值同步', vals() === 'relaxed,relaxed,relaxed', vals());
ck('三处提示文案已填充', hints.every(h => /每格|AI 每手/.test(h.textContent)), hints[0].textContent);

const hold0 = CF.TIMING.walkHold;
change('slow', 0);
ck('★ 单机切换立即改变引擎节奏', CF.TIMING.speed === 'slow' && CF.TIMING.walkHold > hold0,
  `${hold0} → ${CF.TIMING.walkHold}`);
ck('★ 三个界面同步为新档位', vals() === 'slow,slow,slow', vals());
ck('档位写入 localStorage', localStorage.getItem('cf_speed_v1') === 'slow', localStorage.getItem('cf_speed_v1'));

change('normal', 2);          // 顶栏换档同样生效
ck('顶栏下拉也能改档并持久化', CF.TIMING.speed === 'normal' && localStorage.getItem('cf_speed_v1') === 'normal', vals());

console.log('\n===== B 联机模式：handler / 广播 / 回滚 / 离开恢复 =====');
let sent = null;
S.setHandler(key => { sent = key; });            // 模拟 online.js 接管
change('slow', 1);
ck('★ 联机切换交给 handler（带正确档位）', sent === 'slow', String(sent));
ck('★ 联机切换不写本机存档', localStorage.getItem('cf_speed_v1') === 'normal', localStorage.getItem('cf_speed_v1'));

// 模拟 online.js：乐观更新本地节奏，再等服务端广播
S.applyLocal('slow', false);
ck('乐观更新后引擎节奏已变、存档仍未动', CF.TIMING.speed === 'slow' && localStorage.getItem('cf_speed_v1') === 'normal');
S.syncFromServer('slow');
ck('★ 服务端广播覆盖客户端显示', CF.TIMING.speed === 'slow' && vals() === 'slow,slow,slow', vals());
ck('广播同样不污染本机存档', localStorage.getItem('cf_speed_v1') === 'normal', localStorage.getItem('cf_speed_v1'));

S.rollback();
ck('发送失败可回滚到服务端最近档位', CF.TIMING.speed === 'slow' && vals() === 'slow,slow,slow', vals());

S.disable(['lobby-speed', 'game-speed'], true);
ck('非房主可禁用大厅与顶栏下拉',
  selects[1].disabled && selects[2].disabled && !selects[0].disabled,
  selects.map(s => s.disabled).join(','));

S.restoreLocal();
ck('★ 离开联机后恢复玩家自己的单机档位', CF.TIMING.speed === 'normal' && vals() === 'normal,normal,normal', vals());
S.disable(['lobby-speed', 'game-speed'], false);
ck('离开联机后控件重新可编辑', selects.every(s => !s.disabled));
sent = null;
change('slow', 0);
ck('★ restoreLocal 清掉了联机 handler（回到本地分支）', sent === null && CF.TIMING.speed === 'slow', String(sent));
ck('非法档位回落到默认档', S.norm('bogus') === CF.DEFAULT_SPEED);

console.log('\n========================================');
console.log(`  SpeedUI 模块回归：${pass} 通过 / ${fail} 失败`);
process.exitCode = fail ? 1 : 0;

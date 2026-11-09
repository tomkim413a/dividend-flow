/* ============================================================
 * speed.js —— AI / 动画速度档位的前端控制
 *
 * 单一数据源在 js/data.js：CF.TIMING_BASE / CF.SPEED_PRESETS / CF.applySpeed。
 * engine.js 持有 CF.TIMING 的对象引用，改属性即时生效，无需重开局。
 *
 * 两种模式：
 *   单机 → applyLocal()：改本地 CF.TIMING，并存 localStorage（下次打开仍生效）
 *   联机 → online.js 用 setHandler() 接管：档位发给服务端，由房间里的权威引擎生效；
 *          服务端广播回来后再 syncFromServer()，客户端只同步显示、不写本机存档。
 *
 * 三个下拉共用 data-speed-select 标记：开始界面 / 游戏顶栏 / 联机大厅。
 * ============================================================ */
(function () {
  'use strict';
  const CF = window.CF;
  if (!CF || !CF.applySpeed) return;          // data.js 未加载时静默跳过

  const STORE_KEY = 'cf_speed_v1';
  const SELECTS = '[data-speed-select]';
  const HINTS = ['setup-speed-hint', 'game-speed-hint', 'lobby-speed-hint'];

  let handler = null;          // 联机模式下由 online.js 注入的发送函数
  let lastServerKey = null;    // 服务端最近一次下发的档位（发送失败时回滚用）

  const qsa = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const byId = id => document.getElementById(id);
  const norm = k => CF.normSpeed(k);
  const hintFor = k => { const p = CF.speedInfo(k); return p ? p.note : ''; };
  const current = () => CF.TIMING.speed || CF.DEFAULT_SPEED;

  function saved() { try { return localStorage.getItem(STORE_KEY) || ''; } catch (e) { return ''; } }
  function persist(k) { try { localStorage.setItem(STORE_KEY, k); } catch (e) {} }

  function fill(sel) {
    if (!sel) return;
    sel.innerHTML = CF.SPEED_PRESETS
      .map(p => '<option value="' + p.key + '">' + p.label + '</option>').join('');
  }

  /** 同步所有下拉的选中值与提示文字。刻意不动 disabled：权限由调用方单独控制。 */
  function sync(k) {
    const key = norm(k);
    qsa(SELECTS).forEach(sel => { sel.value = key; });
    HINTS.forEach(id => { const h = byId(id); if (h) h.textContent = hintFor(key); });
    return key;
  }

  /** 单机：应用档位 + 可选持久化 + 同步显示 */
  function applyLocal(k, save) {
    const key = CF.applySpeed(k);
    if (save !== false) persist(key);
    return sync(key);
  }

  /** 联机：服务端权威，客户端只同步显示（不写 localStorage，避免串味到单机） */
  function syncFromServer(k) {
    const key = CF.applySpeed(k);
    lastServerKey = key;
    return sync(key);
  }

  /** 发送失败 / 被服务端拒绝：连本地节奏一起回滚到服务端最近一次确认的档位 */
  function rollback() { return syncFromServer(lastServerKey || CF.DEFAULT_SPEED); }

  /** 离开联机：把本地节奏恢复成玩家自己的单机存档 */
  function restoreLocal() {
    handler = null;
    lastServerKey = null;
    return applyLocal(norm(saved() || CF.DEFAULT_SPEED), false);
  }

  function onUserChange(key) {
    if (handler) { handler(norm(key)); return; }
    applyLocal(key, true);
  }

  function disable(ids, val) {
    (Array.isArray(ids) ? ids : [ids]).forEach(id => {
      const s = byId(id); if (s) s.disabled = !!val;
    });
  }

  function init() {
    qsa(SELECTS).forEach(sel => {
      fill(sel);
      sel.addEventListener('change', () => onUserChange(sel.value));
    });
    applyLocal(norm(saved() || CF.DEFAULT_SPEED), false);   // 初始化不覆盖已有存档
  }

  window.SpeedUI = {
    init, fill, sync, syncFromServer, applyLocal, rollback, restoreLocal,
    disable, current, hintFor, norm,
    setHandler: fn => { handler = fn || null; },
    defaultKey: CF.DEFAULT_SPEED
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ============================================================
 * bgm.js —— 背景音乐模块（股息流）· 稳定版
 *
 * 设计原则：简单、可靠、不折腾。
 *   1. 打开页面立即尝试播放开始界面 BGM；
 *   2. 浏览器拦截自动播放时，立即显示「点击页面任意处开启背景音乐」，
 *      首次点击 / 按键补播 —— 提示一定会出现，绝不会「没声音也没提示」；
 *   3. 不做整首预取、不换源、不做静音兜底状态机。
 *      上一版正是这些机制在 Edge 上把音乐搞成彻底静默（a.load() 打断 play
 *      会抛 AbortError，旧代码只认 NotAllowedError，于是既不播也不提示）；
 *   4. 音频用 128kbps 压缩版（单首 2.2–2.9MB），配服务端长缓存，
 *      边下边播即可稳定循环，不再整首下载。
 *
 * 曲目：开始界面 bgm-setup / 对局 bgm-game / 结算 bgm-end
 * 对外：window.BGM.play('setup'|'game'|'end') / .duck() / .toggle()
 *       /.setOn() / .setVol() / .on / .vol
 * ============================================================ */
'use strict';

const BGM = (function () {
  const SRC = {
    setup: 'BGM/bgm-setup.mp3',
    game:  'BGM/bgm-game.mp3',
    end:   'BGM/bgm-end.mp3'
  };
  const DUCK = 0.35;                       // 语音讲解时压低到的比例
  // v3：作废旧存档里可能残留的「关闭 / 音量 0」，保证默认一定能出声
  const KEY_ON  = 'cf_bgm_on_v3';
  const KEY_VOL = 'cf_bgm_vol_v3';

  let on = true;
  let vol = 0.5;
  try {
    on = (localStorage.getItem(KEY_ON) || '1') !== '0';
    const raw = localStorage.getItem(KEY_VOL);
    if (raw !== null && raw !== '') {
      const v = Number(raw);
      if (Number.isFinite(v)) vol = Math.min(1, Math.max(0, v));
    }
  } catch (e) { /* localStorage 不可用 → 用默认值 */ }

  const els = {};                          // { setup: <audio>, game: <audio>, end: <audio> }
  let scene = 'setup';
  let ducked = false;
  let gestureArmed = false;

  function effVol() { return Math.max(0, Math.min(1, vol * (ducked ? DUCK : 1))); }
  function applyVol() {
    Object.keys(els).forEach(k => { try { els[k].volume = effVol(); } catch (e) {} });
  }
  function el(key) {
    if (els[key]) return els[key];
    const a = new Audio(SRC[key]);
    a.loop = true;
    // 打开即缓冲起播。绝不手动调用 a.load()：它会中断正在进行的 play()
    // 并抛 AbortError，是上一版「音乐彻底没了」的直接原因。
    a.preload = 'auto';
    a.volume = effVol();
    els[key] = a;
    return a;
  }
  function pauseAll() {
    Object.keys(els).forEach(k => { try { els[k].pause(); } catch (e) {} });
  }

  /* 底部轻提示。浏览器禁止「无手势有声播放」时，让用户知道点一下就好 */
  function showTip() {
    if (document.getElementById('bgm-tip')) return;
    const d = document.createElement('div');
    d.id = 'bgm-tip';
    d.textContent = '🔊 点击页面任意处开启背景音乐';
    d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;' +
      'background:rgba(0,0,0,.78);color:#fff;padding:9px 16px;border-radius:999px;' +
      'font-size:13px;letter-spacing:.5px;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.3)';
    document.body.appendChild(d);
  }
  function hideTip() {
    const d = document.getElementById('bgm-tip');
    if (d) d.remove();
  }

  /* 等首次用户交互补播。任何播放失败都走这里，不区分错误类型 */
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      document.removeEventListener('touchstart', retry);
      gestureArmed = false;
      if (!on) return;
      hideTip();
      play(scene, true);                    // 已有用户手势，这次一定能播
    };
    document.addEventListener('pointerdown', retry);
    document.addEventListener('keydown', retry);
    document.addEventListener('touchstart', retry);
  }
  function blocked() { showTip(); armGesture(); }

  function tryPlay(a) {
    let p = null;
    try { p = a.play(); } catch (e) { blocked(); return; }
    if (p && typeof p.then === 'function') {
      // 不管 reject 的是 NotAllowedError / AbortError / NotSupportedError，
      // 一律显示提示 + 等手势，避免任何浏览器分支漏掉。
      p.then(hideTip).catch(blocked);
    } else if (a.paused) {
      blocked();                            // 不返回 Promise 的老浏览器
    } else {
      hideTip();
    }
  }

  function play(key, force) {
    if (key) {
      // 同一场景且正在播放 → 直接返回（render 每帧都会调，避免音乐反复从头开始）
      if (!force && scene === key && els[key] && !els[key].paused) return;
      // 已在等待用户手势时，不要每帧重复发起 play()（会产生大量 rejected Promise）
      if (!force && scene === key && gestureArmed) return;
      scene = key;
    }
    if (!on) { pauseAll(); hideTip(); return; }
    const a = el(scene);
    Object.keys(els).forEach(k => { if (k !== scene) { try { els[k].pause(); } catch (e) {} } });
    a.volume = effVol();
    tryPlay(a);
  }

  function duck(on_) {
    const next = !!on_;
    if (ducked === next) return;
    ducked = next;
    applyVol();
  }
  function setOn(v) {
    on = !!v;
    try { localStorage.setItem(KEY_ON, on ? '1' : '0'); } catch (e) {}
    if (on) play(scene, true);
    else { pauseAll(); hideTip(); }         // 主动关闭 → 不显示补播提示
    syncUI();
  }
  function toggle() { setOn(!on); }
  function setVol(v) {
    vol = Math.max(0, Math.min(1, Number(v) || 0));
    try { localStorage.setItem(KEY_VOL, String(vol)); } catch (e) {}
    applyVol();
    syncUI();
  }

  /* 两处界面（开始界面 / 顶栏）的按钮与滑块保持同一状态 */
  function syncUI() {
    document.querySelectorAll('.bgm-toggle').forEach(b => {
      b.textContent = on ? '🎵 音乐' : '🔇 音乐';
      b.classList.toggle('off', !on);
    });
    const pct = Math.round(vol * 100);
    document.querySelectorAll('.bgm-vol').forEach(r => {
      if (Number(r.value) !== pct) r.value = pct;
    });
  }

  function init() {
    document.querySelectorAll('.bgm-toggle').forEach(b => {
      b.addEventListener('click', toggle);
    });
    document.querySelectorAll('.bgm-vol').forEach(r => {
      r.addEventListener('input', () => setVol(Number(r.value) / 100));
    });
    syncUI();

    play('setup');                          // 一打开网页就尝试播放

    /* 兜底：某些浏览器 play() 的 Promise 既不 resolve 也不 reject（一直 pending）。
       1.5 秒后若仍未真正起播，照样把提示与手势补播装上。 */
    setTimeout(() => {
      const a = els[scene];
      if (on && a && a.paused) blocked();
    }, 1500);
  }

  return {
    init, play, toggle, setOn, setVol, duck,
    get on() { return on; },
    get vol() { return vol; }
  };
})();

window.BGM = BGM;
window.addEventListener('DOMContentLoaded', BGM.init);

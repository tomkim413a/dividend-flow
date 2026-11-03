/* ============================================================
 * bgm.js —— 背景音乐模块（股息流）
 *
 * 曲目：
 *   开始界面  → BGM/Menu of Small Numbers.mp3
 *   对局进行中 → BGM/Quiet Tape Loop.mp3
 *
 * 职责（不参与任何游戏逻辑）：
 *   1. 按场景切换并循环播放 BGM；
 *   2. 开关 / 音量，偏好写 localStorage（下次打开保持）；
 *   3. 语音讲解时自动压低音量（duck），讲解结束恢复，保证人声清晰；
 *   4. 应对浏览器/Electron 的“无用户手势不自动播放”限制 → 首次交互时补播。
 *
 * 对外：window.BGM.play('setup'|'game') / .duck(true|false)
 * ============================================================ */
'use strict';

const BGM = (function () {
  const SRC = {
    setup: 'BGM/Menu of Small Numbers.mp3',
    game: 'BGM/Quiet Tape Loop.mp3',
    end: 'BGM/Coin Sparkle Fanfare.mp3'      // 结算画面（胜利 / 失败都用它）
  };
  const DUCK = 0.35;                        // 语音讲解时 BGM 压低到的比例
  const KEY_ON = 'cf_bgm_on_v2';   // v2：作废旧版可能误存的“关闭”状态，保证默认一定开启
  const KEY_VOL = 'cf_bgm_vol_v2';   // v2：作废旧存档里可能残留的 0，改用中间音量

  let on = true;
  let vol = 0.5;                            // 默认音量 = 滑块正中
  try {
    on = (localStorage.getItem(KEY_ON) || '1') !== '0';
    const raw = localStorage.getItem(KEY_VOL);
    // 注意：Number(null) 会得到 0 且 isFinite 为真 → 必须显式排除无存档的情况
    if (raw !== null && raw !== '') {
      const v = Number(raw);
      if (Number.isFinite(v)) vol = Math.min(1, Math.max(0, v));
    }
  } catch (e) { /* localStorage 不可用 → 用默认值 */ }

  const els = {};                           // { setup: <audio>, game: <audio> }
  let scene = 'setup';                      // 当前应播放的场景
  let ducked = false;
  let gestureArmed = false;

  function effVol() {
    return Math.max(0, Math.min(1, vol * (ducked ? DUCK : 1)));
  }
  function applyVol() {
    Object.keys(els).forEach(k => { try { els[k].volume = effVol(); } catch (e) {} });
  }
  function el(key) {
    if (els[key]) return els[key];
    const a = new Audio(SRC[key]);
    a.loop = true;
    a.preload = 'auto';
    a.volume = effVol();
    els[key] = a;
    return a;
  }
  function pauseAll() {
    Object.keys(els).forEach(k => { try { els[k].pause(); } catch (e) {} });
  }

  /* 浏览器拦截自动播放时：底部轻提示“点任意处即可开启”，避免用户误以为要去按开关 */
  function showTip() {
    if (document.getElementById('bgm-tip')) return;
    const d = document.createElement('div');
    d.id = 'bgm-tip';
    d.textContent = '🔊 点击页面任意处开启背景音乐';
    d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;' +
      'background:rgba(0,0,0,.72);color:#fff;padding:8px 14px;border-radius:999px;' +
      'font-size:13px;letter-spacing:.5px;pointer-events:none';
    document.body.appendChild(d);
  }
  function hideTip() {
    const d = document.getElementById('bgm-tip');
    if (d) d.remove();
  }

  /* 自动播放被拦截时：等首次用户交互（点击/按键）再补播 */
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      if (on) play(scene);
    };
    document.addEventListener('pointerdown', retry);
    document.addEventListener('keydown', retry);
  }

  function play(key) {
    if (key) {
      // 同一场景且正在播放 → 直接返回（render 每帧都会调用，避免音乐反复从头开始）
      if (scene === key && els[key] && !els[key].paused) return;
      scene = key;
    }
    if (!on) { pauseAll(); return; }
    const a = el(scene);
    Object.keys(els).forEach(k => { if (k !== scene) { try { els[k].pause(); } catch (e) {} } });
    a.volume = effVol();
    try {
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(hideTip).catch(err => {
          const name = (err && (err.name || '')) + ' ' + ((err && err.message) || '');
          if (/NotAllowed|gesture/i.test(name)) { armGesture(); showTip(); }
          else {
            // 非手势限制（例如音频尚未缓冲好）→ 等可播放时自动补一次
            a.addEventListener('canplay', () => {
              if (on && scene === (key || scene)) { try { const q = a.play(); if (q && q.then) q.then(hideTip).catch(() => {}); } catch (e) {} }
            }, { once: true });
          }
        });
      } else { hideTip(); }
    } catch (e) { armGesture(); showTip(); }
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
    if (on) play(scene); else { pauseAll(); hideTip(); }   // 主动关闭 → 不显示补播提示
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
    play('setup');                          // 开始界面 BGM

    /* 页面加载完成后再预取其余曲目：避免与首屏资源抢带宽，
       同时减少切换场景（进入对局 / 结算）时的缓冲卡顿。 */
    const preloadRest = () => {
      Object.keys(SRC).forEach(k => {
        if (k === scene) return;
        const a = el(k);
        a.preload = 'auto';
        try { a.load(); } catch (e) {}
      });
    };
    if (document.readyState === 'complete') setTimeout(preloadRest, 800);
    else window.addEventListener('load', () => setTimeout(preloadRest, 800), { once: true });
  }

  return {
    init, play, toggle, setOn, setVol, duck,
    get on() { return on; },
    get vol() { return vol; }
  };
})();

window.BGM = BGM;
window.addEventListener('DOMContentLoaded', BGM.init);

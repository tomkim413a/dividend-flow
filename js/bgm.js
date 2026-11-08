/* ============================================================
 * bgm.js —— 背景音乐模块（股息流）
 *
 * 曲目（128kbps 版，原 320kbps 母带仍保留在 BGM/ 目录）：
 *   开始界面  → BGM/bgm-setup.mp3
 *   对局进行中 → BGM/bgm-game.mp3
 *   结算画面  → BGM/bgm-end.mp3
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
  // 320kbps 原曲各 5.6–7.1MB，跨境边下边播容易断续；改用 128kbps（2.2–2.9MB，小 60%）。
  // 想换回母带：把下面三行改回 Menu of Small Numbers / Quiet Tape Loop / Coin Sparkle Fanfare.mp3。
  const SRC = {
    setup: 'BGM/bgm-setup.mp3',
    game: 'BGM/bgm-game.mp3',
    end: 'BGM/bgm-end.mp3'                   // 结算画面（胜利 / 失败都用它）
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
  const blobUrls = {};                      // 完整预取完成后的本地 objectURL
  const prefetching = {};                   // 防止同一首重复下载
  let scene = 'setup';                      // 当前应播放的场景
  let ducked = false;
  let gestureArmed = false;
  let prefetchArmed = false;                // 起播约 1 秒后才允许后台完整下载
  let wantPlaying = true;                   // 「意图在播」：不受 load()/换源把 paused 重置影响
  let mutedFallback = false;                // 自动播放被浏览器拦截 → 先静音播着，首次点击恢复音量

  /* ------------------------------------------------------------
   * 完整预取：把整首曲子下成本地 Blob 再交给 <audio>。
   * 线上实测：音频经 Cloudflare 回源 Render（cf-cache-status: DYNAMIC，未命中缓存），
   * 吞吐在 170–455 KB/s 间剧烈波动，且每个 Range 请求还有约 1.3s 跨境延迟。
   * 7MB / 320kbps 的曲子靠边下边播，缓冲区一断就卡，循环播放时尤其明显。
   * 一次性下完后播放完全走本地内存，循环、切场景都不再依赖网络。
   * 只预取当前/即将切换的那一首，且等首次交互或页面空闲才启动，
   * 避免重演「一进页面并发拉 19MB 拖慢登录」的老问题。
   * ------------------------------------------------------------ */
  function prefetch(key) {
    if (!prefetchArmed || !key || !SRC[key] || blobUrls[key] || prefetching[key] || !on) return;
    prefetching[key] = true;
    // priority:'low'：让 audio 首播、页面脚本、登录请求排在前面
    fetch(SRC[key], { cache: 'force-cache', priority: 'low' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.blob(); })
      .then(b => {
        blobUrls[key] = URL.createObjectURL(b);
        if (els[key]) swapToBlob(key, blobUrls[key]);
      })
      .catch(() => { /* 下载失败就保持原来的边下边播，不影响游戏 */ })
      .finally(() => { prefetching[key] = false; });
  }

  /* 已经用网络源播着时换成本地源：保留播放进度与播放状态。
     旧版用 !a.paused 判断是否补播，但 a.load() 会把它重置成 true；
     且预取完成常与「首次点击补播」撞在一起，导致音乐被换源打断后就此静默。
     改用 wantPlaying（播放意图），并在 loadedmetadata 后无条件主动恢复。 */
  function swapToBlob(key, url) {
    const a = els[key];
    if (!a || a.src === url) return;
    const t = a.currentTime || 0;
    const shouldPlay = wantPlaying && on && scene === key;
    a.src = url;
    try { a.load(); } catch (e) {}
    a.addEventListener('loadedmetadata', () => {
      try { a.currentTime = Math.min(t, isFinite(a.duration) ? a.duration : t); } catch (e) {}
      if (!shouldPlay) return;
      try {
        a.volume = effVol();
        a.muted = mutedFallback;            // 保持静音兜底状态，等用户手势再解除
        const p = a.play();
        if (p && p.catch) p.catch(() => { armGesture(); showTip(); });
      } catch (e) { armGesture(); showTip(); }
    }, { once: true });
  }

  function effVol() {
    return Math.max(0, Math.min(1, vol * (ducked ? DUCK : 1)));
  }
  function applyVol() {
    Object.keys(els).forEach(k => { try { els[k].volume = effVol(); } catch (e) {} });
  }
  function el(key) {
    if (els[key]) return els[key];
    const a = new Audio(blobUrls[key] || SRC[key]);
    a.loop = true;
    // 已换成 128kbps（2.2–2.9MB），一打开页面就缓冲起播，不再等交互/8 秒
    a.preload = 'auto';
    a.volume = effVol();
    els[key] = a;
    return a;
  }
  function pauseAll() {
    Object.keys(els).forEach(k => { try { els[k].pause(); } catch (e) {} });
  }

  /* 浏览器拦截自动播放时：底部轻提示“点任意处即可开启”，避免用户误以为要去按开关 */
  function showTip(text) {
    let d = document.getElementById('bgm-tip');
    if (!d) {
      d = document.createElement('div');
      d.id = 'bgm-tip';
      d.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:9999;' +
        'background:rgba(0,0,0,.78);color:#fff;padding:9px 16px;border-radius:999px;' +
        'font-size:13px;letter-spacing:.5px;pointer-events:none;box-shadow:0 2px 12px rgba(0,0,0,.3)';
      document.body.appendChild(d);
    }
    d.textContent = text || '🔊 点击页面任意处开启声音';
  }
  function hideTip() {
    const d = document.getElementById('bgm-tip');
    if (d) d.remove();
  }

  /* 自动播放被拦截时先静音播着（浏览器允许静音自动播放），
     音乐进度/循环照常走，用户第一次点击任意处立刻恢复音量 —— 不会「点了才从头开始」。 */
  function startMuted(a) {
    if (mutedFallback) return;
    mutedFallback = true;
    try { a.muted = true; const p = a.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
    armGesture();
    showTip();
  }

  /* 等首次用户交互（点击/按键）恢复有声播放 */
  function armGesture() {
    if (gestureArmed) return;
    gestureArmed = true;
    const retry = () => {
      document.removeEventListener('pointerdown', retry);
      document.removeEventListener('keydown', retry);
      gestureArmed = false;
      if (!on) return;
      const a = els[scene];
      if (a) { a.muted = false; a.volume = effVol(); }
      mutedFallback = false;
      hideTip();
      play(scene);
    };
    document.addEventListener('pointerdown', retry);
    document.addEventListener('keydown', retry);
  }

  function tryPlay(a) {
    try {
      a.muted = false;
      const p = a.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { mutedFallback = false; hideTip(); }).catch(err => {
          const name = ((err && (err.name || '')) + ' ' + ((err && err.message) || ''));
          if (/NotAllowed|gesture/i.test(name)) startMuted(a);
          else if (!mutedFallback) {
            // 缓冲尚未就绪 → 可播放时自动补一次，不需要用户操作
            a.addEventListener('canplay', () => {
              if (wantPlaying && on) { try { const q = a.play(); if (q && q.catch) q.catch(() => {}); } catch (e) {} }
            }, { once: true });
          }
        });
      } else { mutedFallback = false; hideTip(); }
    } catch (e) { startMuted(a); }
  }

  function play(key) {
    if (key) {
      // 同一场景且正在播放 → 直接返回（render 每帧都会调用，避免音乐反复从头开始）
      if (scene === key && els[key] && !els[key].paused && !mutedFallback) return;
      scene = key;
    }
    wantPlaying = true;
    if (!on) { pauseAll(); return; }
    const a = el(scene);
    Object.keys(els).forEach(k => { if (k !== scene) { try { els[k].pause(); } catch (e) {} } });
    a.volume = effVol();
    prefetch(scene);                        // 切到哪首，就后台把哪首完整拉到本地
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
    if (on) play(scene);
    else { wantPlaying = false; mutedFallback = false; pauseAll(); hideTip(); }  // 主动关闭 → 不显示补播提示
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

    /* 打开页面立刻起播（不再等首次交互 / 8 秒）；浏览器若拦截有声自动播放，
       tryPlay 会退到静音播放 + 提示，首次点击即恢复音量。
       完整预取稍晚 1.2 秒启动并用低优先级：避开首屏脚本与首播缓冲，
       下完后换成本地 Blob，循环和切场景就不再走网络。 */
    play('setup');
    setTimeout(() => { prefetchArmed = true; prefetch(scene); }, 1200);
  }

  return {
    init, play, toggle, setOn, setVol, duck,
    get on() { return on; },
    get vol() { return vol; }
  };
})();

window.BGM = BGM;
window.addEventListener('DOMContentLoaded', BGM.init);

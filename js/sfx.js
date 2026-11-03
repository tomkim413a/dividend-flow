/* ============================================================
 * sfx.js —— 音效模块（Web Audio 实时合成，不需要任何音频文件）
 *
 *   掷骰                        → SFX.dice()
 *   交税 / 意外支出 / 失业        → SFX.bad()   （丢失、错误的下行音）
 *   红利股 / 成长股 / 慈善 / 结算 → SFX.good()  （得到机会的上行音）
 *
 * 说明：
 *   - 不提供独立的开关与音量，跟随背景音乐（BGM）的开关一起启停；
 *   - 音量取固定适中值，避免盖过语音解说；
 *   - AudioContext 在首次用户交互时自动 resume（exe 内已放开自动播放限制）。
 * ============================================================ */
'use strict';

const SFX = (function () {
  let AC = null;

  function ac() {
    try {
      if (!AC) {
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return null;
        AC = new Ctor();
      }
      if (AC.state === 'suspended') AC.resume();
      return AC;
    } catch (e) { return null; }
  }

  /* 音乐关掉时，音效也一并静音 */
  function enabled() {
    return !!(window.BGM && window.BGM.on);
  }

  /* 单音：频率 / 时长 / 波形 / 音量 / 延迟 */
  function tone(freq, dur, type, vol, delay) {
    if (!enabled()) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime + (delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.012);          // 起音
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);    // 衰减
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  /* 滑音：从一个频率滑到另一个（用于“下跌 / 丢失”感） */
  function slide(from, to, dur, type, vol) {
    if (!enabled()) return;
    const c = ac(); if (!c) return;
    const t0 = c.currentTime;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type || 'triangle';
    o.frequency.setValueAtTime(from, t0);
    o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t0); o.stop(t0 + dur + 0.03);
  }

  /* 低通噪声：沙沙 / 碰撞声（掷骰）；支持 delay 以便连成一串 */
  function noise(dur, vol, cutoff, delay) {
    if (!enabled()) return;
    const c = ac(); if (!c) return;
    const n = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, n, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cutoff || 1600;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f); f.connect(g); g.connect(c.destination);
    s.start(c.currentTime + (delay || 0));
  }

  /* 掷骰素材：audio/audio of dice.mp3（预加载；重复播放时从头开始） */
  let diceEl = null;
  function diceAudio() {
    try {
      if (!diceEl) {
        diceEl = new Audio('audio/audio of dice.mp3');
        diceEl.preload = 'auto';
        diceEl.volume = 0.55;                  // 固定适中音量
      }
      return diceEl;
    } catch (e) { return null; }
  }

  /* 合成兜底：骰盅摇晃 + 三下碰撞 + 清脆落定（仅当素材文件不可用时才用） */
  function diceSynth() {
    noise(0.20, 0.22, 3200);
    [0.18, 0.24, 0.29].forEach((t, i) => {
      noise(0.035, 0.30, 4200, t);
      tone(600 + i * 170, 0.06, 'square', 0.13, t);
    });
    tone(990, 0.15, 'triangle', 0.20, 0.34);
    tone(1320, 0.09, 'sine', 0.12, 0.35);
  }

  /* 预热：首次用户交互时创建 AudioContext 并预加载掷骰素材，
     避免第一次掷骰才去下载/初始化导致音效延迟。 */
  function warm() {
    try { const a = diceAudio(); if (a) { a.preload = 'auto'; a.load(); } } catch (e) {}
    ac();
  }
  document.addEventListener('pointerdown', warm, { once: true });
  document.addEventListener('keydown', warm, { once: true });

  return {
    warm,
    /* 掷骰：播放素材 audio/audio of dice.mp3（不可用则回退到合成音） */
    dice() {
      if (!enabled()) return;
      const a = diceAudio();
      if (a) {
        try {
          a.pause(); a.currentTime = 0;
          const p = a.play();
          if (p && typeof p.catch === 'function') p.catch(() => diceSynth());
          return;
        } catch (e) { /* 落到合成兜底 */ }
      }
      diceSynth();
    },

    /* 走一格：轻短 blip；连走多格时音高略升，走出“前进”感（音量刻意压低，避免连响太吵） */
    step(i) {
      const n = Math.min(7, Math.max(0, Number(i) || 0));
      tone(470 + n * 30, 0.05, 'sine', 0.07);
    },

    /* 交税 / 意外支出 / 失业：两声下行“错误”蜂鸣 + 低沉尾音（更明显） */
    bad() {
      tone(466, 0.12, 'square', 0.18);
      tone(349, 0.14, 'square', 0.18, 0.13);
      slide(300, 120, 0.30, 'sawtooth', 0.13);         // 下行滑到低音，强化“丢失”
    },

    /* 红利股 / 成长股 / 慈善 / 结算到账：上行“得到机会”提示音 */
    good() {
      tone(660, 0.11, 'sine', 0.14);
      tone(880, 0.13, 'sine', 0.14, 0.09);
      tone(1174, 0.18, 'sine', 0.12, 0.18);
    },

    /* 切换玩家：轻短柔和的双音提示（明显区别于掷骰的碰撞声） */
    turn() {
      tone(880, 0.07, 'triangle', 0.12);
      tone(1175, 0.10, 'triangle', 0.10, 0.065);
    }
  };
})();

window.SFX = SFX;

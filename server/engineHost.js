/* ============================================================
 * engineHost.js —— 在 Node 里托管浏览器端的规则引擎
 *
 * 设计要点：
 *   1. 复用【同一份】js/data.js + js/engine.js，保证服务端与浏览器规则完全一致，
 *      绝不会出现「两边算法不一样」的问题。
 *   2. 用 vm 隔离上下文：每个房间一个独立 context（引擎内部是单例状态，
 *      多房间必须各自加载一份，否则会互相串局）。
 *   3. window 垫片：data.js 写 window.CF、engine.js 读 window.CF 并写 window.Engine，
 *      所以在沙箱里让 window 指向沙箱自身即可，零侵入。
 *   4. 服务端的 CF.TIMING 全部归零：规则即时推进，不做动画等待
 *      （动画节奏交给客户端渲染层）。
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

/**
 * 创建一局游戏所需的引擎上下文（每房间调用一次）
 * @param {object} [opts] opts.fast=true 时把动画节奏归零（仅批量模拟用）
 * @returns {{ CF: object, Engine: object, takeSfx: Function }}
 */
function createEngineContext(opts) {
  opts = opts || {};
  /* 音效收集器：服务端不发声，引擎调用 SFX.xxx() 时改为记录事件，
     随状态一起下发给客户端，由客户端补播（保证联机也有音效）。
     注意：必须在 createContext 之前就挂到沙箱上，否则引擎访问不到。 */
  const sfxBag = [];
  const sandbox = {
    console,
    setTimeout, clearTimeout,
    setInterval, clearInterval,
    SFX: {
      dice: () => sfxBag.push('dice'),
      step: () => sfxBag.push('step'),
      bad: () => sfxBag.push('bad'),
      good: () => sfxBag.push('good'),
      turn: () => sfxBag.push('turn')
    }
  };
  sandbox.window = sandbox;              // 关键垫片：window 指向沙箱自身
  vm.createContext(sandbox);
  const takeSfx = () => sfxBag.splice(0);

  for (const f of ['js/data.js', 'js/engine.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    vm.runInContext(src, sandbox, { filename: f });
  }

  const CF = sandbox.CF;
  const Engine = sandbox.Engine;
  if (!CF || !Engine) throw new Error('引擎加载失败：CF=' + !!CF + ' Engine=' + !!Engine);

  /* 节奏：联机必须保留 CF.TIMING 的动画节奏 ——
     引擎每走一格会 emit 一次，服务端逐步广播，客户端才会看到「一步一步走」并弹出对应事件。
     只有批量模拟（opts.fast，如跑回归脚本）才归零以即时跑完。 */
  if (opts.fast) {
    Object.keys(CF.TIMING).forEach(k => {
      if (typeof CF.TIMING[k] === 'number') CF.TIMING[k] = 0;
    });
  }

  return { CF, Engine, takeSfx };
}

/** 生成一局的配置（cfg）：[{ name, prof, shape, ai }] */
function buildCfg(CF, players) {
  const profIds = CF.PROFESSIONS.map(p => p.id);
  return players.map((p, i) => ({
    name: p.name,
    prof: profIds[i % profIds.length],
    shape: p.shape || '',
    ai: !!p.ai
  }));
}

module.exports = { createEngineContext, buildCfg, ROOT };

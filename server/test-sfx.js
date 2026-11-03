/* 诊断：确认服务端沙箱里的引擎能否访问到 SFX 收集器 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');

const sfxBag = [];
const sandbox = {
  console, setTimeout, clearTimeout, setInterval, clearInterval,
  SFX: {
    dice: () => sfxBag.push('dice'),
    step: () => sfxBag.push('step'),
    bad: () => sfxBag.push('bad'),
    good: () => sfxBag.push('good'),
    turn: () => sfxBag.push('turn')
  }
};
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/data.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}

console.log('沙箱内 typeof window.SFX =', vm.runInContext('typeof window.SFX', sandbox));
console.log('沙箱内 typeof window.CF  =', vm.runInContext('typeof window.CF', sandbox));
console.log('沙箱内 typeof window.Engine =', vm.runInContext('typeof window.Engine', sandbox));

const CF = sandbox.CF, Engine = sandbox.Engine;
Object.keys(CF.TIMING).forEach(k => { if (typeof CF.TIMING[k] === 'number') CF.TIMING[k] = 0; });

let emits = 0;
Engine.setRender(() => { emits++; });
const profIds = CF.PROFESSIONS.map(p => p.id);
Engine.start([0, 1, 2, 3].map(i => ({ name: 'AI' + (i + 1), prof: profIds[i % profIds.length], shape: '', ai: true })));

setTimeout(() => {
  console.log(`跑 3 秒后：emit 次数=${emits}  收集到的音效=${JSON.stringify(sfxBag.slice(0, 15))}（共 ${sfxBag.length} 个）`);
  process.exit(0);
}, 3000);

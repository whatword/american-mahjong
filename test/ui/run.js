'use strict';
// 執行畫面測試：npm run test:ui
// 只跑部分：npm run test:ui -- layout voice
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.test.js'))
  .filter((f) => !filters.length || filters.some((k) => f.includes(k)))
  .sort();

let bad = 0;
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const okCount = (out.match(/^ok /gm) || []).length;
  const skipped = /^略過/m.test(out);
  const fails = out.split('\n').filter((l) => /^FAIL|Error/.test(l));
  const passed = r.status === 0 && !fails.length;
  if (!passed) bad++;
  console.log(`${skipped ? '－' : passed ? '✔' : '✘'} ${f.padEnd(18)} ${skipped ? '略過 (找不到 Chrome)' : `${String(okCount).padStart(3)} 項通過`}  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!passed) for (const l of fails.slice(0, 10)) console.log('    ' + l);
}
console.log(bad ? `\n${bad} 個畫面測試失敗` : `\n全部 ${files.length} 個畫面測試完成`);
process.exit(bad ? 1 : 0);

'use strict';
// 執行 test/ 底下所有測試：npm test
// 只跑部分：npm test -- guoshui dice   (檔名包含這些字的才跑)
// 隨機對局局數：FUZZ_GAMES=50 npm test
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const filters = process.argv.slice(2);
const files = fs.readdirSync(__dirname)
  .filter((f) => f.endsWith('.js') && !['run.js', 'helpers.js'].includes(f))
  .filter((f) => !filters.length || filters.some((k) => f.includes(k)))
  .sort();

const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const out = (r.stdout || '') + (r.stderr || '');
  const okCount = (out.match(/^ok /gm) || []).length;
  const fails = out.split('\n').filter((l) => /^FAIL|Error/.test(l));
  const passed = r.status === 0 && !fails.length;
  results.push({ f, passed });
  console.log(`${passed ? '✔' : '✘'} ${f.padEnd(22)} ${String(okCount).padStart(3)} 項通過  ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!passed) {
    for (const l of fails.slice(0, 10)) console.log('    ' + l);
    if (r.signal) console.log(`    (逾時或中斷：${r.signal})`);
  }
}
const bad = results.filter((x) => !x.passed);
console.log(bad.length ? `\n${bad.length} 個測試檔失敗：${bad.map((x) => x.f).join('、')}` : `\n全部 ${results.length} 個測試檔通過`);
process.exit(bad.length ? 1 : 0);

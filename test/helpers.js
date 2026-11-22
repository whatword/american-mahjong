'use strict';
// 測試共用設定：在載入 server.js 之前 require 這個檔案
// - 計分板寫到系統暫存資料夾，不會動到正式的 data/stats.json
// - 電腦出牌延遲拉很長，測試自己控制流程
// - ok() 失敗時設定結束碼，讓 npm test 能判斷成敗
const path = require('path');
const os = require('os');

process.env.STATS_FILE = process.env.STATS_FILE || path.join(os.tmpdir(), `mj-stats-test-${process.pid}.json`);
process.env.BOT_DELAY = process.env.BOT_DELAY || '100000';
process.env.DICE_SHOW_MS = process.env.DICE_SHOW_MS || '0';
process.env.SEAT_SHOW_MS = process.env.SEAT_SHOW_MS || '0';

let failed = 0;
function ok(cond, msg) {
  console.log(cond ? 'ok  ' : 'FAIL', msg);
  if (!cond) { failed++; process.exitCode = 1; }
}

// 測試結束：有失敗就以結束碼 1 離開
function finish() {
  if (failed) console.log(`${failed} 項失敗`);
  process.exit(failed ? 1 : 0);
}

module.exports = { ok, finish, root: path.join(__dirname, '..') };

'use strict';
// 換牌取牌：每家都只剩一張可取時自動取牌；還有得選時照常等玩家
process.env.FORCED_PICK_MS = '50';
const { ok, finish } = require('./helpers');
const { Room } = require('../server.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  let r;
  do {
    r = new Room('x');
    for (let i = 0; i < 4; i++) r.seats[i] = { name: 'p' + i, bot: false, ws: { readyState: 1, send() {} }, hand: [], melds: [], flowers: [], discards: [] };
    r.state = 'playing'; r.dealer = 0; r.startHand(); r.dealHand(0, 5); clearTimeout(r.timer);
  } while (r.phase === 'over');
  r.startSwapSelect(); clearTimeout(r.timer);
  for (let i = 0; i < 4; i++) r.confirmCover(i, r.seats[i].hand.slice(0, 3));
  ok(r.phase === 'swapPick' && r.turn === 0, '四家蓋好牌，從莊家開始取牌');

  const left = (p) => r.seats[p].cover.filter((t) => t !== null).length;
  const firstOpen = (i) => { const picks = {}; for (let p = 0; p < 4; p++) if (p !== i) picks[p] = r.seats[p].cover.findIndex((t) => t !== null); return picks; };

  // 第 1、2 位取牌：還有得選 → 不會自動取
  ok(r.pickWait() > 1000, '第 1 位 (莊家) 每家都有 3 張可選 → 等玩家自己取');
  r.doPick(0, firstOpen(0));
  ok(r.turn === 1 && r.pickWait() > 1000, '第 2 位還有得選 → 等玩家自己取');
  r.doPick(1, firstOpen(1));
  // 第 3 位：只有第 4 位那家剩一張，其他兩家還有 2 張 → 仍要自己選
  ok(r.turn === 2 && left(3) === 1 && left(0) === 2 && left(1) === 2, '第 3 位：第 4 家只剩 1 張、另外兩家各剩 2 張');
  ok(r.pickWait() > 1000, '第 3 位還有兩家可以選 → 等玩家自己取 (只剩一張的那家由畫面先幫他選好)');
  r.doPick(2, firstOpen(2));
  // 第 4 位：每家都只剩一張 → 自動取
  ok(r.turn === 3 && [0, 1, 2].every((p) => left(p) === 1), '第 4 位：其他三家都只剩 1 張');
  ok(r.pickWait() < 1000, '第 4 位沒得選 → 很快自動取牌');
  await sleep(200);
  ok(r.phase !== 'swapPick' && r.seats[3].hand.length === 16, '不用玩家操作，自動取完、換牌結束 (第 4 位手牌 16 張)');
  clearTimeout(r.timer);
  finish();
})();

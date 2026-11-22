'use strict';
process.env.STATS_FILE = require('path').join(require('os').tmpdir(), `mj-stats-test-${process.pid}.json`);
// 冒煙測試：1 個真人(自動打牌) + 3 電腦，打完 3 局，檢查結算守恆
process.env.BOT_DELAY = '1';
process.env.PORT = '3999';
process.env.DICE_SHOW_MS = '10';
process.env.SEAT_SHOW_MS = '10';
const WebSocket = require('ws');
const { server } = require('../server');
const G = require('../game');

// 單元：胡牌與台數
(() => {
  const h = [0, 1, 2, 3, 4, 5, 9, 10, 11, 18, 19, 20, 27, 27, 27, 5, 5]; // 17 張
  const r = G.evaluate({ hand: h, melds: [], flowers: [], seatWind: 0, roundWind: 0, selfDraw: true, winTile: 5, kongDraw: false, haidi: false });
  if (!r) throw new Error('應可胡');
  console.log('台數測試', JSON.stringify(r));
  if (G.canWin([0, 1, 2, 3, 4, 6, 9, 10, 11, 18, 19, 20, 27, 27, 27, 5, 5], 0)) throw new Error('不應可胡');
})();

server.listen(3999, () => {
  const ws = new WebSocket('ws://localhost:3999');
  let hands = 0, overSeen = -1, diceRolls = 0;
  ws.on('open', () => {
    ws.send(JSON.stringify({ type: 'login', name: 'tester', email: 'tester@example.com' }));
    ws.send(JSON.stringify({ type: 'create' }));
    for (let i = 0; i < 3; i++) ws.send(JSON.stringify({ type: 'addbot' }));
    ws.send(JSON.stringify({ type: 'start' }));
  });
  const send = (o) => ws.send(JSON.stringify(o));
  ws.on('message', (raw) => {
    const s = JSON.parse(raw);
    if (s.type !== 'state' || s.state !== 'playing') return;
    if (s.phase === 'over') {
      if (overSeen === s.handNo) return;
      overSeen = s.handNo;
      const total = s.scores.reduce((a, b) => a + b, 0);
      const d = s.result.delta ? s.result.delta.reduce((a, b) => a + b, 0) : 0;
      console.log(`第${s.handNo}局結束`, s.result.draw ? '流局' : `${s.result.items.map((i) => i.name + i.tai).join(',')}`, 'scores', s.scores);
      if (total !== 4000 || d !== 0) { console.error('結算不守恆'); process.exit(1); }
      if (++hands >= 3) { console.log('擲骰次數', diceRolls); console.log('OK'); process.exit(0); }
      send({ type: 'next' });
      return;
    }
    if (s.phase === 'seatPick') {
      const sp = s.seatPick;
      if (!sp.done && !sp.slots.some((x) => x.owner === s.you)) {
        if (sp.slots.some((x) => x.owner === null && x.wind !== null)) { console.error('未翻開的風牌外洩'); process.exit(1); }
        const free = sp.slots.findIndex((x) => x.owner === null);
        send({ type: 'seatpick', slot: free });
      }
      return;
    }
    if (s.phase === 'dice') {
      if (s.dice.thrower === s.you && !s.dice.values) { diceRolls++; send({ type: 'roll' }); }
      return;
    }
    if (s.phase === 'swapAsk') {
      if (s.dealer !== s.you) return;
      if (s.hand.length !== 17) { console.error('莊家抽門牌後應有 17 張', s.hand.length); process.exit(1); }
      return send(s.swapLeft === 2 ? { type: 'swapstart' } : { type: 'skipswap' });
    }
    if (s.phase === 'swapSelect') {
      if (!s.seats[s.you].confirmed) send({ type: 'cover', tiles: s.hand.slice(0, 3) });
      return;
    }
    if (s.phase === 'swapPick') {
      if (s.turn !== s.you) return;
      const picks = {};
      for (let p = 0; p < 4; p++) if (p !== s.you) picks[p] = s.seats[p].cover.indexOf(true);
      return send({ type: 'swappick', picks });
    }
    if (s.phase === 'discard' && s.turn === s.you) {
      if (s.actions && s.actions.hu) return send({ type: 'hu' });
      const all = s.drawn != null ? [...s.hand, s.drawn] : s.hand;
      const tiles = all.filter((t) => t < 34);
      send({ type: 'discard', tile: tiles[Math.floor(Math.random() * tiles.length)] });
    } else if (s.phase === 'claim' && s.claim && !s.claim.resp) {
      const o = s.claim.opts;
      if (o.hu) send({ type: 'hu' });
      else if (o.pong && Math.random() < 0.5) send({ type: 'pong' });
      else if (o.chi.length && Math.random() < 0.5) send({ type: 'chi', tiles: o.chi[0] });
      else if (o.kong && Math.random() < 0.5) send({ type: 'kong' });
      else send({ type: 'pass' });
    }
  });
  setTimeout(() => { console.error('逾時'); process.exit(1); }, 90000);
});

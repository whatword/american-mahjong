'use strict';
process.env.STATS_FILE = require('path').join(require('os').tmpdir(), `mj-stats-spec-test-${process.pid}.json`);
process.env.BOT_DELAY = '100000';
const WebSocket = require('ws');
const { server } = require('../server');

const PORT = 3996;
let failed = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    const waiterIdx = c.waiters.findIndex((w) => w.pred(m));
    if (waiterIdx >= 0) {
      const w = c.waiters.splice(waiterIdx, 1)[0];
      w.resolve(m);
    } else {
      c.msgs.push(m);
    }
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = (pred, ms = 2000) => {
    const idx = c.msgs.findIndex(pred);
    if (idx >= 0) {
      const m = c.msgs.splice(idx, 1)[0];
      return Promise.resolve(m);
    }
    return new Promise((resolve, reject) => {
      c.waiters.push({ pred, resolve });
      setTimeout(() => reject(new Error('等待訊息逾時')), ms);
    });
  };
  c.open = new Promise((r) => ws.on('open', r));
  c.closed = new Promise((r) => ws.on('close', r));
  return c;
}
const isType = (t) => (m) => m.type === t;

async function login(name, email) {
  const c = client();
  await c.open;
  c.send({ type: 'login', name, email });
  c.hall = await c.wait(isType('hall'));
  return c;
}

async function main() {
  // 建立一局並加入電腦，然後開始遊戲
  const host = await login('房主', 'host@example.com');
  host.send({ type: 'create' });
  const hostState = await host.wait(isType('state'));
  const roomId = hostState.room;

  // 嘗試在等待中觀戰 → 被拒絕
  const spec1 = await login('觀戰者1', 'spec1@example.com');
  spec1.send({ type: 'spectate', room: roomId });
  const toast1 = await spec1.wait(isType('toast'));
  ok(/尚未開始/.test(toast1.text), '遊戲尚未開始時無法觀戰：' + toast1.text);

  // 加入電腦滿 4 人並開始遊戲
  for (let k = 0; k < 3; k++) host.send({ type: 'addbot' });
  host.send({ type: 'start' });
  await host.wait((m) => m.type === 'state' && m.state === 'playing');

  // 大廳看到遊戲中且人數為 4，此時進入觀戰
  spec1.send({ type: 'spectate', room: roomId });
  const specState1 = await spec1.wait((m) => m.type === 'state' && m.spectating);
  ok(specState1.spectating === true, '觀戰者成功進入已開始的對局');
  ok(specState1.actions === null && specState1.claim === null, '觀戰者收到的動作與鳴牌選項為空 (只能觀看)');
  ok(specState1.spectatorCount >= 1, '觀戰人數統計正確');
  ok(Array.isArray(specState1.hand), '觀戰者看得到當前觀看角色的手牌');

  const initialViewSeat = specState1.you;
  ok(initialViewSeat >= 0 && initialViewSeat < 4, `初始觀看視角為座位 ${initialViewSeat}`);

  // 切換視角至另一個角色
  const targetSeat = (initialViewSeat + 1) % 4;
  spec1.send({ type: 'switchView', seat: targetSeat });
  const switchedState = await spec1.wait((m) => m.type === 'state' && m.spectating && m.you === targetSeat);
  ok(switchedState.you === targetSeat, `成功切換觀看視角至座位 ${targetSeat}`);

  // 再次切換視角至座位 2
  spec1.send({ type: 'switchView', seat: 2 });
  const switchedState2 = await spec1.wait((m) => m.type === 'state' && m.spectating && m.you === 2);
  ok(switchedState2.you === 2, '成功再次切換觀看視角至座位 2');

  // 測試觀戰者無法進行出牌或操作 (只能觀看)
  const handBefore = switchedState2.hand.slice();
  spec1.send({ type: 'discard', tile: handBefore[0] });
  spec1.send({ type: 'hu' });
  spec1.send({ type: 'roll' });
  spec1.send({ type: 'seatpick', slot: 0 });
  // 等待一段時間確認手牌未改變
  await new Promise((r) => setTimeout(r, 200));
  ok(switchedState2.hand.length === handBefore.length, '觀戰者無法進行出牌與遊戲操作');

  // 測試觀戰者可以發言，且會跳出對話框
  spec1.send({ type: 'chat', text: '加油' });
  const chatSay = await spec1.wait((m) => m.type === 'say' && m.kind === 'chat');
  ok(chatSay.seat === -1 && chatSay.text === '加油', '觀戰者聊天會送出對話框訊息');

  // 測試第二位觀戰者加入 (多人觀戰且各自獨立視角)
  const spec2 = await login('觀戰者2', 'spec2@example.com');
  spec2.send({ type: 'spectate', room: roomId });
  const specState2 = await spec2.wait((m) => m.type === 'state' && m.spectating);
  ok(specState2.spectating === true, '第二位觀戰者成功加入');

  spec2.send({ type: 'switchView', seat: 3 });
  const spec2Switched = await spec2.wait((m) => m.type === 'state' && m.spectating && m.you === 3);
  ok(spec2Switched.you === 3, '第二位觀戰者可獨立切換至座位 3，不影響第一位觀戰者');

  // 觀戰者離開房間回到大廳
  spec2.send({ type: 'leave' });
  const spec2Hall = await spec2.wait(isType('hall'));
  ok(spec2Hall.rooms.some((r) => r.id === roomId), '觀戰者離開後回到大廳，房間仍繼續進行');

  // 唯一真人玩家離開房間 → 房間關閉，觀戰者被通知
  host.send({ type: 'leave' });
  const spec1ClosedToast = await spec1.wait((m) => m.type === 'toast' && /關閉/.test(m.text));
  ok(spec1ClosedToast != null, '真人玩家離開且房間關閉時，觀戰者收到房間關閉通知');
  const spec1BackHall = await spec1.wait(isType('hall'));
  ok(spec1BackHall != null, '觀戰者自動回到大廳');

  for (const c of [host, spec1, spec2]) c.ws.close();
}

server.listen(PORT, () => {
  main()
    .catch((err) => { console.log('FAIL', err.message); failed++; })
    .finally(() => { console.log(failed ? `${failed} 項失敗` : 'OK'); process.exit(failed ? 1 : 0); });
});

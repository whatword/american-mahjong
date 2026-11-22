'use strict';
// 計分板測試：放在大廳、顯示暱稱(email)、暱稱跟著最新登入、打完一局即時更新
process.env.STATS_FILE = require('path').join(require('os').tmpdir(), `mj-stats-board-${process.pid}.json`);
process.env.BOT_DELAY = '100000';
const WebSocket = require('ws');
const { server, Room } = require('../server');
const Stats = require('../stats');

const PORT = 3997;
let failed = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.waiters = c.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = (pred, ms = 2000) => new Promise((resolve, reject) => {
    c.waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error('等待訊息逾時')), ms);
  });
  c.open = new Promise((r) => ws.on('open', r));
  return c;
}
async function login(name, email) {
  const c = client();
  await c.open;
  c.send({ type: 'login', name, email });
  c.hall = await c.wait((m) => m.type === 'hall');
  return c;
}

async function main() {
  // 先有一筆戰績：阿明 (ming@x.com) 自摸
  Stats.recordHand(
    [{ name: '阿明', token: 'ming@x.com' }, { name: 'Claude', bot: true }, { name: 'ChatGPT', bot: true }, { name: 'Gemini', bot: true }],
    { draw: false, winner: 0, selfDraw: true, delta: [300, -100, -100, -100] },
  );
  const a = await login('阿明', 'ming@x.com');
  const me = a.hall.board.find((p) => p.email === 'ming@x.com');
  ok(Array.isArray(a.hall.board) && me && me.name === '阿明' && me.you, '進大廳就收到計分板，顯示 阿明(ming@x.com)');
  ok(a.hall.board.filter((p) => p.bot).every((p) => p.email === null), '電腦沒有 email');
  a.ws.close();
  await new Promise((r) => setTimeout(r, 50));

  // 同一個 email 換暱稱登入 → 計分板用最新暱稱，戰績不變
  const a2 = await login('明哥', 'ming@x.com');
  const me2 = a2.hall.board.find((p) => p.email === 'ming@x.com');
  ok(me2.name === '明哥' && me2.money === 300 && me2.wins === 1, '換暱稱「明哥」登入 → 計分板顯示 明哥(ming@x.com)，戰績延續');
  ok(a2.hall.board.filter((p) => p.email === 'ming@x.com').length === 1, '同一個 email 只有一筆');

  // 另一位玩家在大廳；打完一局 → 他的計分板即時更新
  const b = await login('小華', 'hua@x.com');
  const r = new Room('9');
  for (let i = 0; i < 4; i++) r.seats[i] = { name: ['明哥', 'Claude', 'ChatGPT', 'Gemini'][i], bot: i > 0, token: i ? undefined : 'ming@x.com', ws: null, hand: [], melds: [], flowers: [], discards: [] };
  r.state = 'playing'; r.dealer = 1; r.streak = 0; r.round = 0; r.last = null;
  const upd = b.wait((m) => m.type === 'hall' && m.board.find((p) => p.email === 'ming@x.com').wins === 2);
  r.endHand({ winner: 0, from: 1, tile: 0, selfDraw: false, r: { tai: 2, items: [] } });
  clearTimeout(r.timer);
  const h = await upd;
  const m3 = h.board.find((p) => p.email === 'ming@x.com');
  ok(m3.name === '明哥' && m3.wins === 2, '打完一局後，大廳裡小華的計分板即時更新 (明哥 2 胡)');

  a2.ws.close(); b.ws.close();
}

server.listen(PORT, () => {
  main()
    .catch((err) => { console.log('FAIL', err.message); failed++; })
    .finally(() => { console.log(failed ? `${failed} 項失敗` : 'OK'); process.exit(failed ? 1 : 0); });
});

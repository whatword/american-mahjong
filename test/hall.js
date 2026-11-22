'use strict';
process.env.STATS_FILE = require('path').join(require('os').tmpdir(), `mj-stats-test-${process.pid}.json`);
// 登入與大廳測試：email 驗證、開房上限 4 間、加入 / 離開房間、牌局中回到房間、重複登入
process.env.BOT_DELAY = '100000';
const WebSocket = require('ws');
const { server } = require('../server');

const PORT = 3998;
let failed = 0;
const ok = (c, m) => { console.log(c ? 'ok  ' : 'FAIL', m); if (!c) failed++; };

// 一個測試用連線：收集訊息，可等待特定訊息
function client() {
  const ws = new WebSocket(`ws://localhost:${PORT}`);
  const c = { ws, msgs: [], waiters: [] };
  ws.on('message', (raw) => {
    const m = JSON.parse(raw);
    c.msgs.push(m);
    c.waiters = c.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
  });
  c.send = (o) => ws.send(JSON.stringify(o));
  c.wait = (pred, ms = 2000) => new Promise((resolve, reject) => {
    c.waiters.push({ pred, resolve });
    setTimeout(() => reject(new Error('等待訊息逾時')), ms);
  });
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
  // email 驗證
  for (const bad of ['', 'abc', 'a@b', 'a b@c.com', '@x.com']) {
    const c = client();
    await c.open;
    c.send({ type: 'login', name: '測試', email: bad });
    const m = await c.wait((x) => x.type === 'loginError' || x.type === 'hall');
    ok(m.type === 'loginError', `拒絕非 email 帳號「${bad}」`);
    c.ws.close();
  }
  {
    const c = client();
    await c.open;
    c.send({ type: 'login', name: '', email: 'a@b.com' });
    ok((await c.wait((x) => x.type === 'loginError' || x.type === 'hall')).type === 'loginError', '沒填暱稱被拒絕');
    c.ws.close();
  }

  const a = await login('阿明', 'Ming@Example.com');
  ok(a.hall.me.email === 'ming@example.com' && a.hall.rooms.length === 0, '登入成功進入大廳，email 轉成小寫');

  // 開房並在大廳看到
  const b = await login('小華', 'hua@example.com');
  a.send({ type: 'create' });
  const st = await a.wait(isType('state'));
  ok(st.state === 'lobby' && st.title === '第 1 桌', '阿明開了「第 1 桌」並進入等待室');
  let h = await b.wait((m) => m.type === 'hall' && m.rooms.length === 1);
  ok(h.rooms[0].players.includes('阿明') && h.rooms[0].count === 1, '小華在大廳即時看到第 1 桌與阿明');

  // 加入房間
  b.send({ type: 'joinRoom', room: '1' });
  const st2 = await b.wait(isType('state'));
  ok(st2.seats.filter(Boolean).length === 2 && st2.you === 1, '小華加入第 1 桌');

  // 房間上限 4 間
  const others = [];
  for (let k = 2; k <= 4; k++) {
    const c = await login('玩家' + k, `p${k}@example.com`);
    c.send({ type: 'create' });
    await c.wait(isType('state'));
    others.push(c);
  }
  const e = await login('第五人', 'p5@example.com');
  ok(e.hall.rooms.length === 4, '大廳顯示 4 間房');
  e.send({ type: 'create' });
  const t = await e.wait(isType('toast'));
  ok(/上限 4/.test(t.text), '第 5 間房被拒絕：' + t.text);

  // 離開房間：等待中離開會讓出座位；最後一個真人離開，房間刪除
  others[2].send({ type: 'leave' });
  h = await others[2].wait(isType('hall'));
  ok(h.rooms.length === 3 && !h.rooms.some((r) => r.id === '4'), '唯一玩家離開第 4 桌 → 房間刪除，回到大廳');
  e.send({ type: 'create' });
  const st5 = await e.wait(isType('state'));
  ok(st5.title === '第 4 桌', '空出名額後可再開房，沿用第 4 桌');

  // 牌局中離開 → 電腦代打；只能回原房間，不能加入別間
  for (let k = 0; k < 2; k++) a.send({ type: 'addbot' });
  a.send({ type: 'start' });
  await a.wait((m) => m.type === 'state' && m.state === 'playing');
  b.send({ type: 'leave' });
  h = await b.wait(isType('hall'));
  const r1 = h.rooms.find((r) => r.id === '1');
  ok(r1.state === 'playing' && r1.mine, '小華牌局中回大廳，第 1 桌顯示「遊戲中」且標記為自己的房間');
  b.send({ type: 'joinRoom', room: '2' });
  ok(/牌局中/.test((await b.wait(isType('toast'))).text), '牌局進行中，不能加入別的房間');
  b.send({ type: 'joinRoom', room: '1' });
  const back = await b.wait(isType('state'));
  ok(back.state === 'playing' && back.you === 1, '小華「回到房間」，回到原本座位');
  e.send({ type: 'leave' });
  await e.wait(isType('hall'));
  e.send({ type: 'joinRoom', room: '1' });
  ok(/已滿或遊戲已開始/.test((await e.wait(isType('toast'))).text), '別人不能加入遊戲中的房間');

  // 同一帳號重複登入：舊視窗被踢，新視窗可回到牌局
  const b2 = await login('小華', 'hua@example.com');
  await b.closed;
  ok(b.msgs.some((m) => m.type === 'kicked'), '同帳號在新視窗登入，舊視窗被登出');
  ok(b2.hall.rooms.find((r) => r.id === '1').mine, '新視窗大廳可看到自己的牌局');

  for (const c of [a, b2, e, ...others]) c.ws.close();
}

server.listen(PORT, () => {
  main()
    .catch((err) => { console.log('FAIL', err.message); failed++; })
    .finally(() => { console.log(failed ? `${failed} 項失敗` : 'OK'); process.exit(failed ? 1 : 0); });
});

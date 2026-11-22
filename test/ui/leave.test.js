'use strict';
// 離開房間的確認視窗；沒有真人時房間直接關閉
const { ok, run, login, startSoloGame, sleep, shot } = require('./helpers');

const visible = (page) => page.evaluate(() => !document.getElementById('confirmModal').classList.contains('hidden'));
const body = (page) => page.evaluate(() => document.getElementById('confirmBody').textContent);

run(async (env) => {
  let nativeDialogs = 0;
  // ---- 等待室：離開房間 ----
  const a = await login(env, { name: '甲', email: 'leave-a@example.com' });
  a.on('dialog', async (d) => { nativeDialogs++; await d.dismiss(); });
  await a.evaluate(() => send({ type: 'create' }));
  await a.waitForFunction(() => S && S.state === 'lobby');
  await a.click('#leaveBtn'); await sleep(300);
  ok(await visible(a), '等待室按「離開房間」→ 出現確認視窗');
  await shot(a, 'leave-lobby');
  await a.click('#confirmCancel'); await sleep(200);
  ok(!(await visible(a)) && await a.evaluate(() => S && S.state === 'lobby'), '按「留在房間」→ 關閉視窗，仍在等待室');
  await a.click('#leaveBtn'); await sleep(200); await a.keyboard.press('Escape'); await sleep(200);
  ok(!(await visible(a)), '按 Esc → 取消');
  await a.click('#leaveBtn'); await sleep(200); await a.mouse.click(5, 5); await sleep(200);
  ok(!(await visible(a)) && await a.evaluate(() => S && S.state === 'lobby'), '點視窗外面 → 取消');

  // ---- 只有自己一位真人：離開後房間直接關閉 ----
  for (let i = 0; i < 3; i++) { await a.evaluate(() => send({ type: 'addbot' })); await sleep(120); }
  await a.evaluate(() => send({ type: 'start' }));
  await a.waitForFunction(() => S && S.state === 'playing');
  await a.click('#backHallBtn'); await sleep(300);
  ok(await visible(a) && (await body(a)).includes('房間會直接關閉'), '只有自己一位真人 → 提醒「房間會直接關閉」');
  await shot(a, 'leave-alone');
  await a.click('#confirmCancel'); await sleep(200);
  ok(await a.evaluate(() => S && S.state === 'playing'), '按「繼續打牌」→ 留在牌局');
  await a.click('#backHallBtn'); await sleep(300);
  await a.click('#confirmOk');
  await a.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'));
  await sleep(300);
  ok(await a.evaluate(() => hall.rooms.length === 0), '離開後房間立刻關閉');

  // ---- 兩位真人：一人離開，房間保留，可以回來 ----
  await a.evaluate(() => send({ type: 'create' }));
  await a.waitForFunction(() => S && S.state === 'lobby');
  const b = await login(env, { name: '乙', email: 'leave-b@example.com' });
  await b.evaluate(() => send({ type: 'joinRoom', room: hall.rooms[0].id }));
  await b.waitForFunction(() => S && S.state === 'lobby');
  for (let i = 0; i < 2; i++) { await a.evaluate(() => send({ type: 'addbot' })); await sleep(120); }
  await a.evaluate(() => send({ type: 'start' }));
  await a.waitForFunction(() => S && S.state === 'playing');
  await a.click('#backHallBtn'); await sleep(300);
  ok((await body(a)).includes('回到房間'), '還有其他真人 → 說明可以「回到房間」');
  await a.click('#confirmOk');
  await a.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'));
  await sleep(300);
  ok(await a.evaluate(() => hall.rooms.length === 1 && hall.rooms[0].mine && document.getElementById('roomList').textContent.includes('回到房間')), '房間保留，大廳顯示「回到房間」');
  await a.evaluate(() => send({ type: 'joinRoom', room: hall.rooms[0].id }));
  await a.waitForFunction(() => S && S.state === 'playing' && !document.getElementById('game').classList.contains('hidden'));
  ok(true, '從大廳「回到房間」→ 回到牌局');

  // 兩人都離開 → 關閉
  await a.evaluate(() => document.getElementById('backHallBtn').click()); await sleep(300); await a.click('#confirmOk');
  await a.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'));
  await b.evaluate(() => document.getElementById('backHallBtn').click()); await sleep(300);
  ok((await body(b)).includes('房間會直接關閉'), '剩下的乙變成唯一真人 → 提醒房間會關閉');
  await b.click('#confirmOk');
  await sleep(500);
  ok(await a.evaluate(() => hall.rooms.length === 0), '最後一位真人離開 → 房間關閉，大廳即時更新');
  ok(nativeDialogs === 0, '沒有跳出瀏覽器內建的彈窗');
});

'use strict';
// 手牌點選、打牌；畫面更新時沿用原本的牌 (不閃爍)；牌面圖有快取
const { ok, run, login, startSoloGame, driveUntil, sleep, shot, PHONE } = require('./helpers');

run(async (env) => {
  const page = await login(env, { name: '選牌', viewport: PHONE });
  // 只算真的從網路下載的牌面圖 (從瀏覽器快取讀出來的不算)
  let svgRequests = 0;
  page.on('response', (r) => { if (r.url().endsWith('.svg') && !r.fromCache()) svgRequests++; });
  await startSoloGame(page);
  const myTurn = await driveUntil(page, () => S.phase === 'discard' && S.turn === S.you && document.querySelectorAll('#myHand .tile').length >= 14, { timeout: 90000 });
  ok(myTurn, '輪到自己出牌');
  const before = svgRequests;

  // 每張牌做記號，之後檢查是不是同一個元素
  await page.evaluate(() => { let n = 0; for (const e of document.querySelectorAll('.tile')) e.__id = ++n; });
  await page.tap('#myHand .tile:nth-child(3)');
  await sleep(300);
  const r1 = await page.evaluate(() => {
    const sel = document.querySelector('#myHand .tile.sel');
    const tiles = [...document.querySelectorAll('.tile')];
    return { sel: !!sel, tag: sel && sel.querySelector('.seltag') ? sel.querySelector('.seltag').textContent : '', kept: tiles.filter((e) => e.__id).length, total: tiles.length, dim: document.getElementById('myHand').classList.contains('has-sel') };
  });
  ok(r1.sel && r1.tag === '再點一次打出', '點一張牌 → 上浮並顯示「再點一次打出」');
  ok(r1.dim, '選牌時其他牌變暗');
  ok(r1.kept === r1.total, `選牌時畫面上 ${r1.total} 張牌全部沿用原元素 (不重建、不閃爍)`);
  await shot(page, 'tiles-selected');

  await page.tap('#myHand .tile:nth-child(6)');
  await sleep(300);
  const idx = await page.evaluate(() => [...document.querySelectorAll('#myHand .tile')].findIndex((e) => e.classList.contains('sel')));
  ok(idx === 5, '改點另一張 → 選取移到第 6 張');

  const handBefore = await page.evaluate(() => document.querySelectorAll('#myHand .tile').length);
  const poolBefore = await page.evaluate(() => S.seats[S.you].discards.length);
  await page.tap('#myHand .tile:nth-child(6)');
  await page.waitForFunction((n) => S.seats[S.you].discards.length > n, {}, poolBefore);
  const r2 = await page.evaluate(() => document.querySelectorAll('#myHand .tile').length);
  ok(r2 === handBefore - 1, `再點一次 → 打出 (手牌 ${handBefore} → ${r2} 張)`);
  // 等電腦們出牌一輪，畫面更新好幾次，再輪到自己摸牌
  await page.waitForFunction(() => S.phase === 'discard' && S.turn === S.you, { timeout: 30000 }).catch(() => {});
  await sleep(300);
  const r3 = await page.evaluate(() => {
    const hand = [...document.querySelectorAll('#myHand .tile')];
    return { hand: hand.length, kept: hand.filter((e) => e.__id).length };
  });
  ok(r3.kept >= r3.hand - 1, `電腦出牌、畫面多次更新後，手牌沿用原元素 ${r3.kept} 張 (只有新摸的牌是新的，共 ${r3.hand} 張)`);
  ok(svgRequests - before <= 2, `牌局進行中幾乎不再從網路下載牌面圖 (${svgRequests - before} 次)`);
});

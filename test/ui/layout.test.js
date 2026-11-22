'use strict';
// 各種螢幕尺寸 (RWD)：不會左右超出、自己的牌河不被手牌區蓋住、上方列不會擠成三行
const { ok, run, login, startSoloGame, driveUntil, sleep, shot, PHONE } = require('./helpers');

const SIZES = [
  ['手機直向', PHONE],
  ['小手機', { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['手機橫向', { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
  ['筆電', { width: 1280, height: 720 }],
  ['桌機', { width: 1400, height: 900 }],
];

run(async (env) => {
  for (const [label, vp] of SIZES) {
    const page = await login(env, { name: label, viewport: vp });
    const hallW = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(hallW <= vp.width, `${label} ${vp.width}x${vp.height}：大廳沒有左右超出 (${hallW}px)`);
    await startSoloGame(page);
    // 打到自己牌河有幾張牌、又輪到自己
    const ready = await driveUntil(page, () => S.phase === 'discard' && S.turn === S.you && S.seats[S.you].discards.length >= 3, { timeout: 120000, claim: 'pass' });
    ok(ready, `${label}：打了幾輪，輪到自己出牌`);
    await sleep(300);
    const m = await page.evaluate(() => {
      const me = document.getElementById('me').getBoundingClientRect();
      const pool = [...document.querySelectorAll('#pool0 .tile')];
      const topbar = document.getElementById('topbar');
      return {
        width: document.documentElement.scrollWidth,
        covered: pool.filter((t) => t.getBoundingClientRect().bottom > me.top + 1).length,
        pool: pool.length,
        hand: document.querySelectorAll('#myHand .tile').length,
        handVisible: [...document.querySelectorAll('#myHand .tile')].every((t) => { const r = t.getBoundingClientRect(); return r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1; }),
        topbarH: topbar.offsetHeight,
      };
    });
    ok(m.width <= vp.width, `${label}：牌局畫面沒有左右超出 (${m.width}px)`);
    ok(m.covered === 0, `${label}：自己牌河 ${m.pool} 張都沒被手牌區蓋住`);
    ok(m.handVisible, `${label}：${m.hand} 張手牌都在畫面內`);
    ok(m.topbarH <= 90, `${label}：上方列高度 ${m.topbarH}px (不會擠成三行)`);
    await shot(page, `layout-${vp.width}x${vp.height}`);
    await page.close(); // 唯一真人離開 → 房間關閉，下一個尺寸重新開
    await sleep(300);
  }
});

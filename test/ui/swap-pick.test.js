'use strict';
// 換牌取牌：某家只剩一張時畫面自動選好 (不能取消)；三家都只剩一張時不用按，自動取完
process.env.BOT_DELAY = process.env.BOT_DELAY || '80';
const { ok, run, login, startSoloGame, drive, sleep, shot } = require('./helpers');

run(async (env) => {
  const page = await login(env, { name: '取牌' });
  await startSoloGame(page);
  const seen = { partial: null, all: null };
  const t0 = Date.now();
  // 一直打，直到遇過「第 3 位取牌 (一家沒得選)」與「第 4 位取牌 (三家都沒得選)」
  while (Date.now() - t0 < 240000 && !(seen.partial && seen.all)) {
    const st = await page.evaluate(() => {
      if (!S || S.phase !== 'swapPick' || S.turn !== S.you) return null;
      const others = [0, 1, 2, 3].filter((p) => p !== S.you);
      const forced = others.filter((p) => S.seats[p].cover.filter(Boolean).length === 1);
      const k = (p) => (p - S.you + 4) % 4;
      // 只剩一張的那家：畫面上那張已選好、而且不能點
      const forcedOk = forced.every((p) => {
        const pool = document.getElementById('pool' + k(p));
        const sel = pool.querySelectorAll('.cover .tile.sel');
        return sel.length === 1 && !pool.querySelector('.cover .tile.pickable');
      });
      const btn = [...document.querySelectorAll('#actions button')].find((b) => b.textContent.includes('確定取牌'));
      return { forced: forced.length, forcedOk, btn: btn ? btn.textContent : null, hint: document.getElementById('actions').textContent };
    });
    if (st && st.forced === 3 && !seen.all) {
      seen.all = st;
      await shot(page, 'swap-pick-all-forced');
      // 什麼都不按，等伺服器自動取完
      const auto = await page.waitForFunction(() => !(S.phase === 'swapPick' && S.turn === S.you), { timeout: 5000 }).then(() => true, () => false);
      seen.all.auto = auto;
      continue;
    }
    if (st && st.forced >= 1 && st.forced < 3 && !seen.partial) {
      seen.partial = st;
      await shot(page, 'swap-pick-partial');
    }
    // 其他情況照常推進 (自己取牌時選每家第一張)
    await drive(page, { claim: 'pass', next: true });
    await sleep(80);
  }
  ok(!!seen.partial, '遇到「只有一家剩一張」的取牌回合');
  if (seen.partial) {
    ok(seen.partial.forcedOk, '那一家的牌已自動選好，而且不能取消');
    ok(/1\/3|2\/3/.test(seen.partial.btn || '') && seen.partial.hint.includes('已幫你選好'), `按鈕已算進自動選的那張 (${seen.partial.btn})，並提示「已幫你選好」`);
  }
  ok(!!seen.all, '遇到「三家都只剩一張」的取牌回合');
  if (seen.all) {
    ok(seen.all.forcedOk && !seen.all.btn && seen.all.hint.includes('已自動幫你取牌'), '三家都自動選好，不顯示「確定取牌」按鈕');
    ok(seen.all.auto, '不用按任何東西，伺服器自動取完牌');
  }
});

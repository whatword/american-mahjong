'use strict';
// 玩家說話的對話框：打牌、吃碰槓、胡牌都會跳出 (電腦也會)；胡牌後結算畫面延後出現
const { ok, run, login, startSoloGame, drive, sleep, shot, PHONE, DESKTOP } = require('./helpers');

// 在頁面裡記錄：說話事件、出現過的對話框種類、每個對話框遮到海底的牌幾張
function watch() {
  window.__says = [];
  window.__seen = new Set();
  window.__bubbles = 0;
  window.__covering = [];
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.type === 'say') window.__says.push(m); });
  new MutationObserver((muts) => {
    for (const mu of muts) for (const el of mu.addedNodes) {
      if (!el.classList || !el.classList.contains('say')) continue;
      for (const c of el.classList) window.__seen.add(c);
      window.__bubbles++;
      const b = el.getBoundingClientRect();
      const hit = [...document.querySelectorAll('#center .pool .tile')].filter((t) => {
        const r = t.getBoundingClientRect();
        return Math.min(b.right, r.right) - Math.max(b.left, r.left) > 1 && Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top) > 1;
      }).length;
      if (hit) window.__covering.push({ cls: el.className, hit, pool: document.querySelectorAll('#center .pool .tile').length });
    }
  }).observe(document.getElementById('sayLayer'), { childList: true });
}

run(async (env) => {
  // 先用手機打一段，檢查對話框不遮海底
  const phone = await login(env, { name: '手機', viewport: PHONE });
  await phone.evaluate(watch);
  await startSoloGame(phone);
  const tp = Date.now();
  while (Date.now() - tp < 40000) { await drive(phone, { claim: 'take', next: true }); await sleep(120); }
  const pc = await phone.evaluate(() => ({ n: window.__bubbles, cover: window.__covering }));
  ok(pc.n > 20 && pc.cover.length === 0, `手機：${pc.n} 個對話框都沒有遮到海底的牌` + (pc.cover.length ? ` (遮到 ${pc.cover.length} 次：${JSON.stringify(pc.cover.slice(0, 3))})` : ''));
  await shot(phone, 'say-phone');
  await phone.close();
  await sleep(300);

  const page = await login(env, { name: '說話', viewport: DESKTOP });
  await page.evaluate(watch);
  await startSoloGame(page);
  // 打到有人胡牌 (自己能碰能胡就碰就胡)，或流局後再開一局
  const t0 = Date.now();
  let resultAt = null, modalShownAt = null;
  while (Date.now() - t0 < 150000) {
    await drive(page, { claim: 'take' });
    const st = await page.evaluate(() => ({ over: S.phase === 'over', win: S.result && !S.result.draw, modal: !document.getElementById('resultModal').classList.contains('hidden'), seen: [...window.__seen] }));
    if (st.over && st.win && !resultAt) { resultAt = Date.now(); await shot(page, 'say-win'); }
    if (resultAt && st.modal && !modalShownAt) modalShownAt = Date.now();
    if (st.over && !st.win) await page.evaluate(() => send({ type: 'next' }));
    if (modalShownAt && st.seen.includes('say-call')) break;
    await sleep(120);
  }
  const says = await page.evaluate(() => window.__says);
  const seen = await page.evaluate(() => [...window.__seen]);
  const kinds = {};
  for (const s of says) kinds[s.kind] = (kinds[s.kind] || 0) + 1;
  console.log('     說話事件：', JSON.stringify(kinds));
  ok(new Set(says.filter((s) => s.kind === 'discard').map((s) => s.seat)).size === 4, '四家打牌都會說出牌名 (包含三台電腦)');
  ok(seen.includes('say-discard'), '畫面出現打牌的對話框');
  ok(seen.includes('say-call'), '畫面出現吃／碰／槓的對話框');
  ok(seen.includes('say-win') && resultAt, '有人胡牌時出現「胡！」或「自摸！」的對話框');
  ok(modalShownAt && modalShownAt - resultAt >= 1000, `結算畫面延後約 ${modalShownAt && resultAt ? ((modalShownAt - resultAt) / 1000).toFixed(1) : '?'} 秒才出現，先讓大家看到胡牌`);
  const pos = await page.evaluate(() => {
    const el = document.querySelector('#sayLayer .say');
    if (!el) return true;
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  });
  ok(pos, '對話框在畫面範圍內');
  const dc = await page.evaluate(() => ({ n: window.__bubbles, cover: window.__covering }));
  ok(dc.cover.length === 0, `電腦版：${dc.n} 個對話框都沒有遮到海底的牌` + (dc.cover.length ? ` (遮到 ${dc.cover.length} 次：${JSON.stringify(dc.cover.slice(0, 3))})` : ''));
});

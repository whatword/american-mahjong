'use strict';
// 語音朗讀：只用 Google 國語（臺灣）；沒有這個聲音時不提供
// 自動化的 Chrome 載入不到 Google 語音，所以模擬瀏覽器的語音清單，並把朗讀換成記錄器
const { ok, run, login, startSoloGame, driveUntil, sleep, shot } = require('./helpers');

const fakeVoices = (withGoogle) => {
  window.__spoken = [];
  localStorage.setItem('mj_voice', 'on'); // 模擬之前已開啟語音
  const list = [
    { name: 'Meijia', lang: 'zh-TW', localService: true },
    { name: 'Eddy (Chinese (Taiwan))', lang: 'zh-TW', localService: true },
    ...(withGoogle ? [{ name: 'Google 國語（臺灣）', lang: 'zh-TW', localService: false }, { name: 'Google 普通话（中国大陆）', lang: 'zh-CN', localService: false }] : []),
  ];
  speechSynthesis.getVoices = () => list;
  speechSynthesis.speak = (u) => window.__spoken.push({ text: u.text, voice: u.voice && u.voice.name, rate: u.rate });
  speechSynthesis.cancel = () => {};
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
};

run(async (env) => {
  // ---- 有 Google 國語（臺灣）----
  const p = await login(env, { name: '有聲', beforeLoad: `(${fakeVoices})(true)` });
  await startSoloGame(p);
  await p.waitForSelector('#voiceToggle');
  ok((await p.$eval('#voiceToggle', (e) => e.textContent)).includes('語音開'), '之前開啟過 → 進牌局時是「語音開」');
  await p.click('#voiceToggle');
  const panel = await p.evaluate(() => ({ name: document.getElementById('vpVoiceName').textContent, disabled: document.getElementById('vpOn').disabled, select: !!document.getElementById('vpVoice') }));
  ok(panel.name === 'Google 國語（臺灣）' && !panel.disabled && !panel.select, '面板只顯示 Google 國語（臺灣），沒有聲音選單');
  await shot(p, 'voice-panel-google', { clip: { x: 880, y: 0, width: 400, height: 340 } });
  await p.evaluate(() => { const r = document.getElementById('vpRate'); r.value = '1.3'; r.dispatchEvent(new Event('input')); });
  await p.click('#vpTest');
  const t = await p.evaluate(() => window.__spoken.at(-1));
  ok(t && t.voice === 'Google 國語（臺灣）' && Math.abs(t.rate - 1.3) < 0.01, '試聽用 Google 國語（臺灣）與設定的語速');
  await p.keyboard.press('Escape');
  await driveUntil(p, () => window.__spoken.length > 12, { timeout: 40000 });
  const spoken = await p.evaluate(() => window.__spoken);
  ok(spoken.length > 12 && spoken.every((x) => x.voice === 'Google 國語（臺灣）'), `打牌時念了 ${spoken.length} 句，全部用 Google 國語（臺灣）`);
  ok(spoken.some((x) => /[萬筒條]$|^[東南西北]$|紅中|發財|白板/.test(x.text)), '念出牌名');
  // 關閉後不再念
  await p.click('#voiceToggle'); await p.click('#vpOn'); await p.keyboard.press('Escape');
  const n = await p.evaluate(() => window.__spoken.length);
  await driveUntil(p, () => false, { timeout: 3000 });
  ok((await p.evaluate(() => window.__spoken.length)) === n, '關閉後不再念');
  await p.close();
  await sleep(300);

  // ---- 沒有 Google 語音的瀏覽器 ----
  const q = await login(env, { name: '無聲', beforeLoad: `(${fakeVoices})(false)` });
  await startSoloGame(q);
  await q.waitForSelector('#voiceToggle');
  ok((await q.$eval('#voiceToggle', (e) => e.textContent)).includes('語音關'), '沒有 Google 國語（臺灣）→ 顯示「語音關」');
  await q.click('#voiceToggle');
  const p2 = await q.evaluate(() => ({ disabled: document.getElementById('vpOn').disabled, tip: document.getElementById('vpTip').textContent }));
  ok(p2.disabled && p2.tip.includes('電腦版 Google Chrome'), '開關不能勾，說明要用電腦版 Chrome');
  await q.keyboard.press('Escape');
  await driveUntil(q, () => false, { timeout: 3000 });
  ok((await q.evaluate(() => window.__spoken.length)) === 0, '不會改用 Meijia 等其他聲音');
  ok((await q.evaluate(() => localStorage.getItem('mj_voice'))) === 'on', '原本的「開啟」設定沒有被蓋掉');
});

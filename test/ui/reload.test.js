'use strict';
// 網頁程式更新後，重新連線登入時自動重新整理，不會一直跑舊版
const fs = require('fs');
const path = require('path');
const { ok, run, login, sleep } = require('./helpers');

const FILE = path.join(__dirname, '..', '..', 'public', 'style.css');

run(async (env) => {
  const page = await login(env, { name: '更新', email: 'reload@example.com' });
  await page.evaluate(() => { window.__oldPage = true; });

  // 1. 沒有更新：斷線後重新登入，不會重新整理
  await page.evaluate(() => ws.close());
  await page.waitForFunction(() => !document.getElementById('login').classList.contains('hidden'));
  await page.evaluate(() => document.getElementById('loginForm').requestSubmit());
  await page.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'));
  ok(await page.evaluate(() => window.__oldPage === true), '網頁程式沒更新 → 重新登入時不重新整理');

  // 2. 網頁程式更新了 (改檔案時間模擬改版)，斷線後重新登入 → 自動重新整理、自動登入
  const st = fs.statSync(FILE);
  try {
    const later = new Date(Date.now() + 60000);
    fs.utimesSync(FILE, later, later);
    await page.evaluate(() => ws.close());
    await page.waitForFunction(() => !document.getElementById('login').classList.contains('hidden'));
    const nav = page.waitForNavigation({ timeout: 10000 }).then(() => true, () => false);
    await page.evaluate(() => document.getElementById('loginForm').requestSubmit());
    ok(await nav, '網頁程式已更新 → 重新登入時自動重新整理頁面');
    await page.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'), { timeout: 10000 });
    await sleep(200);
    ok(await page.evaluate(() => window.__oldPage === undefined && me && me.email === 'reload@example.com'), '重新整理後載入新版，並自動登入回到大廳');
  } finally {
    fs.utimesSync(FILE, st.atime, st.mtime); // 還原檔案時間
  }
});

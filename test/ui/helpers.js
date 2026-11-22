'use strict';
// 畫面測試共用工具：啟動遊戲伺服器、開 Chrome、登入、自動推進牌局
// 需要電腦上有 Google Chrome。找不到時會「略過」(結束碼 0)，不算失敗
// 指定 Chrome 位置：CHROME_PATH=/path/to/chrome npm run test:ui
// 存截圖：SCREENSHOTS=1 npm run test:ui  (存在 test/ui/screenshots/)
const path = require('path');
const os = require('os');
const fs = require('fs');

process.env.STATS_FILE = path.join(os.tmpdir(), `mj-stats-ui-${process.pid}.json`);
process.env.BOT_DELAY = process.env.BOT_DELAY || '300';
process.env.DICE_SHOW_MS = process.env.DICE_SHOW_MS || '200';
process.env.SEAT_SHOW_MS = process.env.SEAT_SHOW_MS || '200';

const { ok, finish } = require('../helpers');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);

function findChrome() {
  return CHROME_CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

// 啟動伺服器 (隨機 port) 與 Chrome；回傳 { browser, url, close }
async function start() {
  const chrome = findChrome();
  if (!chrome) {
    console.log('略過：找不到 Google Chrome (可用 CHROME_PATH 指定位置)');
    process.exit(0);
  }
  const puppeteer = require('puppeteer-core');
  const { server } = require('../../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await puppeteer.launch({ executablePath: chrome, args: ['--no-first-run'] });
  const close = async () => {
    await browser.close().catch(() => {});
    server.close();
    fs.rmSync(process.env.STATS_FILE, { force: true });
  };
  return { browser, url, close };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 800 };

// 每位玩家用獨立的瀏覽器環境 (localStorage 不互相影響)，登入並等到大廳出現
async function login(env, { name = '測試', email, viewport = DESKTOP, beforeLoad } = {}) {
  const ctx = await env.browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  if (beforeLoad) await page.evaluateOnNewDocument(beforeLoad);
  await page.goto(env.url);
  const mail = email || `ui-${Math.random().toString(36).slice(2)}@example.com`;
  await page.evaluate((n, e) => {
    document.getElementById('name').value = n;
    document.getElementById('email').value = e;
    document.getElementById('loginForm').requestSubmit();
  }, name, mail);
  await page.waitForFunction(() => !document.getElementById('hall').classList.contains('hidden'));
  return page;
}

// 開一桌，補滿電腦並開始；等到進入牌局
async function startSoloGame(page, bots = 3) {
  await page.evaluate(() => send({ type: 'create' }));
  await page.waitForFunction(() => S && S.state === 'lobby');
  for (let i = 0; i < bots; i++) { await page.evaluate(() => send({ type: 'addbot' })); await sleep(120); }
  await page.evaluate(() => send({ type: 'start' }));
  await page.waitForFunction(() => S && S.state === 'playing');
}

// 自動推進一步：選座位、擲骰、換牌、出牌、吃碰 (opts.claim: 'pass' | 'take' 能胡就胡、能碰就碰)
function drive(page, opts = {}) {
  return page.evaluate((o) => {
    if (!S || S.state !== 'playing') return null;
    const ph = S.phase;
    if (ph === 'seatPick') { const i = S.seatPick.slots.findIndex((x) => x.owner === null); if (i >= 0 && !S.seatPick.slots.some((x) => x.owner === S.you)) send({ type: 'seatpick', slot: i }); }
    if (ph === 'dice' && S.dice.thrower === S.you && !S.dice.values) send({ type: 'roll' });
    if (ph === 'swapAsk' && S.dealer === S.you) send({ type: 'skipswap' });
    if (ph === 'swapSelect' && !S.seats[S.you].confirmed) send({ type: 'cover', tiles: S.hand.slice(0, 3) });
    if (ph === 'swapPick' && S.turn === S.you) { const picks = {}; for (let q = 0; q < 4; q++) if (q !== S.you) picks[q] = S.seats[q].cover.indexOf(true); send({ type: 'swappick', picks }); }
    if (ph === 'discard' && S.turn === S.you && !o.noDiscard) {
      if (S.actions && S.actions.hu && o.claim === 'take') send({ type: 'hu' });
      else { const ok = (S.actions && S.actions.forbid) || []; const t = S.drawn != null ? S.drawn : S.hand.find((x) => !ok.includes(x)); send({ type: 'discard', tile: t }); }
    }
    if (ph === 'claim' && S.claim && !S.claim.resp) {
      const c = S.claim.opts;
      if (o.claim === 'take') send(c.hu ? { type: 'hu' } : c.pong ? { type: 'pong' } : c.chi.length ? { type: 'chi', tiles: c.chi[0] } : { type: 'pass' });
      else send(c.forced ? { type: 'hu' } : { type: 'pass' });
    }
    if (ph === 'over' && o.next) send({ type: 'next' });
    return ph;
  }, opts);
}

// 一直推進，直到條件成立或逾時
async function driveUntil(page, cond, { timeout = 60000, ...opts } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await page.evaluate(cond)) return true;
    await drive(page, opts);
    await sleep(150);
  }
  return false;
}

async function shot(page, name, options = {}) {
  if (!process.env.SCREENSHOTS) return;
  const dir = path.join(__dirname, 'screenshots');
  fs.mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + '.png'), ...options });
}

// 包住整個測試：出錯也會關掉 Chrome 與伺服器
async function run(fn) {
  const env = await start();
  try {
    await fn(env);
  } catch (e) {
    ok(false, '測試中斷：' + (e && e.message));
  } finally {
    await env.close();
  }
  finish();
}

module.exports = { ok, run, login, startSoloGame, drive, driveUntil, sleep, shot, PHONE, DESKTOP };

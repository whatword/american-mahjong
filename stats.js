'use strict';
// 計分板：每位玩家 (以 email 區分) 與每台電腦 (以名稱區分) 的累計戰績，存在 data/stats.json
const fs = require('fs');
const path = require('path');

const FILE = process.env.STATS_FILE || path.join(__dirname, 'data', 'stats.json');
let db = {}; // key -> 戰績
let saveTimer = null;

function load() {
  try {
    db = JSON.parse(fs.readFileSync(FILE, 'utf8')) || {};
  } catch {
    db = {};
  }
  // 舊資料沒有分「跟玩家／跟電腦」的金額：只跟一種對手有過輸贏的，可以確定歸類；其餘留在「舊紀錄（未分類）」
  for (const e of Object.values(db)) {
    if (e.moneyVsHuman !== undefined) continue;
    const metHuman = e.vsHuman.w + e.vsHuman.l > 0;
    const metBot = e.vsBot.w + e.vsBot.l > 0;
    e.moneyVsHuman = metHuman && !metBot ? e.money : 0;
    e.moneyVsBot = metBot && !metHuman ? e.money : 0;
  }
}

// 延遲寫檔，並先寫暫存檔再改名，避免寫到一半當機造成檔案損毀
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      const tmp = FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db));
      fs.renameSync(tmp, FILE);
    } catch (e) {
      console.error('計分板存檔失敗', e.message);
    }
  }, 500);
}

function flush() {
  if (!saveTimer) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(db));
}

// 座位 -> 計分板身分
function keyOf(seat) {
  if (!seat) return null;
  if (seat.bot) return 'b:' + seat.name;
  return seat.token ? 'u:' + seat.token : null;
}

function entry(seat) {
  const key = keyOf(seat);
  if (!key) return null;
  if (!db[key]) {
    db[key] = {
      name: seat.name, bot: !!seat.bot, money: 0, moneyVsHuman: 0, moneyVsBot: 0, hands: 0, wins: 0, selfDraws: 0, dealIns: 0,
      vsHuman: { w: 0, l: 0 }, vsBot: { w: 0, l: 0 },
    };
  }
  db[key].name = seat.name; // 暱稱以最新的為準
  return db[key];
}

// 記錄一局結果。seats: 房間座位；result: { draw, winner, from, selfDraw, delta }
// 對戰勝負：胡牌者「贏」每一位付錢的人，付錢的人「輸」給胡牌者；依對手是真人或電腦分開統計
function recordHand(seats, result) {
  const es = seats.map(entry);
  es.forEach((e) => { if (e) e.hands++; });
  if (result && !result.draw) {
    const { winner, delta } = result;
    const we = es[winner];
    if (we) {
      we.wins++;
      if (result.selfDraw) we.selfDraws++;
    }
    for (let p = 0; p < 4; p++) {
      if (es[p]) es[p].money += delta[p] || 0;
      if (p === winner || !(delta[p] < 0)) continue; // 只有付錢的人和胡牌者之間算一場對戰
      if (!result.selfDraw && es[p]) es[p].dealIns++;
      // 金額依對手是真人或電腦分開累計：胡牌者向 p 收 amt，p 付給胡牌者 amt
      const amt = -delta[p];
      if (we) we[seats[p].bot ? 'moneyVsBot' : 'moneyVsHuman'] += amt;
      if (es[p]) es[p][seats[winner].bot ? 'moneyVsBot' : 'moneyVsHuman'] -= amt;
      if (we) (seats[p].bot ? we.vsBot : we.vsHuman).w++;
      if (es[p]) (seats[winner].bot ? es[p].vsBot : es[p].vsHuman).l++;
    }
  }
  save();
}

const rate = (w, n) => (n ? w / n : null);

// 計分板：金額由多到少。真人顯示「暱稱(email)」
function board(myEmail) {
  const list = Object.entries(db).map(([key, e]) => ({
    id: key,
    you: key === 'u:' + myEmail,
    name: e.name,
    email: key.startsWith('u:') ? key.slice(2) : null,
    bot: e.bot,
    // 總金額 = 跟玩家輸贏 + 跟電腦輸贏 (+ 無法拆分的舊紀錄)
    money: e.money,
    moneyVsHuman: e.moneyVsHuman || 0,
    moneyVsBot: e.moneyVsBot || 0,
    moneyLegacy: e.money - (e.moneyVsHuman || 0) - (e.moneyVsBot || 0),
    hands: e.hands,
    wins: e.wins,
    selfDraws: e.selfDraws,
    dealIns: e.dealIns,
    winRate: rate(e.wins, e.hands),
    vsHuman: { ...e.vsHuman, rate: rate(e.vsHuman.w, e.vsHuman.w + e.vsHuman.l) },
    vsBot: { ...e.vsBot, rate: rate(e.vsBot.w, e.vsBot.w + e.vsBot.l) },
  }));
  list.sort((a, b) => b.money - a.money || b.wins - a.wins || a.name.localeCompare(b.name));
  return list;
}

// 登入時更新暱稱：計分板以該 email 最新登入的暱稱顯示 (還沒有戰績就不建立)
function rename(email, name) {
  const e = db['u:' + email];
  if (e && e.name !== name) { e.name = name; save(); }
}

function reset() { db = {}; }

load();
module.exports = { recordHand, board, rename, flush, reset, FILE };

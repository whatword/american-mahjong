'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const G = require('./game');
const AI = require('./ai');
const Stats = require('./stats');
const Habits = require('./habits');

const PORT = process.env.PORT || 3000;
const BASE = 50; // 底錢
const TAI_VALUE = 20; // 台錢
const START_SCORE = 1000;
const BOT_NAMES = ['Claude', 'ChatGPT', 'Gemini'];
const MAX_ROOMS = 4; // 大廳最多同時 4 間房
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const DEAD_WALL = 16; // 海底保留牌數
const CLAIM_MS = 20000;
const TURN_MS = 45000;
const NEXT_HAND_MS = 15000;
const SWAP_MS = 20000;
const SEAT_MS = 30000; // 選座位等待時間
const SEAT_SHOW_MS = Number(process.env.SEAT_SHOW_MS ?? 3000); // 座位結果展示時間
const DICE_MS = 15000; // 擲骰等待時間
const DICE_SHOW_MS = Number(process.env.DICE_SHOW_MS ?? 2500); // 骰子結果展示時間
const SELECT_MS = 40000;
const PICK_MS = 30000;
const FORCED_PICK_MS = Number(process.env.FORCED_PICK_MS ?? 1500); // 每家都只剩一張可取時，自動取牌前的展示時間
const MAX_SWAPS = 2;
const BOT_DELAY = Number(process.env.BOT_DELAY ?? 700);

// ---------- 靜態檔案 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(__dirname, 'public', p));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
    // 牌面圖幾乎不會變，讓瀏覽器快取 1 天；html/js/css 每次用 ETag 確認，有更新才重新下載
    const etag = `"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}"`;
    const cache = p.startsWith('/tiles/') ? 'public, max-age=86400' : 'no-cache';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': cache }); return res.end(); }
    fs.readFile(file, (err2, data) => {
      if (err2) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ETag: etag, 'Cache-Control': cache });
      res.end(data);
    });
  });
});

const wss = new WebSocketServer({ server });
const rooms = new Map();

function send(ws, o) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(o));
}

const sortTiles = (a) => a.slice().sort((x, y) => x - y);
const tileName = (t) => (t == null ? null : G.TILE_NAMES[t]);
const tileNames = (a) => sortTiles(a).map(tileName);

class Room {
  constructor(id) {
    this.id = id;
    this.seats = [null, null, null, null];
    this.state = 'lobby'; // lobby | playing
    this.scores = [START_SCORE, START_SCORE, START_SCORE, START_SCORE];
    this.dealer = 0;
    this.streak = 0; // 連莊數
    this.round = 0; // 圈風 0-3
    this.phase = 'idle'; // discard | claim | over
    this.seq = 0;
    this.timer = null;
    this.deadline = 0;
    this.chat = [];
    this.result = null;
    this.handNo = 0;
  }

  // 打牌習慣紀錄：只記錄真人親自操作 (電腦、離線由電腦代打都不記)。ev 用函式延後計算，出錯也不能影響牌局
  habit(i, ev) {
    const s = this.seats[i];
    if (!s || s.bot || !s.ws || !s.token) return;
    try { Habits.log(s.token, { ts: Date.now(), h: this.handUid, ...ev(s) }); } catch (e) { console.error('打牌紀錄失敗', e.message); }
  }

  // ----- 座位管理 -----
  isAuto(i) { const s = this.seats[i]; return !!s && (s.bot || !s.ws); }
  humanCount() { return this.seats.filter((s) => s && !s.bot && s.ws).length; }
  host() { return this.seats.findIndex((s) => s && !s.bot && s.ws); }

  join(ws, name, token) {
    // 重連
    let idx = this.seats.findIndex((s) => s && !s.bot && s.token === token);
    if (idx >= 0) {
      const s = this.seats[idx];
      if (s.ws && s.ws !== ws) send(s.ws, { type: 'kicked' });
      s.ws = ws;
      s.name = name || s.name;
    } else {
      idx = this.seats.findIndex((s) => !s);
      if (idx < 0 || this.state === 'playing') return -1;
      this.seats[idx] = { name, token, ws, bot: false, hand: [], melds: [], flowers: [], discards: [], drawn: null };
    }
    ws.ctx = { room: this, seat: idx };
    this.sys(`${this.seats[idx].name} 加入了房間`);
    this.broadcast();
    this.maybeAct();
    hallChanged();
    return idx;
  }

  disconnect(ws) {
    const idx = ws.ctx ? ws.ctx.seat : -1;
    if (idx < 0 || !this.seats[idx] || this.seats[idx].ws !== ws) return;
    const s = this.seats[idx];
    s.ws = null;
    this.sys(`${s.name} 離線${this.state === 'playing' ? '（由電腦代打）' : ''}`);
    if (this.state === 'lobby') this.seats[idx] = null;
    // 沒有任何真人在房間 (等待中或牌局中都一樣) → 直接關閉房間
    if (this.humanCount() === 0) {
      this.close();
      return;
    }
    this.broadcast();
    this.maybeAct();
    hallChanged();
  }

  close() {
    clearTimeout(this.timer);
    this.seq++;
    rooms.delete(this.id);
    hallChanged();
  }

  addBot() {
    if (this.state !== 'lobby') return;
    const idx = this.seats.findIndex((s) => !s);
    if (idx < 0) return;
    // 電腦名稱：從這桌還沒使用的名字中隨機挑一個 (一桌最多 3 台電腦，不會重複)
    const used = new Set(this.seats.filter((x) => x && x.bot).map((x) => x.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[Math.floor(Math.random() * free.length)] : `電腦${idx + 1}`;
    this.seats[idx] = { name, bot: true, hand: [], melds: [], flowers: [], discards: [], drawn: null };
    this.broadcast();
    hallChanged();
  }

  removeSeat(i) {
    if (this.state !== 'lobby') return;
    const s = this.seats[i];
    if (s && s.bot) { this.seats[i] = null; this.broadcast(); hallChanged(); }
  }

  sys(text) { this.chat.push({ sys: true, text }); this.chat = this.chat.slice(-50); }

  // ----- 開局 -----
  startGame() {
    if (this.state !== 'lobby' || this.seats.some((s) => !s)) return;
    this.state = 'playing';
    this.scores = [START_SCORE, START_SCORE, START_SCORE, START_SCORE];
    this.dealer = 0;
    this.startDealer = 0; // 起莊者，莊家輪回此人時換圈風
    this.streak = 0;
    this.round = 0;
    this.handNo = 0;
    this.jiang = 0;
    this.sys('遊戲開始！');
    this.enterSeatPick();
    hallChanged();
  }

  // ----- 每將開始：在海底放東南西北，玩家各選一張決定座位 -----
  enterSeatPick() {
    clearTimeout(this.timer);
    this.jiang++;
    this.round = 0;
    this.streak = 0;
    this.result = null;
    this.last = null;
    this.claims = null;
    this.dice = null;
    this.breakInfo = null;
    this.wall = [];
    for (const s of this.seats) { s.hand = []; s.melds = []; s.flowers = []; s.discards = []; s.drawn = null; s.cover = null; s.migi = false; }
    // tiles: 海底上 4 張蓋著的風牌 (隨機)；owners: 位置 -> 選擇者座位；picks: 風 -> 選擇者座位
    this.seatPick = { tiles: G.shuffle([0, 1, 2, 3]), owners: [null, null, null, null], picks: {}, done: false };
    this.phase = 'seatPick';
    this.sys(`第 ${this.jiang} 將開始，請選擇座位（東南西北）`);
    this.setTimer(SEAT_MS, () => this.autoSeatPick());
    this.broadcast();
    this.maybeAct();
  }

  // slot：玩家點的是第幾張蓋牌 (0-3)，翻開後才知道是哪個風
  pickSeat(i, slot) {
    const sp = this.seatPick;
    if (this.phase !== 'seatPick' || sp.done) return;
    if (!Number.isInteger(slot) || slot < 0 || slot > 3 || sp.owners[slot] !== null) return;
    if (sp.owners.includes(i)) return;
    const wind = sp.tiles[slot];
    sp.owners[slot] = i;
    sp.picks[wind] = i;
    this.sys(`${this.seats[i].name} 選了「${['東', '南', '西', '北'][wind]}」`);
    if (Object.keys(sp.picks).length === 4) this.applySeats();
    else this.broadcast();
  }

  autoSeatPick() {
    const sp = this.seatPick;
    if (this.phase !== 'seatPick' || sp.done) return;
    for (let i = 0; i < 4 && !sp.done; i++) {
      if (sp.owners.includes(i)) continue;
      const free = [0, 1, 2, 3].filter((k) => sp.owners[k] === null);
      this.pickSeat(i, free[Math.floor(Math.random() * free.length)]);
    }
  }

  // 依選到的風重排座位：東=座位0，依打牌順序 南=1、西=2、北=3
  applySeats() {
    const sp = this.seatPick;
    sp.done = true;
    const oldSeats = this.seats.slice();
    const oldScores = this.scores.slice();
    for (let w = 0; w < 4; w++) {
      const from = sp.picks[w];
      this.seats[w] = oldSeats[from];
      this.scores[w] = oldScores[from];
      if (this.seats[w].ws && this.seats[w].ws.ctx) this.seats[w].ws.ctx.seat = w;
    }
    // 換位後 owners/picks 改成指向新座位，方便畫面顯示
    sp.owners = sp.tiles.map((w) => w);
    for (let w = 0; w < 4; w++) sp.picks[w] = w;
    this.sys(`座位決定：${this.seats.map((x, w) => `${['東', '南', '西', '北'][w]} ${x.name}`).join('、')}`);
    this.setTimer(SEAT_SHOW_MS, () => this.startHand(true));
    this.broadcast();
  }

  // 每局開始：firstHand 時先擲骰決定起莊，再由莊家擲骰決定開門位置
  startHand(firstHand = false) {
    clearTimeout(this.timer);
    this.handNo++;
    this.handUid = `${Date.now().toString(36)}-${this.id}-${this.handNo}`;
    this.wall = [];
    this.result = null;
    this.last = null;
    this.claims = null;
    this.kongDraw = false;
    for (const s of this.seats) { s.hand = []; s.melds = []; s.flowers = []; s.discards = []; s.drawn = null; s.cover = null; s.taken = []; s.confirmed = false; s.noPong = new Set(); s.migi = false; s.swapIn = null; s.forbid = null; s.justDiscarded = null; s.noRon = false; s.dn = 0; }
    this.breakInfo = null;
    this.handDice = null;
    if (firstHand) {
      this.seatPick = null;
      this.enterDice('dealer', 0); // 選到「東」的玩家擲骰決定起莊
    } else this.enterDice('break', this.dealer);
  }

  // ----- 擲骰 -----
  // 3 顆骰子；從擲骰者算 1，依打牌順序 (下家 2、對家 3、上家 4) 數到總點數的那一家
  enterDice(stage, thrower) {
    this.phase = 'dice';
    this.turn = thrower;
    this.dice = { stage, thrower, values: null, total: 0, target: -1 };
    this.setTimer(DICE_MS, () => this.rollDice(thrower));
    this.broadcast();
    this.maybeAct();
  }

  rollDice(i) {
    if (this.phase !== 'dice' || this.dice.values || i !== this.dice.thrower) return;
    const values = [0, 0, 0].map(() => 1 + Math.floor(Math.random() * 6));
    const total = values[0] + values[1] + values[2];
    const target = (i + total - 1) % 4;
    Object.assign(this.dice, { values, total, target, rolledAt: Date.now() });
    const who = this.seats[i].name;
    if (this.dice.stage === 'dealer') this.sys(`${who} 擲骰 ${values.join('、')} 共 ${total} 點，由 ${this.seats[target].name} 起莊（東風）`);
    else this.sys(`莊家 ${who} 擲骰 ${values.join('、')} 共 ${total} 點，從 ${this.seats[target].name} 的牌牆第 ${total + 1} 墩開門`);
    this.setTimer(DICE_SHOW_MS, () => this.afterDice());
    this.broadcast();
  }

  afterDice() {
    const d = this.dice;
    if (d.stage === 'dealer') {
      this.dealer = d.target;
      this.startDealer = d.target;
      return this.enterDice('break', this.dealer);
    }
    this.handDice = d.values;
    this.dealHand(d.target, d.total);
  }

  // 依骰子點數開門：每家面前 18 墩 (36 張)，從 owner 牌牆右側數 total 墩後開始抓牌
  dealHand(owner = this.dealer, total = 3) {
    const tiles = G.newWall(); // 144 張洗好依牌桌位置排列：座位 k 的牌牆為 [k*36, k*36+36)
    const start = (owner * 36 + total * 2) % tiles.length;
    this.wall = tiles.slice(start).concat(tiles.slice(0, start)); // 前端順抓，尾端為補花/槓尾
    this.breakInfo = { owner, stack: total + 1 };
    this.discardCount = 0; // 全桌已打出張數 (MIGI 判定用)
    this.discardLog = []; // 全桌出牌順序 (電腦判斷安全牌用，皆為公開資訊)
    this.called = false; // 是否有人吃/碰/槓過
    for (let r = 0; r < 16; r++) for (let i = 0; i < 4; i++) this.seats[i].hand.push(this.wall.shift());
    // 補花 (從莊家開始)
    for (let k = 0; k < 4; k++) {
      const s = this.seats[(this.dealer + k) % 4];
      this.fixFlowers(s);
    }
    for (let i = 0; i < 4; i++) {
      this.habit(i, (s) => ({ k: 'start', no: this.handNo, dealer: i === this.dealer, seatWind: '東南西北'[(i - this.dealer + 4) % 4], roundWind: '東南西北'[this.round], hand: tileNames(s.hand), flowers: s.flowers.length }));
    }
    if (this.flowerWin()) return;
    // 莊家先抽門牌 (第 17 張)，再決定是否換牌
    this.kongDraw = false;
    this.drawFor(this.dealer, false);
    this.sys(`莊家 ${this.seats[this.dealer].name} 抽門牌`);
    if (this.flowerWin()) return;
    this.swapsDone = 0;
    this.enterSwapAsk();
  }

  // ----- 換牌 (莊家決定是否換，最多 2 次) -----
  // swapAsk: 莊家決定 -> swapSelect: 每人選 3 張蓋牌並確定 -> swapPick: 從莊家開始依序，向其他三家各取一張
  enterSwapAsk() {
    this.turn = this.dealer;
    this.phase = 'swapAsk';
    this.setTimer(SWAP_MS, () => this.finishSwap());
    this.broadcast();
    this.maybeAct();
  }

  finishSwap() {
    if (!this.phase.startsWith('swap')) return;
    for (const s of this.seats) { s.cover = null; s.taken = []; s.confirmed = false; }
    // 莊家已在開局抽過門牌 (17 張)，換牌結束直接出牌，不再摸牌
    const d = this.seats[this.dealer];
    if (d.drawn == null || !d.hand.includes(d.drawn)) d.drawn = d.hand[d.hand.length - 1]; // 門牌被換走時，以最後換進的牌當作摸進的牌
    this.enterDiscard(this.dealer);
  }

  startSwapSelect() {
    this.phase = 'swapSelect';
    for (const s of this.seats) { s.cover = null; s.taken = []; s.confirmed = false; }
    this.setTimer(SELECT_MS, () => this.autoSelectAll());
    this.broadcast();
    this.maybeAct();
  }

  confirmCover(i, tiles) {
    const s = this.seats[i];
    if (this.phase !== 'swapSelect' || s.confirmed) return;
    if (!Array.isArray(tiles) || tiles.length !== 3 || !tiles.every((t) => Number.isInteger(t) && t >= 0 && t < 34)) return;
    const need = G.counts(tiles);
    const have = G.counts(s.hand);
    if (need.some((n, t) => n > have[t])) return;
    for (const t of tiles) s.hand.splice(s.hand.indexOf(t), 1);
    s.cover = G.shuffle(tiles.slice()); // 蓋牌時洗一次，看不出原本選牌順序；之後取牌不再洗
    s.confirmed = true;
    if (this.seats.every((x) => x.confirmed)) this.startSwapPick();
    else this.broadcast();
  }

  autoSelectAll() {
    for (let i = 0; i < 4 && this.phase === 'swapSelect'; i++) {
      const s = this.seats[i];
      if (s.confirmed) continue;
      this.confirmCover(i, this.isAuto(i) ? AI.chooseWorst(this, i, 3) : G.shuffle(s.hand.slice()).slice(0, 3));
    }
  }

  startSwapPick() {
    this.phase = 'swapPick';
    this.pickIdx = 0;
    this.turn = this.dealer;
    this.setTimer(this.pickWait(), () => this.autoPick(this.turn));
    this.broadcast();
    this.maybeAct();
  }

  // 輪到的玩家如果每一家都只剩一張蓋牌可取 (沒得選)，就直接幫他取，只留一點時間讓大家看到
  pickWait() {
    const i = this.turn;
    const forced = this.seats.every((s, p) => p === i || (s.cover && s.cover.filter((t) => t !== null).length === 1));
    return forced ? FORCED_PICK_MS : PICK_MS;
  }

  autoPick(i) {
    if (this.phase !== 'swapPick' || this.turn !== i) return;
    const picks = {};
    for (let p = 0; p < 4; p++) {
      if (p === i) continue;
      const slots = this.seats[p].cover.map((t, k) => (t === null ? -1 : k)).filter((k) => k >= 0);
      picks[p] = slots[Math.floor(Math.random() * slots.length)];
    }
    this.doPick(i, picks);
  }

  doPick(i, picks) {
    if (this.phase !== 'swapPick' || this.turn !== i || !picks) return;
    for (let p = 0; p < 4; p++) {
      if (p === i) continue;
      const k = picks[p];
      if (!Number.isInteger(k) || k < 0 || k > 2 || this.seats[p].cover[k] === null) return;
    }
    for (let p = 0; p < 4; p++) {
      if (p === i) continue;
      const k = picks[p];
      this.seats[i].taken.push(this.seats[p].cover[k]);
      this.seats[p].cover[k] = null;
    }
    this.pickIdx++;
    if (this.pickIdx >= 4) return this.finishPick();
    this.turn = (this.dealer + this.pickIdx) % 4;
    this.setTimer(this.pickWait(), () => this.autoPick(this.turn));
    this.broadcast();
    this.maybeAct();
  }

  finishPick() {
    // swapIn：這次換進來的牌，畫面上標示給本人看，打出第一張牌後清除
    for (const s of this.seats) { s.hand.push(...s.taken); s.swapIn = s.taken.slice(); s.taken = []; s.cover = null; s.confirmed = false; }
    this.swapsDone++;
    this.sys(`第 ${this.swapsDone} 次換牌完成`);
    if (this.swapsDone >= MAX_SWAPS) this.finishSwap();
    else this.enterSwapAsk();
  }

  fixFlowers(s) {
    let guard = 0;
    while (guard++ < 50) {
      const fi = s.hand.findIndex(G.isFlower);
      if (fi < 0) break;
      s.flowers.push(s.hand.splice(fi, 1)[0]);
      s.hand.push(this.wall.pop());
    }
  }

  // 摸牌 (fromBack: 槓後補牌，從牌尾摸)；回傳摸到的非花牌
  drawFor(i, fromBack) {
    const s = this.seats[i];
    let t;
    do {
      t = fromBack ? this.wall.pop() : this.wall.shift();
      if (G.isFlower(t)) s.flowers.push(t);
      else break;
      fromBack = true; // 補花從牌尾
    } while (this.wall.length > 0);
    s.hand.push(t);
    s.drawn = t;
    return t;
  }

  // 八仙過海 / 七搶一 (各 8 台)，成立即結束本局
  flowerWin() {
    const eight = this.seats.findIndex((s) => s.flowers.length === 8);
    if (eight >= 0) {
      this.endHand({ winner: eight, from: -1, tile: null, selfDraw: true, special: '八仙過海', r: { tai: 8, items: [{ name: '八仙過海', tai: 8 }] } });
      return true;
    }
    const seven = this.seats.findIndex((s) => s.flowers.length === 7);
    const one = this.seats.findIndex((s) => s.flowers.length === 1);
    if (seven >= 0 && one >= 0) {
      this.endHand({ winner: seven, from: one, tile: null, selfDraw: false, special: '七搶一', r: { tai: 8, items: [{ name: '七搶一', tai: 8 }] } });
      return true;
    }
    return false;
  }

  turnDraw(i) {
    if (this.wall.length <= DEAD_WALL) return this.endHand(null);
    this.seats[i].justDiscarded = null;
    this.seats[i].noPong.clear(); // 輪到自己 → 過碰解除
    this.kongDraw = false;
    this.drawFor(i, false);
    if (this.flowerWin()) return;
    this.enterDiscard(i);
  }

  enterDiscard(i) {
    this.turn = i;
    this.phase = 'discard';
    this.claims = null;
    this.setTimer(TURN_MS, () => this.autoDiscard(i));
    this.broadcast();
    this.maybeAct();
  }

  setTimer(ms, fn) {
    clearTimeout(this.timer);
    this.seq++;
    const seq = this.seq;
    this.deadline = Date.now() + ms;
    this.timer = setTimeout(() => { if (seq === this.seq) fn(); }, ms);
  }

  // ----- 玩家可選動作 -----
  selfActions(i) {
    const s = this.seats[i];
    const c = G.counts(s.hand);
    const angang = [];
    // 碰/吃之後 (沒有摸牌) 只能出牌，不能槓
    const justClaimed = s.drawn == null;
    if (!justClaimed) for (let t = 0; t < 34; t++) if (c[t] === 4) angang.push(t);
    const jiagang = justClaimed ? [] : s.melds.filter((m) => m.type === 'pong' && c[m.tiles[0]] >= 1).map((m) => m.tiles[0]);
    // 過水中連自摸都不行
    const hu = s.drawn != null && !s.noRon && !!this.evalWin(i, null, true);
    if (s.migi) return { hu, angang: [], jiagang: [], migi: [], locked: true };
    const allowed = new Set(this.allowedDiscards(i));
    const forbid = [...new Set(s.hand.filter((t) => !allowed.has(t)))];
    return { hu, angang, jiagang, migi: this.migiOptions(i).filter((t) => allowed.has(t)), forbid };
  }

  // MIGI：全桌前 8 張捨牌內、無人吃碰槓，打出某張後即聽牌者可宣告
  migiOptions(i) {
    const s = this.seats[i];
    if (s.migi || this.called || this.discardCount >= 8 || s.melds.length > 0) return [];
    const res = [];
    for (const t of new Set(s.hand)) {
      const rest = s.hand.slice();
      rest.splice(rest.indexOf(t), 1);
      if (G.waits(rest, 0).length > 0) res.push(t);
    }
    return res;
  }

  evalWin(i, tile, selfDraw) {
    const s = this.seats[i];
    const hand = tile == null ? s.hand : [...s.hand, tile];
    const winTile = tile == null ? s.drawn : tile;
    return G.evaluate({
      hand, melds: s.melds, flowers: s.flowers,
      seatWind: (i - this.dealer + 4) % 4, roundWind: this.round,
      selfDraw, winTile, kongDraw: this.kongDraw, haidi: this.wall.length <= DEAD_WALL,
      migi: s.migi, robKong: !!(this.last && this.last.rob && tile != null),
    });
  }

  claimOptions(i, tile, isNext) {
    const s = this.seats[i];
    const c = G.counts(s.hand);
    const o = { hu: false, pong: false, kong: false, chi: [] };
    // 過水：之前可以胡卻沒胡，要等自己打出一張牌後才能再胡別人打的牌 (自摸不受影響)
    if (G.canWin([...s.hand, tile], s.melds.length) && !s.noRon) o.hu = true;
    if (s.migi) { o.any = o.hu; o.forced = o.hu; return o; } // MIGI 後只能胡，且有槍牌必須胡
    // 過碰：之前放棄碰同一張牌，且自己尚未打出牌，就不能再碰/槓
    // 自己剛打出的牌，在還沒輪到自己之前，別家打出同一張也不能碰/槓/吃 (打 1 又碰 1 沒有意義)
    const justOut = s.justDiscarded === tile;
    const blocked = (s.noPong && s.noPong.has(tile)) || justOut;
    if (c[tile] >= 2 && !blocked) o.pong = true;
    // 明槓不能槓上家的牌 (isNext = 上家打出)
    if (c[tile] >= 3 && !blocked && !isNext && this.wall.length > DEAD_WALL) o.kong = true;
    if (isNext && tile < 27 && !justOut) {
      const r = tile % 9;
      const has = (d) => { const r2 = r + d; return r2 >= 0 && r2 <= 8 && c[tile + d] > 0; };
      if (has(-2) && has(-1)) o.chi.push([tile - 2, tile - 1]);
      if (has(-1) && has(1)) o.chi.push([tile - 1, tile + 1]);
      if (has(1) && has(2)) o.chi.push([tile + 1, tile + 2]);
    }
    o.any = o.hu || o.pong || o.kong || o.chi.length > 0;
    return o;
  }

  // ----- 動作處理 -----
  handle(i, msg) {
    if (this.state !== 'playing') return;
    const s = this.seats[i];
    if (this.phase === 'seatPick') {
      if (msg.type === 'seatpick') this.pickSeat(i, msg.slot);
      return;
    }
    if (this.phase === 'dice') {
      if (msg.type === 'roll') this.rollDice(i);
      return;
    }
    if (this.phase.startsWith('swap')) {
      if (this.phase === 'swapAsk' && i === this.dealer) {
        if (msg.type === 'swapstart') this.startSwapSelect();
        else if (msg.type === 'skipswap') this.finishSwap();
      } else if (this.phase === 'swapSelect' && msg.type === 'cover') this.confirmCover(i, msg.tiles);
      else if (this.phase === 'swapPick' && msg.type === 'swappick') this.doPick(i, msg.picks);
      return;
    }
    if (this.phase === 'discard' && this.turn === i) {
      if (msg.type === 'discard') {
        const idx = s.hand.indexOf(msg.tile);
        if (idx < 0) return;
        if (s.migi) {
          // MIGI 後手牌鎖定：只能打出摸進的牌；能自摸時必須胡
          if (this.evalWin(i, null, true)) return send(s.ws, { type: 'toast', text: 'MIGI 中，自摸必須胡牌' });
          if (msg.tile !== s.drawn) return send(s.ws, { type: 'toast', text: 'MIGI 中只能打出摸進的牌' });
        }
        if (!this.allowedDiscards(i).includes(msg.tile)) {
          return send(s.ws, { type: 'toast', text: `剛${s.melds[s.melds.length - 1].type === 'chi' ? '吃' : '碰'}牌，不能馬上打出 ${G.TILE_NAMES[msg.tile]}` });
        }
        if (msg.migi) {
          if (!this.migiOptions(i).includes(msg.tile)) return send(s.ws, { type: 'toast', text: '打出這張後沒有聽牌，不能 MIGI' });
          s.migi = true;
          this.sys(`${s.name} 宣告 MIGI！`);
        }
        this.doDiscard(i, msg.tile, !!msg.migi);
      } else if (msg.type === 'hu') {
        if (s.noRon) return send(s.ws, { type: 'toast', text: '過水中，要先打出一張不是胡牌的牌才能再胡' });
        const r = s.drawn != null && this.evalWin(i, null, true);
        if (r) this.endHand({ winner: i, from: -1, tile: s.drawn, r, selfDraw: true });
        else send(s.ws, { type: 'toast', text: '目前無法胡牌' });
      } else if (s.migi) {
        // MIGI 後不可暗槓/加槓
      } else if (msg.type === 'angang') {
        if (s.drawn != null && G.counts(s.hand)[msg.tile] === 4) this.doAngang(i, msg.tile);
      } else if (msg.type === 'jiagang') {
        const m = s.melds.find((x) => x.type === 'pong' && x.tiles[0] === msg.tile);
        if (s.drawn != null && m && s.hand.includes(msg.tile)) this.doJiagang(i, m);
      }
    } else if (this.phase === 'claim' && this.claims && this.claims[i] && !this.claims[i].resp) {
      this.respond(i, msg);
    } else if (msg.type === 'hu') {
      send(s.ws, { type: 'toast', text: '已超過時間或目前無法胡牌' });

    }
  }

  // 玩家「說話」：打牌、吃、碰、槓、胡時，在該玩家旁邊跳出對話框 (電腦也一樣)
  // 只是畫面效果，不存進牌局狀態
  say(i, kind, tile = null, text = null) {
    for (const s of this.seats) if (s && s.ws) send(s.ws, { type: 'say', seat: i, kind, tile, text });
  }

  doDiscard(i, tile, migi = false, how = null) {
    const s = this.seats[i];
    this.habit(i, () => {
      const r = AI.reviewDiscard(this, i, tile, [...new Set(this.allowedDiscards(i))]);
      return {
        k: 'discard', n: ++s.dn, hand: tileNames(s.hand), drawn: tileName(s.drawn), tile: tileName(tile), migi, timeout: how === 'timeout',
        wall: Math.max(0, this.wall.length - DEAD_WALL), melds: s.melds.length,
        chosen: r.chosen, best: { ...r.best, tile: tileName(r.best.tile) }, threat: r.threat, defending: r.defending,
      };
    });
    this.say(i, migi ? 'migi' : 'discard', tile);
    s.hand.splice(s.hand.indexOf(tile), 1);
    s.noPong.clear();
    // 過水解除：打出的是「非胡牌」才解除。打出的牌如果正好是自己聽的牌 (摸到胡牌又打掉)，仍在過水中
    if (s.noRon && !G.canWin([...s.hand, tile], s.melds.length)) s.noRon = false;
    s.swapIn = null;
    s.forbid = null;
    s.justDiscarded = tile;
    s.discards.push(tile);
    this.discardCount++;
    if (this.discardLog) this.discardLog.push({ seat: i, tile });
    s.drawn = null;
    this.last = { tile, from: i };
    this.kongDraw = false;
    this.openClaim();
  }

  // 吃/碰後不能馬上打出的牌 (無意義的換牌)：
  //   吃：被吃的那張，以及跟同一組搭子能湊成另一個順子的牌 (234 吃 1 後不能打 4；吃 5 配 67 後不能打 8)
  //   碰：碰的那張
  // 打出一張牌後解除
  forbiddenAfterCall(tile, type, pair) {
    const f = new Set([tile]);
    if (type === 'chi' && tile < 27) {
      const [a, b] = pair.slice().sort((x, y) => x - y);
      const r = tile % 9;
      if (a === tile + 1 && b === tile + 2 && r + 3 <= 8) f.add(tile + 3); // 吃低張 (1 配 23) → 不能打 4
      if (b === tile - 1 && a === tile - 2 && r - 3 >= 0) f.add(tile - 3); // 吃高張 (4 配 23) → 不能打 1
    }
    return f;
  }

  // 這次能打的牌 (全部都被禁止時就不限制)
  allowedDiscards(i) {
    const s = this.seats[i];
    const f = s.forbid;
    if (!f || !f.size) return s.hand.slice();
    const ok = s.hand.filter((t) => !f.has(t));
    return ok.length ? ok : s.hand.slice();
  }

  autoDiscard(i) {
    const s = this.seats[i];
    if (this.phase !== 'discard' || this.turn !== i) return;
    if (s.migi && this.evalWin(i, null, true)) return this.handle(i, { type: 'hu' });
    const allowed = this.allowedDiscards(i);
    const t = s.drawn != null && allowed.includes(s.drawn) ? s.drawn : allowed[allowed.length - 1];
    this.doDiscard(i, t, false, 'timeout');
  }

  doAngang(i, tile) {
    const s = this.seats[i];
    this.say(i, 'kong');
    this.habit(i, () => ({ k: 'kong', type: 'angang', tile: tileName(tile) }));
    s.hand = s.hand.filter((t) => t !== tile);
    s.melds.push({ type: 'angang', tiles: [tile, tile, tile, tile] });
    this.afterKong(i, false);
  }

  // 加槓 (明槓) 可被搶槓；暗槓不可搶
  doJiagang(i, meld) {
    const tile = meld.tiles[0];
    this.habit(i, () => ({ k: 'kong', type: 'jiagang', tile: tileName(tile) }));
    const claims = {};
    for (let k = 1; k <= 3; k++) {
      const p = (i + k) % 4;
      const ps = this.seats[p];
      if (G.canWin([...ps.hand, tile], ps.melds.length) && !ps.noRon) {
        claims[p] = { opts: { hu: true, pong: false, kong: false, chi: [], any: true, forced: ps.migi }, resp: null };
      }
    }
    if (Object.keys(claims).length === 0) return this.applyJiagang(i, meld);
    this.last = { tile, from: i, rob: true, meld };
    this.phase = 'claim';
    this.claims = claims;
    this.sys(`${this.seats[i].name} 加槓 ${G.TILE_NAMES[tile]}`);
    this.setTimer(CLAIM_MS, () => this.resolveClaims());
    this.broadcast();
    this.maybeAct();
  }

  applyJiagang(i, meld) {
    const s = this.seats[i];
    this.say(i, 'kong');
    s.hand.splice(s.hand.indexOf(meld.tiles[0]), 1);
    meld.type = 'kong';
    meld.tiles = [meld.tiles[0], meld.tiles[0], meld.tiles[0], meld.tiles[0]];
    this.afterKong(i, true);
  }

  // exposed: 明槓 (大明槓/加槓)。明槓後補牌不能自摸，補到胡牌進入過水
  afterKong(i, exposed) {
    const s = this.seats[i];
    s.drawn = null;
    if (this.wall.length <= DEAD_WALL) return this.endHand(null);
    this.drawFor(i, true);
    if (this.flowerWin()) return;
    this.kongDraw = true;
    if (exposed && s.drawn != null && !s.noRon && this.evalWin(i, null, true)) {
      s.noRon = true;
      this.sys(`${s.name} 明槓後摸到胡牌，不能自摸，進入過水`);
    }
    this.enterDiscard(i);
  }

  openClaim() {
    const { tile, from } = this.last;
    this.phase = 'claim';
    this.claims = {};
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4;
      const o = this.claimOptions(p, tile, k === 1);
      if (o.any) this.claims[p] = { opts: o, resp: null };
    }
    if (Object.keys(this.claims).length === 0) return this.nextTurn();
    this.setTimer(CLAIM_MS, () => this.resolveClaims());
    this.broadcast();
    this.maybeAct();
  }

  nextTurn() {
    this.claims = null;
    this.turnDraw((this.last.from + 1) % 4);
  }

  respond(i, msg) {
    const c = this.claims[i];
    const o = c.opts;
    const type = msg.type;
    let ok = false;
    if (type === 'pass') {
      ok = !o.forced;
      if (!ok) send(this.seats[i].ws, { type: 'toast', text: 'MIGI 中不能過，必須胡牌' });
    }
    else if (type === 'hu') ok = o.hu;
    else if (type === 'pong') ok = o.pong;
    else if (type === 'kong') ok = o.kong;
    else if (type === 'chi') {
      // 吃的兩張不限順序
      const m = Array.isArray(msg.tiles) && msg.tiles.length === 2 ? msg.tiles.slice().sort((x, y) => x - y) : null;
      const hit = m && o.chi.find((p) => { const q = p.slice().sort((x, y) => x - y); return q[0] === m[0] && q[1] === m[1]; });
      ok = !!hit;
      if (hit) msg = { ...msg, tiles: hit };
    }
    if (!ok) return;
    c.resp = { type, tiles: msg.tiles };
    if (Object.values(this.claims).every((x) => x.resp) || this.huDecided() || this.pongDecided()) this.resolveClaims();
    else this.broadcast();
  }

  // 碰/槓比吃優先：有人選碰或槓，且能胡、能碰、能槓的人都已決定 (都沒胡)，
  // 就不必等只能吃的人，直接碰/槓，吃牌被打斷
  pongDecided() {
    const cs = Object.values(this.claims);
    if (!cs.some((c) => c.resp && (c.resp.type === 'pong' || c.resp.type === 'kong'))) return false;
    return cs.every((c) => c.resp || !(c.opts.hu || c.opts.pong || c.opts.kong));
  }

  // 胡牌最大：依順位找第一位「可以胡、且還沒選過」的玩家；
  // 若他已選胡，就不必等其他人 (只有一人能胡時即刻胡；多人能胡則順位最前者截胡)
  huDecided() {
    const { from } = this.last;
    for (let k = 1; k <= 3; k++) {
      const p = (from + k) % 4;
      const c = this.claims[p];
      if (!c || !c.opts.hu) continue;
      const t = c.resp && c.resp.type;
      if (t === 'hu') return true;
      if (!t) return false; // 順位較前的可胡者還沒決定，要等他
    }
    return false;
  }

  resolveClaims() {
    if (this.phase !== 'claim' || !this.claims) return;
    clearTimeout(this.timer);
    this.seq++;
    const { tile, from } = this.last;
    const order = [1, 2, 3].map((k) => (from + k) % 4).filter((p) => this.claims[p]);
    const timedOut = Date.now() >= this.deadline - 100;
    for (const p of order) {
      const c = this.claims[p];
      const t = c.resp && c.resp.type;
      this.habit(p, () => {
        const o = c.opts;
        return {
          k: 'claim', tile: tileName(tile), from: ['', '上家', '對家', '下家'][(p - from + 4) % 4],
          options: [o.hu && 'hu', o.pong && 'pong', o.kong && 'kong', o.chi && o.chi.length && 'chi'].filter(Boolean),
          action: t || (o.forced ? 'hu' : timedOut ? 'timeout' : 'none'), tiles: c.resp && c.resp.tiles ? c.resp.tiles.map(tileName) : undefined,
          ref: o.hu ? 'hu' : AI.decideClaim(this, p, o, tile).type, sh: AI.currentState(this, p).sh,
        };
      });
      // 過碰：可以碰卻沒碰，到輪到自己之前不能再碰同一張
      if ((c.opts.pong || c.opts.kong) && t !== 'pong' && t !== 'kong' && t !== 'hu') this.seats[p].noPong.add(tile);
      // 過水：可以胡卻沒胡 (按過、時間到、改選吃碰)，到自己打出一張牌前都不能胡別人的牌
      if (c.opts.hu && t !== 'hu' && !c.opts.forced) this.seats[p].noRon = true;
    }
    const respOf = (p) => {
      const c = this.claims[p];
      if (c.resp) return c.resp;
      return { type: c.opts.forced ? 'hu' : 'pass' };
    };
    const rob = this.last.rob;
    // 胡 > 碰/槓 > 吃
    for (const p of order) {
      if (respOf(p).type === 'hu') {
        const r = this.evalWin(p, tile, false);
        if (r) {
          // 截胡：通知其他同樣可以胡的玩家
          for (const q of order) if (q !== p && this.claims[q].opts.hu) send(this.seats[q].ws, { type: 'toast', text: `${this.seats[p].name} 順位較前，已截胡` });
          if (rob) { const ks = this.seats[from]; ks.hand.splice(ks.hand.indexOf(tile), 1); }
          return this.endHand({ winner: p, from, tile, r, selfDraw: false });
        }
      }
    }
    if (rob) { const { meld } = this.last; this.last = null; return this.applyJiagang(from, meld); }
    for (const p of order) {
      const r = respOf(p);
      if (r.type === 'pong' || r.type === 'kong') {
        // 通知可以吃 (或已選吃) 的玩家：吃牌被打斷
        for (const q of order) {
          if (q !== p && this.claims[q].opts.chi && this.claims[q].opts.chi.length) {
            send(this.seats[q].ws, { type: 'toast', text: `${this.seats[p].name} ${r.type === 'pong' ? '碰' : '槓'}牌，吃牌被打斷` });
          }
        }
        return this.doMeld(p, r.type, tile, from);
      }
    }
    for (const p of order) {
      const r = respOf(p);
      if (r.type === 'chi') return this.doMeld(p, 'chi', tile, from, r.tiles);
    }
    this.nextTurn();
  }

  doMeld(p, type, tile, from, tiles) {
    const s = this.seats[p];
    const take = (t, n) => { for (let k = 0; k < n; k++) s.hand.splice(s.hand.indexOf(t), 1); };
    this.say(p, type, tile); // 碰！ 吃！ 槓！
    this.seats[from].discards.pop();
    this.called = true;
    if (type === 'pong') { take(tile, 2); s.melds.push({ type: 'pong', tiles: [tile, tile, tile], from }); }
    else if (type === 'kong') { take(tile, 3); s.melds.push({ type: 'kong', tiles: [tile, tile, tile, tile], from }); }
    else { take(tiles[0], 1); take(tiles[1], 1); const [a, b] = sortTiles(tiles); s.melds.push({ type: 'chi', tiles: [a, tile, b], claimed: 1, from }); }
    s.drawn = null;
    this.last = null;
    s.justDiscarded = null;
    s.forbid = type === 'kong' ? null : this.forbiddenAfterCall(tile, type, tiles || []);
    if (type === 'kong') return this.afterKong(p, true);
    this.kongDraw = false;
    this.enterDiscard(p);
  }

  // ----- 結算 -----
  endHand(win) {
    if (win) {
      const kind = win.special ? 'special' : win.selfDraw ? 'zimo' : this.last && this.last.rob ? 'rob' : 'hu';
      this.say(win.winner, kind, win.tile, win.special || null);
    }
    clearTimeout(this.timer);
    this.seq++;
    this.phase = 'over';
    this.claims = null;
    const delta = [0, 0, 0, 0];
    const dealerTai = 1 + 2 * this.streak;
    let dealerStays;
    if (!win) {
      this.result = { draw: true, text: '流局' };
      dealerStays = true;
    } else {
      const { winner, from, r, selfDraw } = win;
      const rule = G.diceRule(this.handDice);
      const ruleTai = rule ? rule.tai : 0;
      const mult = rule ? rule.mult : 1;
      const pay = (payer) => {
        let tai = r.tai;
        if (winner === this.dealer || payer === this.dealer) tai += dealerTai;
        tai += ruleTai; // 骰規順子 +2 台
        const amt = (BASE + tai * TAI_VALUE) * mult; // 骰規豹子：(底 + 台數) 整筆 ×2
        delta[payer] -= amt;
        delta[winner] += amt;
        return amt;
      };
      const items = r.items.slice();
      if (winner === this.dealer || (!selfDraw && from === this.dealer)) {
        items.unshift({ name: this.streak > 0 ? `莊家 連${this.streak}拉${this.streak}` : '莊家', tai: dealerTai });
      }
      if (rule) items.push({ name: rule.name, tai: rule.tai, text: rule.text });
      if (selfDraw) { for (let p = 0; p < 4; p++) if (p !== winner) pay(p); }
      else pay(from);
      const shownDealer = winner === this.dealer || (!selfDraw && from === this.dealer) ? dealerTai : 0;
      this.result = {
        draw: false, winner, from, selfDraw, tile: win.tile, items, special: win.special || null, rob: !!(this.last && this.last.rob),
        tai: r.tai + shownDealer + ruleTai, mult, handTai: r.tai, diceRule: rule ? rule.text : null, dice: this.handDice || null, delta,
      };
      dealerStays = winner === this.dealer;
      for (let p = 0; p < 4; p++) this.scores[p] += delta[p];
    }
    for (let p = 0; p < 4; p++) {
      this.habit(p, (s) => {
        const r = this.result;
        const outcome = r.draw ? 'draw' : r.winner === p ? (r.selfDraw ? 'zimo' : 'win') : r.selfDraw ? 'zimoLoss' : r.from === p ? 'dealin' : 'otherWin';
        return {
          k: 'end', no: this.handNo, outcome, dealer: p === this.dealer, delta: r.delta ? r.delta[p] : 0, tai: r.draw ? 0 : r.tai,
          items: r.draw ? [] : r.items.map((x) => x.name), hand: tileNames(s.hand), flowers: s.flowers.length,
          melds: s.melds.map((m) => ({ type: m.type, tiles: m.tiles.map((t) => (t == null ? null : tileName(t))) })),
          ting: s.hand.length % 3 === 1 ? G.waits(s.hand, s.melds.length).length > 0 : null,
        };
      });
    }
    Stats.recordHand(this.seats, this.result); // 計分板：累計金額、勝率、自摸、放槍
    hallChanged(); // 大廳的計分板即時更新
    if (dealerStays) this.streak++;
    else {
      this.streak = 0;
      this.dealer = (this.dealer + 1) % 4;
      if (this.dealer === this.startDealer) {
        this.round++;
        if (this.round >= 4) { this.round = 3; this.jiangOver = true; } // 北風圈打完，一將結束
      }
    }
    this.result.jiangOver = !!this.jiangOver;
    this.result.jiang = this.jiang;
    this.result.nextAt = Date.now() + NEXT_HAND_MS;
    const winName = win ? this.seats[win.winner].name : null;
    this.sys(win ? `${winName} ${win.special || (win.selfDraw ? '自摸' : '胡牌')}！共 ${this.result.tai} 台` : '流局');
    this.broadcast();
    this.timer = setTimeout(() => this.nextHandIfReady(), NEXT_HAND_MS);
  }

  nextHandIfReady() {
    if (this.phase !== 'over') return;
    if (this.humanCount() === 0) return;
    if (this.jiangOver) {
      this.jiangOver = false;
      this.sys(`第 ${this.jiang} 將結束`);
      return this.enterSeatPick();
    }
    this.startHand();
  }

  // ----- 聽牌提示 -----
  // 16 張 (等別人出牌) 時：目前聽哪些牌、各剩幾張
  // 17 張 (輪到自己打) 時：打出哪一張後會聽牌、聽哪些牌
  // 剩餘張數只扣掉自己看得到的牌 (自己手牌、牌河、明牌副露)
  tingInfo(i) {
    if (this.phase !== 'discard' && this.phase !== 'claim') return null;
    const s = this.seats[i];
    const mc = s.melds.length;
    const unseen = AI.unseenCounts(this, i);
    // 預估台數：別人打出來胡 (ron) 與自摸 (tsumo) 各幾台。
    // 自己是莊家會加莊家台；骰規順子 +2 台；骰規豹子另外標 ×2 (底 + 台 一起加倍)
    const rule = G.diceRule(this.handDice);
    const extra = (i === this.dealer ? 1 + 2 * this.streak : 0) + (rule ? rule.tai : 0);
    const taiOf = (hand, w, selfDraw) => {
      const r = G.evaluate({
        hand: [...hand, w], melds: s.melds, flowers: s.flowers,
        seatWind: (i - this.dealer + 4) % 4, roundWind: this.round,
        selfDraw, winTile: w, kongDraw: false, haidi: false, migi: s.migi,
      });
      return r ? r.tai + extra : null;
    };
    const list = (hand) => G.waits(hand, mc).map((t) => ({ tile: t, left: unseen[t], ron: taiOf(hand, t, false), tsumo: taiOf(hand, t, true) }));
    const mult = rule ? rule.mult : 1;
    if (s.hand.length % 3 === 1) {
      const w = list(s.hand);
      return w.length ? { waits: w, mult, noRon: !!s.noRon } : null;
    }
    if (this.phase !== 'discard' || this.turn !== i) return null;
    const byDiscard = {};
    for (const t of new Set(s.hand)) {
      const rest = s.hand.slice();
      rest.splice(rest.indexOf(t), 1);
      const w = list(rest);
      if (w.length) byDiscard[t] = w;
    }
    return Object.keys(byDiscard).length ? { byDiscard, mult, noRon: !!s.noRon } : null;
  }

  // ----- 電腦 / 離線代打 -----
  maybeAct() {
    if (this.state !== 'playing') return;
    const seq = this.seq;
    if (this.phase === 'seatPick') {
      for (let i = 0; i < 4; i++) {
        if (!this.isAuto(i)) continue;
        setTimeout(() => {
          const sp = this.seatPick;
          if (seq !== this.seq || this.phase !== 'seatPick' || sp.done || sp.owners.includes(i)) return;
          const free = [0, 1, 2, 3].filter((k) => sp.owners[k] === null);
          this.pickSeat(i, free[Math.floor(Math.random() * free.length)]);
        }, BOT_DELAY * (1 + i));
      }
    } else if (this.phase === 'dice') {
      const i = this.dice.thrower;
      if (!this.dice.values && this.isAuto(i)) setTimeout(() => { if (seq === this.seq) this.rollDice(i); }, BOT_DELAY);
    } else if (this.phase === 'swapAsk') {
      if (this.isAuto(this.dealer)) setTimeout(() => {
        if (seq !== this.seq || this.phase !== 'swapAsk') return;
        // 電腦莊家：評估換牌後是否明顯變好
        const swap = AI.decideSwap(this, this.dealer);
        this.sys(`莊家 ${this.seats[this.dealer].name} ${swap ? '決定換牌' : '決定不換牌'}`);
        if (swap) this.startSwapSelect();
        else this.finishSwap();
      }, BOT_DELAY);
    } else if (this.phase === 'swapSelect') {
      for (let i = 0; i < 4; i++) {
        if (this.isAuto(i)) setTimeout(() => {
          if (seq === this.seq && this.phase === 'swapSelect' && !this.seats[i].confirmed) this.confirmCover(i, AI.chooseWorst(this, i, 3));
        }, BOT_DELAY);
      }
    } else if (this.phase === 'swapPick') {
      const i = this.turn;
      if (this.isAuto(i)) setTimeout(() => { if (seq === this.seq && this.phase === 'swapPick' && this.turn === i) this.autoPick(i); }, BOT_DELAY);
    } else if (this.phase === 'discard' && this.isAuto(this.turn)) {
      const i = this.turn;
      setTimeout(() => { if (seq === this.seq && this.phase === 'discard' && this.turn === i) this.botTurn(i); }, BOT_DELAY);
    } else if (this.phase === 'claim' && this.claims) {
      for (const k of Object.keys(this.claims)) {
        const i = Number(k);
        if (this.isAuto(i) && !this.claims[i].resp) {
          setTimeout(() => {
            if (seq === this.seq && this.phase === 'claim' && this.claims && this.claims[i] && !this.claims[i].resp) this.botClaim(i);
          }, BOT_DELAY * 0.7);
        }
      }
    }
  }

  botTurn(i) {
    const s = this.seats[i];
    const a = this.selfActions(i);
    if (a.hu) return this.handle(i, { type: 'hu' });
    if (s.migi) return this.handle(i, { type: 'discard', tile: s.drawn });
    const k = AI.decideKong(this, i, a);
    if (k) return this.handle(i, k);
    // 依向聽數 + 進張數選捨牌
    const best = AI.chooseDiscard(this, i, [...new Set(this.allowedDiscards(i))]).tile;
    // 打出後可 MIGI 就宣告
    this.handle(i, { type: 'discard', tile: best, migi: a.migi.includes(best) });
  }

  botClaim(i) {
    const o = this.claims[i].opts;
    const t = this.last.tile;
    if (o.hu) return this.respond(i, { type: 'hu' });
    this.respond(i, AI.decideClaim(this, i, o, t));
  }

  // ----- 廣播 -----
  view(i) {
    const me = this.seats[i];
    const over = this.phase === 'over';
    const v = {
      type: 'state', room: this.id, title: this.title || `第 ${this.id} 桌`, you: i, state: this.state, host: this.host(),
      scores: this.scores, dealer: this.dealer, streak: this.streak, round: this.round,
      phase: this.phase, turn: this.turn, wall: this.wall ? Math.max(0, this.wall.length - DEAD_WALL) : 0,
      dice: this.dice || null, breakInfo: this.breakInfo || null,
      jiang: this.jiang,
      // 未翻開的風牌不送給前端，避免偷看
      seatPick: this.phase === 'seatPick' ? {
        done: this.seatPick.done,
        slots: this.seatPick.tiles.map((w, k) => {
          const owner = this.seatPick.owners[k];
          return { owner, wind: owner !== null ? w : null };
        }),
      } : null,
      handDice: this.handDice || null,
      last: this.last, deadline: this.deadline, handNo: this.handNo, chat: this.chat.slice(-30),
      result: this.result, swapLeft: this.phase.startsWith('swap') ? MAX_SWAPS - this.swapsDone : 0, swapMax: MAX_SWAPS, base: BASE, taiValue: TAI_VALUE,
      seats: this.seats.map((s, k) => s && {
        name: s.name, bot: s.bot, online: s.bot || !!s.ws,
        migi: !!s.migi, confirmed: !!s.confirmed, cover: s.cover ? s.cover.map((t) => t !== null) : null,
        handCount: s.hand.length,
        // 暗槓牌面只給本人看；結算時才公開
        melds: k === i || this.phase === 'over' ? s.melds : s.melds.map((m) => (m.type === 'angang' ? { type: 'angang', tiles: [null, null, null, null] } : m)), flowers: s.flowers, discards: s.discards,
        hand: over && this.state === 'playing' && this.phase === 'over' ? sortTiles(s.hand) : undefined,
      }),
    };
    if (this.state === 'playing' && me) {
      const hand = me.hand.slice();
      let drawn = null;
      if (me.drawn != null && this.phase === 'discard' && this.turn === i) {
        hand.splice(hand.indexOf(me.drawn), 1);
        drawn = me.drawn;
      }
      v.hand = sortTiles(hand);
      v.myTaken = me.taken || [];
      v.swapIn = me.swapIn || [];
      v.myCover = me.cover ? me.cover.filter((t) => t !== null) : [];
      v.drawn = drawn;
      if (this.phase === 'discard' && this.turn === i) v.actions = this.selfActions(i);
      v.ting = this.tingInfo(i);
      if (this.phase === 'claim' && this.claims && this.claims[i]) {
        v.claim = { opts: this.claims[i].opts, resp: this.claims[i].resp && this.claims[i].resp.type };
      }
      if (this.phase === 'claim' && this.claims) v.waiting = Object.keys(this.claims).filter((k) => !this.claims[k].resp).map(Number);
    }
    return v;
  }

  broadcast() {
    for (let i = 0; i < 4; i++) {
      const s = this.seats[i];
      if (s && s.ws) send(s.ws, this.view(i));
    }
  }
}

// 網頁程式的版本：public/ 底下 html、js、css 最後修改時間。
// 玩家重新連線登入時拿來比對，網頁程式更新過就讓瀏覽器重新整理，避免分頁一直跑舊版
function assetVersion() {
  const dir = path.join(__dirname, 'public');
  let v = 0;
  for (const f of fs.readdirSync(dir)) {
    if (/\.(html|js|css)$/.test(f)) v = Math.max(v, fs.statSync(path.join(dir, f)).mtimeMs);
  }
  return String(Math.floor(v));
}

// ---------- 大廳 ----------
function hallList(email) {
  return [...rooms.values()].map((r) => ({
    id: r.id,
    title: r.title || `第 ${r.id} 桌`,
    state: r.state,
    count: r.seats.filter(Boolean).length,
    players: r.seats.map((x) => (x ? x.name : null)),
    mine: r.seats.some((x) => x && !x.bot && x.token === email),
  }));
}

function sendHall(ws) {
  send(ws, { type: 'hall', rooms: hallList(ws.user.email), max: MAX_ROOMS, me: ws.user, board: Stats.board(ws.user.email), achievements: Stats.ACHIEVEMENTS });
}

// 房間有變動時，更新所有在大廳的玩家畫面 (同一輪事件只送一次)
let hallPending = false;
function hallChanged() {
  if (hallPending) return;
  hallPending = true;
  setImmediate(() => {
    hallPending = false;
    for (const c of wss.clients) if (c.user && !c.ctx) sendHall(c);
  });
}

// 玩家是否還有進行中的牌局 (離線由電腦代打中)
function activeRoomOf(email) {
  return [...rooms.values()].find((r) => r.state === 'playing' && r.seats.some((x) => x && !x.bot && x.token === email));
}

function enterRoom(ws, room) {
  const active = activeRoomOf(ws.user.email);
  if (active && active !== room) return send(ws, { type: 'toast', text: `你還在「${active.title}」的牌局中，請先回到該房間` });
  const idx = room.join(ws, ws.user.name, ws.user.email);
  if (idx < 0) {
    send(ws, { type: 'toast', text: '房間已滿或遊戲已開始' });
    sendHall(ws);
  }
}

// ---------- WebSocket ----------
wss.on('connection', (ws) => {
  ws.ctx = null;
  ws.user = null;
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.type !== 'string') return;

    // 登入：暱稱 + 帳號 (email)
    if (msg.type === 'login') {
      if (ws.user) return;
      const name = String(msg.name || '').trim().slice(0, 12);
      const email = String(msg.email || '').trim().toLowerCase().slice(0, 254);
      if (!name) return send(ws, { type: 'loginError', text: '請輸入暱稱' });
      if (!EMAIL_RE.test(email)) return send(ws, { type: 'loginError', text: '帳號必須是有效的 email' });
      // 同一帳號只能在一個視窗登入
      for (const c of wss.clients) {
        if (c !== ws && c.user && c.user.email === email) { send(c, { type: 'kicked' }); c.close(); }
      }
      ws.user = { name, email };
      Stats.rename(email, name); // 計分板顯示這個 email 最新登入的暱稱
      send(ws, { type: 'loggedIn', me: ws.user, version: assetVersion() });
      return sendHall(ws);
    }
    if (!ws.user) return;

    // 個人化頁面：下載打牌習慣 (md = 附 AI 分析指示的檔案，json = 原始資料)；只能下載自己登入帳號的紀錄
    if (msg.type === 'habitExport') {
      const fmt = msg.fmt === 'json' ? 'json' : 'md';
      const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const content = fmt === 'json' ? Habits.exportJson(ws.user.email, ws.user.name) : Habits.exportMarkdown(ws.user.email, ws.user.name);
      return send(ws, { type: 'habitFile', fmt, filename: `mahjong-habits-${date}.${fmt}`, content });
    }

    if (msg.type === 'habitClear') {
      Habits.clear(ws.user.email);
      return send(ws, { type: 'toast', text: '已清除你的打牌紀錄' });
    }

    // 大廳
    if (!ws.ctx) {
      if (msg.type === 'create') {
        if (rooms.size >= MAX_ROOMS) { send(ws, { type: 'toast', text: `房間已達上限 ${MAX_ROOMS} 間` }); return sendHall(ws); }
        const id = ['1', '2', '3', '4'].find((k) => !rooms.has(k));
        const room = new Room(id);
        room.title = `第 ${id} 桌`;
        rooms.set(id, room);
        enterRoom(ws, room);
        if (!ws.ctx) { rooms.delete(id); hallChanged(); }
      } else if (msg.type === 'joinRoom') {
        const room = rooms.get(String(msg.room || ''));
        if (!room) { send(ws, { type: 'toast', text: '房間不存在' }); return sendHall(ws); }
        enterRoom(ws, room);
      } else if (msg.type === 'hall') sendHall(ws);
      return;
    }

    const { room, seat } = ws.ctx;
    switch (msg.type) {
      case 'leave': // 回大廳；牌局中離開由電腦代打，可從大廳回來
        room.disconnect(ws);
        ws.ctx = null;
        sendHall(ws);
        break;
      case 'chat': {
        const text = String(msg.text || '').trim().slice(0, 100);
        if (text) { room.chat.push({ from: room.seats[seat].name, text }); room.broadcast(); }
        break;
      }
      case 'addbot': if (seat === room.host()) room.addBot(); break;
      case 'removebot': if (seat === room.host()) room.removeSeat(Number(msg.seat)); break;
      case 'start': if (seat === room.host()) room.startGame(); break;
      case 'next': if (room.phase === 'over') room.nextHandIfReady(); break;
      case 'seatpick': case 'roll': case 'swapstart': case 'skipswap': case 'cover': case 'swappick': case 'discard': case 'hu': case 'angang': case 'jiagang': case 'pass': case 'pong': case 'kong': case 'chi':
        room.handle(seat, msg);
        break;
    }
  });
  ws.on('close', () => { if (ws.ctx) ws.ctx.room.disconnect(ws); ws.ctx = null; });
  ws.on('error', () => {});
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

if (require.main === module) {
  server.listen(PORT, () => console.log(`麻將伺服器啟動： http://localhost:${PORT}`));
  // 關閉伺服器前把計分板寫入檔案
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { Stats.flush(); process.exit(0); });
}
module.exports = { server, Room };

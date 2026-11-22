'use strict';
// 美國麻將：牌組、胡牌判定、台數計算
// 牌編號：0-8 萬, 9-17 筒, 18-26 條, 27-30 東南西北, 31-33 中發白, 34-41 花 (春夏秋冬梅蘭菊竹)
// 花牌編號對應門風：1東(春、梅) 2南(夏、蘭) 3西(秋、菊) 4北(冬、竹)

const TILE_NAMES = (() => {
  const n = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const a = [];
  for (let i = 0; i < 9; i++) a.push(n[i] + '萬');
  for (let i = 0; i < 9; i++) a.push(n[i] + '筒');
  for (let i = 0; i < 9; i++) a.push(n[i] + '條');
  a.push('東', '南', '西', '北', '紅中', '發財', '白板');
  a.push('春', '夏', '秋', '冬', '梅', '蘭', '菊', '竹');
  return a;
})();

const isFlower = (t) => t >= 34;
const isHonor = (t) => t >= 27 && t < 34;
// 0 萬 1 筒 2 條 3 字
const suitOf = (t) => (t < 27 ? Math.floor(t / 9) : 3);

function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function newWall() {
  const w = [];
  for (let t = 0; t < 34; t++) for (let k = 0; k < 4; k++) w.push(t);
  for (let t = 34; t < 42; t++) w.push(t);
  return shuffle(w);
}

function counts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) if (t < 34) c[t]++;
  return c;
}

// 將 c (34 格計數) 拆成 nSets 組面子 + 1 對眼，回傳所有拆法
function decompose(c, nSets) {
  const res = [];
  const sets = [];
  const rec = (i, need, pair) => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      if (need === 0) res.push({ pair, sets: sets.slice() });
      return;
    }
    if (need === 0) return;
    if (c[i] >= 3) {
      c[i] -= 3;
      sets.push({ type: 'tri', tile: i });
      rec(i, need - 1, pair);
      sets.pop();
      c[i] += 3;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      sets.push({ type: 'seq', tile: i });
      rec(i, need - 1, pair);
      sets.pop();
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
  };
  for (let p = 0; p < 34; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      rec(0, nSets, p);
      c[p] += 2;
    }
  }
  return res;
}

// 手牌(不含已副露) + 副露數 -> 所有胡牌拆法 (空陣列 = 不能胡)
function winDecomps(hand, meldCount) {
  const n = 5 - meldCount;
  if (hand.length !== 3 * n + 2) return [];
  return decompose(counts(hand), n);
}

// 嚦咕嚦咕：門清，7 對 + 1 刻（8 對視為其一）
function isPairsHand(hand, meldCount) {
  if (meldCount !== 0 || hand.length !== 17) return false;
  const c = counts(hand);
  let pairs = 0, tris = 0;
  for (const n of c) {
    if (n === 2) pairs++;
    else if (n === 3) tris++;
    else if (n === 4) pairs += 2;
    else if (n === 1) return false;
  }
  return tris === 1 && pairs === 7;
}

function canWin(hand, meldCount) {
  return winDecomps(hand, meldCount).length > 0 || isPairsHand(hand, meldCount);
}

// 聽牌：回傳所有可胡的牌 (hand 為 3n+1 張)
function waits(hand, meldCount) {
  const c = counts(hand);
  const res = [];
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue; // 自己已有 4 張，不可能再摸到
    if (canWin([...hand, t], meldCount)) res.push(t);
  }
  return res;
}

const MIGI_TAI = 8;

// 計算台數。ctx:
// hand(完整手牌含胡的那張), melds, flowers, seatWind(0-3), roundWind(0-3),
// selfDraw, winTile, kongDraw, haidi
// 回傳 {tai, items:[{name,tai}]} 或 null (不能胡)；莊家/連莊台由結算時另外加計
function evaluate(ctx) {
  const { hand, melds, flowers, seatWind, roundWind, selfDraw, winTile, kongDraw, haidi, migi, robKong } = ctx;
  const decomps = winDecomps(hand, melds.length);
  const candidates = [];

  const open = melds.filter((m) => m.type !== 'angang');
  const noOpen = open.length === 0;

  // 通用 (與拆法無關) 台
  const base = [];
  const add = (arr, name, tai) => arr.push({ name, tai });

  if (selfDraw) add(base, '自摸', 1);
  if (noOpen) {
    add(base, '門清', 1);
    if (selfDraw) add(base, '不求人', 1);
  }
  if (kongDraw && selfDraw) add(base, '槓上開花', 1);
  if (robKong) add(base, '搶槓', 1);
  if (migi) add(base, 'MIGI', MIGI_TAI);
  // 獨聽：去掉胡的那張後，牌理上只聽這一張 (全求人/半求人不重複計)
  let lone = false;
  if (!(melds.length === 5 && open.length === 5)) {
    const before = hand.slice();
    before.splice(before.indexOf(winTile), 1);
    const w = waits(before, melds.length);
    lone = w.length === 1 && w[0] === winTile;
  }
  if (lone) add(base, '獨聽', 1);
  if (haidi) add(base, '海底撈月', 1);

  // 花牌
  const fset = new Set(flowers);
  const seasons = [34, 35, 36, 37].every((f) => fset.has(f));
  const gents = [38, 39, 40, 41].every((f) => fset.has(f));
  if (seasons) add(base, '四季', 2);
  if (gents) add(base, '四君子', 2);
  for (const f of flowers) {
    const w = (f - 34) % 4;
    if (w === seatWind) {
      if ((f < 38 && seasons) || (f >= 38 && gents)) continue;
      add(base, '正花 ' + TILE_NAMES[f], 1);
    }
  }

  const meldSets = melds.map((m) => (m.type === 'chi' ? { type: 'seq', tile: Math.min(...m.tiles), open: true }
    : { type: 'tri', tile: m.tiles[0], open: m.type !== 'angang', ang: m.type === 'angang' }));

  const allTiles = [...hand];
  for (const m of melds) allTiles.push(...m.tiles);

  // 清一色 / 混一色 / 字一色
  const suits = new Set(allTiles.map(suitOf));
  const hasHonor = suits.has(3);
  const numSuits = [...suits].filter((s) => s !== 3);
  const suitItems = [];
  if (numSuits.length === 0) add(suitItems, '字一色', 16);
  else if (numSuits.length === 1 && !hasHonor) add(suitItems, '清一色', 8);
  else if (numSuits.length === 1 && hasHonor) add(suitItems, '混一色', 4);

  if (decomps.length === 0) {
    if (isPairsHand(hand, melds.length)) {
      const items = [...base, ...suitItems, { name: '嚦咕嚦咕', tai: 8 }];
      return finalize(items);
    }
    return null;
  }

  for (const d of decomps) {
    const items = [...base, ...suitItems];
    const sets = [...d.sets.map((s) => ({ ...s })), ...meldSets];
    const tris = sets.filter((s) => s.type === 'tri');

    // 全求人 / 半求人
    if (melds.length === 5 && open.length === 5) {
      if (selfDraw) add(items, '半求人', 1);
      else add(items, '全求人', 2);
    }

    // 三元
    const dragons = tris.filter((s) => s.tile >= 31).length;
    const dragonPair = d.pair >= 31;
    if (dragons === 3) add(items, '大三元', 8);
    else if (dragons === 2 && dragonPair) add(items, '小三元', 4);
    else for (const s of tris) if (s.tile >= 31) add(items, TILE_NAMES[s.tile], 1);

    // 風
    const winds = tris.filter((s) => s.tile >= 27 && s.tile <= 30).length;
    const windPair = d.pair >= 27 && d.pair <= 30;
    if (winds === 4) add(items, '大四喜', 16);
    else if (winds === 3 && windPair) add(items, '小四喜', 8);
    else {
      for (const s of tris) {
        if (s.tile === 27 + roundWind) add(items, '圈風 ' + TILE_NAMES[s.tile], 1);
        if (s.tile === 27 + seatWind) add(items, '門風 ' + TILE_NAMES[s.tile], 1);
      }
    }

    // 碰碰胡
    if (sets.every((s) => s.type === 'tri')) add(items, '碰碰胡', 4);

    // 暗刻 (榮胡湊成的刻子算明刻)
    let anke = melds.filter((m) => m.type === 'angang').length;
    for (const s of d.sets) {
      if (s.type !== 'tri') continue;
      if (!selfDraw && s.tile === winTile) continue;
      anke++;
    }
    if (anke >= 5) add(items, '五暗刻', 8);
    else if (anke === 4) add(items, '四暗刻', 5);
    else if (anke === 3) add(items, '三暗刻', 2);

    // 平胡：無花、無字、全順子、榮胡、兩面聽
    if (flowers.length === 0 && !hasHonor && !selfDraw && sets.every((s) => s.type === 'seq')) {
      const ok = d.sets.some((s) => {
        if (s.type !== 'seq') return false;
        const lo = s.tile;
        if (winTile === lo && lo % 9 <= 5) return true; // 胡 lo，聽 lo,lo+3 之兩面 (排除 7-8-9 邊張)
        if (winTile === lo + 2 && lo % 9 >= 1) return true; // 胡 hi，排除 1-2-3 邊張
        return false;
      });
      if (ok) add(items, '平胡', 2);
    }

    candidates.push(finalize(items));
  }
  candidates.sort((a, b) => b.tai - a.tai);
  return candidates[0];
}

function finalize(items) {
  // 大小三元/四喜與字一色同時存在時直接累加 (網站規則未排除)
  const tai = items.reduce((s, i) => s + i.tai, 0);
  return { tai, items };
}

// 骰規：依本局開門骰子 (3 顆)
// 連號 (123 234 345 456 561 612) → 加 2 台
// 三顆相同 (豹子) → 整筆金額 ×2，也就是 (底 + 台數 × 台錢) × 2，連底錢一起加倍
// 回傳 { tai: 加幾台, mult: 金額倍數 }
function diceRule(values) {
  if (!Array.isArray(values) || values.length !== 3) return null;
  const [a, b, c] = values.slice().sort((x, y) => x - y);
  if (a === b && b === c) return { kind: 'triple', name: `骰規 豹子 ${values.join('')}`, text: '(底 + 台) ×2', tai: 0, mult: 2 };
  const key = `${a}${b}${c}`;
  if (['123', '234', '345', '456', '156', '126'].includes(key)) return { kind: 'straight', name: `骰規 順子 ${values.join('')}`, text: '+2 台', tai: 2, mult: 1 };
  return null;
}

module.exports = { diceRule, MIGI_TAI, waits, TILE_NAMES, isFlower, isHonor, suitOf, shuffle, newWall, counts, canWin, winDecomps, evaluate };

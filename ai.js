'use strict';
// 電腦 AI：依「向聽數」與「進張數」(有效牌剩餘張數) 做取捨
// 向聽數：還差幾張可以聽牌 (0 = 聽牌, -1 = 胡牌)
// 進張數：打出某張後，牌桌上尚未現身、能讓向聽數下降的牌總張數
const G = require('./game');

// 一般型向聽數。c: 34 格計數 (會暫時修改但結束時還原)，need: 還需要的面子數 (5 - 副露數)
function shanten(c, need) {
  let best = 2 * need;
  const dfs = (i, m, t, p) => {
    while (i < 34 && c[i] === 0) i++;
    if (i >= 34) {
      const tt = Math.min(t, need - m);
      const s = 2 * (need - m) - tt - p;
      if (s < best) best = s;
      return;
    }
    // 剪枝：剩下的牌全部變成面子也不會更好
    if (2 * (need - m) - Math.min(t, need - m) - p - 2 * Math.floor(remaining(c, i) / 3) >= best + 2) return;
    const seqOk = i < 27 && i % 9 <= 6;
    if (c[i] >= 3) { c[i] -= 3; dfs(i, m + 1, t, p); c[i] += 3; }
    if (seqOk && c[i + 1] && c[i + 2]) { c[i]--; c[i + 1]--; c[i + 2]--; dfs(i, m + 1, t, p); c[i]++; c[i + 1]++; c[i + 2]++; }
    if (c[i] >= 2) {
      c[i] -= 2;
      if (!p) dfs(i, m, t, 1);
      if (m + t < need) dfs(i, m, t + 1, p);
      c[i] += 2;
    }
    if (m + t < need && i < 27) {
      if (i % 9 <= 7 && c[i + 1]) { c[i]--; c[i + 1]--; dfs(i, m, t + 1, p); c[i]++; c[i + 1]++; }
      if (i % 9 <= 6 && c[i + 2]) { c[i]--; c[i + 2]--; dfs(i, m, t + 1, p); c[i]++; c[i + 2]++; }
    }
    c[i]--; dfs(i, m, t, p); c[i]++; // 當作孤張
  };
  dfs(0, 0, 0, 0);
  return best;
}

function remaining(c, from) {
  let n = 0;
  for (let k = from; k < 34; k++) n += c[k];
  return n;
}

// 嚦咕嚦咕 (7 對 + 1 刻，門清 17 張) 向聽數
function pairsShanten(c) {
  let pairs = 0, tri = 0;
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 3) tri++;
    if (c[t] >= 2) pairs++;
  }
  // 需要 8 組：7 對 + 1 刻 (刻子同時算一組對子)。胡牌 = 8 組含刻子 → -1
  return 8 - Math.min(pairs, 8) - (tri > 0 ? 1 : 0);
}

function handShanten(hand, meldCount) {
  const c = G.counts(hand);
  const need = 5 - meldCount;
  let s = shanten(c, need);
  if (meldCount === 0) s = Math.min(s, pairsShanten(c));
  return s;
}

// 牌桌上尚未現身的張數 (以這位玩家看得到的資訊計算)
function unseenCounts(room, seat) {
  const u = new Array(34).fill(4);
  const see = (t) => { if (t != null && t < 34) u[t]--; };
  room.seats[seat].hand.forEach(see);
  for (let p = 0; p < 4; p++) {
    const s = room.seats[p];
    s.discards.forEach(see);
    for (const m of s.melds) {
      if (m.type === 'angang' && p !== seat) continue; // 別人的暗槓看不到
      m.tiles.forEach(see);
    }
  }
  return u.map((n) => Math.max(0, n));
}

// 打出 discard 後的向聽數與進張數
function evalDiscard(hand, meldCount, discard, unseen) {
  const after = hand.slice();
  after.splice(after.indexOf(discard), 1);
  const sh = handShanten(after, meldCount);
  let uk = 0;
  for (let x = 0; x < 34; x++) {
    if (!unseen[x]) continue;
    after.push(x);
    if (handShanten(after, meldCount) < sh) uk += unseen[x];
    after.pop();
  }
  return { sh, uk };
}

// 同分時的取捨：孤立字牌、么九先打；有價值的字牌 (三元、圈風、門風) 晚一點打；別人打過的牌較安全
function tieBreak(room, seat, t) {
  let v = 0;
  if (t >= 27) {
    const seatWind = (seat - room.dealer + 4) % 4;
    const valuable = t >= 31 || t === 27 + room.round || t === 27 + seatWind;
    v += valuable ? -0.5 : 1;
  } else {
    const r = t % 9;
    if (r === 0 || r === 8) v += 0.6;
    else if (r === 1 || r === 7) v += 0.3;
  }
  // 安全度：其他家已打出過同一張
  for (let p = 0; p < 4; p++) if (p !== seat && room.seats[p].discards.includes(t)) v += 0.4;
  return v;
}

// ---------- 防守 ----------
// 只使用公開資訊：MIGI 宣告、副露、牌河、出牌順序、剩餘牌數

// 對手聽牌的威脅度 (0~1)
function threatOf(room, me, p) {
  const s = room.seats[p];
  if (s.migi) return 1; // 宣告 MIGI = 確定聽牌
  const open = s.melds.filter((m) => m.type !== 'angang').length;
  let t = [0, 0.15, 0.4, 0.7, 0.9, 1][Math.min(open, 5)];
  const left = room.wall ? room.wall.length - 16 : 99;
  if (left < 30) t += 0.2;
  if (left < 15) t += 0.2;
  if (s.discards.length >= 10) t += 0.15;
  return Math.min(1, t);
}

// 對手 p 已「放過」的牌：p 上次打牌之後，其他家打出、p 沒有胡的牌
function passedBy(room, p) {
  const log = room.discardLog || [];
  const res = new Set();
  for (let k = log.length - 1; k >= 0; k--) {
    if (log[k].seat === p) break;
    res.add(log[k].tile);
  }
  return res;
}

// 對手 p 若在聽牌，打出 t 放槍的危險度 (0~1)
function dangerFor(room, p, t, unseen) {
  const s = room.seats[p];
  if (passedBy(room, p).has(t)) return 0.05; // 剛放過同一張，幾乎安全
  let d;
  if (t >= 27) {
    // 字牌只能單吊或對碰：看不到的張數越少越安全
    d = [0, 0.25, 0.6, 0.8, 0.8][unseen[t]];
  } else {
    const r = t % 9;
    d = r === 0 || r === 8 ? 0.6 : r === 1 || r === 7 ? 0.8 : 1;
    // 附近的牌都已現身 4 張，能組成的聽牌形就少
    const near = [t - 2, t - 1, t + 1, t + 2].filter((x) => x >= 0 && x < 27 && Math.floor(x / 9) === Math.floor(t / 9));
    const dead = near.filter((x) => unseen[x] === 0).length;
    d *= 1 - 0.15 * dead;
  }
  // 自己打過的牌 (台灣規則沒有振聽，仍有風險，但通常已不需要這張)
  if (s.discards.includes(t)) d *= 0.35;
  // 副露全是同一門 (做清一色/混一色)：該門危險、其他門安全
  const suits = new Set(s.melds.filter((m) => m.type !== 'angang').map((m) => G.suitOf(m.tiles[0])).filter((x) => x !== 3));
  if (s.melds.length >= 2 && suits.size === 1) {
    const [suit] = suits;
    if (G.suitOf(t) === suit) d *= 1.4;
    else if (t < 27) d *= 0.3;
  }
  return Math.min(1, d);
}

// 打出 t 的總危險度 = Σ 威脅度 × 危險度
function dangerOf(room, me, t, unseen, threats) {
  let sum = 0;
  for (let p = 0; p < 4; p++) {
    if (p === me || !threats[p]) continue;
    sum += threats[p] * dangerFor(room, p, t, unseen);
  }
  return sum;
}

function threatsFor(room, me) {
  return [0, 1, 2, 3].map((p) => (p === me ? 0 : threatOf(room, me, p)));
}

// 防守權重：自己離聽牌越遠、越該棄胡；已聽牌就只避開非常危險的牌
const DEF = {
  trigger: Number(process.env.AI_DEF_TRIGGER ?? 0.9), // 最大威脅度達此值才開始防守
  w2: Number(process.env.AI_DEF_W2 ?? 2500), // 二向聽以上
  w1: Number(process.env.AI_DEF_W1 ?? 1000), // 一向聽
  w0: Number(process.env.AI_DEF_W0 ?? 100), // 已聽牌
};
function defenseWeight(sh) {
  return sh >= 2 ? DEF.w2 : sh === 1 ? DEF.w1 : DEF.w0;
}

// 選出最佳捨牌：進攻分數 (向聽、進張) − 防守權重 × 危險度
function chooseDiscard(room, seat, candidates) {
  const s = room.seats[seat];
  const unseen = unseenCounts(room, seat);
  const tiles = candidates || [...new Set(s.hand)];
  const threats = threatsFor(room, seat);
  const maxThreat = Math.max(...threats);
  const evals = tiles.map((t) => ({ tile: t, ...evalDiscard(s.hand, s.melds.length, t, unseen) }));
  const bestSh = Math.min(...evals.map((e) => e.sh));
  const w = maxThreat >= DEF.trigger ? defenseWeight(bestSh) : 0;
  let best = null;
  for (const e of evals) {
    const danger = w ? dangerOf(room, seat, e.tile, unseen, threats) : 0;
    const score = -e.sh * 1000 + e.uk * 10 + tieBreak(room, seat, e.tile) - w * danger;
    if (!best || score > best.score) best = { ...e, score, danger, defending: w > 0 };
  }
  return best;
}

// 依序挑出最不需要的 n 張 (換牌用)
function chooseWorst(room, seat, n) {
  const s = room.seats[seat];
  const saved = s.hand;
  const hand = saved.slice();
  const out = [];
  try {
    for (let k = 0; k < n; k++) {
      s.hand = hand;
      const b = chooseDiscard(room, seat);
      out.push(b.tile);
      hand.splice(hand.indexOf(b.tile), 1);
    }
  } finally {
    s.hand = saved;
  }
  return out;
}

// 吃/碰/槓後能打出的最佳結果 (向聽數、進張數)
function afterCall(room, seat, removeTiles, newMeldCount, forbid) {
  const s = room.seats[seat];
  const hand = s.hand.slice();
  for (const t of removeTiles) hand.splice(hand.indexOf(t), 1);
  const unseen = unseenCounts(room, seat);
  let best = null;
  const cands = [...new Set(hand)].filter((t) => !forbid || !forbid.has(t));
  for (const t of cands.length ? cands : new Set(hand)) {
    const e = evalDiscard(hand, newMeldCount, t, unseen);
    if (!best || e.sh < best.sh || (e.sh === best.sh && e.uk > best.uk)) best = e;
  }
  return best;
}

// 目前手牌 (16 張狀態) 的向聽數與進張數
function currentState(room, seat) {
  const s = room.seats[seat];
  const unseen = unseenCounts(room, seat);
  const sh = handShanten(s.hand, s.melds.length);
  let uk = 0;
  for (let x = 0; x < 34; x++) {
    if (!unseen[x]) continue;
    if (handShanten([...s.hand, x], s.melds.length) < sh) uk += unseen[x];
  }
  return { sh, uk };
}

// 是否吃/碰：只有能讓向聽數下降才叫牌；有價值字牌的刻子即使向聽不變、進張不減也碰 (多 1 台)
function decideClaim(room, seat, opts, tile) {
  const s = room.seats[seat];
  const cur = currentState(room, seat);
  const mc = s.melds.length;
  const seatWind = (seat - room.dealer + 4) % 4;
  const valuable = tile >= 31 || tile === 27 + room.round || tile === 27 + seatWind;
  // 別家威脅大、自己又離聽牌還遠：不吃碰，保留手牌好防守
  if (Math.max(...threatsFor(room, seat)) >= 0.6 && cur.sh >= 2) return { type: 'pass' };
  let choice = { type: 'pass' }, bestSh = cur.sh, bestUk = cur.uk;
  // 門清時，碰三元/風牌多的 1 台會被少掉的門清 1 台抵銷，所以只有向聽數下降才叫牌
  const menqing = s.melds.every((m) => m.type === 'angang');
  const consider = (resp, remove, extraBonus) => {
    const forbid = room.forbiddenAfterCall ? room.forbiddenAfterCall(tile, resp.type, resp.tiles || []) : null;
    const e = afterCall(room, seat, remove, mc + 1, forbid);
    if (!e) return;
    const better = e.sh < bestSh || (extraBonus && e.sh === bestSh && e.uk >= bestUk);
    if (better) { choice = resp; bestSh = e.sh; bestUk = e.uk; }
  };
  // 手上已經有暗刻 (三張) 就不碰：碰只用掉兩張，剩一張孤張，還把暗刻變成明刻
  const own = s.hand.filter((t) => t === tile).length;
  if (opts.pong && own < 3) consider({ type: 'pong' }, [tile, tile], valuable && !menqing);
  for (const pair of opts.chi || []) consider({ type: 'chi', tiles: pair }, pair, false);
  // 不明槓別人打的牌：會破壞門清 (門清、不求人)，手上的暗刻也會變成明槓 (少算暗刻)，
  // 只換來多摸一張，台數上划不來
  return choice;
}

// 暗槓 / 加槓：槓完後向聽數不變才槓
// 槓牌的必要性不高，只在不吃虧時才槓：
// - 暗槓：不破壞門清、仍算暗刻；槓完 (補一張前) 的向聽數與進張數不能比「直接打一張」差
// - 加槓：只在那張牌本來就是要打出去的牌時才加槓 (多摸一張，又不必把它打給別人)
function decideKong(room, seat, actions) {
  const s = room.seats[seat];
  const mc = s.melds.length;
  if (!actions.angang.length && !actions.jiagang.length) return null;
  const best = chooseDiscard(room, seat); // 不槓的話，最好的打法
  const unseen = unseenCounts(room, seat);
  for (const t of actions.angang) {
    const after = s.hand.filter((x) => x !== t);
    const sh = handShanten(after, mc + 1);
    if (sh > best.sh) continue;
    let uk = 0;
    for (let x = 0; x < 34; x++) {
      if (!unseen[x]) continue;
      after.push(x);
      if (handShanten(after, mc + 1) < sh) uk += unseen[x];
      after.pop();
    }
    if (sh < best.sh || uk >= best.uk) return { type: 'angang', tile: t };
  }
  for (const t of actions.jiagang) {
    if (t === best.tile) return { type: 'jiagang', tile: t };
  }
  return null;
}

// ---------- 莊家是否換牌 ----------
// 依實測 (每家蓋出最不需要的 3 張、從莊家開始依序各取一張，400 手隨機起手)：
//   起手向聽 ≥ 3：換牌後平均向聽 -0.46 ~ -1.5，且從未變差
//   起手向聽 ≤ 2：換牌後沒有變好，40% 變差 (好牌型被拆掉)
// 所以莊家手牌還差 3 張以上才聽牌時換，否則不換
const SWAP_MIN_SHANTEN = 3;
function decideSwap(room, seat) {
  return currentState(room, seat).sh >= SWAP_MIN_SHANTEN;
}

module.exports = { decideSwap, threatOf, dangerFor, passedBy, shanten, handShanten, unseenCounts, chooseDiscard, chooseWorst, decideClaim, decideKong, currentState };

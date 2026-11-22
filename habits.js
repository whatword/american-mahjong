'use strict';
// 打牌習慣紀錄：每位真人玩家 (以 email 區分) 一個 JSONL 檔，一行一個事件，只增不改。
// 個人化頁面可以下載「AI 分析檔 (.md)」和「原始資料 (.json)」，一起提供給任何 AI 就能得到打牌建議。
// 電腦、離線由電腦代打的操作都不會記錄。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = process.env.HABITS_DIR ||
  (process.env.STATS_FILE ? process.env.STATS_FILE + '.habits' : path.join(__dirname, 'data', 'habits'));
const MAX_HANDS = 20; // 每位玩家只保留最新幾局的紀錄
const MD_HANDS = MAX_HANDS;

// email 轉成固定長度的檔名，避免特殊字元造成路徑問題
const fileOf = (email) => path.join(DIR, crypto.createHash('sha256').update(String(email)).digest('hex').slice(0, 24) + '.jsonl');

function log(email, ev) {
  if (!email) return;
  try {
    fs.mkdirSync(DIR, { recursive: true });
    fs.appendFileSync(fileOf(email), JSON.stringify(ev) + '\n');
    if (ev.k === 'end') prune(email);
  } catch (e) {
    console.error('打牌紀錄寫入失敗', e.message);
  }
}

function load(email) {
  let raw;
  try { raw = fs.readFileSync(fileOf(email), 'utf8'); } catch { return []; }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try { out.push(JSON.parse(line)); } catch { /* 略過損毀的行 */ }
  }
  return out;
}

// 只留最新 MAX_HANDS 局 (依第一次出現的順序)；先寫暫存檔再改名，避免寫到一半損毀
function prune(email) {
  const events = load(email);
  const hands = groupByHand(events);
  if (hands.length <= MAX_HANDS) return;
  const keep = hands.slice(-MAX_HANDS).flatMap((x) => x.events);
  const file = fileOf(email);
  fs.writeFileSync(file + '.tmp', keep.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.renameSync(file + '.tmp', file);
}

function clear(email) {
  try { fs.rmSync(fileOf(email), { force: true }); } catch { /* 沒有檔案就算了 */ }
}

// 依局分組 (保持出現順序)
function groupByHand(events) {
  const map = new Map();
  for (const e of events) {
    if (!e.h) continue;
    if (!map.has(e.h)) map.set(e.h, []);
    map.get(e.h).push(e);
  }
  return [...map.entries()].map(([h, evs]) => ({ h, events: evs }));
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
const avg = (sum, n) => (n ? Math.round((sum / n) * 100) / 100 : null);

// 統計摘要。sh = 向聽數 (0 = 聽牌)，uk = 進張數，danger = 放槍危險度 (0~約3)，皆為內建電腦的評估
function summarize(events) {
  const hands = groupByHand(events);
  const S = {
    hands: 0, wins: 0, selfDraws: 0, dealIns: 0, draws: 0, otherWins: 0, zimoLosses: 0,
    money: 0, avgWinTai: null, avgDealInLoss: null,
    discard: {
      total: 0, timeouts: 0, migi: 0, sameAsComputer: 0, sameAsComputerPct: null,
      worseShanten: 0, worseShantenPct: null, sameShantenLessUk: 0, avgUkLoss: null,
      defendingSpots: 0, riskyInDefense: 0, riskyInDefensePct: null, avgDangerInDefense: null,
      avgShantenAfter: null,
    },
    ting: { hands: 0, handsPct: null, avgFirstTingTurn: null, winsWhenTing: 0, dealInsWhenNotTing: 0 },
    claim: {
      total: 0, timeouts: 0, taken: { chi: 0, pong: 0, kong: 0, hu: 0 }, huOpportunities: 0, passedHu: 0,
      calledButComputerPassed: 0, passedButComputerCalled: 0,
    },
    kong: { angang: 0, jiagang: 0 },
    openMeldHands: 0, openMeldWins: 0, closedWins: 0,
  };
  let winTai = 0, dealLoss = 0, shAfterSum = 0, ukLossSum = 0, ukLossN = 0, defDangerSum = 0, firstTingSum = 0;
  const D = S.discard, T = S.ting, C = S.claim;

  for (const { events: evs } of hands) {
    let firstTing = null, claimedMeld = false;
    for (const e of evs) {
      if (e.k === 'discard') {
        D.total++;
        if (e.timeout) D.timeouts++;
        if (e.migi) D.migi++;
        const same = e.tile === e.best.tile;
        if (same) D.sameAsComputer++;
        shAfterSum += e.chosen.sh;
        if (e.chosen.sh > e.best.sh) D.worseShanten++;
        else if (e.chosen.sh === e.best.sh && e.chosen.uk < e.best.uk) { D.sameShantenLessUk++; ukLossSum += e.best.uk - e.chosen.uk; ukLossN++; }
        if (e.defending) {
          D.defendingSpots++;
          defDangerSum += e.chosen.danger;
          if (e.chosen.danger > e.best.danger + 0.3) D.riskyInDefense++;
        }
        if (firstTing === null && e.chosen.sh === 0) firstTing = e.n;
      } else if (e.k === 'claim') {
        C.total++;
        if (e.action === 'timeout') C.timeouts++;
        if (C.taken[e.action] !== undefined) C.taken[e.action]++;
        if (e.options.includes('hu')) { C.huOpportunities++; if (e.action !== 'hu') C.passedHu++; }
        const took = ['chi', 'pong', 'kong'].includes(e.action);
        const refTook = ['chi', 'pong', 'kong'].includes(e.ref);
        if (took) claimedMeld = true;
        if (took && !refTook && !e.options.includes('hu')) C.calledButComputerPassed++;
        if (!took && refTook && !e.options.includes('hu')) C.passedButComputerCalled++;
      } else if (e.k === 'kong') {
        S.kong[e.type]++;
      } else if (e.k === 'end') {
        S.hands++;
        S.money += e.delta || 0;
        if (e.outcome === 'win' || e.outcome === 'zimo') {
          S.wins++; winTai += e.tai || 0;
          if (e.outcome === 'zimo') S.selfDraws++;
          if (claimedMeld) S.openMeldWins++; else S.closedWins++;
          if (firstTing !== null) T.winsWhenTing++;
        } else if (e.outcome === 'dealin') {
          S.dealIns++; dealLoss += -(e.delta || 0);
          if (firstTing === null) T.dealInsWhenNotTing++;
        } else if (e.outcome === 'draw') S.draws++;
        else if (e.outcome === 'zimoLoss') S.zimoLosses++;
        else S.otherWins++;
        if (claimedMeld) S.openMeldHands++;
      }
    }
    if (firstTing !== null) { T.hands++; firstTingSum += firstTing; }
  }
  D.sameAsComputerPct = pct(D.sameAsComputer, D.total);
  D.worseShantenPct = pct(D.worseShanten, D.total);
  D.avgUkLoss = avg(ukLossSum, ukLossN);
  D.riskyInDefensePct = pct(D.riskyInDefense, D.defendingSpots);
  D.avgDangerInDefense = avg(defDangerSum, D.defendingSpots);
  D.avgShantenAfter = avg(shAfterSum, D.total);
  T.handsPct = pct(T.hands, S.hands);
  T.avgFirstTingTurn = avg(firstTingSum, T.hands);
  S.avgWinTai = avg(winTai, S.wins);
  S.avgDealInLoss = avg(dealLoss, S.dealIns);
  S.winPct = pct(S.wins, S.hands);
  S.dealInPct = pct(S.dealIns, S.hands);
  return S;
}

const RULES_NOTE = '台灣 16 張麻將 (含花牌)，4 人，莊家連莊拉莊。胡牌看台數，沒有振聽；過水 = 可以胡卻沒胡，打出下一張牌前不能再胡；MIGI = 全桌前 8 張捨牌內、無人吃碰槓時，打出某張後即聽牌者可宣告。';
const FIELD_NOTE = {
  sh: '向聽數 (shanten)：還差幾步聽牌，0 = 已聽牌，數字越小越好。由內建電腦計算',
  uk: '進張數：打出這張後，能讓手牌更接近聽牌的牌還剩幾張 (扣掉自己看得到的牌)，越大越好',
  danger: '放槍危險度：依對手聽牌威脅與牌河推估，0 = 很安全，越大越危險',
  defending: '防守局面：有對手已 MIGI、多次副露或牌局後段，內建電腦判斷應該開始防守',
  computer: '「電腦建議」是本遊戲內建 AI 的選擇 (以向聽數、進張數、防守為主)，只是參考，不一定是唯一正解',
};

function build(email, name) {
  const events = load(email);
  const hands = groupByHand(events);
  return {
    format: 'american-mahjong-habits', version: 1, exportedAt: new Date().toISOString(),
    player: { name, email }, rules: RULES_NOTE, fields: FIELD_NOTE,
    summary: summarize(events), hands,
  };
}

function exportJson(email, name) {
  return JSON.stringify(build(email, name), null, 1);
}

const show = (v, unit = '') => (v === null || v === undefined ? '—' : v + unit);

function eventLine(e) {
  if (e.k === 'start') return `- 開局：${e.dealer ? '莊家' : '閒家'}，門風 ${e.seatWind}、圈風 ${e.roundWind}，起手 ${e.hand.join(' ')}（花 ${e.flowers}）`;
  if (e.k === 'discard') {
    const flags = `${e.timeout ? ' [超時自動打出]' : ''}${e.migi ? ' [宣告 MIGI]' : ''}`;
    const same = e.tile === e.best.tile;
    const ref = same ? '同電腦建議' : `電腦建議 ${e.best.tile}(向聽${e.best.sh}/進張${e.best.uk}/危險${e.best.danger})`;
    const def = e.defending ? ` [防守局面，最大威脅 ${e.threat}]` : '';
    return `- 第${e.n}打：手牌 ${e.hand.join(' ')}｜摸 ${e.drawn ?? '—'}｜打 ${e.tile}(向聽${e.chosen.sh}/進張${e.chosen.uk}/危險${e.chosen.danger})，${ref}${def}${flags}｜牌牆剩 ${e.wall}`;
  }
  if (e.k === 'claim') {
    const tiles = e.tiles ? `(${e.tiles.join('')})` : '';
    return `- ${e.from}打出 ${e.tile}：可 ${e.options.join('/')}｜我選 ${e.action}${tiles}，電腦會選 ${e.ref}｜目前向聽 ${e.sh}`;
  }
  if (e.k === 'kong') return `- ${e.type === 'angang' ? '暗槓' : '加槓'} ${e.tile}`;
  if (e.k === 'end') {
    const label = { win: '胡牌(榮和)', zimo: '自摸', dealin: '放槍', zimoLoss: '被自摸', otherWin: '別家胡別家', draw: '流局' }[e.outcome] || e.outcome;
    const items = e.items && e.items.length ? `，牌型 ${e.items.join('、')}` : '';
    const ting = e.ting === null ? '' : `，結束時${e.ting ? '有聽牌' : '未聽牌'}`;
    return `- 結果：${label}，${e.delta >= 0 ? '+' : ''}${e.delta} 元${e.tai ? `，${e.tai} 台` : ''}${items}${ting}`;
  }
  return null;
}

function exportMarkdown(email, name) {
  const b = build(email, name);
  const s = b.summary;
  const L = [];
  L.push('# 麻將打牌習慣分析檔', '');
  L.push('## 給 AI 的指示', '');
  L.push(
    `你是一位經驗豐富的台灣麻將教練。以下是玩家「${name}」在網頁麻將遊戲中的打牌紀錄與統計。請用繁體中文，根據資料（不要編造沒有出現的局面）分析他的打牌習慣，並依下列格式回答：`, '',
    '1. **整體評價**：用 3~5 句話概括他的風格（攻擊型／保守型／叫牌傾向等），並說明依據的數字。',
    '2. **做得好的地方**：至少 3 點，每點附上統計數字或具體局例（引用「第幾局、第幾打」）。',
    '3. **需要改善的地方**：依重要性排序至少 3 點，每點說明問題、為什麼會輸分，並附上局例與較好的打法。',
    '4. **防守與放槍**：檢視放槍次數、防守局面的出牌是否過於危險、聽牌時機。',
    '5. **叫牌（吃碰槓）與過水**：是否叫太多或太少、有沒有放掉可以胡的牌。',
    '6. **接下來的練習計畫**：給 3 個具體、可執行的小目標，例如「聽牌前先看牌河再打字牌」。',
    '7. 資料量太少（少於約 10 局）時，請明說結論的可信度有限。', '',
    '注意：「電腦建議」只是內建 AI 的參考選擇，與玩家不同不代表一定是錯的；請用台數、牌型目標與局勢判斷，不要只看是否與電腦一致。', '',
  );
  L.push('## 遊戲規則與欄位說明', '', `- ${b.rules}`);
  for (const v of Object.values(b.fields)) L.push(`- ${v}`);
  L.push('', '## 統計摘要（最新 20 局以內的全部紀錄）', '');
  const d = s.discard, t = s.ting, c = s.claim;
  L.push(
    '| 項目 | 數值 |', '|---|---|',
    `| 局數 | ${s.hands} |`,
    `| 胡牌 | ${s.wins}（${show(s.winPct, '%')}），其中自摸 ${s.selfDraws}，平均 ${show(s.avgWinTai)} 台 |`,
    `| 放槍 | ${s.dealIns}（${show(s.dealInPct, '%')}），平均每次損失 ${show(s.avgDealInLoss)} 元 |`,
    `| 流局 / 被自摸 / 別家互胡 | ${s.draws} / ${s.zimoLosses} / ${s.otherWins} |`,
    `| 累計輸贏 | ${s.money >= 0 ? '+' : ''}${s.money} 元 |`,
    `| 有叫牌(吃碰槓)的局 | ${s.openMeldHands} 局，其中胡牌 ${s.openMeldWins}；門清胡牌 ${s.closedWins} |`,
    `| 打牌次數 | ${d.total}（超時自動打出 ${d.timeouts}，MIGI ${d.migi}） |`,
    `| 與電腦建議相同的比例 | ${show(d.sameAsComputerPct, '%')} |`,
    `| 打出後向聽數比電腦建議更差 | ${d.worseShanten} 次（${show(d.worseShantenPct, '%')}） |`,
    `| 向聽相同但進張較少 | ${d.sameShantenLessUk} 次，平均少 ${show(d.avgUkLoss)} 張 |`,
    `| 打牌後平均向聽數 | ${show(d.avgShantenAfter)} |`,
    `| 防守局面 | ${d.defendingSpots} 次，其中打出明顯較危險的牌 ${d.riskyInDefense} 次（${show(d.riskyInDefensePct, '%')}），平均危險度 ${show(d.avgDangerInDefense)} |`,
    `| 曾經聽牌的局 | ${t.hands} 局（${show(t.handsPct, '%')}），平均第 ${show(t.avgFirstTingTurn)} 打首次聽牌 |`,
    `| 聽牌後胡牌 / 沒聽牌時放槍 | ${t.winsWhenTing} / ${t.dealInsWhenNotTing} |`,
    `| 別家打牌可回應 | ${c.total} 次：吃 ${c.taken.chi}、碰 ${c.taken.pong}、槓 ${c.taken.kong}、胡 ${c.taken.hu}、超時 ${c.timeouts} |`,
    `| 可以胡卻沒胡（過水） | ${c.passedHu} / ${c.huOpportunities} |`,
    `| 叫牌但電腦不叫 / 電腦會叫但沒叫 | ${c.calledButComputerPassed} / ${c.passedButComputerCalled} |`,
    `| 槓 | 暗槓 ${s.kong.angang}、加槓 ${s.kong.jiagang} |`,
    '',
  );
  const recent = b.hands.slice(-MD_HANDS);
  L.push(`## 最近 ${recent.length} 局的逐步紀錄（共 ${b.hands.length} 局）`, '');
  if (!recent.length) L.push('（還沒有紀錄，打幾局之後再下載。）', '');
  for (const { h, events } of recent) {
    const end = events.find((e) => e.k === 'end');
    L.push(`### 局 ${h}${end ? `（第 ${end.no} 局）` : '（未完成）'}`);
    for (const e of events) { const ln = eventLine(e); if (ln) L.push(ln); }
    L.push('');
  }
  L.push('## 摘要原始資料（JSON）', '', '```json', JSON.stringify(s), '```', '');
  return L.join('\n');
}

module.exports = { MAX_HANDS, log, load, clear, summarize, exportJson, exportMarkdown, groupByHand, DIR };

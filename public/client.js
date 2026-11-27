'use strict';
const NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
const SUIT = ['萬', '筒', '條'];
const HONOR = ['東', '南', '西', '北', '中', '發', '白'];
const FLOWER = ['春', '夏', '秋', '冬', '梅', '蘭', '菊', '竹'];
const WINDS = ['東', '南', '西', '北'];
const $ = (id) => document.getElementById(id);

let swapSel = [], swapPicks = {}, swapKey = '';
let ws, S = null, selected = null, tick = null; // selected: 手牌位置 (index)

// 牌面圖：萬筒條與字牌用 FluffyStuff 圖組 (公有領域)，花牌為自製；圖案疊在 Front.svg 上
// 白板用自製的藍框 (HakuFrame)，原圖組的白板是全白，容易看成空白牌
const HONOR_FILE = ['Ton', 'Nan', 'Shaa', 'Pei', 'Chun', 'Hatsu', 'HakuFrame'];
const FLOWER_FILE = ['Spring', 'Summer', 'Autumn', 'Winter', 'Plum', 'Orchid', 'Chrysanthemum', 'Bamboo'];
function tileFile(t) {
  if (t < 9) return 'Man' + (t + 1);
  if (t < 18) return 'Pin' + (t - 8);
  if (t < 27) return 'Sou' + (t - 17);
  if (t < 34) return HONOR_FILE[t - 27];
  return FLOWER_FILE[t - 34];
}

// 牌的大小一律由 font-size 決定 (寬 0.825em、高 1.1em)，所以各處原本的 font-size 設定都照樣有效
function tileEl(t, extra = '') {
  const d = document.createElement('div');
  d.className = `tile ${t >= 34 ? 'f' : ''} ${extra}`;
  d.style.backgroundImage = `url(tiles/${tileFile(t)}.svg), url(tiles/Front.svg)`;
  d.title = tileName(t);
  return d;
}

// 預先載入所有牌面，避免第一次出現時閃爍
for (const f of ['Front', 'BackGreen', ...HONOR_FILE, ...FLOWER_FILE, ...[1, 2, 3, 4, 5, 6, 7, 8, 9].flatMap((n) => ['Man' + n, 'Pin' + n, 'Sou' + n])]) {
  new Image().src = `tiles/${f}.svg`;
}

function tileName(t) {
  if (t < 27) return NUM[t % 9] + SUIT[Math.floor(t / 9)];
  if (t < 34) return ['東', '南', '西', '北', '紅中', '發財', '白板'][t - 27];
  return FLOWER[t - 34];
}

// ---------- 畫面差異更新 ----------
// 重畫時不整排刪掉重建，而是沿用原本的元素、只改有變的屬性。
// 牌面是 SVG 背景圖，元素一旦重建，手機瀏覽器會重新繪製而閃一下；沿用元素就不會。
function morph(o, n) {
  if (o.nodeType === 3) { if (o.nodeValue !== n.nodeValue) o.nodeValue = n.nodeValue; return; }
  for (const a of [...o.attributes]) if (!n.hasAttribute(a.name)) o.removeAttribute(a.name);
  for (const a of n.attributes) if (o.getAttribute(a.name) !== a.value) o.setAttribute(a.name, a.value);
  o.onclick = n.onclick;
  patchChildren(o, [...n.childNodes]);
}
function patchChildren(parent, nodes) {
  const old = [...parent.childNodes];
  nodes.forEach((n, k) => {
    const o = old[k];
    if (!o) parent.appendChild(n);
    else if (o.nodeType === n.nodeType && o.nodeName === n.nodeName) morph(o, n);
    else parent.replaceChild(n, o);
  });
  for (let k = nodes.length; k < old.length; k++) old[k].remove();
}

function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

// ---------- 登入 ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
let me = null, hall = null, kicked = false, clientVersion = null;
$('name').value = localStorage.getItem('mj_name') || '';
$('email').value = localStorage.getItem('mj_email') || '';

function show(id) {
  for (const k of ['login', 'hall', 'lobby', 'game']) $(k).classList.toggle('hidden', k !== id);
}

$('loginForm').onsubmit = (e) => {
  e.preventDefault();
  const name = $('name').value.trim();
  const email = $('email').value.trim().toLowerCase();
  if (!name) return ($('loginErr').textContent = '請輸入暱稱');
  if (!EMAIL_RE.test(email)) return ($('loginErr').textContent = '帳號必須是有效的 email');
  $('loginErr').textContent = '';
  connect(name, email);
};

$('logoutBtn').onclick = () => {
  localStorage.removeItem('mj_email');
  me = null;
  if (ws) { ws.onclose = null; ws.close(); }
  show('login');
};

function connect(name, email) {
  if (ws) { ws.onclose = null; ws.close(); }
  kicked = false;
  $('loginBtn').disabled = true;
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);
  ws.onopen = () => send({ type: 'login', name, email });
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.type === 'loggedIn') {
      // 重新連線時發現網頁程式已更新 (例如伺服器改版重啟)：重新整理頁面載入新版，之後會自動登入
      if (clientVersion && m.version && m.version !== clientVersion) { location.reload(); return; }
      clientVersion = m.version;
      me = m.me;
      localStorage.setItem('mj_name', me.name);
      localStorage.setItem('mj_email', me.email);
      $('loginBtn').disabled = false;
    } else if (m.type === 'loginError') {
      $('loginErr').textContent = m.text;
      $('loginBtn').disabled = false;
      ws.onclose = null;
      ws.close();
    } else if (m.type === 'hall') {
      const fromGame = !!S;
      S = null; hall = m; renderHall();
      if (fromGame && hallTab === 'me') send({ type: 'habitRadar' });
    }
    else if (m.type === 'state') { S = m; render(); }
    else if (m.type === 'toast') toast(m.text);
    else if (m.type === 'say') showSay(m);
    else if (m.type === 'recommend') {
      if (!S || S.phase !== 'discard' || S.turn !== S.you) return;
      const k = S.hand.indexOf(m.tile);
      selected = S.drawn === m.tile ? 'drawn' : k >= 0 ? k : null;
      renderGame();
    }
    else if (m.type === 'habitFile') downloadFile(m);
    else if (m.type === 'habitRadar') renderRadar(m.data);
    else if (m.type === 'kicked') kicked = true;
  };
  ws.onclose = () => {
    S = null;
    $('loginBtn').disabled = false;
    show('login');
    $('loginErr').textContent = kicked ? '此帳號已在其他視窗登入' : '連線中斷，請重新登入';
  };
}

// 重新整理頁面時，用上次的暱稱與帳號自動登入
if ($('name').value && EMAIL_RE.test($('email').value)) connect($('name').value.trim(), $('email').value.trim().toLowerCase());

// ---------- 大廳 ----------
function renderHall() {
  show('hall');
  $('hallMe').textContent = `${me.name}（${me.email}）`;
  const list = $('roomList');
  list.innerHTML = '';
  $('hallCount').textContent = `房間 ${hall.rooms.length} / ${hall.max}`;
  renderBoard(hall.board || []);
  renderMe(hall.board || [], hall.achievements || []);
  $('createBtn').disabled = hall.rooms.length >= hall.max;
  if (!hall.rooms.length) {
    list.innerHTML = '<p class="hint">目前沒有房間，按「開新房間」建立一桌。</p>';
    return;
  }
  for (const r of hall.rooms) {
    const card = document.createElement('div');
    card.className = 'roomcard' + (r.mine ? ' mine' : '');
    const status = r.state === 'playing' ? '<span class="tag playing">遊戲中</span>' : '<span class="tag waiting">等待中</span>';
    const seats = r.players.map((n) => `<li>${n ? escapeHtml(n) : '<em>空位</em>'}</li>`).join('');
    const specText = r.spectators ? ` <span class="spec-count">(${r.spectators} 人觀戰)</span>` : '';
    card.innerHTML = `<div class="rtitle">${escapeHtml(r.title)} ${status}</div><div class="rcount">${r.count} / 4 人${specText}</div><ul>${seats}</ul>`;
    const b = document.createElement('button');
    if (r.mine) {
      b.textContent = '回到房間';
      b.onclick = () => send({ type: 'joinRoom', room: r.id });
    } else if (r.state === 'playing') {
      b.textContent = '觀戰';
      b.className = 'spectate-btn';
      b.onclick = () => send({ type: 'spectate', room: r.id });
    } else if (r.count >= 4) {
      b.textContent = '已滿';
      b.disabled = true;
    } else {
      b.textContent = '加入';
      b.onclick = () => send({ type: 'joinRoom', room: r.id });
    }
    card.appendChild(b);
    list.appendChild(card);
  }
}
$('createBtn').onclick = () => send({ type: 'create' });

// ---------- 計分板 ----------
const money = (n) => (n > 0 ? '+' : '') + n.toLocaleString();
const sign = (n) => (n > 0 ? 'pos' : n < 0 ? 'neg' : '');
// 金額拆分：跟玩家 / 跟電腦
const split = (p) => `<div class="msplit"><span>玩家 <i class="${sign(p.moneyVsHuman)}">${money(p.moneyVsHuman)}</i></span><span>電腦 <i class="${sign(p.moneyVsBot)}">${money(p.moneyVsBot)}</i></span>${p.moneyLegacy ? `<span>舊 <i class="${sign(p.moneyLegacy)}">${money(p.moneyLegacy)}</i></span>` : ''}</div>`;
const pctText = (r) => (r == null ? '—' : (r * 100).toFixed(1) + '%');
// 真人顯示「暱稱(email)」，暱稱為該 email 最新登入時的暱稱
const who = (p) => `${p.bot ? '🤖 ' : ''}${escapeHtml(p.name)}${p.email ? `<span class="em">(${escapeHtml(p.email)})</span>` : ''}${p.you ? '（你）' : ''}`;

function renderBoard(list) {
  const podium = $('podium');
  const rest = $('rankList');
  podium.innerHTML = '';
  rest.innerHTML = '';
  if (!list.length) {
    podium.innerHTML = '<p class="hint">還沒有任何戰績，打完一局後就會出現。</p>';
    return;
  }
  // 頒獎台：第二名在左、第一名在中間最高、第三名在右
  const medals = ['🥇', '🥈', '🥉'];
  for (const rank of [1, 0, 2]) {
    const p = list[rank];
    const col = document.createElement('div');
    col.className = `pcol r${rank + 1}`;
    if (p) {
      col.innerHTML = `<div class="pcard${p.you ? ' you' : ''}"><div class="medal">${medals[rank]}</div>` +
        `<div class="pname">${who(p)}</div><div class="pmoney ${p.money >= 0 ? 'pos' : 'neg'}">${money(p.money)}</div>${split(p)}</div>` +
        `<div class="step">${rank + 1}</div>`;
      col.querySelector('.pcard').onclick = () => showStats(p, rank + 1);
    } else col.innerHTML = '<div class="pcard empty"></div><div class="step"></div>';
    podium.appendChild(col);
  }
  list.slice(3).forEach((p, k) => {
    const row = document.createElement('div');
    row.className = 'rankrow' + (p.you ? ' you' : '');
    row.innerHTML = `<span class="rk">${k + 4}</span><span class="nm">${who(p)}</span><span class="rmoney"><b class="${p.money >= 0 ? 'pos' : 'neg'}">${money(p.money)}</b>${split(p)}</span>`;
    row.onclick = () => showStats(p, k + 4);
    rest.appendChild(row);
  });
}

// 戰績明細 (計分板的彈窗和個人化頁面共用)
function statGridHtml(p) {
  const vs = (o) => `${pctText(o.rate)} <small>（${o.w} 勝 ${o.l} 負）</small>`;
  return `<div class="statgrid">
      <div class="wide"><span>總金額 = 跟玩家輸贏 + 跟電腦輸贏</span>
        <b class="${p.money >= 0 ? 'pos' : 'neg'}">${money(p.money)}</b>
        <small>= 跟玩家 <i class="${sign(p.moneyVsHuman)}">${money(p.moneyVsHuman)}</i> ＋ 跟電腦 <i class="${sign(p.moneyVsBot)}">${money(p.moneyVsBot)}</i>${p.moneyLegacy ? ` ＋ 舊紀錄（未分類） <i class="${sign(p.moneyLegacy)}">${money(p.moneyLegacy)}</i>` : ''}</small></div>
      <div><span>總勝率</span><b>${pctText(p.winRate)} <small>（${p.wins} 胡 / ${p.hands} 局）</small></b></div>
      <div><span>跟玩家勝率</span><b>${vs(p.vsHuman)}</b></div>
      <div><span>跟電腦勝率</span><b>${vs(p.vsBot)}</b></div>
      <div><span>自摸次數</span><b>${p.selfDraws}</b></div>
      <div><span>放槍次數</span><b>${p.dealIns}</b></div>
    </div>`;
}

function showStats(p, rank) {
  const m = $('statModal');
  m.innerHTML = `<div class="box">
    <h2>第 ${rank} 名　${who(p)}</h2>
    ${statGridHtml(p)}
    <p class="hint">總勝率 = 胡牌局數 ÷ 參與局數。跟玩家／電腦勝率 = 和真人／電腦之間有輸贏的次數中，自己贏的比例（胡牌時贏每位付錢的人，付錢時輸給胡牌的人）。</p>
    <button id="statClose">關閉</button>
  </div>`;
  m.classList.remove('hidden');
  $('statClose').onclick = () => m.classList.add('hidden');
  m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
}

// ---------- 個人化頁面 ----------
let hallTab = 'board';
function setHallTab(t) {
  hallTab = t;
  $('boardPane').classList.toggle('hidden', t !== 'board');
  $('mePane').classList.toggle('hidden', t !== 'me');
  $('achPane').classList.toggle('hidden', t !== 'ach');
  $('colPane').classList.toggle('hidden', t !== 'col');
  $('tabBoard').classList.toggle('active', t === 'board');
  $('tabMe').classList.toggle('active', t === 'me');
  $('tabAch').classList.toggle('active', t === 'ach');
  $('tabCol').classList.toggle('active', t === 'col');
  if (t === 'me') send({ type: 'habitRadar' });
}

// 打牌習慣六角雷達圖 (Chart.js 從 CDN 載入，載入失敗就不顯示圖)
let radarChart = null;
function renderRadar(data) {
  const empty = $('radarEmpty');
  const canvas = $('habitRadar');
  if (radarChart) { radarChart.destroy(); radarChart = null; }
  canvas.classList.toggle('hidden', !data);
  empty.classList.toggle('hidden', !!data);
  if (!data || typeof Chart === 'undefined') return;
  const luck = data.values[5];
  const labels = data.labels.map((l, i) => (i === 5 ? `${l} (${luck >= 50 ? '順風' : '逆風'})` : l));
  radarChart = new Chart(canvas.getContext('2d'), {
    type: 'radar',
    data: {
      labels,
      datasets: [
        {
          label: '目前表現',
          data: data.values,
          backgroundColor: 'rgba(56, 189, 248, 0.28)',
          borderColor: '#38bdf8',
          borderWidth: 2.5,
          pointBackgroundColor: data.values.map((v, i) => (i === 5 && v < 50 ? '#f87171' : '#38bdf8')),
          pointBorderColor: '#fff',
          pointRadius: 4,
          order: 1,
        },
        {
          label: '50 分基準線',
          data: [50, 50, 50, 50, 50, 50],
          fill: false,
          backgroundColor: 'transparent',
          borderColor: '#fbbf24',
          borderWidth: 2,
          borderDash: [6, 5],
          pointRadius: 0,
          pointHoverRadius: 0,
          order: 2,
        },
      ],
    },
    options: {
      responsive: true,
      scales: {
        r: {
          min: 0, max: 100,
          ticks: { stepSize: 25, color: '#94a3b8', backdropColor: 'transparent', font: { size: 11 } },
          grid: { color: 'rgba(148, 163, 184, 0.25)' },
          angleLines: { color: 'rgba(148, 163, 184, 0.3)' },
          pointLabels: { color: '#f1f5f9', font: { size: 13, weight: 'bold' } },
        },
      },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#cbd5e1', padding: 16, usePointStyle: true } },
        tooltip: {
          callbacks: {
            label(ctx) {
              if (ctx.datasetIndex === 1) return ' 基準線: 50 分';
              const diff = ctx.raw - 50;
              return ` ${ctx.dataset.label}: ${ctx.raw} 分 (相對基準 ${diff >= 0 ? '+' : ''}${diff})`;
            },
          },
        },
      },
    },
  });
}
$('tabBoard').onclick = () => setHallTab('board');
$('tabMe').onclick = () => setHallTab('me');
$('tabAch').onclick = () => setHallTab('ach');
$('tabCol').onclick = () => setHallTab('col');

// 打牌習慣：向伺服器要檔案，收到後用 Blob 觸發瀏覽器下載
$('habitMd').onclick = () => send({ type: 'habitExport', fmt: 'md' });
$('habitJson').onclick = () => send({ type: 'habitExport', fmt: 'json' });
$('habitClear').onclick = async () => {
  const yes = await confirmDialog({
    title: '清除打牌紀錄？',
    body: '<p>會刪除你這個帳號所有的打牌習慣紀錄，<b>無法復原</b>。計分板的戰績與成就不受影響。</p>',
    ok: '清除',
    cancel: '取消',
    danger: true,
  });
  if (yes) send({ type: 'habitClear' });
};
function downloadFile({ filename, content, fmt }) {
  const type = fmt === 'json' ? 'application/json' : 'text/markdown';
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderMe(list, achievements) {
  const empty = {
    money: 0, moneyVsHuman: 0, moneyVsBot: 0, moneyLegacy: 0, hands: 0, wins: 0, selfDraws: 0, dealIns: 0, winRate: null,
    vsHuman: { w: 0, l: 0, rate: null }, vsBot: { w: 0, l: 0, rate: null }, ach: {}, tiles: {},
  };
  const p = list.find((x) => x.you) || empty;
  $('meStats').innerHTML = statGridHtml(p);
  const done = achievements.filter((a) => p.ach[a.name] > 0);
  const todo = achievements.filter((a) => !(p.ach[a.name] > 0));
  const item = (a, n) => `<div class="ach ${n ? 'done' : 'todo'}"><span class="atai">${a.tai} 台</span><span class="aname">${n ? '✅' : '🔒'} ${escapeHtml(a.name)}</span>${n ? `<span class="acnt">×${n}</span>` : ''}</div>`;
  $('achList').innerHTML =
    `<h4>已完成 ${done.length} / ${achievements.length}</h4><div class="achgrid">${done.map((a) => item(a, p.ach[a.name])).join('') || '<p class="hint">還沒有完成的成就。</p>'}</div>` +
    `<h4>未完成 ${todo.length}</h4><div class="achgrid">${todo.map((a) => item(a, 0)).join('') || '<p class="hint">全部完成了！🎉</p>'}</div>`;
  renderCollection(p.tiles || {});
}

// 收藏：萬、筒、條各 9 張加上 7 種字牌 (不含花牌)，胡過的牌點亮並顯示次數
function renderCollection(tiles) {
  const groups = [['萬子', 0, 9], ['筒子', 9, 18], ['條子', 18, 27], ['字牌', 27, 34]];
  const got = Array.from({ length: 34 }, (_, t) => t).filter((t) => tiles[t] > 0).length;
  const box = $('colList');
  box.innerHTML = `<h4>已收藏 ${got} / 34</h4>`;
  for (const [title, a, b] of groups) {
    const h = document.createElement('h4');
    h.textContent = title;
    const grid = document.createElement('div');
    grid.className = 'colgrid';
    for (let t = a; t < b; t++) {
      const n = tiles[t] || 0;
      const cell = document.createElement('div');
      cell.className = 'colcell ' + (n ? 'done' : 'todo');
      cell.appendChild(tileEl(t));
      if (n) { const c = document.createElement('span'); c.className = 'colcnt'; c.textContent = '×' + n; cell.appendChild(c); }
      grid.appendChild(cell);
    }
    box.append(h, grid);
  }
}
$('leaveBtn').onclick = async () => {
  const yes = await confirmDialog({
    title: '要離開房間嗎？',
    body: '<p>遊戲還沒開始，離開後會<b>讓出座位</b>。</p><p>你是最後一位玩家的話，房間會被關閉。</p>',
    ok: '離開房間',
    cancel: '留在房間',
    danger: true,
  });
  if (yes) send({ type: 'leave' });
};

// 確認視窗：回傳 Promise<boolean>。點背景、按 Esc 都算取消
function confirmDialog({ title, body, ok = '確定', cancel = '取消', danger = false }) {
  const m = $('confirmModal');
  $('confirmTitle').textContent = title;
  $('confirmBody').innerHTML = body;
  $('confirmOk').textContent = ok;
  $('confirmOk').className = danger ? 'danger' : '';
  $('confirmCancel').textContent = cancel;
  m.classList.remove('hidden');
  $('confirmCancel').focus();
  return new Promise((resolve) => {
    const done = (v) => {
      m.classList.add('hidden');
      document.removeEventListener('keydown', onKey);
      m.onclick = $('confirmOk').onclick = $('confirmCancel').onclick = null;
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(false); if (e.key === 'Enter') done(true); };
    document.addEventListener('keydown', onKey);
    $('confirmOk').onclick = () => done(true);
    $('confirmCancel').onclick = () => done(false);
    m.onclick = (e) => { if (e.target === m) done(false); };
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------- 渲染 ----------
function render() {
  $('login').classList.add('hidden');
  $('hall').classList.add('hidden');
  if (S.state === 'lobby') {
    $('game').classList.add('hidden');
    $('lobby').classList.remove('hidden');
    renderLobby();
  } else {
    $('lobby').classList.add('hidden');
    $('game').classList.remove('hidden');
    renderGame();
  }
}

function renderLobby() {
  $('lobbyRoom').textContent = S.title;
  const box = $('lobbySeats');
  box.innerHTML = '';
  const isHost = S.host === S.you;
  S.seats.forEach((s, i) => {
    const d = document.createElement('div');
    d.className = 'lseat';
    d.innerHTML = `<span>座位 ${i + 1}：${s ? s.name + (i === S.you ? '（你）' : '') + (i === S.host ? ' 👑' : '') : '<em>空位</em>'}</span>`;
    if (s && s.bot && isHost) {
      const b = document.createElement('button');
      b.textContent = '移除';
      b.onclick = () => send({ type: 'removebot', seat: i });
      d.appendChild(b);
    }
    box.appendChild(d);
  });
  const full = S.seats.every(Boolean);
  $('addBotBtn').disabled = !isHost || full;
  $('startBtn').disabled = !isHost || !full;
  $('startBtn').textContent = isHost ? '開始遊戲' : '等待房主開始';
}
$('addBotBtn').onclick = () => send({ type: 'addbot' });
$('startBtn').onclick = () => send({ type: 'start' });

// 蓋著的牌：用牌背圖，大小跟同位置的正面牌一致
function backEl(extra = '') {
  const e = document.createElement('div');
  e.className = 'tile back-t ' + extra;
  return e;
}

function meldEl(m) {
  const d = document.createElement('div');
  d.className = 'meld';
  m.tiles.forEach((t, k) => {
    // 暗槓：對手收到的是 null，全部蓋牌；自己看得到牌面，兩端仍以蓋牌表示
    if (t === null || (m.type === 'angang' && (k === 0 || k === 3))) {
      d.appendChild(backEl());
      return;
    }
    const e = tileEl(t, 'sm' + (m.claimed === k ? ' claimed' : ''));
    d.appendChild(e);
  });
  return d;
}

// 牌桌角色前方蓋著的 3 張牌
const coverKeys = {};
function coverEl(i, pickable) {
  const d = document.createElement('div');
  d.className = 'cover';
  const cov = S.seats[i].cover;
  if (!cov) { delete coverKeys[i]; return d; }
  // 蓋牌剛出現 (伺服器洗牌一次) → 播放洗牌動畫；開始取牌後不再播放
  const key = `${S.handNo}-${S.swapLeft}`;
  if (coverKeys[i] !== key) { coverKeys[i] = key; d.classList.add('shuffling'); }
  cov.forEach((has, k) => {
    const t = backEl((has ? '' : ' gone') + (pickable && has && i !== S.you ? ' pickable' : '') + (swapPicks[i] === k ? ' sel' : ''));
    if (pickable && has && i !== S.you) t.onclick = () => { swapPicks[i] = swapPicks[i] === k ? undefined : k; renderGame(); };
    d.appendChild(t);
  });
  return d;
}

function renderGame() {
  updateUnread();
  const isSpectator = !!S.spectating;
  const me = S.you;
  const swapMode = S.phase === 'swapSelect' && !S.seats[me].confirmed && !isSpectator; // 我正在選要蓋的 3 張牌
  const pickMode = false; // 取牌改為系統自動隨機取；原條件：S.phase === 'swapPick' && S.turn === me && !isSpectator; // 輪到我取牌
  const key = `${S.handNo}-${S.phase}-${S.swapLeft}-${pickMode ? S.turn : ''}`;
  if (key !== swapKey) { swapKey = key; swapSel = []; swapPicks = {}; }
  // 換牌取牌：某一家只剩一張蓋牌可取時，直接幫玩家選好
  const forcedPicks = [];
  if (pickMode) {
    for (let p = 0; p < 4; p++) {
      if (p === me || !S.seats[p].cover) continue;
      const left = S.seats[p].cover.map((has, k) => (has ? k : -1)).filter((k) => k >= 0);
      if (left.length === 1) { swapPicks[p] = left[0]; forcedPicks.push(p); }
    }
  }
  const rel = (k) => (me + k) % 4; // k: 0 自己, 1 下家(右), 2 對家, 3 上家(左)

  const specBadge = isSpectator ? '<span class="tag spectating-tag">👀 觀戰中</span>' : '';
  const specCountText = isSpectator && S.spectatorCount > 1 ? `<span class="opt">(${S.spectatorCount} 人觀戰)</span>` : '';
  const backBtnText = isSpectator ? '離開觀戰' : '回大廳';

  $('topbar').innerHTML = `<button id="backHallBtn" class="ghost small">${backBtnText}</button>${specBadge}<span>${S.title}</span>${specCountText}<span>第 ${S.jiang} 將 ・ ${WINDS[S.round]}風圈 ・ 第 ${S.handNo} 局</span>` +
    `<span>莊家：${S.seats[S.dealer].name}</span>` +
    (S.breakInfo ? `<span class="opt2">開門：${S.seats[S.breakInfo.owner].name} 牌牆第 ${S.breakInfo.stack} 墩</span>` : '') +
    `<span>剩餘牌數：${S.wall}</span><span class="opt">底${S.base} / 每台${S.taiValue}</span>` +
    (VOICE_OK ? (() => { const on = voiceOn && !!zhVoice; return `<button id="voiceToggle" class="ghost small${on ? ' on' : ''}" title="打牌、吃、碰、胡時念出來" aria-label="${on ? '語音開' : '語音關'}">${on ? '🔊<span class="lbl"> 語音開</span>' : '🔇<span class="lbl"> 語音關</span>'}</button>`; })() : '') +
    `<button id="chatToggle" class="ghost small" aria-label="聊天">💬<span class="lbl"> 聊天</span>${chatUnread ? `<b class="dot">${chatUnread}</b>` : ''}</button>`;
  if (VOICE_OK) $('voiceToggle').onclick = () => toggleVoicePanel();
  $('chatToggle').onclick = () => {
    document.body.classList.toggle('chat-open');
    chatUnread = 0;
    chatSeen = S.chat.length;
    renderGame();
  };

  $('backHallBtn').onclick = async () => {
    if (isSpectator) {
      send({ type: 'leave' });
      return;
    }
    const alone = S.seats.every((x, k) => k === S.you || !x || x.bot || !x.online);
    const yes = await confirmDialog({
      title: '要離開牌局嗎？',
      // 只剩自己一位真人時，離開房間就會直接關閉
      body: alone
        ? '<p class="warn">目前只有你一位玩家，離開後<b>房間會直接關閉</b>，這場牌局就結束了。</p>'
        : '<p>離開後由<b>電腦代打</b>你的座位，牌局會繼續進行。</p><p>之後可以從大廳點「<b>回到房間</b>」，回到原本的座位接著打。</p>',
      ok: '回大廳',
      cancel: '繼續打牌',
      danger: true,
    });
    if (yes) send({ type: 'leave' });
  };
  for (let k = 0; k < 4; k++) {
    const i = rel(k);
    const s = S.seats[i];
    const wind = WINDS[(i - S.dealer + 4) % 4];
    if (k !== 0) {
      const seatEl = $('seat' + k);
      seatEl.className = 'seat ' + ['', 'right', 'top', 'left'][k] + (S.phase !== 'over' && S.turn === i ? ' turn' : '') + (isSpectator ? ' spectator-clickable' : '');
      if (isSpectator) {
        seatEl.title = `點擊切換至 ${s.name} 的視角`;
        seatEl.onclick = () => send({ type: 'switchView', seat: i });
      } else {
        seatEl.title = '';
        seatEl.onclick = null;
      }
      const el = document.createElement('div'); // 先畫在暫存容器，最後差異更新到畫面
      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.innerHTML = '';
      nm.append(`${wind} ${s.name}${s.online ? '' : '(離線)'}${i === S.dealer ? ' 莊' : ''}`);
      if (i === S.dealer && S.streak) nm.append(' ', Object.assign(document.createElement('b'), { className: 'streak', textContent: `🔥 連${S.streak}拉${S.streak}` }));
      if (s.migi) nm.appendChild(Object.assign(document.createElement('span'), { className: 'migi-badge', textContent: 'MIGI' }));
      if (!s.bot && s.online) {
        const mine = i === S.you && !isSpectator;
        const tg = document.createElement('button');
        tg.type = 'button';
        tg.className = 'auto-toggle' + (s.auto ? ' on' : '');
        tg.textContent = s.auto ? '代打中' : '代打';
        if (mine) { tg.title = '開啟後所有決策由電腦自動完成'; tg.onclick = (e) => { e.stopPropagation(); send({ type: 'auto', on: !s.auto }); }; }
        else { tg.disabled = true; if (!s.auto) tg.style.display = 'none'; }
        nm.append(' ', tg);
      }
      el.appendChild(nm);
      const sc = document.createElement('div');
      sc.textContent = `💰 ${S.scores[i]}`;
      el.appendChild(sc);
      const hc = document.createElement('div');
      hc.className = 'hcount';
      hc.textContent = `🀫 ${s.handCount} 張`;
      el.appendChild(hc);
      const backs = document.createElement('div');
      backs.className = 'backs' + (S.phase === 'over' && s.hand ? ' revealed' : '');
      if (S.phase === 'over' && s.hand) s.hand.forEach((t) => backs.appendChild(tileEl(t, 'sm')));
      else for (let n = 0; n < s.handCount; n++) {
        const b = document.createElement('div');
        b.className = 'back';
        backs.appendChild(b);
      }
      el.appendChild(backs);
      const ml = document.createElement('div');
      ml.className = 'melds';
      s.melds.forEach((m) => ml.appendChild(meldEl(m)));
      el.appendChild(ml);
      const fl = document.createElement('div');
      fl.className = 'flw';
      s.flowers.forEach((t) => fl.appendChild(tileEl(t, 'sm')));
      el.appendChild(fl);
      patchChildren(seatEl, [...el.childNodes]);
    }
    // 牌河
    const pool = document.createElement('div');
    // 換牌時蓋著的 3 張放在各家海底
    // 只剩一張的那家已自動選好，不能取消
    if (s.cover) pool.appendChild(coverEl(i, pickMode && i !== me && !forcedPicks.includes(i)));
    s.discards.forEach((t, n) => {
      const latest = S.last && !S.last.rob && S.phase === 'claim' && S.last.from === i && n === s.discards.length - 1;
      pool.appendChild(tileEl(t, 'sm' + (latest ? ' latest' : '')));
    });
    patchChildren($('pool' + k), [...pool.childNodes]);
  }

  // 中央資訊
  let info = '';
  if (S.phase === 'lastDraw') {
    info = (S.turn === me && !isSpectator)
      ? '<div class="big">最後一張牌，你還沒聽牌</div><div>可以選擇不摸，直接流局</div>'
      : `<div>等待 ${S.seats[S.turn].name} 決定是否摸最後一張牌</div>`;
  } else if (S.phase === 'discard') {
    info = (S.turn === me && !isSpectator)
      ? '<div class="big">輪到你出牌</div>'
      : (S.turn === me && isSpectator)
        ? `<div class="big">輪到 ${S.seats[me].name} 出牌（當前視角）</div>`
        : `<div>等待 ${S.seats[S.turn].name} 出牌</div>`;
  } else if (S.phase === 'claim') {
    info = `<div>${S.seats[S.last.from].name} ${S.last.rob ? '加槓' : '打出'} <b>${tileName(S.last.tile)}</b></div>` +
      (S.last.rob ? '<div>可搶槓</div>' : '') +
      (S.waiting && S.waiting.length ? `<div>等待 ${S.waiting.map((p) => S.seats[p].name).join('、')}</div>` : '');
  } else if (S.phase === 'dice' && S.dice) {
    info = diceInfo();
  } else if (S.phase === 'seatPick' && S.seatPick) {
    info = '';
  } else if (S.phase.startsWith('swap')) {
    const left = `<div>還可換 ${S.swapLeft} 次</div>`;
    const done = S.seats.filter((s) => s.confirmed).length;
    if (S.phase === 'swapAsk') {
      info = (S.dealer === me && !isSpectator)
        ? `<div class="big">你是莊家，要換牌嗎？</div>${left}`
        : `<div>莊家 ${S.seats[S.dealer].name} 考慮換牌中</div>${left}`;
    } else if (S.phase === 'swapSelect') {
      info = `<div class="big">換牌：選 3 張蓋牌</div><div>已確定 ${done}/4 人</div>`;
    } else {
      info = pickMode
        ? `<div class="big">輪到你取牌</div><div>從其他三家各取一張</div>`
        : `<div>輪到 ${S.seats[S.turn].name} 取牌</div>`;
    }
  }
  info += `<div class="timer" id="timer"></div>`;
  $('info').innerHTML = info;
  if (S.phase === 'seatPick' && S.seatPick) renderSeatPick($('info'));

  // 我的牌
  const wind = WINDS[(me - S.dealer + 4) % 4];
  const myTurn = S.phase === 'discard' && S.turn === me && !isSpectator;
  const mm = document.createElement('div');
  const viewingBadge = isSpectator ? '<span class="tag viewing-tag">當前視角</span>' : '';
  // 名稱下方放聽牌小燈泡 (亮起時點一下看聽牌內容)
  const lamp = !isSpectator && S.ting ? '<button type="button" id="tingLamp" class="ting-lamp" title="聽牌提醒" aria-label="聽牌提醒">💡</button>' : '';
  mm.innerHTML = `<span class="myname"><span>${wind} ${S.seats[me].name}${viewingBadge}${me === S.dealer ? ' 莊' : ''}${me === S.dealer && S.streak ? ` <b class="streak">🔥 連${S.streak}拉${S.streak}</b>` : ''} 💰${S.scores[me]}</span>${lamp}</span>` +
    (S.seats[me].migi ? '<span class="migi-badge">MIGI</span>' : '');
  const lampEl = mm.querySelector('#tingLamp');
  if (lampEl) lampEl.onclick = (ev) => { ev.stopPropagation(); tingOpen = !tingOpen; renderGame(); };
  if (!isSpectator && !S.seats[me].bot) {
    const tg = document.createElement('button');
    const on = !!S.seats[me].auto;
    tg.type = 'button';
    tg.className = 'auto-toggle' + (on ? ' on' : '');
    tg.textContent = on ? '🤖 代打中' : '🤖 代打';
    tg.title = '開啟後所有決策由電腦自動完成';
    tg.onclick = () => send({ type: 'auto', on: !on });
    mm.insertBefore(tg, mm.firstChild.nextSibling);
  }
  if (S.myTaken && S.myTaken.length) {
    const tk = document.createElement('span');
    tk.style.cssText = 'display:flex;gap:2px;margin-left:10px;align-items:center';
    tk.append('取得：');
    S.myTaken.forEach((t) => tk.appendChild(tileEl(t, 'sm')));
    mm.appendChild(tk);
  }
  // 吃碰槓的牌依發生順序翻開，放在花牌旁
  if (S.seats[me].melds.length) {
    const zone = document.createElement('div');
    zone.className = 'meld-zone';
    const lb = document.createElement('span');
    lb.className = 'meld-label';
    lb.textContent = '吃碰槓';
    zone.appendChild(lb);
    const ms = document.createElement('div');
    ms.className = 'meld-list';
    S.seats[me].melds.forEach((m) => ms.appendChild(meldEl(m)));
    zone.appendChild(ms);
    mm.appendChild(zone);
  }
  const fl = document.createElement('span');
  fl.style.cssText = 'display:flex;gap:2px;margin-left:10px';
  S.seats[me].flowers.forEach((t) => fl.appendChild(tileEl(t, 'sm')));
  mm.appendChild(fl);
  patchChildren($('myMelds'), [...mm.childNodes]);

  const handEl = $('myHand');
  handEl.className = 'row' + (myTurn || swapMode ? '' : ' disabled') + (isSpectator ? ' spectator-hand' : '');
  const hand = document.createElement('div');
  const related = isSpectator ? null : claimRelated();
  if (S.phase !== 'claim') claimPick = null;
  const addTile = (t, cls, idx) => {
    const e = tileEl(t, cls);
    if (related && related.has(t)) e.classList.add('sel');
    if (!isSpectator) {
      // 選取中的牌：上浮、黃框發光，上方標示下一步要做什麼
      const tag = (text) => e.appendChild(Object.assign(document.createElement('span'), { className: 'seltag', textContent: text }));
      if (myTurn && selected === idx) { e.classList.add('sel'); tag('再點一次打出'); }
      if (swapMode && swapSel.includes(idx)) { e.classList.add('sel'); tag('蓋牌'); }
      e.onclick = () => {
        if (swapMode) {
          const p = swapSel.indexOf(idx);
          if (p >= 0) swapSel.splice(p, 1);
          else if (swapSel.length < 3) swapSel.push(idx);
          renderGame();
          return;
        }
        if (!myTurn) return;
        if (S.actions && S.actions.locked && idx !== 'drawn') return toast('MIGI 中只能打出摸進的牌');
        if (S.actions && S.actions.forbid && S.actions.forbid.includes(t)) return toast(`剛吃碰完，不能馬上打出 ${tileName(t)}`);
        if (selected === idx) { selected = null; send({ type: 'discard', tile: t }); }
        else { selected = idx; renderGame(); }
      };
    }
    hand.appendChild(e);
  };
  // 打出後能聽牌的牌，在牌上加小標記
  const tingable = (t) => (myTurn && S.ting && S.ting.byDiscard && S.ting.byDiscard[t] ? ' tingable' : '');
  // MIGI 中只能摸打：手上其他牌變暗、不能點
  const locked = myTurn && S.actions && S.actions.locked ? ' locked' : '';
  // 剛吃/碰完，不能馬上打出的牌 (變暗、不能點)
  const forbid = new Set(myTurn && S.actions && S.actions.forbid ? S.actions.forbid : []);
  // 剛換進來的牌加上「換」標記 (同樣的牌換進幾張就標幾張)
  const swapLeft = {};
  for (const t of S.swapIn || []) swapLeft[t] = (swapLeft[t] || 0) + 1;
  const swapped = (t) => (swapLeft[t] > 0 ? (swapLeft[t]--, ' swapin') : '');
  (S.hand || []).forEach((t, k) => addTile(t, tingable(t) + locked + swapped(t) + (forbid.has(t) ? ' forbid' : ''), k));
  if (S.drawn != null) addTile(S.drawn, 'drawn' + tingable(S.drawn) + swapped(S.drawn), 'drawn');
  patchChildren(handEl, [...hand.childNodes]);
  // 有選牌時，其他牌稍微變暗，讓選到的牌更突出
  handEl.classList.toggle('has-sel', !isSpectator && !!handEl.querySelector('.tile.sel'));
  if (!myTurn) selected = null;

  renderTing(myTurn);
  renderActions();
  renderChat();
  renderResult();
  startTimer();
}

// 聽牌提示：聽哪些牌、各剩幾張 (只扣掉自己看得到的牌)
let tingOpen = false;
document.addEventListener('click', (ev) => {
  if (tingOpen && !ev.target.closest('#tingBar')) { tingOpen = false; if (S) renderGame(); }
});
function renderTing(myTurn) {
  const bar = $('tingBar');
  const full = document.createElement('div');
  const t = S.ting;
  // 內容先畫到暫存容器，有內容燈泡就亮，點燈泡才顯示在 #tingBar
  const finish = () => {
    const lit = full.childNodes.length > 0;
    const lamp = $('tingLamp');
    if (lamp) lamp.classList.toggle('on', lit);
    if (!lit) tingOpen = false;
    // 選了一張打出後會聽牌的牌：直接顯示；已經聽牌時則要點燈泡才展開
    bar.replaceChildren(...((tingOpen || auto) && lit ? [...full.childNodes] : []));
  };
  let auto = false;
  if (!t) return finish();
  const show = (label, waits) => {
    const total = waits.reduce((n, w) => n + w.left, 0);
    const d = document.createElement('div');
    d.className = 'ting';
    d.append(label);
    for (const w of waits) {
      const cell = document.createElement('span');
      cell.className = 'tw' + (w.left === 0 ? ' dead' : '');
      cell.appendChild(tileEl(w.tile, 'sm'));
      // 剩幾張 + 預估台數 (胡 = 別人打出、摸 = 自摸)
      const info = document.createElement('span');
      info.className = 'tinfo';
      info.innerHTML = `<span>${w.left}張</span><span class="ttai">胡${w.ron}・摸${w.tsumo}台</span>`;
      cell.appendChild(info);
      d.appendChild(cell);
    }
    const sum = document.createElement('span');
    sum.className = 'tsum';
    sum.textContent = (total ? `共 ${total} 張` : '已無牌可胡') + (t.mult > 1 ? `・骰規豹子 (底+台)×${t.mult}` : '');
    d.appendChild(sum);
    full.appendChild(d);
  };
  if (t.waits) {
    show(t.noRon ? '聽牌 (過水中，暫時不能胡)：' : '聽牌：', t.waits);
    if (t.noRon) full.firstChild.classList.add('noron');
    return finish();
  }
  if (!myTurn || !t.byDiscard) return finish();
  const selTile = selected === 'drawn' ? S.drawn : selected != null ? S.hand[selected] : null;
  if (selTile != null && t.byDiscard[selTile]) {
    // 過水中：打出的牌如果是自己聽的牌，打完還在過水
    auto = true;
    const stillNoRon = t.noRon && t.byDiscard[selTile].some((w) => w.tile === selTile);
    show(`打出「${tileName(selTile)}」聽${t.noRon ? (stillNoRon ? '（打這張仍在過水中）' : '（打這張可解除過水）') : ''}：`, t.byDiscard[selTile]);
    if (stillNoRon) full.firstChild.classList.add('noron');
    return finish();
  }
  // 沒選牌時不顯示內容 (燈泡不亮)，▲ 的說明併到下方操作提示裡
  finish();
}

// 圓角方形的動作按鈕：可以做的亮起來，不能做的灰掉
function roundBtn(row, label, cls, enabled, fn, active) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rbtn ' + cls + (enabled ? ' ready' : '') + (active ? ' active' : '');
  b.textContent = label;
  b.disabled = !enabled;
  if (enabled && fn) b.onclick = fn;
  row.appendChild(b);
  return b;
}

function btn(text, cls, fn) {
  const b = document.createElement('button');
  b.textContent = text;
  if (cls) b.className = cls;
  b.onclick = fn;
  actBox.appendChild(b);
  return b;
}

let actBox = null;
// 目前展開選擇框的動作 (目前只有 'chi')
let claimPick = null;

// 有人打牌可以吃碰槓時，手牌中跟這些動作有關的牌 (用牌值表示)
function claimRelated() {
  if (!S || S.phase !== 'claim' || !S.claim || S.claim.resp || !S.last) return null;
  const o = S.claim.opts, lt = S.last.tile, set = new Set();
  if (o.pong || o.kong) set.add(lt);
  (o.chi || []).forEach((p) => p.forEach((t) => set.add(t)));
  return set.size ? set : null;
}
// 先畫到暫存容器，內容沒變就保留舊按鈕，避免點擊途中按鈕被重建而失效
function renderActions() {
  const real = $('actions');
  actBox = document.createElement('div');
  renderActionsInto(actBox);
  if (actBox.innerHTML === real.innerHTML) return;
  real.replaceChildren(...actBox.childNodes);
}

function renderActionsInto(box) {
  if (S.spectating) {
    const bar = document.createElement('div');
    bar.className = 'spectator-bar';
    const lbl = document.createElement('span');
    lbl.className = 'spec-lbl';
    lbl.textContent = '👀 觀看視角：';
    bar.appendChild(lbl);
    for (let i = 0; i < 4; i++) {
      const s = S.seats[i];
      if (!s) continue;
      const wind = WINDS[(i - S.dealer + 4) % 4];
      const isCurrent = i === S.you;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'spec-seat-btn' + (isCurrent ? ' active' : '');
      b.textContent = `${wind}・${s.name}${i === S.dealer ? ' 莊' : ''}${isCurrent ? ' ✓' : ''}`;
      b.title = isCurrent ? '目前正在觀看此角色' : `切換至 ${s.name} 視角`;
      b.onclick = () => { if (!isCurrent) send({ type: 'switchView', seat: i }); };
      bar.appendChild(b);
    }
    box.appendChild(bar);
    return;
  }
  if (S.phase === 'seatPick') return;
  if (S.phase === 'dice') {
    if (S.dice && S.dice.thrower === S.you && !S.dice.values) btn('🎲 擲骰子', 'hu', () => send({ type: 'roll' }));
    return;
  }
  if (S.phase === 'swapAsk') {
    if (S.dealer !== S.you) return;
    btn(`開始換牌（還可 ${S.swapLeft} 次）`, '', () => send({ type: 'swapstart' }));
    btn('不換了，開始打牌', '', () => send({ type: 'skipswap' }));
    return;
  }
  if (S.phase === 'swapSelect') {
    if (S.seats[S.you].confirmed) { box.innerHTML = '<span class="hint">已確定，等待其他玩家…</span>'; return; }
    const b = btn(`確定（已選 ${swapSel.length}/3 張）`, '', () => send({ type: 'cover', tiles: swapSel.map((k) => S.hand[k]) }));
    b.disabled = swapSel.length !== 3;
    return;
  }
  if (S.phase === 'swapPick') {
    box.innerHTML = `<span class="hint">${S.turn === S.you ? '系統自動隨機幫你取牌…' : `${S.seats[S.turn].name} 取牌中…`}</span>`;
    return;
    const others = [0, 1, 2, 3].filter((p) => p !== S.you);
    const picked = others.filter((p) => swapPicks[p] !== undefined).length;
    const forced = others.filter((p) => S.seats[p].cover && S.seats[p].cover.filter(Boolean).length === 1);
    if (forced.length === 3) {
      // 每家都只剩一張：伺服器會自動取牌，不用按
      box.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: '每家都只剩一張，已自動幫你取牌…' }));
      return;
    }
    const b = btn(`確定取牌（${picked}/3）`, '', () => send({ type: 'swappick', picks: swapPicks }));
    b.disabled = picked !== 3;
    const tip = forced.length ? `${forced.map((p) => S.seats[p].name).join('、')} 只剩一張，已幫你選好；` : '';
    box.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: tip + '在其他三家面前各點一張蓋著的牌' }));
    return;
  }
  if (S.phase === 'lastDraw') {
    if (S.turn !== S.you) return;
    btn('摸牌', '', () => send({ type: 'draw' }));
    btn('不摸，直接結束', 'hu', () => send({ type: 'endhand' }));
    return;
  }
  if (S.phase === 'discard' && S.turn === S.you && S.actions) {
    const a = S.actions;
    // 可以自摸時，只顯示自摸按鈕 (不顯示 MIGI、暗槓、加槓)
    // 可以自摸時，一樣顯示五個按鈕，「胡」改成「自摸」；不胡就直接打牌，所以「過」不能按
    if (a.hu) {
      const row = document.createElement('div');
      row.className = 'claimbtns';
      roundBtn(row, '吃', 'chi', false);
      roundBtn(row, '碰', 'pong', false);
      roundBtn(row, '槓', 'kong', false);
      roundBtn(row, '自摸', 'hu zimo', true, () => send({ type: 'hu' }));
      roundBtn(row, '過', 'pass', false);
      box.appendChild(row);
      return;
    }
    btn('電腦推薦', '', () => send({ type: 'recommend' }));
    if (a.locked) {
      box.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'MIGI 中：點兩下摸進的牌打出' }));
      return;
    }
    if (a.migi && a.migi.length) {
      const selTile = selected === 'drawn' ? S.drawn : selected != null ? S.hand[selected] : null;
      const ok = selTile != null && a.migi.includes(selTile);
      const b = btn(ok ? `MIGI（打出 ${tileName(selTile)}）` : 'MIGI', 'migi', () => send({ type: 'discard', tile: selTile, migi: true }));
      b.disabled = !ok;
      if (!ok) box.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: '可以 MIGI！先點選要打出的牌' }));
    }
    a.angang.forEach((t) => btn(`暗槓 ${tileName(t)}`, '', () => send({ type: 'angang', tile: t })));
    a.jiagang.forEach((t) => btn(`加槓 ${tileName(t)}`, '', () => send({ type: 'jiagang', tile: t })));
    if (box.children.length === 1) {
      const tingTip = S.ting && S.ting.byDiscard ? '・▲ 打出就聽牌，點選看聽什麼' : '';
      box.insertAdjacentHTML('beforeend', `<span class="hint">點兩下打出${tingTip}</span>`);
    }
  } else if (S.phase === 'claim' && S.claim && !S.claim.resp) {
    const o = S.claim.opts;
    const lt = S.last.tile;
    const chi = o.chi || [];
    const done = (msg) => { claimPick = null; send(msg); };
    // 五個圓形按鈕：可以做的亮起來，不能做的灰掉不能點
    const row = document.createElement('div');
    row.className = 'claimbtns';
    const round = (label, cls, enabled, fn) => roundBtn(row, label, cls, enabled, fn, claimPick === cls);
    // 只有一種選擇就直接執行，有多種 (例如吃 123 / 234) 才跳出選擇框
    const choose = (kind, count, run) => () => {
      if (count > 1) { claimPick = claimPick === kind ? null : kind; renderGame(); }
      else run();
    };
    round('吃', 'chi', chi.length > 0, choose('chi', chi.length, () => done({ type: 'chi', tiles: chi[0] })));
    // 點吃後，選擇框取代碰、槓、胡：吃 [選擇框] 過。再點一次吃就回復原狀
    if (claimPick === 'chi' && chi.length > 1) {
      const pick = document.createElement('div');
      pick.className = 'claimpick';
      chi.forEach((p) => {
        const [a, b] = p.slice().sort((x, y) => x - y);
        const d = document.createElement('div');
        d.className = 'chiopt';
        [a, lt, b].forEach((t, k) => d.appendChild(tileEl(t, 'sm' + (k === 1 ? ' claimed' : ''))));
        d.onclick = () => done({ type: 'chi', tiles: p });
        pick.appendChild(d);
      });
      row.appendChild(pick);
    } else {
      round('碰', 'pong', !!o.pong, () => done({ type: 'pong' }));
      round('槓', 'kong', !!o.kong, () => done({ type: 'kong' }));
      round('胡', 'hu', !!o.hu, () => done({ type: 'hu' }));
    }
    // 可以胡別人的牌時，不胡就是「過水」
    round(o.hu ? '過水' : '過', 'pass' + (o.hu ? ' guoshui' : ''), !o.forced, () => done({ type: 'pass' }));
    box.appendChild(row);
    if (o.forced) box.appendChild(Object.assign(document.createElement('span'), { className: 'hint', textContent: 'MIGI 中必須胡牌' }));
  } else if (S.phase === 'claim' && S.claim && S.claim.resp) {
    box.innerHTML = '<span class="hint">已選擇，等待其他玩家…</span>';
  }
}

// 手機聊天視窗收起時，計算未讀訊息數
let chatSeen = 0, chatUnread = 0;
function updateUnread() {
  if (document.body.classList.contains('chat-open')) { chatSeen = S.chat.length; chatUnread = 0; }
  else chatUnread = Math.min(99, S.chat.filter((c, k) => k >= chatSeen && !c.sys).length);
}
$('chatClose').onclick = () => { document.body.classList.remove('chat-open'); if (S) renderGame(); };
function renderChat() {
  const isSpectator = !!(S && S.spectating);
  const inp = $('chatInput');
  const btnEl = $('chatForm').querySelector('button');
  if (inp) {
    inp.disabled = isSpectator;
    inp.placeholder = isSpectator ? '觀戰模式無法發言' : '聊天...';
  }
  if (btnEl) btnEl.disabled = isSpectator;

  const log = $('chatlog');
  const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 20;
  log.innerHTML = '';
  S.chat.forEach((c) => {
    const d = document.createElement('div');
    if (c.sys) { d.className = 'sys'; d.textContent = '• ' + c.text; }
    else d.textContent = `${c.from}：${c.text}`;
    log.appendChild(d);
  });
  if (atBottom) log.scrollTop = log.scrollHeight;
}
$('chatForm').onsubmit = (e) => {
  e.preventDefault();
  if (S && S.spectating) return;
  const v = $('chatInput').value.trim();
  if (v) send({ type: 'chat', text: v });
  $('chatInput').value = '';
};

let resultShownKey = '', resultTimer = null;
function renderResult() {
  const m = $('resultModal');
  if (S.phase !== 'over' || !S.result) { m.classList.add('hidden'); return; }
  // 先讓「胡！」「自摸！」的對話框秀一下，再跳出結算畫面
  const key = `${S.handNo}-${S.result.nextAt}`;
  if (key !== resultShownKey) {
    m.classList.add('hidden');
    if (!resultTimer) {
      resultTimer = setTimeout(() => {
        resultTimer = null;
        resultShownKey = key;
        if (S && S.phase === 'over') renderResult();
      }, S.result.draw ? 600 : S.result.selfDraw && !S.result.special && fxActive() ? ZIMO_FX_MS + 200 : 1500);
    }
    return;
  }
  const r = S.result;
  let h = '<div class="box">';
  if (r.draw) h += '<h2>流局</h2><p>牌牆已摸完，莊家連莊。' + ` <b class="streak">🔥 連${S.streak}拉${S.streak}</b>` + '</p>';
  else {
    const w = S.seats[r.winner].name;
    h += `<h2>${w} ${r.special || (r.selfDraw ? '自摸' : r.rob ? '搶槓' : '胡牌')}　${r.tai} 台${r.mult > 1 ? `　(底 + 台) ×${r.mult}` : ''}</h2>`;
    if (r.special === '七搶一') h += `<p>付款：${S.seats[r.from].name}（持有第 8 張花）</p>`;
    else if (!r.selfDraw) h += `<p>放槍：${S.seats[r.from].name}　胡 ${tileName(r.tile)}</p>`;
    h += '<div class="items">' + r.items.map((i) => `<div><span>${i.name}</span><span>${i.text || i.tai + ' 台'}</span></div>`).join('') + '</div>';
    if (r.dice) h += `<p class="hint">本局骰子：${r.dice.map((v) => DICE_FACE[v - 1]).join(' ')}${r.diceRule ? `（骰規：${r.diceRule}）` : '（無骰規）'}</p>`;
    h += '<div class="row" style="margin:10px 0">';
    const hand = S.seats[r.winner].hand || [];
    const tmp = document.createElement('div');
    hand.forEach((t) => tmp.appendChild(tileEl(t, 'sm')));
    S.seats[r.winner].melds.forEach((mm) => tmp.appendChild(meldEl(mm)));
    if (!r.selfDraw && r.tile != null) tmp.appendChild(tileEl(r.tile, 'sm latest'));
    if (r.special) S.seats[r.winner].flowers.forEach((t) => tmp.appendChild(tileEl(t, 'sm')));
    h += tmp.innerHTML + '</div>';
  }
  h += '<table>' + S.seats.map((s, i) => {
    const d = r.delta ? r.delta[i] : 0;
    return `<tr><td>${s.name}</td><td>${S.scores[i]}</td><td class="${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}">${d > 0 ? '+' : ''}${d}</td></tr>`;
  }).join('') + '</table>';
  if (r.jiangOver) h += `<p class="big" style="color:#f4c542">第 ${r.jiang} 將結束！下一將重新選座位、擲骰決定莊家</p>`;
  const nextBtnHtml = S.spectating ? '' : `<button id="nextBtn">${r.jiangOver ? '下一將' : '下一局'}</button> `;
  h += `${nextBtnHtml}<span class="timer" id="nextTimer"></span></div>`;
  m.innerHTML = h;
  m.classList.remove('hidden');
  if (!S.spectating) $('nextBtn').onclick = () => send({ type: 'next' });
}

function startTimer() {
  clearInterval(tick);
  const upd = () => {
    const left = Math.max(0, Math.ceil((S.deadline - Date.now()) / 1000));
    const t = $('timer');
    if (t && (S.phase === 'discard' || S.phase === 'lastDraw' || S.phase === 'claim' || S.phase === 'seatPick' || S.phase === 'dice' || S.phase.startsWith('swap'))) t.textContent = `⏱ ${left}s` + (S.wall > 0 && S.phase !== 'seatPick' && S.phase !== 'dice' && !S.phase.startsWith('swap') ? ` ｜ 剩餘 ${S.wall} 張` : '');
    const nt = $('nextTimer');
    if (nt && S.result && S.result.nextAt) nt.textContent = `${Math.max(0, Math.ceil((S.result.nextAt - Date.now()) / 1000))} 秒後自動開始`;
  };
  upd();
  tick = setInterval(upd, 500);
}

function toast(text) {
  const d = document.createElement('div');
  d.className = 'toast';
  d.textContent = text;
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 2500);
}

const DICE_FACE = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
let diceAnimKey = '';
// 擲骰資訊：所有玩家都看得到骰子與結果
function diceInfo() {
  const d = S.dice;
  const thrower = S.seats[d.thrower].name;
  const title = d.stage === 'dealer' ? '擲骰決定起莊' : `莊家 ${thrower} 擲骰開門`;
  if (!d.values) {
    const wait = (d.thrower === S.you && !S.spectating) ? '<div class="big">請擲骰子</div>' : `<div>等待 ${thrower} 擲骰子…</div>`;
    return `<div>${title}</div>${wait}<div class="dice">${'<span class="die idle">⚀</span>'.repeat(3)}</div>`;
  }
  const key = `${S.handNo}-${d.stage}-${d.rolledAt}`;
  const anim = key !== diceAnimKey && Date.now() - d.rolledAt < 1500;
  diceAnimKey = key;
  const dice = d.values.map((v) => `<span class="die${anim ? ' roll' : ''}">${DICE_FACE[v - 1]}</span>`).join('');
  const target = S.seats[d.target].name;
  const res = d.stage === 'dealer'
    ? `由 <b>${target}</b> 起莊（東風）`
    : `從 <b>${target}</b> 的牌牆第 ${d.total + 1} 墩開門`;
  return `<div>${title}</div><div class="dice">${dice}</div><div class="big">${d.total} 點</div><div>${res}</div>`;
}

// 每將開始：海底擺東南西北，點選一張決定座位
function renderSeatPick(box) {
  const sp = S.seatPick;
  const mySlot = !S.spectating ? sp.slots.find((x) => x.owner === S.you) : null;
  const mine = mySlot ? mySlot.wind : undefined;
  box.innerHTML = `<div class="big">第 ${S.jiang} 將：選擇座位</div>` +
    `<div>${sp.done ? '座位已決定，東家擲骰決定起莊…' : S.spectating ? '玩家正在選擇座位…' : mine !== undefined ? `你翻到「${WINDS[mine]}」，等待其他玩家…` : '風牌蓋著，點選一張翻開決定你的座位'}</div>`;
  const row = document.createElement('div');
  row.className = 'seatpick';
  sp.slots.forEach((slot, k) => {
    const cell = document.createElement('div');
    cell.className = 'seatcell';
    const owner = slot.owner;
    let t;
    if (slot.wind !== null) t = tileEl(27 + slot.wind, 'taken');
    else {
      t = document.createElement('div');
      t.className = 'tile facedown' + (mine === undefined && !sp.done && !S.spectating ? ' pickable' : '');
      if (mine === undefined && !sp.done && !S.spectating) t.onclick = () => send({ type: 'seatpick', slot: k });
    }
    cell.appendChild(t);
    const nm = document.createElement('div');
    nm.className = 'seatname';
    nm.textContent = owner !== null ? S.seats[owner].name + (owner === S.you ? '（你）' : '') : '　';
    cell.appendChild(nm);
    row.appendChild(cell);
  });
  box.appendChild(row);
  const t = document.createElement('div');
  t.className = 'timer';
  t.id = 'timer';
  box.appendChild(t);
}

// ---------- 玩家說話 ----------
// 伺服器在打牌、吃、碰、槓、胡時送來 say 事件，在該玩家旁邊跳出對話框 (電腦也一樣)
const SAY_TEXT = { pong: '碰！', chi: '吃！', kong: '槓！', hu: '胡！', zimo: '自摸！', rob: '搶槓！' };
const sayEls = {};
function showSay(m) {
  if (!S || S.state !== 'playing') return;
  const k = (m.seat - S.you + 4) % 4; // 0 自己、1 下家 (右)、2 對家、3 上家 (左)
  const anchor = k === 0 ? $('me') : $('seat' + k);
  if (!anchor || !anchor.offsetParent) return;
  const win = ['hu', 'zimo', 'rob', 'special'].includes(m.kind);
  const call = ['pong', 'chi', 'kong'].includes(m.kind);
  const el = document.createElement('div');
  el.className = 'say ' + (win ? 'say-win' : call ? 'say-call' : 'say-discard') + ' from' + k;
  const name = document.createElement('span');
  name.className = 'say-name';
  name.textContent = S.seats[m.seat] ? S.seats[m.seat].name : '';
  el.appendChild(name);
  const line = document.createElement('div');
  line.className = 'say-line';
  if (m.kind === 'discard' || m.kind === 'migi') {
    if (m.kind === 'migi') line.appendChild(Object.assign(document.createElement('b'), { className: 'say-migi', textContent: 'MIGI！' }));
    line.appendChild(tileEl(m.tile, 'sm'));
    line.append(tileName(m.tile));
  } else {
    line.append(m.kind === 'special' ? `${m.text}！` : SAY_TEXT[m.kind] || '');
  }
  el.appendChild(line);
  speakSay(m);
  if (m.kind === 'zimo' && m.fx) showZimoFx(m);
  // 同一位玩家的新對話框取代舊的
  if (sayEls[m.seat]) sayEls[m.seat].remove();
  sayEls[m.seat] = el;
  $('sayLayer').appendChild(el);
  placeSay(el, anchor, k);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => { el.remove(); if (sayEls[m.seat] === el) delete sayEls[m.seat]; }, 250); }, win ? 2200 : call ? 1600 : 1300);
}

// ---------- 自摸特效 ----------
// 全螢幕暗幕 + 光芒，胡牌的整副牌放在正中間，下方依序顯示 4 台以上的牌型、門清一摸三 / 自摸
const ZIMO_FX_MS = 4000;
let fxEl = null;
const fxActive = () => !!fxEl;
function showZimoFx(m) {
  const fx = m.fx;
  if (fxEl) fxEl.remove();
  const el = document.createElement('div');
  el.id = 'zimoFx';
  const rays = document.createElement('div');
  rays.className = 'fx-rays';
  el.appendChild(rays);
  const box = document.createElement('div');
  box.className = 'fx-box';
  const who = document.createElement('div');
  who.className = 'fx-who';
  who.textContent = S.seats[m.seat] ? S.seats[m.seat].name : '';
  box.appendChild(who);
  const row = document.createElement('div');
  row.className = 'fx-hand';
  let n = 0;
  const add = (node) => { node.style.setProperty('--i', n++); node.classList.add('fx-in'); row.appendChild(node); };
  fx.hand.forEach((t) => add(tileEl(t, 'sm')));
  fx.melds.forEach((mm) => add(meldEl(mm)));
  if (fx.drawn != null) add(tileEl(fx.drawn, 'sm latest fx-drawn'));
  box.appendChild(row);
  const txt = document.createElement('div');
  txt.className = 'fx-text';
  fx.lines.forEach((l, k) => {
    const d = document.createElement('div');
    d.className = k === fx.lines.length - 1 ? 'fx-main' : 'fx-big';
    d.textContent = l;
    d.style.animationDelay = `${0.5 + k * 0.35}s`;
    txt.appendChild(d);
  });
  box.appendChild(txt);
  el.appendChild(box);
  document.body.appendChild(el);
  fxEl = el;
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => { el.remove(); if (fxEl === el) fxEl = null; }, 400);
  }, ZIMO_FX_MS - 400);
  setTimeout(() => { if (fxEl === el) fxEl = null; }, ZIMO_FX_MS);
}

// 對話框位置：不能遮住海底的牌 (各家牌河、換牌蓋牌)，也盡量不蓋到其他人的對話框
// 電腦版：放在牌桌中央的空位 (海底裡沒有牌的地方)，由靠近說話玩家的位置先挑
// 手機版：放在說話玩家的手牌／座位區域 (對家在上方、上家在左、下家在右、自己在下方)
function placeSay(el, anchor, k) {
  const w = el.offsetWidth, h = el.offsetHeight;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rects = (sel) => [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height);
  const others = [...document.querySelectorAll('#sayLayer .say')].filter((e) => e !== el && !e.classList.contains('out')).map((e) => e.getBoundingClientRect());
  const area = (x, y, r) => Math.max(0, Math.min(x + w, r.right) - Math.max(x, r.left)) * Math.max(0, Math.min(y + h, r.bottom) - Math.max(y, r.top));
  const sum = (x, y, list) => list.reduce((t, r) => t + area(x, y, r), 0);
  const mobile = window.matchMedia('(max-width: 1000px)').matches;
  const pool = rects('#center .pool .tile, #center .cover');
  const hand = rects('#myHand .tile');
  const a = anchor.getBoundingClientRect();
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;

  let x0, x1, y0, y1;
  if (mobile) {
    if (k === 3) {
      // 上家 (左)：在左側玩家區域，沿垂直方向挑選不遮海底的位置
      x0 = Math.max(2, Math.min(vw - w - 4, a.left + 2));
      x1 = Math.max(x0, Math.min(vw - w - 4, a.left + 6));
      y0 = Math.max(4, a.top + 4);
      y1 = Math.max(y0, Math.min(vh - h - 4, a.bottom - h - 4));
    } else if (k === 1) {
      // 下家 (右)：在右側玩家區域，沿垂直方向挑選不遮海底的位置
      x0 = Math.max(4, Math.min(vw - w - 2, a.right - w - 6));
      x1 = Math.max(x0, Math.min(vw - w - 2, a.right - w - 2));
      y0 = Math.max(4, a.top + 4);
      y1 = Math.max(y0, Math.min(vh - h - 4, a.bottom - h - 4));
    } else if (k === 2) {
      // 對家 (上)：在上方對家手牌／座位區
      const cx = a.left + (a.width - w) / 2;
      x0 = Math.max(4, Math.min(vw - w - 4, cx - 16));
      x1 = Math.max(x0, Math.min(vw - w - 4, cx + 16));
      y0 = Math.max(4, a.top + 2);
      y1 = Math.max(y0, Math.min(vh - h - 4, a.bottom - h - 2));
    } else {
      // 自己 (下)：在自己的手牌／操作區上方，避開手牌
      x0 = Math.max(4, a.left + 4);
      x1 = Math.max(x0, Math.min(vw - w - 4, a.right - w - 4));
      y0 = Math.max(4, a.top + 2);
      y1 = Math.max(y0, Math.min(vh - h - 4, a.bottom - h - 4));
    }
  } else {
    const box = ($('center') || anchor).getBoundingClientRect();
    x0 = box.left + 4;
    x1 = Math.max(x0, box.right - w - 4);
    y0 = box.top + 4;
    y1 = Math.max(y0, box.bottom - h - 4);
  }

  let best = null;
  const N = 16;
  for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
    const x = x0 + ((x1 - x0) * i) / N, y = y0 + ((y1 - y0) * j) / N;
    // 先比遮住的牌 (海底最重要，其次是別人的對話框；自己喊牌時避開自己的手牌)，再比離說話玩家的距離
    const c = sum(x, y, pool) * 20 + sum(x, y, others) * 4 + (k === 0 ? sum(x, y, hand) * 0.05 : 0);
    const d = Math.hypot(x + w / 2 - ax, y + h / 2 - ay);
    if (!best || c < best.c - 1 || (Math.abs(c - best.c) <= 1 && d < best.d)) best = { x, y, c, d };
  }
  el.style.left = (best ? best.x : x0) + 'px';
  el.style.top = (best ? best.y : y0) + 'px';
  el.classList.add('inside'); // 對話框在牌桌中央或座位區，不需要指向座位的小尾巴
}

// ---------- 語音朗讀 (瀏覽器內建 Web Speech API) ----------
// 預設關閉。按牌桌上方的「語音」打開設定面板：開關、調語速、試聽。設定存在這台裝置
const VOICE_OK = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
let voiceOn = VOICE_OK && localStorage.getItem('mj_voice') === 'on';
let voiceRate = Number(localStorage.getItem('mj_voice_rate')) || 1.1;
let zhVoice = null;

// 只用「Google 國語（臺灣）」：這個聲音內建在電腦版 Google Chrome，需要連網。
// 其他瀏覽器 (Safari、Edge、Firefox、手機) 沒有這個聲音，語音功能就不提供
const GOOGLE_TW = '國語（臺灣）';
function pickVoice() {
  if (!VOICE_OK) return;
  zhVoice = speechSynthesis.getVoices().find((v) => /Google/i.test(v.name) && /zh[-_]TW/i.test(v.lang)) || null;
  if (!$('voicePanel').classList.contains('hidden')) fillVoicePanel();
  if (S && S.state === 'playing') renderGame();
}
if (VOICE_OK) { pickVoice(); speechSynthesis.addEventListener('voiceschanged', pickVoice); }

function speak(text, seat = 0, force = false) {
  if ((!voiceOn && !force) || !text || !zhVoice) return;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = zhVoice.lang;
  u.voice = zhVoice;
  u.rate = voiceRate;
  u.pitch = [1, 1.12, 0.9, 1.05][seat % 4]; // 四個座位音調稍微不同，聽得出是誰
  speechSynthesis.speak(u);
}

// 打牌很快：新的一句直接蓋掉還沒念完的，避免越念越慢
function speakSay(m) {
  if (!voiceOn) return;
  const text = m.kind === 'discard' ? tileName(m.tile)
    : m.kind === 'migi' ? `MIGI，${tileName(m.tile)}`
      : m.kind === 'special' ? m.text
        : ({ pong: '碰', chi: '吃', kong: '槓', hu: '胡', zimo: '自摸', rob: '搶槓' })[m.kind];
  speechSynthesis.cancel();
  speak(text, m.seat);
}

function setVoice(on) {
  voiceOn = on;
  localStorage.setItem('mj_voice', on ? 'on' : 'off');
  if (on) speak('語音已開啟'); // 手機瀏覽器要在點擊時先念一次，之後才能自動念
  else if (VOICE_OK) speechSynthesis.cancel();
}

// ----- 語音設定面板 -----
function fillVoicePanel() {
  const has = !!zhVoice;
  $('vpOn').checked = voiceOn && has;
  $('vpOn').disabled = !has;
  $('vpTest').disabled = !has;
  $('vpRate').value = voiceRate;
  $('vpRateVal').textContent = `${voiceRate.toFixed(2)}×`;
  $('vpVoiceName').textContent = has ? `Google ${GOOGLE_TW}` : '這個瀏覽器沒有';
  $('vpTip').innerHTML = has ? '' :
    `語音只使用「Google ${GOOGLE_TW}」，這個聲音內建在<b>電腦版 Google Chrome</b>（需要連網）。<br>` +
    'Safari、Edge、Firefox 和手機瀏覽器沒有這個聲音，所以不提供語音。';
}
function toggleVoicePanel(force) {
  const p = $('voicePanel');
  const open = force !== undefined ? force : p.classList.contains('hidden');
  p.classList.toggle('hidden', !open);
  if (open) fillVoicePanel();
}
if (VOICE_OK) {
  $('vpClose').onclick = () => toggleVoicePanel(false);
  $('vpOn').onchange = (e) => { setVoice(e.target.checked && !!zhVoice); fillVoicePanel(); if (S) renderGame(); };
  $('vpRate').oninput = (e) => {
    voiceRate = Number(e.target.value);
    localStorage.setItem('mj_voice_rate', String(voiceRate));
    $('vpRateVal').textContent = `${voiceRate.toFixed(2)}×`;
  };
  $('vpTest').onclick = () => { speechSynthesis.cancel(); speak('三萬，碰！自摸，三台！', 0, true); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleVoicePanel(false); });
}

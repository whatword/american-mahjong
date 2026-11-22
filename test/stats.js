'use strict';
// 計分板戰績計算與存檔：金額 (跟玩家 / 跟電腦)、勝率、自摸、放槍、顯示暱稱(email)
const { ok, finish } = require('./helpers');
const fs = require('fs');
const FILE = process.env.STATS_FILE;
fs.rmSync(FILE, { force: true });
const Stats = require('../stats.js');

const A = { name: '阿明', token: 'a@x.com' }, B = { name: '小華', token: 'b@x.com' }, C = { name: 'Claude', bot: true }, G = { name: 'Gemini', bot: true };
const seats = [A, B, C, G];
// 1. 阿明 自摸：三家各付 (小華 -100, Claude -100, Gemini -150)
Stats.recordHand(seats, { draw: false, winner: 0, from: -1, selfDraw: true, delta: [350, -100, -100, -150] });
// 2. Claude 胡 小華 放槍
Stats.recordHand(seats, { draw: false, winner: 2, from: 1, selfDraw: false, delta: [0, -130, 130, 0] });
// 3. 流局
Stats.recordHand(seats, { draw: true });
// 4. 小華 胡 阿明 放槍
Stats.recordHand(seats, { draw: false, winner: 1, from: 0, selfDraw: false, delta: [-90, 90, 0, 0] });

const b = Stats.board('a@x.com');
const by = (n) => b.find((p) => p.name === n);
ok(b.map((p) => p.name).join() === '阿明,Claude,小華,Gemini', '金額由多到少：' + b.map((p) => `${p.name} ${p.money}`).join('、'));
const a = by('阿明');
ok(a.you && a.hands === 4 && a.wins === 1 && a.winRate === 0.25, '阿明 總勝率 1/4 = 25%');
ok(a.selfDraws === 1 && a.dealIns === 1, '阿明 自摸 1、放槍 1');
ok(a.vsHuman.w === 1 && a.vsHuman.l === 1 && a.vsHuman.rate === 0.5, '阿明 跟玩家：贏小華(自摸) 1、輸小華 1 → 50%');
ok(a.vsBot.w === 2 && a.vsBot.l === 0 && a.vsBot.rate === 1, '阿明 跟電腦：自摸贏 Claude、Gemini → 2 勝 0 負');
ok(a.money === a.moneyVsHuman + a.moneyVsBot && a.moneyVsHuman === 10 && a.moneyVsBot === 250, '阿明 總金額 260 = 跟玩家 10 + 跟電腦 250');
const h = by('小華');
ok(h.dealIns === 1 && h.vsBot.l === 1 && h.vsHuman.w === 1 && h.vsHuman.l === 1, '小華 放槍 1、輸電腦 1、跟玩家 1 勝 1 負');
const c = by('Claude');
ok(c.bot && c.vsHuman.w === 1 && c.vsHuman.l === 1 && c.vsBot.w === 0 && c.vsBot.l === 0, 'Claude 跟玩家 1 勝 1 負，跟電腦無對戰');
ok(c.vsBot.rate === null, '沒有對戰時勝率為「—」');
ok(b.every((p) => p.money === p.moneyVsHuman + p.moneyVsBot && p.moneyLegacy === 0), '每個人 總金額 = 跟玩家 + 跟電腦');
ok(a.email === 'a@x.com' && c.email === null, '真人顯示 email，電腦沒有 email');

// 暱稱以最新登入為準
Stats.rename('a@x.com', '明哥');
ok(Stats.board('a@x.com').find((p) => p.email === 'a@x.com').name === '明哥', '換暱稱登入 → 計分板顯示新暱稱，戰績不變');

// 存檔、重新載入
Stats.flush();
const saved = JSON.parse(fs.readFileSync(FILE, 'utf8'));
ok(Object.keys(saved).length === 4, '戰績已寫入檔案');
delete require.cache[require.resolve('../stats.js')];
const S2 = require('../stats.js');
ok(S2.board('a@x.com').find((p) => p.email === 'a@x.com').money === 260, '重啟後讀回檔案，金額 +260');
fs.rmSync(FILE, { force: true });
finish();

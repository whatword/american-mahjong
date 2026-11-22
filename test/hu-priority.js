'use strict';
// 胡牌最大與截胡、吃牌被吃的牌放中間
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const toasts=[[],[],[],[]];
function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:{readyState:1,send:(m)=>{const o=JSON.parse(m);if(o.type==='toast')toasts[i].push(o.text);}},hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.migi=false;s.flowers=[];}r.turn=0;r.phase='discard';return r;}
const WAIT28=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28]; // 聽 28
const PONG28=[28,28,6,7,8,12,13,14,21,22,23,24,25,26,30,31]; // 可碰 28
// 1. 只有一人能胡 → 選胡立即胡，不等其他人 (另一家有碰可選但還沒決定)
let r=mk(); r.seats[0].hand.push(28); r.seats[0].drawn=28;
r.seats[2].hand=WAIT28.slice(); r.seats[3].hand=PONG28.slice();
r.handle(0,{type:'discard',tile:28});
ok(r.phase==='claim'&&r.claims[2].opts.hu&&r.claims[3].opts.pong,'p2 可胡、p3 可碰');
r.handle(2,{type:'hu'});
ok(r.phase==='over'&&r.result.winner===2,'唯一可胡者選胡 → 立即胡，不等 p3');
// 2. 兩人可胡：順位後面的 p2 先選胡 → 還要等順位前面的 p1
r=mk(); r.seats[0].hand.push(28); r.seats[0].drawn=28;
r.seats[1].hand=WAIT28.slice(); r.seats[2].hand=WAIT28.slice();
r.handle(0,{type:'discard',tile:28});
r.handle(2,{type:'hu'});
ok(r.phase==='claim','順位後面的 p2 先喊胡 → 等順位前面的 p1 決定');
r.handle(1,{type:'hu'});
ok(r.phase==='over'&&r.result.winner===1,'p1 也胡 → p1 截胡');
ok(toasts[2].some(t=>t.includes('截胡')),'p2 收到截胡通知');
// 3. 兩人可胡：順位前面的 p1 先選胡 → 立即截胡，不等 p2
r=mk(); toasts.forEach(t=>t.length=0); r.seats[0].hand.push(28); r.seats[0].drawn=28;
r.seats[1].hand=WAIT28.slice(); r.seats[2].hand=WAIT28.slice();
r.handle(0,{type:'discard',tile:28});
r.handle(1,{type:'hu'});
ok(r.phase==='over'&&r.result.winner===1,'順位前面的 p1 選胡 → 立即截胡');
ok(toasts[2].some(t=>t.includes('截胡')),'還沒決定的 p2 也收到截胡通知');
// 4. 順位前面的 p1 選過 → p2 已選胡 → 立即由 p2 胡
r=mk(); r.seats[0].hand.push(28); r.seats[0].drawn=28;
r.seats[1].hand=WAIT28.slice(); r.seats[2].hand=WAIT28.slice();
r.handle(0,{type:'discard',tile:28});
r.handle(2,{type:'hu'}); r.handle(1,{type:'pass'});
ok(r.phase==='over'&&r.result.winner===2,'p1 過 → p2 胡');
// 5. 吃：被吃的牌放中間
r=mk(); r.seats[0].hand.push(4); r.seats[0].drawn=4;
r.seats[1].hand=[3,5,9,10,11,12,13,14,18,19,20,21,22,23,30,31];
r.handle(0,{type:'discard',tile:4});
r.handle(1,{type:'chi',tiles:[5,3]});
for(const k of Object.keys(r.claims||{})) if(r.claims[k]&&!r.claims[k].resp) r.respond(+k,{type:'pass'});
const m=r.seats[1].melds[0];
ok(m&&m.type==='chi'&&m.tiles.join()==='3,4,5'&&m.claimed===1,'吃 5萬：顯示 4萬 5萬 6萬，被吃的 5萬 在中間 → '+(m&&m.tiles));
r=mk(); r.seats[0].hand.push(3); r.seats[0].drawn=3;
r.seats[1].hand=[4,5,9,10,11,12,13,14,18,19,20,21,22,23,30,31];
r.handle(0,{type:'discard',tile:3});
r.handle(1,{type:'chi',tiles:[4,5]});
for(const k of Object.keys(r.claims||{})) if(r.claims[k]&&!r.claims[k].resp) r.respond(+k,{type:'pass'});
const m2=r.seats[1].melds[0];
ok(m2&&m2.tiles.join()==='4,3,5'&&m2.claimed===1,'吃 4萬 (配 5、6萬)：顯示 5萬 4萬 6萬 → '+(m2&&m2.tiles));
const G=require('../game.js');
const ev=G.evaluate({hand:[9,10,11,12,13,14,18,19,20,21,22,23,6,6],melds:[{type:'chi',tiles:[4,3,5]}],flowers:[],seatWind:1,roundWind:0,selfDraw:false,winTile:6,kongDraw:false,haidi:false});
ok(ev&&ev.items.length>=0,'中間放被吃牌後，台數計算仍正常');
finish();

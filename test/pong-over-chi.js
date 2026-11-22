'use strict';
// 碰槓比吃優先
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const toasts=[[],[],[],[]];
function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:{readyState:1,send:(m)=>{const o=JSON.parse(m);if(o.type==='toast')toasts[i].push(o.text);}},hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.migi=false;s.flowers=[];s.noPong=new Set();}toasts.forEach(t=>t.length=0);
  r.turn=0;r.phase='discard';r.seats[0].hand.push(4);r.seats[0].drawn=4;return r;}
const CHI=[3,5,9,10,11,12,13,14,18,19,20,21,22,23,30,31];  // 下家 p1：可吃 五萬(4)
const PONG=[4,4,6,7,8,12,13,14,24,25,26,27,28,29,31,32];   // p2：可碰 五萬
const HU=[0,1,2,3,5,9,10,11,18,19,20,27,27,27,28,28];        // 聽 四萬/五萬... 
// 1. 下家還沒選吃，p2 選碰 → 立即碰，不等下家
let r=mk(); r.seats[1].hand=CHI.slice(); r.seats[2].hand=PONG.slice(); r.seats[3].hand=[6,7,8,15,16,17,24,25,26,29,29,30,30,33,33,32];
r.handle(0,{type:'discard',tile:4});
ok(r.phase==='claim'&&r.claims[1].opts.chi.length&&r.claims[2].opts.pong,'p1 可吃、p2 可碰');
r.handle(2,{type:'pong'});
ok(r.phase==='discard'&&r.turn===2&&r.seats[2].melds[0].type==='pong','p2 選碰 → 立即碰牌，輪到 p2 出牌 (不等 p1)');
ok(toasts[1].some(t=>t.includes('吃牌被打斷')),'p1 收到「吃牌被打斷」');
// 2. 下家先選吃，p2 後選碰 → 碰優先
r=mk(); r.seats[1].hand=CHI.slice(); r.seats[2].hand=PONG.slice(); r.seats[3].hand=[6,7,8,15,16,17,24,25,26,29,29,30,30,33,33,32];
r.handle(0,{type:'discard',tile:4});
r.handle(1,{type:'chi',tiles:[3,5]});
ok(r.phase==='claim','p1 先選吃 → 還要等可碰的 p2');
r.handle(2,{type:'pong'});
ok(r.turn===2&&r.seats[2].melds[0].type==='pong'&&r.seats[1].melds.length===0,'p2 碰 → 打斷 p1 的吃');
ok(toasts[1].some(t=>t.includes('吃牌被打斷')),'已選吃的 p1 也收到通知');
// 3. p2 選過 → p1 吃成立
r=mk(); r.seats[1].hand=CHI.slice(); r.seats[2].hand=PONG.slice(); r.seats[3].hand=[6,7,8,15,16,17,24,25,26,29,29,30,30,33,33,32];
r.handle(0,{type:'discard',tile:4});
r.handle(1,{type:'chi',tiles:[3,5]}); r.handle(2,{type:'pass'});
ok(r.turn===1&&r.seats[1].melds[0].type==='chi','可碰的人過 → 吃牌成立');
// 4. 碰的人選碰，但還有人可以胡且未決定 → 要等胡
r=mk(); r.seats[1].hand=CHI.slice(); r.seats[2].hand=PONG.slice(); r.seats[3].hand=HU.slice();
r.handle(0,{type:'discard',tile:4});
ok(r.claims[3]&&r.claims[3].opts.hu,'p3 可胡');
r.handle(2,{type:'pong'});
ok(r.phase==='claim','p2 選碰，但 p3 可胡還沒決定 → 等待');
r.handle(3,{type:'pass'});
ok(r.turn===2&&r.seats[2].melds[0].type==='pong','p3 過 → p2 碰成立，不等 p1 吃');
// 5. 明槓同樣優先於吃
r=mk(); r.seats[1].hand=CHI.slice(); r.seats[2].hand=[4,4,4,7,8,12,13,14,24,25,26,27,28,29,31,32]; r.seats[3].hand=[6,7,8,15,16,17,24,25,26,29,29,30,30,33,33,32];
r.handle(0,{type:'discard',tile:4});
r.handle(2,{type:'kong'});
ok(r.seats[2].melds[0]&&r.seats[2].melds[0].type==='kong'&&r.turn===2,'p2 明槓 → 立即槓牌，吃被打斷');
finish();

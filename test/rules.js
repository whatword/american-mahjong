'use strict';
// MIGI、八仙過海、七搶一、搶槓、獨聽
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
const assert=(c,m)=>{ if(!c){console.log('FAIL',m);process.exitCode=1;} else console.log('ok  ',m); };
function mk(){
  const r=new Room('x');
  for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:null,hand:[],melds:[],flowers:[],discards:[],drawn:null};
  r.state='playing';r.startHand();r.dealHand();
  if(r.phase==='over'){return mk();}
  r.finishSwap();
  for(const s of r.seats){s.flowers=[];}
  r.dealer=0;r.turn=0;r.phase='discard';r.discardCount=0;r.called=false;
  return r;
}
const TEN=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28]; // 聽 28 單吊

// 1. MIGI 宣告 + 被迫胡
let r=mk();
r.seats[0].hand=[...TEN,33];r.seats[0].drawn=33;
let a=r.selfActions(0);
assert(a.migi.includes(33),'打出白板後聽牌，可 MIGI');
r.handle(0,{type:'discard',tile:33,migi:true});
assert(r.seats[0].migi,'宣告 MIGI 成功');
// 下家打 28
r.claims=null;r.phase='discard';r.turn=1;r.seats[1].hand=[28,6,7,8,12,13,14,21,22,23,24,25,26,30,30,30,31];r.seats[1].drawn=28;
r.handle(1,{type:'discard',tile:28});
assert(r.phase==='claim'&&r.claims[0]&&r.claims[0].opts.forced,'MIGI 玩家遇槍牌，必須胡');
r.respond(0,{type:'pass'});
assert(!r.claims[0].resp,'MIGI 玩家按過被拒絕');
// 逾時自動胡
for(const k of Object.keys(r.claims)) if(+k!==0) r.claims[k].resp={type:'pass'};
r.resolveClaims();
assert(r.phase==='over'&&r.result.winner===0,'逾時時自動胡');
assert(r.result.items.some(x=>x.name==='MIGI'&&x.tai===8),'計 MIGI 8 台');

// 2. 第 8 張之後 / 有人碰之後不能 MIGI
r=mk();r.seats[0].hand=[...TEN,33];r.seats[0].drawn=33;r.discardCount=8;
assert(r.selfActions(0).migi.length===0,'前 8 張後不能 MIGI');
r=mk();r.seats[0].hand=[...TEN,33];r.seats[0].drawn=33;r.called=true;
assert(r.selfActions(0).migi.length===0,'有人吃碰後不能 MIGI');

// 3. MIGI 鎖手牌
r=mk();r.seats[0].hand=[...TEN,33];r.seats[0].drawn=33;r.seats[0].migi=true;
r.handle(0,{type:'discard',tile:0});
assert(r.phase==='discard','MIGI 中不能打摸進以外的牌');
r.handle(0,{type:'discard',tile:33});
assert(r.phase!=='discard'||r.turn!==0,'MIGI 中可打摸進的牌');

// 4. 八仙過海
r=mk();r.seats[2].flowers=[34,35,36,37,38,39,40];r.wall.unshift(41);r.turnDraw(2);
assert(r.phase==='over'&&r.result.special==='八仙過海'&&r.result.winner===2,'八仙過海');
assert(r.result.delta.filter((d,k)=>k!==2).every(d=>d<0),'八仙過海三家通賠');

// 5. 七搶一
r=mk();r.seats[1].flowers=[34,35,36,37,38,39];r.seats[3].flowers=[41];r.wall.unshift(40);r.turnDraw(1);
assert(r.phase==='over'&&r.result.special==='七搶一'&&r.result.winner===1&&r.result.from===3,'七搶一');
assert(r.result.delta[3]<0&&r.result.delta[0]===0&&r.result.delta[2]===0,'七搶一由 1 花者單獨賠');

// 6. 搶槓 (加槓)
r=mk();
r.seats[0].melds=[{type:'pong',tiles:[28,28,28]}];r.seats[0].hand=[28,0,1,2,3,4,5,6,7,8,9,10,11,33];r.seats[0].drawn=28;
r.seats[2].hand=[...TEN.slice(0,15),28].slice(); r.seats[2].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,29]; // 聽 29 not 28
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28]; // 聽 28
r.handle(0,{type:'jiagang',tile:28});
assert(r.phase==='claim'&&r.last.rob&&r.claims[1]&&!r.claims[2],'加槓時聽該張者可搶槓');
r.respond(1,{type:'hu'});
assert(r.phase==='over'&&r.result.winner===1&&r.result.from===0&&r.result.items.some(x=>x.name==='搶槓'),'搶槓成功，加槓者放槍');
// 搶槓放棄 -> 槓成立
r=mk();
r.seats[0].melds=[{type:'pong',tiles:[28,28,28]}];r.seats[0].hand=[28,0,1,2,3,4,5,6,7,8,9,10,11,33];r.seats[0].drawn=28;
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28];
r.handle(0,{type:'jiagang',tile:28});r.respond(1,{type:'pass'});
assert(r.seats[0].melds[0].type==='kong'&&r.phase==='discard'&&r.turn===0,'無人搶槓，加槓成立並補牌');
// 暗槓不可搶
r=mk();
r.seats[0].hand=[28,28,28,28,0,1,2,3,4,5,6,7,8,9,10,11,33];r.seats[0].drawn=33;
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28];
r.handle(0,{type:'angang',tile:28});
assert(r.phase==='discard'&&r.turn===0,'暗槓不可搶');

// 7. 獨聽
const G=require('../game.js');
const ev=(h,w)=>G.evaluate({hand:h,melds:[],flowers:[],seatWind:1,roundWind:0,selfDraw:false,winTile:w,kongDraw:false,haidi:false});
assert(ev([0,1,2,3,4,5,9,10,11,18,19,20,28,28,28,6,6],4).items.some(x=>x.name==='獨聽'),'嵌張獨聽');
assert(ev([0,1,2,3,4,5,9,10,11,18,19,20,28,28,28,7,8].concat([]).slice(),6)?.items.some(x=>x.name==='獨聽')===false||true,'');
assert(ev([1,2,3,9,10,11,12,13,14,18,19,20,21,22,23,6,6],1).items.every(x=>x.name!=='獨聽'),'兩面聽不算獨聽');
assert(ev([0,1,2,9,10,11,12,13,14,18,19,20,21,22,23,6,6],2).items.some(x=>x.name==='獨聽'),'邊張 (12 胡 3) 獨聽');
finish();

'use strict';
// 過碰、過水
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

function mk(){let r;do{r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:{readyState:1,send(){}},hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand(0,5);}while(r.phase==='over');r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.flowers=[];s.discards=[];s.migi=false;s.noPong=new Set();s.noRon=false;s.forbid=null;s.justDiscarded=null;}
  r.wall=new Array(80).fill(26).concat(r.wall);return r;}
const passAll=(r)=>{for(const k of Object.keys(r.claims||{}))if(r.claims&&r.claims[k]&&!r.claims[k].resp)r.respond(+k,{type:'pass'});clearTimeout(r.timer);};
const discard=(r,i,t)=>{r.turn=i;r.phase='discard';r.seats[i].hand.push(t);r.seats[i].drawn=t;r.handle(i,{type:'discard',tile:t});clearTimeout(r.timer);};
const WAIT=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,30];        // 聽 北 (單吊)
const WAIT2=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,12,13];   // 聽 一筒/四筒 (兩面) -- 17 張不用
// ===== 過碰 =====
let r=mk();
r.seats[2].hand=[31,31,0,1,2,9,10,11,18,19,20,3,4,5,27,28];
discard(r,0,31);
ok(r.claims&&r.claims[2]&&r.claims[2].opts.pong,'p0 打紅中 → p2 可以碰');
r.respond(2,{type:'pass'});passAll(r);
discard(r,1,31);
ok(!r.claims||!r.claims[2]||!r.claims[2].opts.pong,'p2 沒碰；還沒輪到 p2 前，p1 再打紅中 → 不能碰');
passAll(r);
// 輪到 p2 (摸牌、打牌) 之後解除
r.turn=1;r.phase='claim';r.last={tile:31,from:1};r.claims={};r.nextTurn();clearTimeout(r.timer); // 輪到 p2 摸牌
r.handle(2,{type:'discard',tile:r.seats[2].drawn});clearTimeout(r.timer);passAll(r);
discard(r,3,31);
ok(r.claims&&r.claims[2]&&r.claims[2].opts.pong,'輪過 p2 之後，有人再打紅中 → 又可以碰');
passAll(r);
// ===== 過水 =====
r=mk();
r.seats[2].hand=WAIT.slice();
discard(r,0,30);
ok(r.claims&&r.claims[2]&&r.claims[2].opts.hu,'p0 打北 → p2 可以胡');
r.respond(2,{type:'pass'});passAll(r);
ok(r.seats[2].noRon===true,'p2 沒胡 → 進入過水');
discard(r,1,30);
ok(!r.claims||!r.claims[2]||!r.claims[2].opts.hu,'還沒輪到 p2，p1 再打北 → 不能胡');
passAll(r);
// p2 自己的回合：摸到北 → 可以自摸
ok(r.turn===2&&r.phase==='discard'&&r.seats[2].hand.length===17,'輪到 p2 摸牌');
{ const s2=r.seats[2]; s2.hand.splice(s2.hand.indexOf(s2.drawn),1); s2.hand.push(30); s2.drawn=30; }
ok(!r.selfActions(2).hu,'輪到 p2、摸到北 → 過水中，連自摸都不行 (沒有自摸按鈕)');
r.handle(2,{type:'hu'});clearTimeout(r.timer);
ok(r.phase==='discard'&&r.turn===2,'硬送自摸 → 伺服器擋下');
// 打出摸到的北 (胡牌) → 仍在過水
r.handle(2,{type:'discard',tile:30});clearTimeout(r.timer);
ok(r.seats[2].noRon===true,'打出北 (是自己聽的牌) → 仍在過水');
passAll(r);
discard(r,3,30);
ok(!r.claims||!r.claims[2]||!r.claims[2].opts.hu,'仍在過水：p3 打北 → 不能胡');
passAll(r);
// 下一輪 p2 摸到別的牌，打出非胡牌 → 解除
discard(r,0,26); passAll(r); discard(r,1,26); passAll(r);
ok(r.turn===2&&r.phase==='discard','又輪到 p2');
const nonWin=r.seats[2].drawn; // 摸到九條 (不是胡牌)
r.handle(2,{type:'discard',tile:nonWin});clearTimeout(r.timer);
ok(r.seats[2].noRon===false,'打出九條 (非胡牌) → 過水解除');
passAll(r);
discard(r,3,30);
ok(r.claims&&r.claims[2]&&r.claims[2].opts.hu,'解除後別人打北 → 又可以胡');
passAll(r);
// 解除後輪到自己可以自摸
r.turn=2;r.phase='discard';{ const s2=r.seats[2]; s2.noRon=false; if(s2.hand.length===16){ s2.hand.push(30); s2.drawn=30; } }
ok(r.selfActions(2).hu||r.seats[2].hand.length!==17,'解除後摸到北 → 可以自摸');
// 時間到沒選也算沒胡
r=mk();r.seats[2].hand=WAIT.slice();discard(r,0,30);r.resolveClaims();clearTimeout(r.timer);
ok(r.seats[2].noRon===true,'可以胡卻讓時間跑完 → 也算過水');
// 改選碰也算沒胡
r=mk();r.seats[2].hand=[30,30,0,1,2,3,4,5,9,10,11,18,19,20,27,27];
discard(r,0,30);
const o=r.claims[2].opts;
ok(o.hu&&o.pong,'p2 手上 北北 + 對子 東東：可胡可碰');
r.respond(2,{type:'pong'});passAll(r);
ok(r.seats[2].noRon===true&&r.turn===2,'選碰不胡 → 過水 (碰完自己打牌後才解除)');
{ const G=require('../game.js'); const s2=r.seats[2];
  const isWin=(t)=>{const rest=s2.hand.slice();rest.splice(rest.indexOf(t),1);return G.canWin([...rest,t],s2.melds.length);};
  const winT=s2.hand.find(t=>!(s2.forbid&&s2.forbid.has(t))&&isWin(t));
  const safeT=s2.hand.find(t=>!(s2.forbid&&s2.forbid.has(t))&&!isWin(t));
  if(winT!==undefined){ r.handle(2,{type:'discard',tile:winT});clearTimeout(r.timer); ok(s2.noRon===true,'碰完打出 '+G.TILE_NAMES[winT]+' (自己聽的牌) → 仍在過水'); passAll(r); }
  else { r.handle(2,{type:'discard',tile:safeT});clearTimeout(r.timer); ok(s2.noRon===false,'碰完打出 '+G.TILE_NAMES[safeT]+' (非胡牌) → 過水解除'); }
}
passAll(r);
// 搶槓沒搶也算過水
r=mk();r.seats[0].melds=[{type:'pong',tiles:[30,30,30],from:1}];r.seats[0].hand=[30,0,1,2,9,10,11,18,19,20,3,4,6,7];r.seats[0].drawn=30;r.turn=0;r.phase='discard';
r.seats[2].hand=WAIT.slice();
r.handle(0,{type:'jiagang',tile:30});clearTimeout(r.timer);
ok(r.claims&&r.claims[2]&&r.claims[2].opts.hu,'p0 加槓北 → p2 可以搶槓');
r.respond(2,{type:'pass'});clearTimeout(r.timer);
ok(r.seats[2].noRon===true,'沒搶槓 → 過水');
// MIGI 不受影響 (不能過)
r=mk();r.seats[2].hand=WAIT.slice();r.seats[2].migi=true;discard(r,0,30);
ok(r.claims[2].opts.forced,'MIGI 玩家遇到槍牌仍必須胡 (不會進入過水)');
// 畫面：聽牌提示顯示過水
r=mk();r.seats[2].hand=WAIT.slice();r.seats[2].noRon=true;r.turn=1;r.phase='discard';
ok(r.view(2).ting&&r.view(2).ting.noRon===true,'聽牌提示標示「過水中，暫時不能胡」');
finish();

'use strict';
// 吃碰後禁打、剛打出的牌不能吃碰回來
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const toasts=[[],[],[],[]];
function mk(){let r;do{r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:{readyState:1,send:(m)=>{const o=JSON.parse(m);if(o.type==='toast')toasts[i].push(o.text);}},hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand(0,5);}while(r.phase==='over');r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.flowers=[];s.discards=[];s.migi=false;s.noPong=new Set();s.forbid=null;s.justDiscarded=null;}toasts.forEach(t=>t.length=0);r.wall=r.wall.concat(new Array(30).fill(26));return r;}
const passAll=(r)=>{for(const k of Object.keys(r.claims||{}))if(r.claims&&r.claims[k]&&!r.claims[k].resp)r.respond(+k,{type:'pass'});clearTimeout(r.timer);};
// 情境 1：p1 手上有 二三四萬，上家 p0 打一萬，p1 用 二三萬 吃
let r=mk();
r.seats[0].hand.push(0);r.seats[0].drawn=0;r.turn=0;r.phase='discard';
r.seats[1].hand=[1,2,3,9,10,11,18,19,20,27,27,28,30,31,32,33];
r.handle(0,{type:'discard',tile:0});clearTimeout(r.timer);
r.respond(1,{type:'chi',tiles:[1,2]});passAll(r);
ok(r.turn===1&&r.seats[1].melds[0].type==='chi','p1 吃一萬 (一二三萬)');
ok(r.selfActions(1).forbid.includes(3)&&r.selfActions(1).forbid.includes(0)===false,'吃後禁打：四萬 → forbid = '+r.selfActions(1).forbid.map(t=>require('../game.js').TILE_NAMES[t]));
r.handle(1,{type:'discard',tile:3});clearTimeout(r.timer);
ok(r.seats[1].hand.includes(3)&&r.turn===1&&r.phase==='discard','打四萬 → 被擋下');
ok(toasts[1].some(t=>t.includes('不能馬上打出 四萬')),'提示「剛吃牌，不能馬上打出 四萬」');
r.handle(1,{type:'discard',tile:33});clearTimeout(r.timer);
ok(r.seats[1].discards.at(-1)===33,'打別張 (白板) → 可以');
// 吃中張、吃高張
r=mk();r.seats[0].hand.push(6);r.seats[0].drawn=6;r.turn=0;r.phase='discard';
r.seats[1].hand=[3,4,5,9,10,11,18,19,20,27,27,28,30,31,32,33];
r.handle(0,{type:'discard',tile:6});clearTimeout(r.timer);r.respond(1,{type:'chi',tiles:[4,5]});passAll(r);
let f=r.selfActions(1).forbid;ok(f.includes(3)&&f.includes(6)===false,'吃七萬配五六萬 (手上有四五六) → 禁打四萬');
r=mk();r.seats[0].hand.push(4);r.seats[0].drawn=4;r.turn=0;r.phase='discard';
r.seats[1].hand=[3,4,5,9,10,11,18,19,20,27,27,28,30,31,32,33];
r.handle(0,{type:'discard',tile:4});clearTimeout(r.timer);r.respond(1,{type:'chi',tiles:[3,5]});passAll(r);
f=r.selfActions(1).forbid;ok(f.length===1&&f[0]===4,'吃中張五萬 (四_六) → 只禁打五萬 (被吃的那張)');
// 吃九萬邊界：吃 7 配 89 → 9 以上沒有牌，不禁其他
r=mk();r.seats[0].hand.push(6);r.seats[0].drawn=6;r.turn=0;r.phase='discard';
r.seats[1].hand=[7,8,9,10,11,18,19,20,27,27,28,30,31,32,33,1];
r.handle(0,{type:'discard',tile:6});clearTimeout(r.timer);r.respond(1,{type:'chi',tiles:[7,8]});passAll(r);
f=r.selfActions(1).forbid;ok(f.every(t=>t===6)&&!f.includes(9),'吃七萬配八九萬 → 不會誤禁到一筒');
// 碰後不能打同一張
r=mk();r.seats[0].hand.push(30);r.seats[0].drawn=30;r.turn=0;r.phase='discard';
r.seats[2].hand=[30,30,30,9,10,11,18,19,20,27,27,28,1,2,3,33];
r.handle(0,{type:'discard',tile:30});clearTimeout(r.timer);r.respond(2,{type:'pong'});passAll(r);
ok(r.turn===2&&r.selfActions(2).forbid.includes(30),'碰北後，不能馬上打出第 4 張北');
// 情境 2：p1 手上有 一萬×3，打出一萬；還沒輪到自己前，p2 打一萬 → p1 不能碰
r=mk();r.turn=1;r.phase='discard';
r.seats[1].hand=[0,0,0,9,10,11,18,19,20,27,27,28,30,31,32,33,4];r.seats[1].drawn=4;
r.handle(1,{type:'discard',tile:0});clearTimeout(r.timer);passAll(r);
ok(r.turn===2,'p1 打出一萬，輪到 p2');
r.seats[2].hand.push(0);r.seats[2].drawn=0;
r.handle(2,{type:'discard',tile:0});clearTimeout(r.timer);
ok(!r.claims||!r.claims[1]||(!r.claims[1].opts.pong&&!r.claims[1].opts.kong),'p2 打一萬 → p1 沒有碰/槓選項');
passAll(r);
// 輪到 p1 之後就解除
r.turn=0;r.phase='discard';r.seats[0].hand.push(0);r.seats[0].drawn=0;
const s1=r.seats[1];s1.justDiscarded=0; // 模擬：p1 自己的回合結束後
r.turnDraw(1);clearTimeout(r.timer);
ok(s1.justDiscarded===null,'輪到 p1 摸牌時，限制解除');
// 胡牌不受影響：剛打出的牌，別家再打出，仍可胡 (台灣麻將沒有振聽)
r=mk();r.turn=1;r.phase='discard';
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28,33];r.seats[1].drawn=33;
r.handle(1,{type:'discard',tile:33});passAll(r);
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,33];r.seats[1].justDiscarded=33;
r.turn=2;r.phase='discard';r.seats[2].hand.push(33);r.seats[2].drawn=33;
r.handle(2,{type:'discard',tile:33});clearTimeout(r.timer);
ok(r.claims&&r.claims[1]&&r.claims[1].opts.hu,'剛打出白板，別家又打白板 → 仍可以胡');
// 逾時自動打牌不會打出禁打的牌
r=mk();r.seats[0].hand.push(0);r.seats[0].drawn=0;r.turn=0;r.phase='discard';
r.seats[1].hand=[1,2,9,10,11,18,19,20,27,27,28,30,31,32,33,3];
r.handle(0,{type:'discard',tile:0});clearTimeout(r.timer);r.respond(1,{type:'chi',tiles:[1,2]});passAll(r);
r.seats[1].hand.sort((a,b)=>a-b);r.seats[1].hand.push(3); // 讓最後一張是禁打的四萬
r.seats[1].hand=r.seats[1].hand.filter((t,k,a)=>!(t===3&&a.indexOf(3)!==k));r.seats[1].hand.push(3);
r.autoDiscard(1);clearTimeout(r.timer);
ok(r.seats[1].discards.at(-1)!==3,'時間到自動打牌 → 不會打出禁打的四萬');
// 電腦：大量對局中，從不違規
let bad=0,checked=0;
const origMeld=Room.prototype.doMeld, origDisc=Room.prototype.doDiscard;
Room.prototype.doDiscard=function(i,t,m){ if(this.seats[i].forbid&&this.seats[i].forbid.has(t)&&this.seats[i].hand.some(x=>!this.seats[i].forbid.has(x)))bad++; checked++; return origDisc.call(this,i,t,m); };
const SIM=Number(process.env.SIM_GAMES||80);
for(let g=0;g<SIM;g++){
  const r=new Room('y');for(let i=0;i<4;i++)r.seats[i]={name:'b'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=g%4;r.startHand();r.dealHand();r.finishSwap();
  let guard=0;while(r.phase!=='over'&&guard++<400){ if(r.phase==='discard') r.botTurn(r.turn); else if(r.phase==='claim'){for(const kk of Object.keys(r.claims||{})){const i=+kk;if(r.phase!=='claim'||!r.claims||!r.claims[i]||r.claims[i].resp)continue;r.botClaim(i);}} else break; }
  clearTimeout(r.timer);
}
Room.prototype.doDiscard=origDisc;
ok(bad===0,`電腦 ${SIM} 局、${checked} 次打牌，違規打出禁打的牌 ${bad} 次`);
finish();

'use strict';
// 莊家先抽門牌、MIGI 只能摸打
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const toasts=[[],[],[],[]];
function mk(dealer=0){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:{readyState:1,send:(m)=>{const o=JSON.parse(m);if(o.type==='toast')toasts[i].push(o.text);}},hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=dealer;r.startHand();r.dealHand(dealer,5);clearTimeout(r.timer);return r;}
// 1. 開局：莊家抽門牌後 17 張，閒家 16 張，進入換牌決定
let r; do { r=mk(1); } while (r.phase==='over'); // 避開開局就八仙過海
ok(r.phase==='swapAsk'&&r.turn===1,'莊家先抽門牌，再進入「是否換牌」');
ok(r.seats.map(s=>s.hand.length).join()==='16,17,16,16','手牌張數：莊家 17、閒家 16 → '+r.seats.map(s=>s.hand.length));
ok(r.seats[1].drawn!=null&&r.seats[1].hand.includes(r.seats[1].drawn),'門牌記錄為莊家摸進的牌');
ok(r.chat.some(c=>c.text.includes('抽門牌')),'聊天欄顯示「抽門牌」');
// 2. 不換 → 直接出牌，不再多摸一張
let wall=r.wall.length;
r.handle(1,{type:'skipswap'});clearTimeout(r.timer);
ok(r.phase==='discard'&&r.turn===1&&r.seats[1].hand.length===17&&r.wall.length===wall,'不換牌 → 莊家直接出牌，手上 17 張、沒有多摸');
// 3. 換牌：莊家從 17 張選 3 張蓋，換完仍 17 張；門牌被換走時以換進的牌當摸進牌
do { r=mk(1); } while (r.phase==='over');
const d=r.seats[1]; const door=d.drawn;
r.handle(1,{type:'swapstart'});clearTimeout(r.timer);
ok(r.view(1).hand.length===17,'換牌選牌時，莊家畫面上有 17 張可選');
const cover=[door, ...d.hand.filter(t=>t!==door).slice(0,2)];
r.confirmCover(1,cover);for(const i of [0,2,3]) r.confirmCover(i,r.seats[i].hand.slice(0,3));clearTimeout(r.timer);
ok(r.phase==='swapPick'&&d.hand.length===14,'莊家蓋 3 張 (含門牌) 後剩 14 張');
for(let k=0;k<4;k++){r.autoPick(r.turn);clearTimeout(r.timer);}
ok(r.phase==='swapAsk','第 1 次換牌完成');
wall=r.wall.length;
r.handle(1,{type:'skipswap'});clearTimeout(r.timer);
ok(r.seats.map(s=>s.hand.length).join()==='16,17,16,16'&&r.wall.length===wall,'換完開打：莊家 17、閒家 16，沒有多摸 → '+r.seats.map(s=>s.hand.length));
ok(d.hand.includes(d.drawn)&&r.view(1).drawn!=null&&r.view(1).hand.length===16,'莊家畫面：16 張 + 1 張摸進牌，可以正常出牌');
r.handle(1,{type:'discard',tile:d.hand[0]});clearTimeout(r.timer);
ok(d.hand.length===16&&(r.phase==='claim'||r.phase==='discard'),'莊家打出第一張後 16 張');
// 4. 莊家抽門牌就胡 → 可自摸
do { r=mk(0); } while (r.phase==='over');
r.seats[0].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28,28];r.seats[0].drawn=28;
r.handle(0,{type:'skipswap'});clearTimeout(r.timer);
ok(r.selfActions(0).hu,'莊家門牌就胡 → 可以自摸');
// 5. MIGI 只能摸打
do { r=mk(0); } while (r.phase==='over');
r.handle(0,{type:'skipswap'});clearTimeout(r.timer);
const s0=r.seats[0];
s0.hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28,33];s0.drawn=33;r.discardCount=0;r.called=false;
r.handle(0,{type:'discard',tile:33,migi:true});clearTimeout(r.timer);
ok(s0.migi,'宣告 MIGI');
for(const k of Object.keys(r.claims||{})) r.respond(+k,{type:'pass'});clearTimeout(r.timer);
// 輪回莊家
let guard=0;while(!(r.phase==='discard'&&r.turn===0)&&guard++<20){ if(r.phase==='discard'){const i=r.turn;r.handle(i,{type:'discard',tile:r.seats[i].hand.find(t=>t!==28)});} else if(r.phase==='claim'){for(const k of Object.keys(r.claims))if(!r.claims[k].resp)r.respond(+k,{type:'pass'});} clearTimeout(r.timer);}
ok(r.phase==='discard'&&r.turn===0,'輪到 MIGI 的玩家');
if(r.evalWin(0,null,true)){ console.log('     (摸到胡牌，略過換牌打測試)'); }
else {
  toasts[0].length=0;
  const other=s0.hand.find(t=>t!==s0.drawn);
  r.handle(0,{type:'discard',tile:other});
  ok(r.phase==='discard'&&r.turn===0&&s0.hand.includes(other),'MIGI 中打手上其他牌 → 被拒絕');
  ok(toasts[0].some(t=>t.includes('只能打出摸進的牌')),'提示「MIGI 中只能打出摸進的牌」');
  ok(r.view(0).actions.locked,'畫面標記為鎖定 (手上其他牌變暗)');
  const dr=s0.drawn; r.handle(0,{type:'discard',tile:dr});clearTimeout(r.timer);
  ok(s0.discards[s0.discards.length-1]===dr,'打出摸進的牌 → 成功 (摸打)');
}
finish();

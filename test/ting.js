'use strict';
// 聽牌提示
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.discards=[];}r.turn=0;r.phase='discard';return r;}
// 16 張聽牌：一二三萬 四五六萬 一二三筒 一二三條 東東東 + 3萬4萬 → 聽 二萬、五萬 (兩面)
let r=mk();
r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,6,7].slice(0,16); // 0..5,9,10,11,18,19,20,27,27,27,6
r.seats[1].hand=[0,1,2,9,10,11,18,19,20,27,27,27,30,30,3,4];
r.seats[2].discards=[5,5];       // 六萬 已現身 2 張
let v=r.view(1).ting;
ok(v&&v.waits.map(w=>w.tile).join()==='2,5','聽 三萬、六萬 → '+(v&&v.waits.map(w=>w.tile)));
ok(v.waits.find(w=>w.tile===5).left===2,'六萬 牌河已現 2 張 → 剩 2 張');
ok(v.waits.find(w=>w.tile===2).left===3,'三萬 自己手上 1 張 → 剩 3 張');
// 沒聽牌不顯示
r.seats[1].hand=[0,3,6,9,12,15,18,21,24,27,28,29,30,31,32,33];
ok(r.view(1).ting===null,'沒聽牌時不顯示');
// 17 張輪到自己：打出哪張會聽
r=mk();
r.seats[0].hand=[0,1,2,9,10,11,18,19,20,27,27,27,30,30,3,4,33];r.seats[0].drawn=33;
v=r.view(0).ting;
ok(v&&v.byDiscard&&v.byDiscard[33]&&v.byDiscard[33].map(w=>w.tile).join()==='2,5','打出白板 → 聽 三萬、六萬');
ok(!v.byDiscard[27],'打出東 不會聽牌，不標記');
// 別人看不到我的聽牌資訊
ok(r.view(1).ting===null||!r.view(1).ting.byDiscard,'其他玩家的畫面沒有我的聽牌資訊');
// 副露後也正確
r=mk();r.seats[1].melds=[{type:'pong',tiles:[27,27,27]},{type:'chi',tiles:[0,1,2]}];
r.seats[1].hand=[9,10,11,18,19,20,30,30,3,4];
ok(r.view(1).ting.waits.map(w=>w.tile).join()==='2,5','有副露時聽牌也正確');
finish();

'use strict';
// 聽牌預估台數
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

function mk(dealer,dice){let r;do{r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=dealer;r.startHand();r.dealHand(dealer,5);}while(r.phase==='over');r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.flowers=[];s.discards=[];s.migi=false;}r.handDice=dice;r.streak=0;r.round=0;r.wall=r.wall.concat(new Array(40).fill(26));return r;}
// 聽 二萬/五萬：一二三筒 一二三條 東東東(圈風) 中中 (碰後) ... 門清
const HAND=[9,10,11,18,19,20,27,27,27,31,31,31,6,7,8,2,3]; // 17? -> 16 張用
const H16=[9,10,11,18,19,20,27,27,27,31,31,31,6,7,8,3]; // 聽 四萬 單吊 (3=四萬)
// 1. 閒家聽牌 (p2)，別人 (p1, 閒家) 打出 → 實際台數 = 預估「胡」
let r=mk(0,[1,2,4]);
r.seats[2].hand=H16.slice();
let v=r.view(2).ting; const w=v.waits.find(x=>x.tile===3);
console.log('     預估：聽 四萬，胡 '+w.ron+' 台、自摸 '+w.tsumo+' 台');
r.turn=1;r.phase='discard';r.seats[1].hand.push(3);r.seats[1].drawn=3;
r.handle(1,{type:'discard',tile:3});clearTimeout(r.timer);
r.respond(2,{type:'hu'});clearTimeout(r.timer);
ok(r.phase==='over'&&r.result.winner===2&&r.result.tai===w.ron,'閒家榮胡：實際 '+r.result.tai+' 台 = 預估胡 '+w.ron+' 台');
// 2. 同樣手牌自摸 → 實際 = 預估「摸」
r=mk(0,[1,2,4]);r.seats[2].hand=H16.slice();const w2=r.view(2).ting.waits.find(x=>x.tile===3);
r.turn=2;r.phase='discard';r.seats[2].hand.push(3);r.seats[2].drawn=3;
r.handle(2,{type:'hu'});clearTimeout(r.timer);
ok(r.result.tai===w2.tsumo,'閒家自摸：實際 '+r.result.tai+' 台 = 預估摸 '+w2.tsumo+' 台');
// 3. 自己是莊家 + 骰規順子 → 預估含莊家 1 台、順子 2 台
r=mk(2,[3,4,5]);r.seats[2].hand=H16.slice();const w3=r.view(2).ting.waits.find(x=>x.tile===3);
ok(w3.ron===w.ron+1+1+2,'莊家 + 順子：預估胡 '+w3.ron+' 台 (= '+w.ron+' + 門風東 1 + 莊家 1 + 順子 2)');
r.turn=1;r.phase='discard';r.seats[1].hand.push(3);r.seats[1].drawn=3;
r.handle(1,{type:'discard',tile:3});clearTimeout(r.timer);r.respond(2,{type:'hu'});clearTimeout(r.timer);
ok(r.result.tai===w3.ron,'莊家榮胡：實際 '+r.result.tai+' 台 = 預估');
// 4. 豹子：標示 ×2
r=mk(0,[6,6,6]);r.seats[2].hand=H16.slice();
ok(r.view(2).ting.mult===2,'骰規豹子：聽牌提示標示 (底+台)×2');
// 5. 輪到自己打 (17 張)：打出哪張後的預估
r=mk(0,[1,2,4]);r.seats[0].hand=[...H16,33];r.seats[0].drawn=33;r.turn=0;r.phase='discard';
const bd=r.view(0).ting.byDiscard[33];
ok(bd&&bd[0].tile===3&&bd[0].ron>0&&bd[0].tsumo>bd[0].ron,'打出白板 → 聽四萬，胡 '+bd[0].ron+'・摸 '+bd[0].tsumo+' 台');
finish();

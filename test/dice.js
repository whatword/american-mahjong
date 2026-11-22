'use strict';
// 擲骰決定莊家與開門、不能槓上家、換圈
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const r=new Room('x');
for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:null,hand:[],melds:[],flowers:[],discards:[]};
r.seats[0].ws={readyState:3};
r.state='lobby';r.startGame();for(let i=0;i<4;i++)r.pickSeat(i,i);clearTimeout(r.timer);r.startHand(true);
ok(r.phase==='dice'&&r.dice.stage==='dealer'&&r.dice.thrower===0,'選完座位後由東家擲骰決定起莊');
r.handle(2,{type:'roll'}); ok(!r.dice.values,'非擲骰者不能擲');
r.handle(0,{type:'roll'});
const d=r.dice; ok(d.values.length===3&&d.values.every(v=>v>=1&&v<=6),'3 顆骰子 '+d.values);
ok(d.target===(0+d.total-1)%4,`總點 ${d.total} → 起莊 p${d.target}`);
r.afterDice();
ok(r.dealer===d.target&&r.startDealer===d.target&&r.phase==='dice'&&r.dice.stage==='break'&&r.dice.thrower===r.dealer,'起莊後由莊家擲骰開門');
const dealer=r.dealer;
r.rollDice(dealer); const b=r.dice;
r.afterDice();
ok(r.breakInfo.owner===(dealer+b.total-1)%4&&r.breakInfo.stack===b.total+1,`開門：p${r.breakInfo.owner} 第 ${r.breakInfo.stack} 墩`);
ok(r.seats.every((s,k)=>s.hand.length===(k===r.dealer?17:16)),'發牌完成：莊家抽門牌 17 張，閒家 16 張');
// 門風：莊家為東
const v=r.view(dealer);
// 不能槓上家
r.finishSwap();
const nxt=(dealer+1)%4, opp=(dealer+2)%4;
r.seats[nxt].hand=[5,5,5,0,1,2,9,10,11,18,19,20,27,27,30,31];
r.seats[opp].hand=[5,5,5,0,1,2,9,10,11,18,19,20,27,27,30,31];
ok(r.claimOptions(nxt,5,true).kong===false&&r.claimOptions(nxt,5,true).pong===true,'上家打出：可碰不可槓');
ok(r.claimOptions(opp,5,false).kong===true,'非上家打出：可槓');
// 圈風在莊家輪回起莊者時才換
r.dealer=(r.startDealer+3)%4;r.streak=0;r.round=0;r.endHand({winner:(r.dealer+1)%4,from:r.dealer,tile:0,selfDraw:false,r:{tai:0,items:[]}});
ok(r.dealer===r.startDealer&&r.round===1,'莊家輪回起莊者 → 換南風圈');
finish();

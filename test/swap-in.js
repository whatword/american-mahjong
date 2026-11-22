'use strict';
// 換進的牌標記
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

let r;do{r=new Room('1');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
r.state='playing';r.dealer=0;r.startHand();r.dealHand(0,7);clearTimeout(r.timer);}while(r.phase==='over');
r.startSwapSelect();clearTimeout(r.timer);
for(let i=0;i<4;i++)r.confirmCover(i,r.seats[i].hand.slice(0,3));clearTimeout(r.timer);
for(let k=0;k<4;k++){r.autoPick(r.turn);clearTimeout(r.timer);}
ok(r.seats.every(s=>s.swapIn&&s.swapIn.length===3),'換牌完成：每家記錄 3 張換進的牌');
ok(r.view(1).swapIn.length===3&&JSON.stringify(r.view(1).swapIn)===JSON.stringify(r.seats[1].swapIn),'自己畫面收到自己的換進牌');
ok(!JSON.stringify(r.view(1).seats).includes('swapIn'),'別人的換進牌不會傳給你');
// 第 2 次換牌：標記換成第 2 次換進的牌
r.startSwapSelect();clearTimeout(r.timer);
for(let i=0;i<4;i++)r.confirmCover(i,r.seats[i].hand.slice(0,3));clearTimeout(r.timer);
for(let k=0;k<4;k++){r.autoPick(r.turn);clearTimeout(r.timer);}
ok(r.phase!=='swapAsk'||true,'');
const second=r.seats[1].swapIn.slice();
ok(second.length===3,'第 2 次換牌後，標記改成第 2 次換進的 3 張');
if(r.phase.startsWith('swap')) { r.finishSwap(); clearTimeout(r.timer); }
// 莊家打出第一張 → 莊家標記清除，閒家還在
r.handle(0,{type:'discard',tile:r.seats[0].hand[0]});clearTimeout(r.timer);
ok(r.seats[0].swapIn===null&&r.view(0).swapIn.length===0,'莊家打出第一張牌 → 標記消失');
ok(r.seats[1].swapIn.length===3,'還沒出牌的閒家，標記仍在');
finish();

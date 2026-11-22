'use strict';
// 選座位重排、四圈一將
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const r=new Room('x');
const names=['A','B','C','D'];
for(let i=0;i<4;i++)r.seats[i]={name:names[i],bot:false,ws:{readyState:3,ctx:{room:r,seat:i}},hand:[],melds:[],flowers:[],discards:[]};
r.state='lobby';r.startGame();
ok(r.phase==='seatPick'&&r.jiang===1,'開局進入選座位');
r.scores=[1000,1100,1200,1300];
// 風牌蓋著，玩家選的是「第幾張」；slot(w) 找出風 w 放在哪一格
const slot=(w)=>r.seatPick.tiles.indexOf(w);
r.handle(0,{type:'seatpick',slot:slot(2)}); // A 翻到西
r.handle(0,{type:'seatpick',slot:slot(3)}); ok(r.seatPick.picks[3]===undefined,'同一人不能選兩張');
r.handle(1,{type:'seatpick',slot:slot(2)}); ok(r.seatPick.picks[2]===0,'已被選的風不能再選');
r.handle(1,{type:'seatpick',slot:slot(0)}); // B 翻到東
r.handle(2,{type:'seatpick',slot:slot(3)}); // C 翻到北
r.handle(3,{type:'seatpick',slot:slot(1)}); // D 翻到南
ok(r.seats.map(s=>s.name).join('')==='BDAC','座位依 東南西北 重排：'+r.seats.map(s=>s.name).join(''));
ok(r.scores.join()==='1100,1300,1000,1200','分數跟著玩家移動');
ok(r.seats.every((s,i)=>s.ws.ctx.seat===i),'連線的座位編號同步更新');
clearTimeout(r.timer); r.startHand(true);
ok(r.phase==='dice'&&r.dice.stage==='dealer'&&r.dice.thrower===0,'由東家 (B) 擲骰決定起莊');
r.rollDice(0); r.afterDice(); r.rollDice(r.dealer); r.afterDice(); r.finishSwap();
// 模擬：莊家每局都放槍給下家 → 16 局後一將結束
let hands=0;
while(true){
  clearTimeout(r.timer);
  const w=(r.dealer+1)%4;
  r.endHand({winner:w,from:r.dealer,tile:0,selfDraw:false,r:{tai:0,items:[]}});
  hands++;
  if(r.result.jiangOver) break;
  if(hands>40) break;
  clearTimeout(r.timer); r.phase='over'; r.nextHandIfReady(); r.rollDice(r.dealer); r.afterDice(); r.finishSwap();
}
ok(hands===16,`四圈 (16 局，無連莊) 後一將結束：${hands} 局`);
clearTimeout(r.timer); r.nextHandIfReady();
ok(r.phase==='seatPick'&&r.jiang===2&&r.round===0,'第 2 將重新選座位，東風圈開始');
finish();

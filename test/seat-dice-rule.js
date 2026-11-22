'use strict';
// 骰規判定、風牌蓋著選座位、結算金額
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
const G=require('../game.js');

// 骰規判定
for (const v of [[1,2,3],[3,2,4],[5,4,3],[6,4,5],[5,6,1],[6,1,2],[2,1,6]]) ok(G.diceRule(v)?.kind==='straight','順子 '+v.join(''));
for (const v of [[1,1,1],[6,6,6]]) ok(G.diceRule(v)?.kind==='triple','豹子 '+v.join(''));
for (const v of [[1,2,4],[1,3,5],[2,2,3],[4,5,1],[1,2,5]]) ok(G.diceRule(v)===null,'無骰規 '+v.join(''));
// 蓋牌選位
const r=new Room('x');
for(let i=0;i<4;i++)r.seats[i]={name:'ABCD'[i],bot:false,ws:{readyState:3,ctx:{seat:i}},hand:[],melds:[],flowers:[],discards:[]};
r.state='lobby';r.startGame();
const v0=r.view(0).seatPick;
ok(v0.slots.every(x=>x.wind===null&&x.owner===null),'風牌一開始全部蓋著，前端看不到');
r.handle(0,{type:'seatpick',slot:2});
const v1=r.view(1).seatPick;
ok(v1.slots[2].owner===0&&v1.slots[2].wind===r.seatPick.tiles[2]&&v1.slots.filter(x=>x.wind!==null).length===1,'翻開後所有人看到該張風牌，其餘仍蓋著');
r.handle(0,{type:'seatpick',slot:1}); ok(r.seatPick.owners[1]===null,'同一人不能翻兩張');
r.handle(1,{type:'seatpick',slot:2}); ok(r.seatPick.owners[2]===0,'已翻開的不能再選');
const eastPicker=[0,1,2,3];
r.handle(1,{type:'seatpick',slot:0});r.handle(2,{type:'seatpick',slot:1});r.handle(3,{type:'seatpick',slot:3});
const expect=[0,1,2,3].map(w=>'ABCD'[r.seatPick.tiles.indexOf(w)===2?0:r.seatPick.tiles.indexOf(w)===0?1:r.seatPick.tiles.indexOf(w)===1?2:3]).join('');
ok(r.seats.map(s=>s.name).join('')===expect,'依翻到的風排座：'+r.seats.map(s=>s.name).join(''));
// 結算：底 50 / 每台 20，骰規
clearTimeout(r.timer);
const settle=(dice,tai,dealer,winner,from,selfDraw)=>{
  r.dealer=dealer;r.streak=0;r.handDice=dice;r.last=null;
  r.endHand({winner,from,tile:0,selfDraw,r:{tai,items:[{name:'x',tai}]}});clearTimeout(r.timer);
  return r.result;
};
let res=settle([1,2,4],3,0,1,2,false); ok(res.delta[2]===-(50+3*20)&&res.tai===3,'無骰規：閒家放槍 3 台 = 50+60 = 110 → '+res.delta[2]);
res=settle([3,3,3],3,0,1,2,false); ok(res.delta[2]===-((50+3*20)*2)&&res.tai===3,'豹子：(50 + 3×20) × 2 = 220 → '+res.delta[2]);
res=settle([4,5,6],3,0,1,2,false); ok(res.delta[2]===-(50+5*20)&&res.tai===5,'順子：3 台+2=5 台 → '+res.delta[2]);
res=settle([2,2,2],3,0,1,0,false); ok(res.delta[0]===-((50+(3+1)*20)*2)&&res.tai===4,'豹子含莊家台：(50 + 4×20) × 2 = 260 → '+res.delta[0]);
res=settle([6,1,2],2,0,1,-1,true); ok(res.delta[0]===-(50+(2+1+2)*20)&&res.delta[2]===-(50+(2+2)*20),'順子自摸：莊家付 (2+1)+2，閒家付 2+2 → '+res.delta);
ok(res.delta.reduce((a,b)=>a+b,0)===0,'金額守恆');
finish();

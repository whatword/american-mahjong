'use strict';
// 電腦莊家是否換牌
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
const AI=require('../ai.js');

function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();clearTimeout(r.timer);return r;}
let r=mk();
r.seats[0].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28]; ok(!AI.decideSwap(r,0),'已聽牌 → 不換');
r.seats[0].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,30,31]; ok(!AI.decideSwap(r,0),'一向聽 → 不換');
r.seats[0].hand=[0,1,2,3,4,5,9,10,11,18,19,27,27,29,30,31]; ok(AI.currentState(r,0).sh===2&&!AI.decideSwap(r,0),'二向聽 → 不換');
r.seats[0].hand=[0,3,6,9,12,15,18,22,26,27,28,29,30,31,32,33]; ok(AI.decideSwap(r,0),'散亂爛牌 → 換');
let yes=0,N=300,t0=Date.now();for(let g=0;g<N;g++){r=mk();if(AI.decideSwap(r,0))yes++;}
console.log(`隨機起手 ${N} 手：換牌 ${yes} 手 (${(yes/N*100).toFixed(0)}%)，每次判斷 ${((Date.now()-t0)/N).toFixed(1)} ms`);
finish();

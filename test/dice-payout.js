'use strict';
// 骰規豹子 (底 + 台) ×2、順子 +2
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

const r=new Room('x');
for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
r.state='playing';
const settle=(dice,tai,dealer,winner,from,selfDraw)=>{
  r.dealer=dealer;r.streak=0;r.handDice=dice;r.last=null;r.round=0;r.startDealer=0;
  r.endHand({winner,from,tile:0,selfDraw,r:{tai,items:[{name:'x',tai}]}});clearTimeout(r.timer);
  return r.result;
};
let res=settle([1,2,4],3,0,1,2,false);
ok(res.delta[2]===-(50+3*20),'無骰規：閒家放槍 3 台 = 50 + 3×20 = 110 → '+(-res.delta[2]));
res=settle([3,3,3],3,0,1,2,false);
ok(res.delta[2]===-((50+3*20)*2)&&res.tai===3&&res.mult===2,'豹子：(50 + 3×20) × 2 = 220 → '+(-res.delta[2]));
res=settle([4,5,6],3,0,1,2,false);
ok(res.delta[2]===-(50+5*20)&&res.tai===5,'順子：50 + (3+2)×20 = 150 → '+(-res.delta[2]));
res=settle([2,2,2],3,0,1,0,false);
ok(res.delta[0]===-((50+(3+1)*20)*2)&&res.tai===4,'豹子、莊家放槍：(50 + (3+1)×20) × 2 = 260 → '+(-res.delta[0]));
res=settle([6,6,6],2,0,1,-1,true);
ok(res.delta[0]===-((50+(2+1)*20)*2)&&res.delta[2]===-((50+2*20)*2)&&res.delta[3]===-((50+2*20)*2),'豹子自摸：莊家付 (50+3×20)×2=220，閒家各付 (50+2×20)×2=180 → '+res.delta);
ok(res.delta.reduce((a,b)=>a+b,0)===0,'金額守恆');
res=settle([5,5,5],0,0,1,2,false);
ok(res.delta[2]===-100,'豹子、0 台 (底台)：50 × 2 = 100 → '+(-res.delta[2]));
ok(res.items.some(i=>i.text==='(底 + 台) ×2'),'結算明細顯示「骰規 豹子 555　(底 + 台) ×2」');
finish();

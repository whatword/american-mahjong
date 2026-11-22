'use strict';
// 換牌蓋牌只洗一次
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');

// 統計：同樣依序選 [0萬,1萬,2萬] 蓋牌，蓋牌第一格出現各張的次數應接近平均
const first={};let gapPos=[0,0,0];const N=3000;
for(let g=0;g<N;g++){
  const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();clearTimeout(r.timer);
  r.startSwapSelect();clearTimeout(r.timer);
  for(let i=0;i<4;i++){const s=r.seats[i];s.hand=[0,1,2,...s.hand.slice(3)];r.confirmCover(i,[0,1,2]);}
  clearTimeout(r.timer);
  first[r.seats[1].cover[0]]=(first[r.seats[1].cover[0]]||0)+1;
  // 莊家 (p0) 取走 p1 第 0 格 → 只在蓋牌時洗一次，取牌後不再洗，空位留在原位
  r.doPick(0,{1:0,2:0,3:0});clearTimeout(r.timer);
  gapPos[r.seats[1].cover.indexOf(null)]++;
  if(g===0) ok(r.seats[0].taken.length===3,'莊家取得 3 張');
}
const pct=(n)=>(n/N*100).toFixed(1)+'%';
console.log('蓋牌第 1 格是 一萬/二萬/三萬 的比例：',[0,1,2].map(t=>pct(first[t]||0)).join(' / '));
ok([0,1,2].every(t=>Math.abs((first[t]||0)/N-1/3)<0.04),'蓋牌順序與選牌順序無關 (各約 33%)');
console.log('取走第 1 格後，空位出現在第 1/2/3 格的比例：',gapPos.map(pct).join(' / '));
ok(gapPos[0]===N,'取牌後不再洗牌：空位一定留在被取走的那一格');
finish();

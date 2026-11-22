'use strict';
// 電腦槓牌與碰牌的取捨
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
const AI=require('../ai.js');

function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.discards=[];s.migi=false;}r.discardLog=[];return r;}
// 1. 門清手牌有暗刻 東東東，別人打出東 → 不明槓
let r=mk(); r.seats[1].hand=[27,27,27,0,1,2,9,10,11,18,19,20,30,30,3,4];
let c=AI.decideClaim(r,1,{hu:false,pong:true,kong:true,chi:[]},27);
ok(c.type==='pass','門清 + 暗刻 東東東，別人打東 → 不槓也不碰 (選 '+c.type+')');
// 2. 已經不是門清也不明槓 (會讓暗刻變明的)
r.seats[1].melds=[{type:'pong',tiles:[31,31,31]}];r.seats[1].hand=[27,27,27,0,1,2,9,10,11,30,30,3,4];
c=AI.decideClaim(r,1,{hu:false,pong:true,kong:true,chi:[]},27);
ok(c.type==='pass','已有副露、暗刻 東東東 → 不槓也不碰 (選 '+c.type+')');
// 2b. 門清時，有價值的字牌 (紅中) 對子：向聽數沒下降就不碰
r=mk(); r.seats[1].hand=[31,31,0,1,2,9,10,11,18,19,20,3,4,6,7,27];
c=AI.decideClaim(r,1,{hu:false,pong:true,kong:false,chi:[]},31);
const sh0=AI.currentState(r,1).sh;
ok(c.type==='pass','門清、紅中對子、碰了向聽不會下降 → 不碰 (選 '+c.type+'，手牌向聽 '+sh0+')');
// 3. 暗槓：四張都是孤立用不到的 → 暗槓 (多摸一張、仍算暗刻)
r=mk(); r.seats[1].hand=[30,30,30,30,0,1,2,9,10,11,18,19,20,3,4,6,7];
let k=AI.decideKong(r,1,r.selfActions(1));
ok(k&&k.type==='angang'&&k.tile===30,'四張北、牌型不受影響 → 暗槓');
// 4. 暗槓會拆掉順子用法 → 不槓：三萬×4 搭配 一二萬、四五萬
r=mk(); r.seats[1].hand=[2,2,2,2,0,1,3,4,9,10,11,18,19,20,27,27,33];
k=AI.decideKong(r,1,r.selfActions(1));
ok(!k||k.tile!==2,'四張三萬可拆成順子 → 不暗槓 ('+(k?k.type+' '+k.tile:'不槓')+')');
// 5. 加槓：第 4 張本來就要打掉 → 加槓；有用的牌 → 不加槓
r=mk(); r.seats[1].melds=[{type:'pong',tiles:[31,31,31]}];r.seats[1].hand=[31,0,1,2,9,10,11,18,19,20,3,4,27,27];
k=AI.decideKong(r,1,r.selfActions(1));
ok(k&&k.type==='jiagang','碰過紅中、第 4 張紅中用不到 → 加槓');
r=mk(); r.seats[1].melds=[{type:'pong',tiles:[3,3,3]}];r.seats[1].hand=[3,4,5,9,10,11,18,19,20,27,27,30,31,33];
k=AI.decideKong(r,1,r.selfActions(1));
ok(!k,'碰過四萬、第 4 張四萬可配五六萬 → 不加槓');
// 6. 電腦對戰統計：明槓次數、門清胡牌
let ming=0,an=0,jia=0,hands=0,wins=0,menqing=0;
const SIM=Number(process.env.SIM_GAMES||150);
for(let g=0;g<SIM;g++){
  const r=new Room('y');for(let i=0;i<4;i++)r.seats[i]={name:'b'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=g%4;r.startHand();r.dealHand();r.finishSwap();
  let guard=0;
  while(r.phase!=='over'&&guard++<400){
    if(r.phase==='discard') r.botTurn(r.turn);
    else if(r.phase==='claim'){for(const kk of Object.keys(r.claims||{})){const i=+kk;if(r.phase!=='claim'||!r.claims||!r.claims[i]||r.claims[i].resp)continue;r.botClaim(i);}}
    else break;
  }
  clearTimeout(r.timer);hands++;
  for(const s of r.seats)for(const m of s.melds){if(m.type==='angang')an++;else if(m.type==='kong'&&m.from!==undefined&&m.tiles.length===4&&!m.wasPong)ming++;}
  if(r.result&&!r.result.draw){wins++;if(r.result.items.some(x=>x.name==='門清'))menqing++;}
}
console.log(`     ${SIM} 局電腦對戰：胡 ${wins} 局，其中門清 ${menqing} 局；暗槓 ${an} 次、明槓/加槓 ${ming} 次`);
finish();

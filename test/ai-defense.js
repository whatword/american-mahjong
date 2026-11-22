'use strict';
// 電腦防守 (安全牌)
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
const AI=require('../ai.js');

function mk(){const r=new Room('x');for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:true,hand:[],melds:[],flowers:[],discards:[]};
  r.state='playing';r.dealer=0;r.startHand();r.dealHand();r.finishSwap();clearTimeout(r.timer);
  for(const s of r.seats){s.melds=[];s.discards=[];s.migi=false;}r.discardLog=[];return r;}
// 自己離聽牌很遠的手牌：5萬 是進攻上最該打的孤張中張；9條 是對手 MIGI 的現物
const far=[4, 0,0, 9,11, 13,15, 19,21, 27,28,29,30,31,32, 26, 33];
let r=mk(); r.seats[1].hand=far.slice(); r.turn=1;
const atk=AI.chooseDiscard(r,1);
ok(!atk.defending,'無威脅時正常進攻，打 '+atk.tile);
r=mk(); r.seats[1].hand=far.slice(); r.turn=1;
r.seats[2].migi=true; r.seats[2].discards=[26]; r.discardLog=[{seat:2,tile:26}];
const d1=AI.chooseDiscard(r,1);
ok(d1.defending && d1.tile===26,'對家 MIGI：離聽牌遠 → 改打對家現物 9條，實際打 '+d1.tile);
// 剛被放過的牌：p2 打牌後，p3 打出 5萬 p2 沒胡 → 5萬 對 p2 安全
r=mk(); r.seats[1].hand=far.slice(); r.seats[2].migi=true;
r.seats[2].discards=[18]; r.seats[3].discards=[4];
r.discardLog=[{seat:2,tile:18},{seat:3,tile:4}];
ok(AI.passedBy(r,2).has(4),'p2 放過的牌被記錄');
const d2=AI.chooseDiscard(r,1);
ok(d2.danger<0.1,'打出 p2 剛放過的牌，危險度 '+d2.danger.toFixed(2)+' 打 '+d2.tile);
// 已聽牌時不棄胡
r=mk(); r.seats[1].hand=[0,1,2,3,4,5,9,10,11,18,19,20,27,27,27,28,31]; r.seats[2].migi=true;
const d3=AI.chooseDiscard(r,1);
ok(d3.sh===0,'自己已聽牌：仍維持聽牌 (打 '+d3.tile+')');
// 字牌：看不到的張數少 → 安全
r=mk();ok(AI.dangerFor(r,2,31,[...Array(34)].map((_,k)=>k===31?0:4))===0,'字牌全部現身 → 危險度 0');
// 威脅度
r=mk(); r.seats[3].melds=[{type:'pong',tiles:[1,1,1]},{type:'chi',tiles:[3,4,5]},{type:'pong',tiles:[7,7,7]}];
ok(AI.threatOf(r,1,3)>=0.7,'3 組副露 → 高威脅 '+AI.threatOf(r,1,3));
ok(AI.dangerFor(r,3,20,new Array(34).fill(4))<AI.dangerFor(r,3,2,new Array(34).fill(4)),'對手副露全萬子 → 萬子危險、條子安全');
finish();

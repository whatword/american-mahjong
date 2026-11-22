'use strict';
// 隨機對局：每次能胡都要胡得成
const { ok, finish } = require('./helpers');
const {Room}=require('../server.js');
let tries=0,fails=0,good=0;
const N=Number(process.env.FUZZ_GAMES||300);
for(let g=0;g<N;g++){
  const r=new Room('x');
  for(let i=0;i<4;i++)r.seats[i]={name:'p'+i,bot:false,ws:null,hand:[],melds:[],flowers:[],discards:[],drawn:null,noPong:new Set()};
  r.state='playing';r.startHand();r.dealHand();r.finishSwap();
  let guard=0;
  while(r.phase!=='over'&&guard++<500){
    if(r.phase==='discard'){
      const i=r.turn;const a=r.selfActions(i);
      if(a.hu){tries++;r.handle(i,{type:'hu'});if(r.phase!=='over'){fails++;console.log('selfdraw fail',JSON.stringify(r.seats[i].hand),JSON.stringify(r.seats[i].melds),r.seats[i].drawn);}else good++;continue;}
      r.botTurn(i);
    } else if(r.phase==='claim'){
      const ks=Object.keys(r.claims).map(Number);
      const huer=ks.find(k=>r.claims[k].opts.hu);
      if(huer!==undefined){tries++;r.handle(huer,{type:'hu'});
        if(r.phase!=='over'){ // other players still pending?
          for(const k of ks) if(!r.claims||!r.claims[k]) break; else if(!r.claims[k].resp) r.respond(k,{type:'pass'});
          if(r.phase!=='over'){fails++;console.log('ron fail',JSON.stringify(r.seats[huer].hand),JSON.stringify(r.seats[huer].melds),r.last&&r.last.tile);}else good++;
        } else good++;
        continue;}
      for(const k of ks) if(r.claims&&r.claims[k]&&!r.claims[k].resp){ const o=r.claims[k].opts; r.respond(k, o.pong&&Math.random()<.5?{type:'pong'}:o.chi.length&&Math.random()<.5?{type:'chi',tiles:o.chi[0]}:{type:'pass'}); }
    } else break;
  }
  clearTimeout(r.timer);
}
ok(fails===0&&tries>0,`${N} 局隨機對局：能胡 ${tries} 次，胡成功 ${good} 次，失敗 ${fails} 次`);
finish();

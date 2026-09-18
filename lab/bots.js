// Kaputt! bot module registry. Bots receive only public match state + the revealed first die.
window.KaputtBots=(()=>{
  const bots={};
  const add=(id,label,choose)=>bots[id]={id,label,choose};
  add('random','Random',ctx=>({choice:Math.random()<.5?'attack':'defense',why:'Random 50/50.'}));
  add('aggressive','Aggressive',({A})=>({choice:A.success>=1/6?'attack':'defense',why:'Aggressive: attacks whenever success is possible.'}));
  add('safe','Safe',({A,D})=>({choice:(A.kaputt<=1/6&&A.points>D.points)?'attack':'defense',why:'Safe: low Kaputt risk + better immediate EV.'}));
  add('ev','EV Score',({A,D})=>({choice:A.points>D.points?'attack':'defense',why:'EV Score: higher expected immediate points.'}));
  add('state','State-aware',({A,D,p,opp,target,lim,n})=>{const urgency=(p.score<opp.score?2:0)+(opp.score>=target*.8?2:0),danger=p.k>=lim-1?5:0,ua=A.points-A.kaputt*(8+danger)+A.success*urgency,ud=D.points+(D.next<n?1.5:0);return{choice:ua>ud?'attack':'defense',why:'State-aware: score gap, match pressure, Kaputt danger and NtB de-escalation.'}});
  add('strategist','Strategist',ctx=>{const {a,n,A,p,opp,target,lim,resolve}=ctx,self=1,enemy=0;
    const terminal=(sc,ks)=>sc[self]>=target||ks[enemy]>=lim?1:(sc[enemy]>=target||ks[self]>=lim?0:null);
    const pressureWinProb=(enemyScore,nextNtb)=>{let wins=0;for(let v=1;v<=6;v++)for(let h=1;h<=6;h++){const r=resolve('attack',v,h,nextNtb);if(r.ok&&enemyScore+r.points>=target)wins++}return wins/36};
    const evalAction=action=>{let total=0;for(let h=1;h<=6;h++){const r=resolve(action,a,h,n),sc=[opp.score,p.score],ks=[opp.k,p.k];sc[self]+=r.points;if(r.kaputt)ks[self]++;const t=terminal(sc,ks);if(t!==null){total+=t;continue}const myNeed=Math.max(0,target-sc[self]),theirNeed=Math.max(0,target-sc[enemy]),myLives=lim-ks[self],theirLives=lim-ks[enemy],oppClose=theirNeed<=12,meClose=myNeed<=12,giveaway=pressureWinProb(sc[enemy],r.next);let u=.5+(sc[self]-sc[enemy])/(target*3)+(myLives-theirLives)*.055+(meClose?.08:0)-(oppClose?.10:0)-giveaway*(oppClose?.42:.18)+Math.min(r.next,36)/36*(oppClose?.10:.035);if(r.kaputt)u-=myLives<=1?.9:(oppClose?.025:.07);total+=Math.max(0,Math.min(1,u))}return total/6};
    const ua=evalAction('attack'),ud=evalAction('defense'),choice=ua>ud?'attack':'defense',hold=choice==='attack'&&A.success===0;
    return{choice,why:'Strategist: '+(hold?'spends a Kaputt to hold NtB pressure':'match-state win utility')+' · A '+ua.toFixed(2)+' vs D '+ud.toFixed(2)+'.'}});
  return{get:id=>bots[id],list:()=>Object.values(bots)};
})();
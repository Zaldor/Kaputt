const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const id=()=>crypto.randomUUID();

async function saveMatch(env, body){
  const m=body.match||body, mid=m.id||id(), exp=m.experimentId||null, turns=m.history||m.turnsData||[];
  await env.DB.prepare(`INSERT INTO matches
    (id,experiment_id,source,ruleset,target,kaputt_limit,starting_ntb,player_a,player_b,winner,terminal_cause,turns,score_a,score_b,kaputt_a,kaputt_b,lead_changes,payload_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .bind(mid,exp,m.source||"human",m.ruleset||"K3-E1",m.target||100,m.kaputtLimit||5,m.startingNtb??1,
      m.playerA||"P1",m.playerB||"P2",m.winner||null,m.terminalCause||null,turns.length,
      m.scoreA??m.players?.[0]?.score??0,m.scoreB??m.players?.[1]?.score??0,
      m.kaputtA??m.players?.[0]?.k??0,m.kaputtB??m.players?.[1]?.k??0,m.leadChanges||0,JSON.stringify(m)).run();
  const stmt=env.DB.prepare(`INSERT OR REPLACE INTO turns
    (match_id,turn_no,actor,score_self_before,score_opp_before,kaputt_self_before,kaputt_opp_before,ntb_before,visible_die,hidden_die,choice,points,kaputt,ntb_after,extreme,decision_ms,strategic_hold,bot_reason)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  if(turns.length) await env.DB.batch(turns.map((t,i)=>stmt.bind(mid,t.turn||i+1,t.actor||t.player||"?",
    t.scoreSelfBefore??null,t.scoreOpponentBefore??null,t.kaputtSelfBefore??null,t.kaputtOpponentBefore??null,
    t.ntbBefore??t.ntb??1,t.visibleDie??t.a??0,t.hiddenDie??t.b??0,t.choice||"?",
    t.points||0,t.kaputt?1:0,t.ntbAfter??t.nextNtb??t.ntb??1,t.extreme?1:0,t.decisionMs??null,
    t.strategicHold?1:0,t.botReason||t.why||null)));
  return mid;
}

export default {
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/api/health") return json({ok:true,service:"kaputt-lab",db:true});
    if(u.pathname==="/api/matches"&&request.method==="POST"){
      try{return json({ok:true,id:await saveMatch(env,await request.json())},201)}catch(e){return json({ok:false,error:String(e)},400)}
    }
    if(u.pathname==="/api/experiments"&&request.method==="POST"){
      const b=await request.json(),eid=b.id||id();
      await env.DB.prepare(`INSERT INTO experiments(id,kind,ruleset,target,kaputt_limit,starting_ntb,player_a,player_b,game_count,seed,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
        .bind(eid,b.kind||"batch",b.ruleset||"K3-E1",b.target||100,b.kaputtLimit||5,b.startingNtb??1,b.playerA||null,b.playerB||null,b.gameCount||1,b.seed||null,JSON.stringify(b.metadata||{})).run();
      return json({ok:true,id:eid},201);
    }
    if(u.pathname==="/api/stats"){
      const [m,t,h]=await Promise.all([
        env.DB.prepare("SELECT COUNT(*) matches, AVG(turns) avg_turns, AVG(score_a+score_b) avg_total_score FROM matches").first(),
        env.DB.prepare("SELECT choice, COUNT(*) n, AVG(kaputt) kaputt_rate, AVG(ntb_after-ntb_before) avg_ntb_delta FROM turns GROUP BY choice").all(),
        env.DB.prepare("SELECT ntb_before, COUNT(*) decisions, AVG(choice='attack') attack_rate, AVG(strategic_hold) hold_rate FROM turns GROUP BY ntb_before ORDER BY ntb_before").all()
      ]);
      return json({matches:m,choices:t.results,byNtb:h.results});
    }
    if(u.pathname==="/api/llm-proxy"&&request.method==="POST"){
      try{
        const b=await request.json();
        if(!b.url||!b.body) return json({ok:false,error:"missing url or body"},400);
        const allowed=["api.anthropic.com","generativelanguage.googleapis.com"];
        const host=new URL(b.url).hostname;
        if(!allowed.some(h=>host.endsWith(h))) return json({ok:false,error:"provider not allowed"},403);
        const resp=await fetch(b.url,{method:"POST",headers:b.headers||{"Content-Type":"application/json"},body:JSON.stringify(b.body)});
        const data=await resp.json();
        return json(data,resp.status);
      }catch(e){return json({ok:false,error:String(e)},500)}
    }
    return env.ASSETS.fetch(request);
  }
};

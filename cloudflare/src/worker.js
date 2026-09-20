const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"content-type":"application/json","cache-control":"no-store"}});
const id=()=>crypto.randomUUID();
const roomCode=()=>{const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';let r='';for(let i=0;i<4;i++)r+=c[Math.floor(Math.random()*c.length)];return r};

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
  if(m.winner) await updatePlayerStats(env,m).catch(()=>{});
  return mid;
}

async function updatePlayerStats(env, m){
  const players=[m.playerA||'P1',m.playerB||'P2'];
  const scores=[m.scoreA??m.players?.[0]?.score??0,m.scoreB??m.players?.[1]?.score??0];
  const winIdx=m.winner==='P1'?0:m.winner==='P2'?1:m.winner===0?0:m.winner===1?1:-1;
  for(let i=0;i<2;i++){
    const name=players[i],won=winIdx===i,lost=winIdx>=0&&winIdx!==i;
    await env.DB.prepare(`INSERT INTO players(name,wins,losses,total_points,total_turns,best_score,matches_played,last_played)
      VALUES(?,0,0,0,0,0,0,CURRENT_TIMESTAMP)
      ON CONFLICT(name) DO UPDATE SET wins=wins+?,losses=losses+?,total_points=total_points+?,
        total_turns=total_turns+?,best_score=MAX(best_score,?),matches_played=matches_played+1,
        last_played=CURRENT_TIMESTAMP`)
      .bind(name,won?1:0,lost?1:0,scores[i],m.turns||0,scores[i]).run();
  }
}

async function createRoom(env, body){
  const code=roomCode();
  await env.DB.prepare(`INSERT INTO rooms(code,host_name,target,kaputt_limit,starting_ntb,status)
    VALUES(?,?,?,?,?,?)`)
    .bind(code,body.hostName||'Host',body.target||100,body.kaputtLimit||5,body.startingNtb??1,'waiting').run();
  return{code,status:'waiting'};
}

async function getRoom(env,code){
  return await env.DB.prepare(`SELECT * FROM rooms WHERE code=?`).bind(code).first();
}

async function joinRoom(env,code,guestName){
  const room=await getRoom(env,code);
  if(!room)return{error:'Room not found'};
  if(room.status!=='waiting')return{error:'Room not accepting players'};
  if(room.guest_name)return{error:'Room full'};
  const first=Math.random()<0.5?0:1;
  const state={
    phase:'playing',currentPlayer:first,turn:0,
    ntb:room.starting_ntb,target:room.target,kaputtLimit:room.kaputt_limit,
    dice:[0,0],choice:null,visibleDie:null,
    players:[{name:room.host_name,score:0,kaputt:0},{name:guestName,score:0,kaputt:0}],
    lastResult:null,extremes:0,leadChanges:0,lastLeader:-1,
    history:[]
  };
  await env.DB.prepare(`UPDATE rooms SET guest_name=?,status='playing',current_state_json=?,last_updated=CURRENT_TIMESTAMP WHERE code=?`)
    .bind(guestName,JSON.stringify(state),code).run();
  return{ok:true,room:{...room,guest_name:guestName,status:'playing',current_state_json:JSON.stringify(state)},playerIndex:1,firstPlayer:first};
}

async function submitAction(env,code,body){
  const room=await getRoom(env,code);
  if(!room)return{error:'Room not found'};
  if(room.status!=='playing')return{error:'Match not active'};
  const state=JSON.parse(room.current_state_json||'{}');
  if(state.phase==='finished')return{error:'Match finished'};
  if(state.currentPlayer!==body.playerIndex)return{error:'Not your turn'};
  if(!['attack','defense'].includes(body.action))return{error:'Invalid action'};
  const {visibleDie,hiddenDie}=body;
  if(visibleDie<1||visibleDie>6||hiddenDie<1||hiddenDie>6)return{error:'Invalid dice'};
  const extreme=(visibleDie===1&&hiddenDie===6)||(visibleDie===6&&hiddenDie===1);
  let value,points,kaputt=false,nextNtb;
  if(body.action==='attack'){
    value=extreme?36:visibleDie*hiddenDie;
    const success=value>state.ntb;
    points=success?value:0; kaputt=!success; nextNtb=success?value:state.ntb;
  }else{
    value=extreme?2:visibleDie+hiddenDie;
    points=extreme?1:Math.max(visibleDie,hiddenDie);
    nextNtb=value;
  }
  const player=state.players[body.playerIndex];
  const opponent=state.players[1-body.playerIndex];
  const pre={score:[player.score,opponent.score],kaputt:[player.kaputt,opponent.kaputt]};
  player.score+=points;
  if(kaputt){player.kaputt++}
  state.ntb=nextNtb; state.extremes=(state.extremes||0)+(extreme?1:0);
  let leader=player.score===opponent.score?-1:(player.score>opponent.score?body.playerIndex:1-body.playerIndex);
  if(state.lastLeader>=0&&leader>=0&&leader!==state.lastLeader)state.leadChanges=(state.leadChanges||0)+1;
  if(leader>=0)state.lastLeader=leader;
  let terminal=false,winner=null,winReason=null;
  if(player.score>=state.target){terminal=true;winner=body.playerIndex;winReason='score target'}
  else if(player.kaputt>=state.kaputtLimit){terminal=true;winner=1-body.playerIndex;winReason='opponent reached Kaputt limit'}
  const turnEvent={turn:state.turn+1,player:body.playerIndex,visibleDie,hiddenDie,action:body.action,value,points,kaputt,extreme,nextNtb,ntbBefore:state.ntb,scoreBefore:pre.score,kaputtBefore:pre.kaputt};
  state.history.push(turnEvent);
  state.lastResult={...turnEvent,terminal,winner,winReason,players:state.players.map(p=>({name:p.name,score:p.score,kaputt:p.kaputt}))};
  state.currentPlayer=1-body.playerIndex;
  state.turn++;
  state.phase=terminal?'finished':'playing';
  if(terminal)state.winner=winner;
  const newStatus=terminal?'finished':'playing';
  await env.DB.prepare(`UPDATE rooms SET current_state_json=?,status=?,last_updated=CURRENT_TIMESTAMP WHERE code=?`)
    .bind(JSON.stringify(state),newStatus,code).run();
  if(terminal)await updatePlayerStats(env,{playerA:state.players[0].name,playerB:state.players[1].name,
    winner:winner===0?'P1':'P2',scoreA:state.players[0].score,scoreB:state.players[1].score,turns:state.turn}).catch(()=>{});
  return{ok:true,state};
}

async function getLeaderboard(env,limit=25){
  const rows=await env.DB.prepare(`SELECT name,wins,losses,matches_played,total_points,best_score,
    CASE WHEN matches_played>0 THEN ROUND(100.0*wins/matches_played,1) ELSE 0 END as win_rate
    FROM players WHERE matches_played>0 ORDER BY wins DESC LIMIT ?`).bind(limit).all();
  return rows.results||[];
}

async function finishRoom(env,code,matchId){
  await env.DB.prepare(`UPDATE rooms SET match_id=?,status='finished',last_updated=CURRENT_TIMESTAMP WHERE code=?`).bind(matchId,code).run();
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
        if(!b.url) return json({ok:false,error:"missing url"},400);
        const allowed=["api.anthropic.com","generativelanguage.googleapis.com"];
        const host=new URL(b.url).hostname;
        if(!allowed.some(h=>host.endsWith(h))) return json({ok:false,error:"provider not allowed"},403);
        const method=b.body?"POST":"GET";
        const opts={method,headers:b.headers||{}};
        if(b.body) opts.body=JSON.stringify(b.body);
        const resp=await fetch(b.url,opts);
        const data=await resp.json();
        return json(data,resp.status);
      }catch(e){return json({ok:false,error:String(e)},500)}
    }
    if(u.pathname==="/api/rooms"&&request.method==="POST"){
      try{return json({ok:true,...await createRoom(env,await request.json())},201)}catch(e){return json({ok:false,error:String(e)},400)}
    }
    const roomMatch=u.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})$/);
    if(roomMatch){
      if(request.method==="GET"){
        const room=await getRoom(env,roomMatch[1]);
        return room?json({ok:true,room}):json({ok:false,error:"Room not found"},404);
      }
    }
    const joinMatch=u.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})\/join$/);
    if(joinMatch&&request.method==="POST"){
      try{const b=await request.json();const r=await joinRoom(env,joinMatch[1],b.guestName||'Guest');return r.error?json({ok:false,error:r.error},400):json(r)}catch(e){return json({ok:false,error:String(e)},400)}
    }
    const actionMatch=u.pathname.match(/^\/api\/rooms\/([A-Z0-9]{4})\/action$/);
    if(actionMatch&&request.method==="POST"){
      try{const r=await submitAction(env,actionMatch[1],await request.json());return r.error?json({ok:false,error:r.error},400):json({ok:true,...r})}catch(e){return json({ok:false,error:String(e)},400)}
    }
    if(u.pathname==="/api/leaderboard"){
      try{const limit=+(u.searchParams.get('limit')||25);return json({ok:true,players:await getLeaderboard(env,Math.min(limit,100))})}catch(e){return json({ok:false,error:String(e)},500)}
    }
    return env.ASSETS.fetch(request);
  }
};

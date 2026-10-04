import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from '../scripts/local-runtime.mjs';
import engine from '../lab/engine.js';
let mf,db;
before(async()=>({mf,db}=await createLocalRuntime()));
after(async()=>{await mf?.dispose();});
const credential=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function api(path,body,token,headers={}) {
  const r=await mf.dispatchFetch('http://game.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,...await r.json()};
}
async function signin(email) {
  const request=await mf.dispatchFetch('http://game.test/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});
  assert.equal(request.status,200);
  const {debugToken}=await request.json();
  const verified=await mf.dispatchFetch('http://game.test/api/auth/verify?token='+debugToken,{redirect:'manual'});
  assert.equal(verified.status,302);
  const session=(verified.headers.get('set-cookie')||'').match(/kaputt_session=([0-9a-f]{64})/);
  assert.ok(session);
  const cookie=`kaputt_session=${session[1]}`;
  const me=await api('/api/me',null,null,{Cookie:cookie});
  assert.equal(me.status,200);
  return {cookie,user:me.user};
}
async function pair(options={}) {
  const tokens=[credential(),credential()];
  const a=await api('/api/rooms',{hostName:'Host '+tokens[0].slice(0,5),sessionToken:tokens[0],...options});assert.equal(a.status,201);
  const key=a.room.code;
  const b=await api(`/api/rooms/${key}/join`,{guestName:'Guest '+tokens[1].slice(0,5),sessionToken:tokens[1]});assert.equal(b.status,200);
  return {key,tokens,room:b.room};
}
const poll=(p,i=0)=>api(`/api/rooms/${p.key}`,null,p.tokens[i]);
async function act(p,action,extra={}) {
  const {room}=await poll(p); const i=room.state?.currentPlayer??0;
  return api(`/api/rooms/${p.key}/action`,{action,version:room.version,requestId:crypto.randomUUID(),...extra},p.tokens[i]);
}
test('health checks the database and advertises the current protocol',async()=>{
  const r=await api('/api/health');assert.equal(r.remoteProtocol,2);assert.equal(r.db,true);
});
test('seat credentials, input validation, and a single concurrent guest claim',async()=>{
  const t=credential(),create={hostName:'Concurrent host',sessionToken:t};
  const a=await api('/api/rooms',create),again=await api('/api/rooms',create);
  assert.equal(a.room.code,again.room.code);
  const key=a.room.code;
  const joins=await Promise.all(['One','Two'].map(guestName=>api(`/api/rooms/${key}/join`,{guestName,sessionToken:credential()})));
  assert.deepEqual(joins.map(j=>j.status).sort(),[200,409]);
  assert.equal((await api(`/api/rooms/${key}`,null,credential())).status,403);
  assert.equal((await api(`/api/rooms/${key}/join`,{guestName:'Concurrent host',sessionToken:credential()})).status,409);
  assert.equal((await api('/api/rooms',{...create,sessionToken:credential(),target:-1})).status,400);
});
test('server owns the roll, locks selection/choice, and conceals dice in all public responses',async()=>{
  const p=await pair();
  let r=await act(p,'roll');assert.equal(r.status,200);assert.deepEqual(r.room.state.values,[null,null]);assert.equal('dice' in r.room.state,false);
  const actor=r.room.state.currentPlayer;
  assert.equal((await api(`/api/rooms/${p.key}/action`,{action:'reveal',dieIndex:1,version:r.room.version,requestId:crypto.randomUUID()},p.tokens[1-actor])).status,403);
  r=await act(p,'reveal',{dieIndex:1});assert.equal(r.status,200);assert.equal(r.room.state.values[0],null);assert.ok(r.room.state.values[1]>=1);
  assert.equal((await act(p,'reveal',{dieIndex:0})).status,409);
  assert.equal((await act(p,'resolve')).status,409);
  assert.equal((await act(p,'choose',{choice:'attack',hiddenDie:6})).status,400);
  r=await act(p,'choose',{choice:'defense'});assert.equal(r.room.state.values[0],null);
  assert.equal((await act(p,'choose',{choice:'attack'})).status,409);
  const ntb=r.room.state.ntb;
  r=await act(p,'resolve'); const event=r.room.state.lastResult;
  assert.equal(event.firstDieIndex,1);assert.equal(event.visibleDie,r.room.state.values[1]);assert.equal(event.ntbBefore,ntb);
  assert.equal(event.points,engine.resolve('defense',...r.room.state.values,ntb).points);
  assert.equal(event.ntbAfter,r.room.state.ntb);assert.equal(r.room.state.currentPlayer,1-actor);
});
test('retry receipts and version guards prevent double scoring and stale actions',async()=>{
  const p=await pair();await act(p,'roll');await act(p,'reveal',{dieIndex:0});await act(p,'choose',{choice:'defense'});
  const {room}=await poll(p),body={action:'resolve',version:room.version,requestId:crypto.randomUUID()},token=p.tokens[room.state.currentPlayer];
  const results=await Promise.all([api(`/api/rooms/${p.key}/action`,body,token),api(`/api/rooms/${p.key}/action`,body,token)]);
  assert.ok(results.every(r=>r.status===200));
  const latest=await poll(p);assert.equal(latest.room.state.turn,1);assert.equal(latest.room.state.history.length,1);
  assert.equal((await api(`/api/rooms/${p.key}/action`,{...body,requestId:crypto.randomUUID()},token)).status,409);
  assert.equal((await api(`/api/rooms/${p.key}/action`,{...body,action:'roll'},token)).status,409);
});
test('finished remote match and turns persist atomically; rematch needs both players',async()=>{
  const p=await pair({target:1});await act(p,'roll');await act(p,'reveal',{dieIndex:1});await act(p,'choose',{choice:'defense'});
  const end=await act(p,'resolve');assert.equal(end.room.status,'finished');
  const matchId=end.room.state.matchId;
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM matches WHERE id=?').bind(matchId).first()).n,1);
  const turn=await db.prepare('SELECT * FROM turns WHERE match_id=?').bind(matchId).first();
  assert.equal(turn.choice,'defense');assert.equal(turn.ntb_before,1);assert.equal(turn.actor,`P${end.room.state.lastResult.player+1}`);
  const standings=await api('/api/leaderboard');
  const winner=standings.players.find(x=>x.name===end.room.state.players[end.room.state.winner].name);
  assert.equal(winner.wins,1);assert.equal(winner.matches_played,1);
  let room=end.room;
  for(const i of [0,1]) {
    const r=await api(`/api/rooms/${p.key}/action`,{action:'rematch',requestId:crypto.randomUUID(),version:room.version},p.tokens[i]);
    assert.equal(r.status,200);room=r.room;
    assert.equal(room.status,i===0?'finished':'playing');
  }
  assert.equal(room.state.turn,0);assert.notEqual(room.state.matchId,matchId);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM matches WHERE id=?').bind(matchId).first()).n,1);
});
test('failed final write rolls back the room and can be retried without losing the turn',async()=>{
  const p=await pair({target:1});await act(p,'roll');await act(p,'reveal',{dieIndex:0});await act(p,'choose',{choice:'defense'});
  await db.exec("CREATE TRIGGER fail_save BEFORE INSERT ON turns BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const {room}=await poll(p),body={action:'resolve',version:room.version,requestId:crypto.randomUUID()},token=p.tokens[room.state.currentPlayer];
  assert.equal((await api(`/api/rooms/${p.key}/action`,body,token)).status,503);
  const failed=await poll(p);assert.equal(failed.room.version,room.version);assert.equal(failed.room.state.phase,'chosen');
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM matches WHERE id=?').bind(room.state.matchId).first()).n,0);
  await db.exec('DROP TRIGGER fail_save;');
  assert.equal((await api(`/api/rooms/${p.key}/action`,body,token)).status,200);
});
test('match upload retry preserves numeric winner zero and does not award twice',async()=>{
  const {cookie}=await signin('retry@kaputt.test');
  const id=crypto.randomUUID(),m={id,playerA:'Numeric winner',playerB:'Numeric loser',winner:0,target:6,scoreA:6,scoreB:0,
    history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]};
  assert.equal((await api('/api/matches',m,null,{Cookie:cookie})).status,201);assert.equal((await api('/api/matches',m,null,{Cookie:cookie})).status,201);
  const winner=(await api('/api/leaderboard')).players.find(p=>p.name==='Numeric winner');assert.equal(winner.wins,1);
  assert.equal((await api('/api/matches',{...m,scoreA:20},null,{Cookie:cookie})).status,409);
});
test('concurrent match ID collision cannot mix histories',async()=>{
  const {cookie}=await signin('collision@kaputt.test');
  const id=crypto.randomUUID(),base={id,playerA:'Collision A',playerB:'Collision B',winner:'P1',target:6,scoreA:6,scoreB:0};
  const one={...base,history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]};
  const two={...base,scoreA:12,history:[{turn:2,player:0,visibleDie:3,hiddenDie:4,choice:'attack',points:12,ntbBefore:1,ntbAfter:12}]};
  const results=await Promise.all([api('/api/matches',one,null,{Cookie:cookie}),api('/api/matches',two,null,{Cookie:cookie})]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const saved=await db.prepare('SELECT payload_json FROM matches WHERE id=?').bind(id).first();
  const turns=await db.prepare('SELECT turn_no FROM turns WHERE match_id=?').bind(id).all();
  assert.deepEqual(turns.results.map(t=>t.turn_no),[JSON.parse(saved.payload_json).history[0].turn]);
});
test('legacy room history remains exportable without exposing new room sessions',async()=>{
  const state={phase:'finished',players:[{name:'Old A',score:100},{name:'Old B',score:42}],winner:0,turn:12,history:[{choice:'attack',points:36}]};
  await db.prepare("INSERT INTO rooms(code,host_name,guest_name,status,current_state_json) VALUES('OLD1','Old A','Old B','finished',?)").bind(JSON.stringify(state)).run();
  const archive=await api('/api/rooms/OLD1/archive');assert.deepEqual(archive.archive.state,state);
  assert.equal((await api('/api/rooms/OLD1')).status,426);
  const standings=await api('/api/leaderboard');assert.equal(standings.players.find(p=>p.name==='Old A').wins,1);
  const p=await pair();assert.equal((await api(`/api/rooms/${p.key}/archive`)).status,403);
  const original=await db.prepare("SELECT current_state_json FROM rooms WHERE code='OLD1'").first();assert.equal(original.current_state_json,JSON.stringify(state));
});
test('leaving ends the room and cannot resurrect a finished match by rematching',async()=>{
  const p=await pair({target:1});await act(p,'roll');await act(p,'reveal',{dieIndex:0});await act(p,'choose',{choice:'defense'});const end=await act(p,'resolve');
  const left=await act(p,'leave');assert.equal(left.room.status,'closed');assert.equal(left.room.state.history.length,1);
  assert.equal((await act(p,'rematch')).status,409);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM matches WHERE id=?').bind(end.room.state.matchId).first()).n,1);
});
test('unchanged polls return presence without resending the whole match history',async()=>{
  const p=await pair(),r=await poll(p);
  const unchanged=await api(`/api/rooms/${p.key}?since=${r.room.version}`,null,p.tokens[0]);
  assert.equal(unchanged.status,200);assert.equal('state' in unchanged.room,false);assert.equal(unchanged.room.presence.length,2);
  await act(p,'roll');const next=await api(`/api/rooms/${p.key}?since=${r.room.version}`,null,p.tokens[0]);assert.equal(next.room.state.phase,'rolled');
});
test('simultaneous rematch requests from both players merge safely',async()=>{
  const p=await pair({target:1});await act(p,'roll');await act(p,'reveal',{dieIndex:0});await act(p,'choose',{choice:'defense'});const {room}=await act(p,'resolve');
  const results=await Promise.all(p.tokens.map(token=>api(`/api/rooms/${p.key}/action`,{action:'rematch',matchId:room.state.matchId,version:room.version,requestId:crypto.randomUUID()},token)));
  assert.ok(results.every(r=>r.status===200));const latest=await poll(p);assert.equal(latest.room.status,'playing');assert.notEqual(latest.room.state.matchId,room.state.matchId);
});
test('period standings, per-player identity, and badges preserve the newest features',async()=>{
  const older=await signin('period-old@kaputt.test'),fresher=await signin('period-new@kaputt.test');
  const make=(other)=>({id:crypto.randomUUID(),playerA:'Same name',playerB:other,playerAId:'client-spoofed-identity',winner:'P1',target:6,scoreA:6,scoreB:0,
    history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]});
  const old=make('Old loser');await api('/api/matches',old,null,{Cookie:older.cookie});
  await db.prepare("UPDATE matches SET created_at='2020-01-01 00:00:00' WHERE id=?").bind(old.id).run();
  const fresh=make('New loser');await api('/api/matches',fresh,null,{Cookie:fresher.cookie});
  const all=await api('/api/leaderboard?limit=100');assert.equal(all.players.filter(p=>p.name==='Same name').length,2);
  assert.ok(!all.players.some(p=>p.identity==='client-spoofed-identity'),'client playerAId never becomes an identity');
  for(const period of ['today','week','month']){const r=await api('/api/leaderboard?limit=100&period='+period);assert.equal(r.players.filter(p=>p.name==='Same name').length,1);assert.equal(r.players.find(p=>p.name==='Same name').identity,fresher.user.id);}
  assert.equal((await api('/api/leaderboard?period=invalid')).status,400);
  const r=await api('/api/badges');assert.equal(r.status,200);assert.ok(r.badges.some(b=>b.id==='berserker'));assert.ok(r.badges.every(b=>!['P1','P2'].includes(b.player)));
});
test('rematch re-randomizes the starting player',async()=>{
  const p=await pair({target:1});
  const seen=new Set();
  for(let n=0;n<20;n++){
    await act(p,'roll');await act(p,'reveal',{dieIndex:0});await act(p,'choose',{choice:'defense'});
    const {room:end}=await act(p,'resolve');assert.equal(end.status,'finished');
    const before=end.state.matchId;
    let room=end;
    for(const i of [0,1]){
      const r=await api(`/api/rooms/${p.key}/action`,{action:'rematch',requestId:crypto.randomUUID(),version:room.version},p.tokens[i]);
      assert.equal(r.status,200);room=r.room;
    }
    assert.equal(room.status,'playing');assert.equal(room.state.phase,'idle');assert.equal(room.state.turn,0);
    assert.notEqual(room.state.matchId,before);assert.ok(room.state.currentPlayer===0||room.state.currentPlayer===1);
    seen.add(room.state.currentPlayer);
  }
  assert.ok(seen.has(0)&&seen.has(1));
});
test('leaderboard rates Elo, hides bots (incl. legacy labels) unless showBots=1, and always excludes test matches',async()=>{
  const sessions={};
  for(const key of ['duel-a','human-bot','loses-bot','sac-one','sac-two','real-a','test-solo','legacy-a'])sessions[key]=await signin(`${key}@kaputt.test`);
  const mk=(aName,bName,bId,winner,extra={})=>({id:crypto.randomUUID(),playerA:aName,playerB:bName,playerAId:'client-spoofed-'+aName,playerBId:bId,winner,
    target:10,scoreA:winner==='P1'?10:0,scoreB:winner==='P1'?0:10,
    history:[{turn:1,player:winner==='P1'?0:1,visibleDie:2,hiddenDie:5,choice:'attack',points:10,ntbBefore:1,ntbAfter:10}],...extra});
  const post=async(session,...args)=>assert.equal((await api('/api/matches',mk(...args),null,{Cookie:session.cookie})).status,201);
  await post(sessions['duel-a'],'LB Duel A','LB Duel B','lb-duel-b','P1');
  await post(sessions['human-bot'],'LB Human Bot','LB Razz Bot','bot-lb-razz','P2');
  await post(sessions['loses-bot'],'LB Loses Bot','LB Dazz Bot','bot-lb-dazz','P2');
  await post(sessions['sac-one'],'LB Sac One','LB Vet Bot','bot-lb-vet','P2');
  await post(sessions['sac-two'],'LB Sac Two','LB Vet Bot','bot-lb-vet','P2');
  await post(sessions['real-a'],'LB Real A','LB Real B','lb-real-b','P1');
  await post(sessions['real-a'],'LB Real A','LB Test B','lb-test-b','P1',{source:'test'});
  await post(sessions['test-solo'],'LB Test Solo','LB Test Solo Two','lb-test-solo-2','P1',{source:'test'});
  await post(sessions['legacy-a'],'LB Legacy A','Grandmaster',undefined,'P1');
  const def=await api('/api/leaderboard?limit=100'),all=await api('/api/leaderboard?limit=100&showBots=1');
  const at=(list,id)=>list.players.find(p=>p.identity===id);
  const human=id=>at(def,sessions[id].user.id);
  assert.ok(def.players.every(p=>!p.identity.startsWith('bot-')));
  assert.equal(at(def,'bot-lb-razz'),undefined);
  for(const id of ['bot-lb-razz','bot-lb-dazz','bot-lb-vet']){
    const bot=at(all,id);assert.ok(bot,id);assert.ok(Number.isInteger(bot.rating));assert.ok(bot.rating>1200);
  }
  const duelA=human('duel-a'),duelB=at(def,'lb-duel-b');
  assert.equal(duelA.rating,1216);assert.equal(duelB.rating,1184);
  assert.equal(human('human-bot').rating,1184);
  assert.equal(human('loses-bot').rating,1184);
  assert.equal(human('sac-one').rating,1184);
  const real=human('real-a');
  assert.equal(real.name,'LB Real A');assert.equal(real.wins,1);assert.equal(real.losses,0);
  assert.equal(real.matches_played,1);assert.equal(real.rating,1216);assert.equal(real.best_score,10);assert.equal(real.win_rate,100);
  assert.ok(!def.players.some(p=>p.identity.startsWith('client-spoofed-')),'client playerAId never becomes an identity');
  for(const id of ['lb-test-b','lb-test-solo','lb-test-solo-2']){assert.equal(at(def,id),undefined);assert.equal(at(all,id),undefined);}
  assert.equal(at(def,sessions['test-solo'].user.id),undefined);assert.equal(at(all,sessions['test-solo'].user.id),undefined);
  assert.equal(at(def,'name:Grandmaster'),undefined);
  assert.equal(at(def,'bot-strategist3'),undefined);
  assert.equal(at(all,'name:Grandmaster'),undefined);
  const legacyBot=at(all,'bot-strategist3');
  assert.ok(legacyBot);assert.equal(legacyBot.name,'Grandmaster');
  assert.equal(legacyBot.rating,1184);assert.equal(legacyBot.wins,0);assert.equal(legacyBot.losses,1);
  assert.equal(human('legacy-a').rating,1216);
  for(const k of ['identity','name','wins','losses','matches_played','total_points','best_score','avg_turns','avg_score','win_rate','rating'])assert.ok(k in real,k);
  const badges=await api('/api/badges');assert.equal(badges.status,200);assert.ok(badges.badges.length>0);
  assert.ok(badges.badges.some(b=>b.id==='high_scorer'));
  assert.ok(badges.badges.every(b=>!b.identity.startsWith('bot-')));
  assert.ok(badges.badges.every(b=>!b.identity.startsWith('name:Grandmaster')));
  assert.ok(badges.badges.every(b=>!['LB Test Solo','LB Test Solo Two','LB Test B','Grandmaster'].includes(b.player)));
});

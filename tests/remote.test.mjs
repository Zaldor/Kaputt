import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from '../scripts/local-runtime.mjs';
import engine from '../lab/engine.js';
let mf,db;
before(async()=>({mf,db}=await createLocalRuntime()));
after(async()=>{await mf?.dispose();});
const credential=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
async function api(path,body,token) {
  const r=await mf.dispatchFetch('http://game.test'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:r.status,...await r.json()};
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
  const id=crypto.randomUUID(),m={id,playerA:'Numeric winner',playerB:'Numeric loser',winner:0,scoreA:10,scoreB:2,history:[]};
  assert.equal((await api('/api/matches',m)).status,201);assert.equal((await api('/api/matches',m)).status,201);
  const winner=(await api('/api/leaderboard')).players.find(p=>p.name==='Numeric winner');assert.equal(winner.wins,1);
  assert.equal((await api('/api/matches',{...m,scoreA:20})).status,409);
});
test('concurrent match ID collision cannot mix histories',async()=>{
  const id=crypto.randomUUID(),base={id,playerA:'Collision A',playerB:'Collision B',winner:'P1',scoreA:6,scoreB:0};
  const one={...base,history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]};
  const two={...base,scoreA:12,history:[{turn:2,player:0,visibleDie:3,hiddenDie:4,choice:'attack',points:12,ntbBefore:1,ntbAfter:12}]};
  const results=await Promise.all([api('/api/matches',one),api('/api/matches',two)]);assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
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
  const make=(id,name,other)=>({id:crypto.randomUUID(),playerA:name,playerB:other,playerAId:id,playerBId:'other-'+id,winner:'P1',scoreA:6,scoreB:0,history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]});
  const old=make('identity-old','Same name','Old loser');await api('/api/matches',old);
  await db.prepare("UPDATE matches SET created_at='2020-01-01 00:00:00' WHERE id=?").bind(old.id).run();
  const fresh=make('identity-new','Same name','New loser');await api('/api/matches',fresh);
  const all=await api('/api/leaderboard?limit=100');assert.equal(all.players.filter(p=>p.name==='Same name').length,2);
  for(const period of ['today','week','month']){const r=await api('/api/leaderboard?limit=100&period='+period);assert.equal(r.players.filter(p=>p.name==='Same name').length,1);assert.equal(r.players.find(p=>p.name==='Same name').identity,'identity-new');}
  assert.equal((await api('/api/leaderboard?period=invalid')).status,400);
  const r=await api('/api/badges');assert.equal(r.status,200);assert.ok(r.badges.some(b=>b.id==='berserker'));assert.ok(r.badges.every(b=>!['P1','P2'].includes(b.player)));
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalRuntime } from '../scripts/local-runtime.mjs';
let mf,db;
before(async()=>({mf,db}=await createLocalRuntime()));
after(async()=>{await mf?.dispose();});
const BASE='http://game.test';
const dispatch=(path,init={})=>mf.dispatchFetch(BASE+path,init);
const call=(path,{method='GET',body,headers={}}={})=>dispatch(path,{method,redirect:'manual',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function request(email){
  const r=await call('/api/auth/request',{method:'POST',body:{email}});
  return {status:r.status,data:await r.json()};
}
async function verify(token){
  const r=await dispatch('/api/auth/verify?token='+token,{redirect:'manual'});
  return {status:r.status,location:r.headers.get('location'),setCookie:r.headers.get('set-cookie')||''};
}
async function signin(email){
  const {status,data}=await request(email);
  assert.equal(status,200);assert.equal(data.ok,true);
  const v=await verify(data.debugToken);
  assert.equal(v.status,302);
  const match=v.setCookie.match(/kaputt_session=([0-9a-f]{64})/);
  assert.ok(match,v.setCookie);
  const cookie=`kaputt_session=${match[1]}`;
  const me=await call('/api/me',{headers:{Cookie:cookie}});
  assert.equal(me.status,200);
  return {cookie,session:match[1],user:(await me.json()).user};
}
const validMatch=(extra={})=>({id:crypto.randomUUID(),playerA:'Honest Player',playerB:'Bot Opponent',playerAId:'client-spoof-id',playerBId:'bot-uploader',
  winner:'P1',target:6,scoreA:6,scoreB:0,kaputtA:0,kaputtB:0,
  history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}],...extra});
const post=(m,headers)=>call('/api/matches',{method:'POST',body:m,headers});

test('request, verify, me, username, and logout follow the auth contract',async()=>{
  assert.equal((await request('not-an-email')).status,400);
  assert.equal((await request('')).status,400);
  const first=await request('  Fresh.Player@Example.COM  ');
  assert.equal(first.status,200);assert.deepEqual(Object.keys(first.data),['ok','debugToken']);
  assert.match(first.data.debugToken,/^[0-9a-f]{64}$/);
  const user=await db.prepare("SELECT id FROM users WHERE email='fresh.player@example.com'").first();
  assert.ok(user,'email is trimmed and lowercased before storage');
  const tokenRow=await db.prepare('SELECT token_hash,used,expires_at FROM magic_tokens WHERE user_id=?').bind(user.id).first();
  assert.match(tokenRow.token_hash,/^[0-9a-f]{64}$/);
  assert.equal(tokenRow.used,0);
  assert.ok(tokenRow.expires_at>Math.floor(Date.now()/1000)+800&&tokenRow.expires_at<=Math.floor(Date.now()/1000)+900);
  assert.notEqual(tokenRow.token_hash,first.data.debugToken,'only the SHA-256 hash is stored');
  assert.equal((await call('/api/me')).status,401);
  const bad=await verify('f'.repeat(64));
  assert.equal(bad.status,401);
  const v=await verify(first.data.debugToken);
  assert.equal(v.status,302);assert.equal(v.location,'/');
  assert.match(v.setCookie,/^kaputt_session=[0-9a-f]{64}; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/);
  assert.ok(!/Secure/i.test(v.setCookie),'Secure is added only for https origins');
  const cookie=`kaputt_session=${v.setCookie.match(/kaputt_session=([0-9a-f]{64})/)[1]}`;
  const who=await call('/api/me',{headers:{Cookie:cookie}});
  assert.equal(who.status,200);
  const me=await who.json();
  assert.equal(me.ok,true);assert.equal(me.user.id,user.id);assert.equal(me.user.email,'fresh.player@example.com');assert.equal(me.user.username,null);
  const tls=await request('tls@kaputt.test');
  assert.equal(tls.status,200);
  const tlsVerify=await mf.dispatchFetch('https://game.test/api/auth/verify?token='+tls.data.debugToken,{redirect:'manual'});
  assert.equal(tlsVerify.status,302);
  assert.match(tlsVerify.headers.get('set-cookie')||'',/Max-Age=2592000; Secure$/,'Secure is added on https origins');
  const reused=await verify(first.data.debugToken);
  assert.equal(reused.status,410,'sign-in tokens are single-use');
  assert.equal((await call('/api/auth/username',{method:'POST',body:{username:'Player-One'}})).status,401);
  assert.equal((await call('/api/auth/username',{method:'POST',body:{username:'ab'},headers:{Cookie:cookie}})).status,400);
  assert.equal((await call('/api/auth/username',{method:'POST',body:{username:'bad name!'},headers:{Cookie:cookie}})).status,400);
  const named=await call('/api/auth/username',{method:'POST',body:{username:'Player-One'},headers:{Cookie:cookie}});
  assert.equal(named.status,200);assert.equal((await named.json()).user.username,'Player-One');
  const other=await signin('second@kaputt.test');
  const clash=await call('/api/auth/username',{method:'POST',body:{username:'player-one'},headers:{Cookie:other.cookie}});
  assert.equal(clash.status,409,'usernames are unique case-insensitively');
  const out=await call('/api/auth/logout',{method:'POST',headers:{Cookie:cookie}});
  assert.equal(out.status,200);assert.equal((await out.json()).ok,true);
  const cleared=out.headers.get('set-cookie')||'';
  assert.match(cleared,/^kaputt_session=;/);assert.match(cleared,/Max-Age=0/);
  assert.equal((await call('/api/me',{headers:{Cookie:cookie}})).status,401);
});

test('sign-in fails without mail configuration and stores no unusable token',async()=>{
  const alt=await createLocalRuntime({allowAuthDebug:false});
  try{
    const r=await alt.mf.dispatchFetch('http://game.test/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'silent@kaputt.test'})});
    assert.equal(r.status,503);
    const data=await r.json();
    assert.equal(data.ok,false);
    assert.ok(!/[0-9a-f]{64}/.test(JSON.stringify(data)),'no raw token in the response body');
    const row=await alt.db.prepare("SELECT COUNT(*) n FROM magic_tokens").first();
    assert.equal(row.n,0,'a failed delivery cannot consume a token or rate-limit slot');
  } finally { await alt.mf.dispose(); }
});

test('sign-in fails when Resend rejects the sender and stores no unusable token',async()=>{
  let outbound;
  const alt=await createLocalRuntime({allowAuthDebug:false,resendApiKey:'re_test',outboundService:async request=>{
    outbound={url:request.url,authorization:request.headers.get('authorization'),body:await request.json()};
    return new Response(JSON.stringify({statusCode:403,message:'Domain not verified'}),{status:403,headers:{'Content-Type':'application/json'}});
  }});
  try{
    const r=await alt.mf.dispatchFetch('https://play-kaputt.juzemaru.com/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'rejected@kaputt.test'})});
    assert.equal(r.status,503);
    const data=await r.json();
    assert.equal(data.ok,false);
    assert.equal(outbound.url,'https://api.resend.com/emails');
    assert.equal(outbound.authorization,'Bearer re_test');
    assert.equal(outbound.body.from,'play-kaputt@no-reply.juzemaru.com');
    assert.match(outbound.body.text,/https:\/\/play-kaputt\.juzemaru\.com\/\?auth=[0-9a-f]{64}/);
    const row=await alt.db.prepare("SELECT COUNT(*) n FROM magic_tokens").first();
    assert.equal(row.n,0,'a rejected email cannot consume a token or rate-limit slot');
  } finally { await alt.mf.dispose(); }
});

test('sign-in succeeds only after Resend accepts the email',async()=>{
  const alt=await createLocalRuntime({allowAuthDebug:false,resendApiKey:'re_test',outboundService:async()=>new Response(JSON.stringify({id:'email-id'}),{status:200,headers:{'Content-Type':'application/json'}})});
  try{
    const r=await alt.mf.dispatchFetch('https://play-kaputt.juzemaru.com/api/auth/request',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'accepted@kaputt.test'})});
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),{ok:true});
    const row=await alt.db.prepare("SELECT COUNT(*) n FROM magic_tokens").first();
    assert.equal(row.n,1);
  } finally { await alt.mf.dispose(); }
});

test('sign-in requests are rate-limited to five per email per hour',async()=>{
  for(let i=0;i<5;i++){
    const r=await request('flood@kaputt.test');
    assert.equal(r.status,200);assert.equal(r.data.ok,true);
  }
  const blocked=await request('flood@kaputt.test');
  assert.equal(blocked.status,429);assert.equal(blocked.data.ok,false);
  assert.equal((await request('calm@kaputt.test')).status,200,'other emails are unaffected');
});

test('match uploads require a session cookie',async()=>{
  const id=crypto.randomUUID();
  const r=await post(validMatch({id}));
  assert.equal(r.status,401);
  const data=await r.json();
  assert.equal(data.ok,false);assert.match(data.error,/sign in/i);
  assert.equal((await db.prepare('SELECT COUNT(*) n FROM matches WHERE id=?').bind(id).first()).n,0);
});

test('spoofed history, totals, and winners are rejected; attribution comes from the session',async()=>{
  const {cookie,user}=await signin('uploader@kaputt.test');
  const stored=await db.prepare("SELECT COUNT(*) n FROM magic_tokens mt JOIN users u ON u.id=mt.user_id WHERE u.email='uploader@kaputt.test'").first();
  assert.ok(stored.n>=1);
  const ok=await post(validMatch(),{Cookie:cookie});
  assert.equal(ok.status,201);
  const saved=await db.prepare('SELECT payload_json FROM matches WHERE id=?').bind((await ok.json()).id).first();
  const payload=JSON.parse(saved.payload_json);
  assert.equal(payload.userIdA,user.id,'the signed-in session owns seat A');
  assert.equal(payload.userIdB,null);
  assert.equal(payload.playerAId,'client-spoof-id','legacy fields are kept but never win attribution');
  const board=await (await call('/api/leaderboard?limit=100')).json();
  assert.ok(board.players.some(p=>p.identity===user.id&&p.name==='Honest Player'));
  assert.ok(!board.players.some(p=>p.identity==='client-spoof-id'));
  const tampered=[
    validMatch({history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:36,ntbBefore:1,ntbAfter:36}]}),
    validMatch({history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:7}]}),
    validMatch({history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:5,ntbAfter:6}]}),
    validMatch({history:[{turn:1,player:1,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6}]}),
    validMatch({scoreA:60}),
    validMatch({target:100}),
    validMatch({winner:null}),
    validMatch({kaputtA:1}),
    validMatch({history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'defense',points:6,ntbBefore:1,ntbAfter:6}]}),
    validMatch({history:[{turn:1,player:0,visibleDie:2,hiddenDie:3,choice:'attack',points:6,ntbBefore:1,ntbAfter:6,kaputt:true}]}),
  ];
  for(const m of tampered){
    const r=await post(m,{Cookie:cookie});
    assert.equal(r.status,400,`rejected: ${JSON.stringify({target:m.target,winner:m.winner,scoreA:m.scoreA,history:m.history})}`);
  }
  const unauth=await post(validMatch());
  assert.equal(unauth.status,401);
});

test('remote room saves attribute both seats to their signed-in users',async()=>{
  const host=await signin('host@kaputt.test'),guest=await signin('guest@kaputt.test');
  const credential=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
  const hostToken=credential(),guestToken=credential();
  const create=await call('/api/rooms',{method:'POST',body:{hostName:'Attributed Host',sessionToken:hostToken,target:1},headers:{Cookie:host.cookie}});
  assert.equal(create.status,201);
  const key=(await create.json()).room.code;
  const join=await call(`/api/rooms/${key}/join`,{method:'POST',body:{guestName:'Attributed Guest',sessionToken:guestToken},headers:{Cookie:guest.cookie}});
  assert.equal(join.status,200);
  const seats=await db.prepare('SELECT player_index,user_id FROM room_seats WHERE room_code=? ORDER BY player_index').bind(key).all();
  assert.deepEqual(seats.results.map(s=>s.user_id),[host.user.id,guest.user.id]);
  let room=(await (await call(`/api/rooms/${key}`,{headers:{Authorization:`Bearer ${hostToken}`}})).json()).room;
  const play=async(action,extra={})=>{
    const bearer=room.state.currentPlayer===0?hostToken:guestToken;
    const r=await call(`/api/rooms/${key}/action`,{method:'POST',body:{action,version:room.version,requestId:crypto.randomUUID(),...extra},headers:{Authorization:`Bearer ${bearer}`}});
    assert.equal(r.status,200);
    room=(await r.json()).room;
  };
  await play('roll');await play('reveal',{dieIndex:0});await play('choose',{choice:'defense'});await play('resolve');
  assert.equal(room.status,'finished');
  const payload=JSON.parse((await db.prepare('SELECT payload_json FROM matches WHERE id=?').bind(room.state.matchId).first()).payload_json);
  assert.equal(payload.userIdA,host.user.id);
  assert.equal(payload.userIdB,guest.user.id);
  const board=await (await call('/api/leaderboard?limit=100')).json();
  assert.ok(board.players.some(p=>p.identity===host.user.id));
  assert.ok(board.players.some(p=>p.identity===guest.user.id));
});

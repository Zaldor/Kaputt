import engine from '../../lab/engine.js';
import { ApiError, integer, playerName, canonicalMatch, matchStatements } from './persistence.js';

const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const randomInt = max => {
  const x = new Uint32Array(1), limit = Math.floor(0x100000000/max)*max;
  do { crypto.getRandomValues(x); } while (x[0]>=limit);
  return x[0]%max;
};
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code = () => Array.from({length:4},()=> alphabet[randomInt(alphabet.length)]).join('');
function credential(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new ApiError('This device has no valid room session.',401);
  return token;
}
const identity = value => typeof value==='string'&&/^[a-zA-Z0-9-]{16,80}$/.test(value)?value:crypto.randomUUID();
const read = (db,key) => db.prepare('SELECT * FROM rooms WHERE code=?').bind(key).first();
const initial = (room, names) => ({
  phase:'idle',currentPlayer:randomInt(2),turn:0,ntb:room.starting_ntb,target:room.target,kaputtLimit:room.kaputt_limit,
  matchId:crypto.randomUUID(),players:names.map((name,index)=>({name,uuid:index?room.guest_uuid:room.host_uuid,score:0,kaputt:0,attackCount:0,defenseCount:0})),
  dice:[0,0],firstDieIndex:null,choice:null,lastResult:null,history:[],winner:null,winReason:null,
  extremes:0,leadChanges:0,lastLeader:-1,rematchReady:[false,false],decisionStarted:null,
});
function publicState(state) {
  if (!state) return null;
  const {dice,decisionStarted,...safe} = state;
  safe.values=[null,null];
  if (['first','chosen','resolved'].includes(state.phase) && state.firstDieIndex !== null) safe.values[state.firstDieIndex]=dice[state.firstDieIndex];
  if (state.phase==='resolved') safe.values=[...dice];
  safe.visibleDie=state.firstDieIndex===null?null:safe.values[state.firstDieIndex];
  return safe;
}
async function publicRoom(db,room,index,unchanged=false) {
  const seats=await db.prepare('SELECT player_index,last_seen FROM room_seats WHERE room_code=?').bind(room.code).all();
  const state=!unchanged&&room.current_state_json?JSON.parse(room.current_state_json):null;
  return {code:room.code,status:room.status,protocol:room.protocol,version:room.version,playerIndex:index,
    hostName:room.host_name,guestName:room.guest_name,target:room.target,kaputtLimit:room.kaputt_limit,startingNtb:room.starting_ntb,
    ...(unchanged?{}:{state:publicState(state)}),presence:[0,1].map(i=>({online:seats.results.some(s=>s.player_index===i && s.last_seen>Date.now()/1000-25)}))};
}
async function authenticate(db,room,token) {
  const seat=await db.prepare('SELECT player_index FROM room_seats WHERE room_code=? AND token_hash=?')
    .bind(room.code,await hash(credential(token))).first();
  if (!seat) throw new ApiError('This device does not own a seat in this room.',403);
  return seat.player_index;
}
function requireModern(room) {
  if (!room) throw new ApiError('Room not found. Check the four-character code.',404);
  if (room.protocol!==2) throw new ApiError('This room uses the previous game version. Its history is preserved; create a new room to play securely.',426);
}
export async function createRoom(db,b) {
  const tokenHash=await hash(credential(b.sessionToken));
  const existing=await db.prepare('SELECT r.*,s.player_index FROM rooms r JOIN room_seats s ON s.room_code=r.code WHERE s.token_hash=?').bind(tokenHash).first();
  if (existing) return publicRoom(db,existing,existing.player_index);
  const name=playerName(b.hostName,'Host');
  const target=integer(b.target,100,1,9999,'score target'), kaputt=integer(b.kaputtLimit,5,1,20,'Kaputt limit'), ntb=integer(b.startingNtb,1,0,99,'starting target');
  for(let attempt=0;attempt<8;attempt++) {
    const key=code();
    if (await read(db,key)) continue;
    try {
      await db.batch([
        db.prepare("INSERT INTO rooms(code,host_name,host_uuid,target,kaputt_limit,starting_ntb,status,protocol,version) VALUES(?,?,?,?,?,?,'waiting',2,0)").bind(key,name,identity(b.playerId),target,kaputt,ntb),
        db.prepare('INSERT INTO room_seats(room_code,player_index,token_hash) VALUES(?,0,?)').bind(key,tokenHash),
      ]);
      return publicRoom(db,await read(db,key),0);
    } catch(error) {
      const retry=await db.prepare('SELECT r.*,s.player_index FROM rooms r JOIN room_seats s ON s.room_code=r.code WHERE s.token_hash=?').bind(tokenHash).first();
      if (retry) return publicRoom(db,retry,retry.player_index);
      if (!await read(db,key)) throw error;
    }
  }
  throw new ApiError('Could not create a room. Please try again.',503);
}
export async function joinRoom(db,key,b) {
  const room=await read(db,key); requireModern(room);
  const tokenHash=await hash(credential(b.sessionToken));
  const prior=await db.prepare('SELECT player_index FROM room_seats WHERE room_code=? AND token_hash=?').bind(key,tokenHash).first();
  if (prior) return publicRoom(db,room,prior.player_index);
  if (room.status!=='waiting') throw new ApiError('This room already has two players.',409);
  const name=playerName(b.guestName,'Guest');
  if (name.toLocaleLowerCase()===room.host_name.toLocaleLowerCase()) throw new ApiError('Choose a different name from your opponent.');
  const guestId=identity(b.playerId),state=initial({...room,guest_uuid:guestId},[room.host_name,name]);
  // One conditional UPDATE plus seat claim in the same transaction: only one guest wins.
  const result=await db.batch([
    db.prepare("UPDATE rooms SET guest_name=?,guest_uuid=?,status='playing',current_state_json=?,version=version+1,last_updated=CURRENT_TIMESTAMP WHERE code=? AND status='waiting' AND version=?")
      .bind(name,guestId,JSON.stringify(state),key,room.version),
    db.prepare('INSERT INTO room_seats(room_code,player_index,token_hash) SELECT ?,1,? WHERE changes()=1').bind(key,tokenHash),
  ]);
  if (!result[0].meta.changes) {
    const own=await db.prepare('SELECT player_index FROM room_seats WHERE room_code=? AND token_hash=?').bind(key,tokenHash).first();
    if (!own) throw new ApiError('Another player just joined this room.',409);
  }
  return publicRoom(db,await read(db,key),1);
}
export async function pollRoom(db,key,token,since) {
  const room=await read(db,key); requireModern(room);
  const index=await authenticate(db,room,token);
  await db.prepare('UPDATE room_seats SET last_seen=unixepoch() WHERE room_code=? AND player_index=? AND last_seen<unixepoch()-10').bind(key,index).run();
  return publicRoom(db,room,index,since===room.version);
}
function turnResult(state,index) {
  const player=state.players[index],opponent=state.players[1-index],ntbBefore=state.ntb;
  const visibleDie=state.dice[state.firstDieIndex],hiddenDie=state.dice[1-state.firstDieIndex];
  const r=engine.resolve(state.choice,visibleDie,hiddenDie,ntbBefore);
  const event={...r,turn:state.turn+1,player:index,actor:`P${index+1}`,choice:state.choice,firstDieIndex:state.firstDieIndex,
    visibleDie,hiddenDie,ntbBefore,ntbAfter:r.nextNtb,scoreSelfBefore:player.score,scoreOpponentBefore:opponent.score,
    kaputtSelfBefore:player.kaputt,kaputtOpponentBefore:opponent.kaputt,decisionMs:state.decisionMs,
    strategicHold:r.kaputt&&r.nextNtb===ntbBefore?1:0};
  player.score+=r.points; player.kaputt+=r.kaputt?1:0;
  player[state.choice==='attack'?'attackCount':'defenseCount']++;
  state.ntb=r.nextNtb; state.extremes+=r.extreme?1:0;
  const leader=state.players[0].score===state.players[1].score?-1:state.players[0].score>state.players[1].score?0:1;
  if (leader>=0 && state.lastLeader>=0 && leader!==state.lastLeader) state.leadChanges++;
  if (leader>=0) state.lastLeader=leader;
  if (player.score>=state.target) { state.winner=index;state.winReason='score target'; }
  else if (player.kaputt>=state.kaputtLimit) {state.winner=1-index;state.winReason='opponent reached Kaputt limit';}
  Object.assign(event,{scoreAfter:player.score,kaputtAfter:player.kaputt,winner:state.winner,winReason:state.winReason});
  state.history.push(event); state.lastResult=event; state.turn++; state.phase='resolved';
  state.currentPlayer=1-index;
}
function matchPayload(room,state) {
  return canonicalMatch({id:state.matchId,source:'remote-vs',ruleset:room.ruleset,target:state.target,
    kaputtLimit:state.kaputtLimit,startingNtb:room.starting_ntb,playerA:state.players[0].name,playerB:state.players[1].name,
    playerAId:room.host_uuid,playerBId:room.guest_uuid,players:state.players,winner:state.winner,terminalCause:state.winReason,turns:state.turn,
    history:state.history,leadChanges:state.leadChanges,extremes:state.extremes,finalNtb:state.ntb});
}
export async function roomAction(db,key,token,b,retry=0) {
  const room=await read(db,key); requireModern(room);
  const index=await authenticate(db,room,token);
  if (typeof b.requestId!=='string' || !/^[a-zA-Z0-9-]{16,80}$/.test(b.requestId)) throw new ApiError('Missing action identifier.');
  const fingerprint=await hash(JSON.stringify(b));
  const previous=await db.prepare('SELECT * FROM room_actions WHERE room_code=? AND request_id=?').bind(key,b.requestId).first();
  if (previous) {
    if (previous.player_index!==index || previous.payload_hash!==fingerprint) throw new ApiError('Action identifier has already been used.',409);
    return publicRoom(db,room,index);
  }
  let state=room.current_state_json?JSON.parse(room.current_state_json):null;
  const sameRematch=b.action==='rematch' && room.status==='finished' && b.matchId===state?.matchId;
  if (!Number.isInteger(b.version) || room.version!==b.version&&!sameRematch) throw new ApiError('The game changed. Synchronizing your screen…',409);
  if ('visibleDie' in b || 'hiddenDie' in b || 'dice' in b || 'playerIndex' in b) throw new ApiError('Dice and player identity are controlled by the server.');
  let status=room.status, matchId=room.match_id;
  if (b.action==='leave') {
    status='closed'; if(state)state.closedBy=index;
  } else if (b.action==='rematch') {
    if (status!=='finished' || !state) throw new ApiError('Finish this match before requesting a rematch.',409);
    if(b.matchId && b.matchId!==state.matchId)throw new ApiError('That match has already ended.',409);
    state.rematchReady[index]=true;
    if (state.rematchReady.every(Boolean)) {state=initial(room,state.players.map(p=>p.name));status='playing';matchId=null;}
  } else {
    if (status!=='playing' || !state) throw new ApiError('This match is not active.',409);
    if (state.currentPlayer!==index) throw new ApiError('It is your opponent’s turn.',403);
    const expected={roll:'idle',reveal:'rolled',choose:'first',resolve:'chosen',next:'resolved'}[b.action];
    if (!expected || state.phase!==expected) throw new ApiError('That move is not available now.',409);
    if (b.action==='roll') { state.dice=[randomInt(6)+1,randomInt(6)+1];state.phase='rolled';state.lastResult=null; }
    if (b.action==='reveal') {
      if (b.dieIndex!==0 && b.dieIndex!==1) throw new ApiError('Choose the left or right die.');
      state.firstDieIndex=b.dieIndex;state.phase='first';state.decisionStarted=Date.now();
    }
    if (b.action==='choose') {
      if (!['attack','defense'].includes(b.choice)) throw new ApiError('Choose Attack or Defense.');
      state.choice=b.choice;state.decisionMs=Date.now()-state.decisionStarted;state.phase='chosen';
    }
    if (b.action==='resolve') {
      turnResult(state,index);
      if (state.winner!==null) {status='finished';matchId=state.matchId;}
    }
    if (b.action==='next') {
      state.phase='idle';state.dice=[0,0];state.firstDieIndex=null;state.choice=null;state.lastResult=null;
    }
  }
  const revision=room.version+1;
  if (state) state.lastAction={id:b.requestId,action:b.action,player:index};
  const statements=[
    db.prepare('UPDATE rooms SET current_state_json=?,status=?,match_id=?,version=version+1,last_updated=CURRENT_TIMESTAMP WHERE code=? AND version=?')
      .bind(state?JSON.stringify(state):null,status,matchId,key,room.version),
    db.prepare('INSERT INTO room_actions(room_code,request_id,version,player_index,payload_hash) SELECT ?,?,?,?,? WHERE changes()=1')
      .bind(key,b.requestId,revision,index,fingerprint),
  ];
  if (status==='finished' && b.action==='resolve') {
    statements.push(...matchStatements(db,matchPayload(room,state),
      'EXISTS(SELECT 1 FROM room_actions WHERE room_code=? AND request_id=? AND version=?)',[key,b.requestId,revision]));
  }
  const result=await db.batch(statements);
  if (!result[0].meta.changes) {
    const receipt=await db.prepare('SELECT payload_hash FROM room_actions WHERE room_code=? AND request_id=?').bind(key,b.requestId).first();
    if(receipt?.payload_hash!==fingerprint && sameRematch && retry<1)return roomAction(db,key,token,b,retry+1);
    if (receipt?.payload_hash!==fingerprint) throw new ApiError('Another request changed the game. Synchronizing…',409);
  }
  return publicRoom(db,await read(db,key),index);
}

// Legacy rooms were public by room code. Keep their recorded history downloadable;
// never expose private dice or credentials from the current protocol.
export async function archiveRoom(db,key) {
  const room=await read(db,key);
  if(!room)throw new ApiError('Room not found.',404);
  if(room.protocol!==1)throw new ApiError('Export this match from your game menu.',403);
  return {code:room.code,status:room.status,hostName:room.host_name,guestName:room.guest_name,
    target:room.target,kaputtLimit:room.kaputt_limit,startingNtb:room.starting_ntb,
    state:room.current_state_json?JSON.parse(room.current_state_json):null};
}

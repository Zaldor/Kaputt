import {RemoteClient, randomId, playerIdentity} from './remote-client.js';
import {animate, enter, bump, shake, number, celebrate, cancelMotion, reduced, toggleMotion, motionEnabled} from './motion.js';
import {queueMatch, flushMatches, pendingMatches} from './match-outbox.js';
const $=id=>document.getElementById(id), E=window.KaputtEngine, LLM=window.KaputtLLM;
const ADJ=['Swift','Bold','Keen','Sharp','Wild','Calm','Brave','Dark','Iron','Silent','Lucky','Crimson','Golden','Phantom','Fierce'];
const NOUN=['Fox','Wolf','Hawk','Bear','Lynx','Raven','Viper','Tiger','Eagle','Cobra','Falcon','Panther','Shark','Dragon','Phoenix'];
function generateName(){return ADJ[Math.floor(Math.random()*ADJ.length)]+NOUN[Math.floor(Math.random()*NOUN.length)]}
function getPlayerName(){let n;try{n=localStorage.getItem('kaputt-player-name')}catch{};if(!n||n==='You'){n=generateName();try{localStorage.setItem('kaputt-player-name',n)}catch{}};return n}
function setPlayerName(n){try{localStorage.setItem('kaputt-player-name',n)}catch{}}
let setup={mode:'human',target:100,kaputtLimit:5,startingNtb:1,playerName:getPlayerName(),player2Name:'Player 2'};
let match=E.createMatch(setup), matchId=randomId();
let version=0,busy=false,passing=false,botThinking=false,busyMessage='';
let scene=null,botWorker=null,botCancel=null,botReason='',displayedValues=[null,null],lastResult=null;
let events=['Match started.'],uploaded=false,uploadStatus='',sound=true,audioContext=null;
let connection={connected:false,pending:false,sending:false,message:''},remoteRoom=null,roomBusy=false;
try{sound=localStorage.getItem('kaputt-sound')!=='off';}catch{}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const valid=token=>token===version;
const online=()=>setup.mode==='remote';
const isBotTurn=()=>!online() && setup.mode!=='human' && match.currentPlayer===1;
const me=()=>online()?(remoteRoom?.playerIndex??0):setup.mode==='human'?match.currentPlayer:0;
const playerLabel=index=>online()?match.players[index]?.name||'Friend':index===0?setup.playerName:setup.mode==='human'?setup.player2Name:$('mode').querySelector(`option[value="${setup.mode}"]`)?.textContent||'Bot';
const humanCanAct=()=>!busy&&!passing&&!match.isTerminal&&(online()?remoteRoom?.status==='playing'&&connection.connected&&!connection.sending&&!connection.pending&&match.currentPlayer===me():!isBotTurn());
function announce(text){$('game-announcement').textContent=text;}
function log(text){events.unshift(text);$('log').textContent=events.join('\n');}
function tone(freq,duration=.09,delay=0,type='sine'){
  if(!sound||document.hidden)return;
  try{
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});
    const oscillator=audioContext.createOscillator(),gain=audioContext.createGain(),start=audioContext.currentTime+delay;
    oscillator.type=type;oscillator.frequency.value=freq;gain.gain.setValueAtTime(.035,start);gain.gain.exponentialRampToValueAtTime(.001,start+duration);
    oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.start(start);oscillator.stop(start+duration);
  }catch{}
}
function sfx(kind){
  if(kind==='roll')for(let i=0;i<5;i++)tone(140+i*35,.035,i*.06,'triangle');
  else if(kind==='kaputt'){tone(170,.15);tone(90,.24,.1);}
  else if(kind==='win')[440,550,660,880].forEach((f,i)=>tone(f,.18,i*.08));
  else if(kind==='success'){tone(440,.1);tone(660,.14,.08);}
  else tone(520,.07,0,'triangle');
}
function showPopup(text,kind){
  const el=$('event-popup');$('event-popup-text').textContent=text;el.className=`event-popup pop-${kind}`;
  animate(el,[{opacity:0,transform:'translate(-50%,-50%) scale(.7)'},{opacity:1,transform:'translate(-50%,-50%) scale(1.05)',offset:.15},{opacity:1,transform:'translate(-50%,-50%) scale(1)',offset:.7},{opacity:0,transform:'translate(-50%,-65%) scale(.98)'}],1400);
}
function drawPenalties(id,count){
  const root=$(id);root.classList.toggle('many',setup.kaputtLimit>5);
  while(root.children.length>setup.kaputtLimit)root.lastChild.remove();
  while(root.children.length<setup.kaputtLimit){const dot=document.createElement('span');dot.className='penalty-dot';root.append(dot);}
  [...root.children].forEach((dot,i)=>{const filled=i<count;if(filled&&!dot.classList.contains('filled'))bump(dot);dot.classList.toggle('filled',filled);});
}
function renderLab(){
  const p=match.players;
  $('telemetry').textContent=`Turns ${match.turnNumber} · Extremes ${match.extremes} · Lead changes ${match.leadChanges}. P1 A/D ${p[0].attackCount}/${p[0].defenseCount} · P2 A/D ${p[1].attackCount}/${p[1].defenseCount}`;
  $('botwhy').textContent=botReason;$('upload-status').textContent=online()?(match.isTerminal?'This online match is saved.':'Online turns are saved as you play.'):uploadStatus;
  $('retry-upload').hidden=!pendingMatches();$('matrix').replaceChildren();
  const state=match.getPublicState();
  if(['first','chosen'].includes(match.phase)){
    $('prob').textContent=`Visible die ${state.visibleDie} · Number to beat ${match.ntb}`;
    const a=E.conditionalStats(state.visibleDie,match.ntb,'attack'),d=E.conditionalStats(state.visibleDie,match.ntb,'defense'),pct=n=>`${(n*100).toFixed(1)}%`;
    for(const [label,av,dv] of [['P(> target)',pct(a.success),pct(d.success)],['P(Kaputt)',pct(a.kaputt),pct(d.kaputt)],['Expected points',a.points.toFixed(2),d.points.toFixed(2)],['Expected next target',a.nextNtb.toFixed(2),d.nextNtb.toFixed(2)],['P(Extreme)',pct(a.extreme),pct(d.extreme)]]){
      const row=document.createElement('tr');for(const value of [label,av,dv]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}$('matrix').append(row);
    }
  }else $('prob').textContent='Reveal one die to see conditional outcomes.';
}
function renderConnection(){
  const bar=$('connection-bar');bar.hidden=!online();$('open-room').hidden=!online();
  if(!online())return;
  bar.dataset.connected=String(connection.connected);
  const room=remoteRoom,other=room?.presence?.[1-me()]?.online;
  let text=connection.sending?'Sending your move…':connection.pending?'Move pending. Retry safely.':!connection.connected?'Reconnecting…':room?.status==='waiting'?`Room ${room.code} · Waiting for a friend`:room?.status==='closed'?'Your opponent left. Start a new match.':`Room ${room?.code||remote.session?.code||''} · ${other?'Friend connected':'Waiting for friend to reconnect'}`;
  if(connection.message&&!connection.connected)text=connection.message;
  $('connection-text').textContent=text;$('retry-connection').hidden=connection.connected&&!connection.pending||connection.sending;
  if(room){
    $('lobby-code').textContent=room.code;$('lobby-status').textContent=room.status==='waiting'?'Waiting for a friend to join…':room.status==='closed'?'This room has closed.':other?'You’re both connected. Game on!':'Your friend can reconnect on their original device.';
    $('lobby-rules').textContent=`First to ${room.target} · ${room.kaputtLimit} Kaputts · Starting target ${room.startingNtb}`;
  }
}
function render(){
  const state=match.getPublicState(),phase=match.phase,self=me(),other=1-self,canAct=humanCanAct();
  $('game').dataset.phase=busy?'animating':phase;$('game').dataset.terminal=String(match.isTerminal);$('game').dataset.passing=String(passing);
  const tl=$('target-label');if(tl)tl.textContent=setup.target;document.querySelectorAll('.score-target').forEach(el=>el.textContent=setup.target);
  $('opponent-name').textContent=playerLabel(other).toUpperCase();
  $('self-name').textContent=match.isTerminal?(match.winner===self?'WINNER!':'GOOD GAME'):`${playerLabel(self)}${match.currentPlayer===self?' · YOUR TURN':''}`;
  number($('opponent-score'),match.players[other].score);number($('self-score'),match.players[self].score);number($('ntb'),match.ntb);
  for(const [prefix,index] of [['opponent',other],['self',self]]){$(`${prefix}-kaputts`).textContent=`${match.players[index].kaputt}/${setup.kaputtLimit}`;drawPenalties(`${prefix}-dots`,match.players[index].kaputt);}
  $('explanation-target').textContent=match.ntb;
  $('attack-short').textContent=`Multiply · beat ${match.ntb}`;
  for(let i=0;i<2;i++){
    const button=$(i?'die-right':'die-left'),value=displayedValues[i],canReveal=canAct&&(phase==='rolled'||phase==='chosen'&&i!==state.firstDieIndex);
    button.disabled=!canReveal;button.setAttribute('aria-label',value===null?`${canReveal?'Reveal ':''}${i?'right':'left'} die${canReveal?'':', hidden'}`:`${i?'Right':'Left'} die: ${value}`);
    button.querySelector('.die-fallback').textContent=value??'?';button.querySelector('.die-fallback').classList.toggle('revealed',value!==null);
  }
  const decisionVisible=phase==='first'&&!busy&&!isBotTurn()&&(!online()||match.currentPlayer===self);
  $('decision-actions').hidden=!decisionVisible;$('choice-explanations').hidden=!decisionVisible;$('attack').disabled=!canAct;$('defense').disabled=!canAct;
  const primary=$('primary-action');primary.hidden=decisionVisible||phase==='rolled'&&!busy&&canAct;
  primary.disabled=!canAct;
  let title='READY TO ROLL?',detail='Two dice. One decision.',action='ROLL THE DICE';
  if(phase==='rolled'){title='PICK A DIE TO REVEAL';detail='Left or right. The choice is yours.';action='CHOOSE A DIE';}
  if(phase==='first'){title='CHOOSE YOUR MOVE';detail='';action='CHOOSING A MOVE';}
  if(phase==='chosen'){title=`${match.choice.toUpperCase()} LOCKED IN`;detail='Your move is set. Reveal the other die.';action='REVEAL SECOND DIE';}
  if(phase==='resolved'&&lastResult){
    title=lastResult.kaputt?'KAPUTT!':lastResult.extreme?`EXTREME! +${lastResult.points}`:`+${lastResult.points} POINTS`;
    detail=lastResult.kaputt?'No points. The target holds.':`${playerLabel(lastResult.player)} banks ${lastResult.points}.`;
    action=online()?'YOUR TURN':setup.mode==='human'?'PASS THE TURN':isBotTurn()?'YOUR TURN':'NEXT TURN';
    // Local engine changes player on nextTurn; online engine does so on resolve.
    if(!online())primary.disabled=busy||passing;
  }
  $('outcome-detail').hidden=phase!=='resolved'||!lastResult||busy;
  if(lastResult)$('outcome-detail').textContent=lastResult.extreme?(lastResult.choice==='attack'?'1 & 6: Extreme Attack becomes 36.':'1 & 6: Extreme Defense scores 1 and sets the target to 2.'):`${lastResult.visibleDie} ${lastResult.choice==='attack'?'×':'+'} ${lastResult.hiddenDie} = ${lastResult.value}. ${lastResult.kaputt?`Must beat ${lastResult.ntbBefore}.`:`New target: ${lastResult.ntbAfter}.`}`;
  if(online()&&match.currentPlayer!==self&&!match.isTerminal){
    if(phase!=='resolved')title=`${playerLabel(other).toUpperCase()}’S TURN`;
    detail=phase==='rolled'?'Your friend is choosing a die.':phase==='first'?'Your friend is deciding: Attack or Defense.':phase==='chosen'?'Move locked. Waiting for the second reveal.':'Watch their move, then make yours.';
    action='WAITING FOR FRIEND';primary.hidden=false;primary.disabled=true;
  }
  if(botThinking){title='OPPONENT IS THINKING';detail='Your opponent sees only the revealed die.';action='THINKING…';}
  if(busy){title=busyMessage;detail='';action=busyMessage;primary.disabled=true;}
  if(match.isTerminal&&!busy){
    title=`${playerLabel(match.winner).toUpperCase()} WINS!`;detail=`${match.winReason==='score target'?'Score target reached':'Kaputt limit reached'} · ${match.turnNumber} ${match.turnNumber===1?'turn':'turns'}`;
    action=online()?(remoteRoom.state.rematchReady[self]?'REMATCH REQUESTED':'PLAY AGAIN'):'PLAY AGAIN';primary.hidden=false;
    primary.disabled=online()&&(!connection.connected||connection.sending||connection.pending||remoteRoom.state.rematchReady[self]);
    if(online()&&remoteRoom.state.rematchReady[other])detail='Your friend wants a rematch. Ready?';
    if(online()&&remoteRoom.state.rematchReady[self])detail='Waiting for your friend to accept the rematch.';
  }
  if(online()&&connection.fatal){title='ROOM UNAVAILABLE';detail='Your saved match history has not been deleted.';action='NEW MATCH';primary.hidden=false;primary.disabled=false;}
  if(online()&&remoteRoom?.status==='waiting'){title='WAITING FOR A FRIEND';detail=`Share room ${remoteRoom.code} to get started.`;action='VIEW ROOM';primary.hidden=false;primary.disabled=false;}
  if(online()&&remoteRoom?.status==='closed'){title='ROOM CLOSED';detail='Your match history is still available in Match lab.';action='NEW MATCH';primary.hidden=false;primary.disabled=false;}
  if($('turn-title').textContent!==title){$('turn-title').textContent=title;enter($('turn-message'));}
  $('turn-detail').textContent=detail;$('primary-label').textContent=action;
  $('toggle-sound').setAttribute('aria-pressed',String(sound));$('sound-label').textContent=sound?'Sound on':'Sound off';
  $('toggle-motion').setAttribute('aria-pressed',String(motionEnabled()));$('motion-label').textContent=motionEnabled()?'Animations on':'Animations off';
  renderConnection();if($('lab-dialog').open)renderLab();
}
function publicValues(){
  if(online())return remoteRoom?.state?.values||[null,null];
  const state=match.getPublicState(),values=[null,null];
  if(state.visibleDie!==null)values[state.firstDieIndex]=state.visibleDie;
  if(match.phase==='resolved'&&lastResult)values[1-state.firstDieIndex]=lastResult.hiddenDie;
  return values;
}
async function animation(kind,index,value){
  if(scene)return kind==='roll'?scene.roll():scene.reveal(index,value);
  if(!reduced())await sleep(kind==='roll'?900:220);
}
function resultFeedback(event){
  log(`#${event.turn} ${playerLabel(event.player)} ${event.choice} · ${event.visibleDie}/${event.hiddenDie} → ${event.value} · +${event.points}${event.kaputt?' KAPUTT':''}`);
  sfx(match.isTerminal?'win':event.kaputt?'kaputt':'success');
  if(event.kaputt)shake(document.querySelector(event.player===me()?'.you':'.opponent'));
  if(match.isTerminal){showPopup(`${playerLabel(match.winner).toUpperCase()} WINS!`,'win');celebrate($('celebration'));}
  else if(event.extreme)showPopup(`EXTREME · ${event.value}`,'extreme');
  else if(event.kaputt)showPopup('KAPUTT!','kaputt');
  else showPopup(`+${event.points} POINTS`,'success');
  if(!reduced()&&navigator.vibrate)navigator.vibrate(event.kaputt?[25,35,25]:18);
  announce(`${event.kaputt?'Kaputt. No points.':`${event.points} points.`} Number to beat ${event.ntbAfter}.${match.isTerminal?` ${playerLabel(match.winner)} wins.`:''}`);
}
async function rollTurn(bot=false){
  if(busy||passing||match.isTerminal||match.phase!=='idle'||!bot&&isBotTurn())return false;
  const token=version;match.roll();displayedValues=[null,null];lastResult=null;botReason='';busy=true;busyMessage='ROLLING…';
  $('dice-stage').classList.add('rolling');render();sfx('roll');await animation('roll');if(!valid(token))return false;
  $('dice-stage').classList.remove('rolling');busy=false;render();announce('Both dice are hidden. Choose either die to reveal.');return true;
}
async function revealFirst(index,bot=false){
  if(busy||passing||match.isTerminal||match.phase!=='rolled'||!bot&&isBotTurn())return false;
  const token=version,result=match.revealFirst(index);busy=true;busyMessage='REVEALING…';render();sfx('reveal');
  await animation('reveal',index,result.visibleDie);if(!valid(token))return false;
  displayedValues[index]=result.visibleDie;scene?.setValues(displayedValues);busy=false;render();enter($('decision-actions'));
  announce(`${index?'Right':'Left'} die is ${result.visibleDie}. Choose Attack or Defense.`);return true;
}
async function chooseAction(choice,bot=false){
  if(busy||passing||match.isTerminal||match.phase!=='first'||!bot&&isBotTurn())return false;
  const token=version;match.choose(choice);sfx('reveal');render();bump($('turn-title'));announce(`${choice} locked in.`);
  await sleep(reduced()?0:250);if(valid(token))await resolveTurn(bot);return true;
}
async function resolveTurn(bot=false){
  if(busy||passing||match.isTerminal||match.phase!=='chosen'||!bot&&isBotTurn())return false;
  const token=version;busy=true;busyMessage='REVEALING…';render();const event=match.revealSecond();event.botReason=botReason||null;
  await animation('reveal',1-event.firstDieIndex,event.hiddenDie);if(!valid(token))return false;
  lastResult=event;displayedValues=publicValues();scene?.setValues(displayedValues);busy=false;render();resultFeedback(event);
  if(match.isTerminal)uploadMatch();return true;
}
function nextTurn(){
  if(busy||match.phase!=='resolved'||match.isTerminal)return;
  match.nextTurn();displayedValues=[null,null];lastResult=null;botReason='';scene?.setValues(displayedValues);
  if(setup.mode==='human'){passing=true;$('pass-message').textContent=`${playerLabel(match.currentPlayer)}, you’re up.`;render();showDialog('pass-dialog');}
  else{render();if(isBotTurn())runBot(version);}
}
function stopAsyncWork(){
  version++;scene?.cancel();cancelMotion();botCancel?.();botCancel=null;botWorker?.terminate();botWorker=null;
  busy=false;passing=false;botThinking=false;$('dice-stage').classList.remove('rolling');$('celebration').replaceChildren();
}
function startMatch(nextSetup=setup){
  stopAsyncWork();remote.detach();remoteRoom=null;setup={...nextSetup};match=E.createMatch(setup);matchId=randomId();
  displayedValues=[null,null];lastResult=null;botReason='';uploaded=false;uploadStatus='';events=[];log('Match started.');scene?.setValues(displayedValues);
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());render();enter($('game'));announce(`New match. ${playerLabel(0)} to roll.`);
}

function workerChoice(state, token) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('bot-worker.js'); botWorker = worker;
    const timeout = setTimeout(() => complete(new Error('Bot took too long')), 30000);
    function complete(error, result) {
      clearTimeout(timeout); worker.terminate();
      if (botWorker === worker) { botWorker = null; botCancel = null; }
      error ? reject(error) : resolve(result);
    }
    botCancel = () => complete(new Error('Match restarted'));
    worker.onmessage = event => {
      if (!valid(token)) return complete(new Error('Match restarted'));
      if (event.data.error) complete(new Error(event.data.error)); else complete(null, event.data);
    };
    worker.onerror = () => complete(new Error('Bot unavailable'));
    worker.postMessage({ mode: setup.mode, state });
  });
}
async function botChoice(token) {
  const state = match.getPublicState(1);
  if (setup.mode.startsWith('llm_')) {
    const condition = setup.mode === 'llm_informed' ? 'informed' : 'naive';
    LLM.setCondition(condition);
    const provider = $('llmprovider').value || Object.keys(LLM.PROVIDERS).find(p => LLM.getApiKey(p));
    if (!provider || !LLM.getApiKey(provider)) throw new Error('No API key configured');
    const result = await LLM.callLLM(provider, state);
    return LLM.formatResult(result, provider, LLM.getModel(provider), condition);
  }
  return workerChoice(state, token);
}
async function runBot(token) {
  await sleep(450); if (!valid(token) || !isBotTurn()) return;
  if (!await rollTurn(true) || !valid(token)) return;
  await sleep(250); if (!valid(token)) return;
  if (!await revealFirst(Math.random() < .5 ? 0 : 1, true) || !valid(token)) return;
  botThinking = true; render();
  let decision;
  try { decision = await botChoice(token); }
  catch (error) { decision = { choice: 'defense', why: `${error.message}. Safe Defense fallback.` }; }
  if (!valid(token)) return;
  botThinking = false; botReason = decision.why;
  chooseAction(decision.choice === 'attack' ? 'attack' : 'defense', true);

}
function payload(){
  if(online())return {id:remoteRoom.state?.matchId,build:'K3-E1-REMOTE-2',source:'remote-vs',roomCode:remoteRoom.code,...setup,...remoteRoom.state};
  const data=match.exportMatch(),p=data.players;
  return {id:matchId,build:'K3-E1-ARCADE',source:setup.mode==='human'?'human-human':'human-bot',ruleset:'K3-E1',target:setup.target,kaputtLimit:setup.kaputtLimit,startingNtb:setup.startingNtb,
    playerA:playerLabel(0),playerB:playerLabel(1),playerAId:playerIdentity(),playerBId:setup.mode==='human'?`${playerIdentity()}-p2`:`bot-${setup.mode}`,winner:data.winner===null?null:`P${data.winner+1}`,terminalCause:data.winReason,turns:data.turns,
    scoreA:p[0].score,scoreB:p[1].score,kaputtA:p[0].kaputt,kaputtB:p[1].kaputt,leadChanges:data.leadChanges,extremes:data.extremes,finalNtb:data.finalNtb,
    setup:{...setup},history:data.history.map(t=>({...t,actor:`P${t.player+1}`,strategicHold:t.kaputt&&t.ntbAfter===t.ntbBefore?1:0}))};
}
function uploadMatch(){
  if(uploaded||online())return;uploaded=true;
  if(!queueMatch(payload()))uploadStatus='Device storage is full. Export this match to keep a copy.';
  else retryUploads();
}
function retryUploads(){return flushMatches(message=>{uploadStatus=message;if($('lab-dialog').open)renderLab();});}
function showDialog(id){
  document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());
  if(id==='lab-dialog')renderLab();$(id).showModal();enter($(id));
}
function exportJson(data,name='kaputt-k3e1-vs.json'){
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function remoteModel(room){
  const state=room.state||{phase:'idle',currentPlayer:0,turn:0,ntb:room.startingNtb,players:[{name:room.hostName,score:0,kaputt:0},{name:room.guestName||'Friend',score:0,kaputt:0}],winner:null,history:[],extremes:0,leadChanges:0,choice:null,firstDieIndex:null,visibleDie:null};
  return {...state,turnNumber:state.turn,isTerminal:state.winner!==null,getPublicState:()=>state};
}
async function receiveRoom(room,changed){
  const previous=remoteRoom,newSession=!online()||previous?.code!==room.code;
  remoteRoom=room;
  if(newSession){stopAsyncWork();events=[];botReason='';announce('Online room connected.');}
  setup={mode:'remote',target:room.target,kaputtLimit:room.kaputtLimit,startingNtb:room.startingNtb,playerName:room.hostName,player2Name:room.guestName||'Friend'};
  match=remoteModel(room);lastResult=room.state?.lastResult||null;
  if(!changed){renderConnection();return;}
  const token=++version;scene?.cancel();busy=false;
  if(newSession&&room.status==='waiting')showDialog('lobby-dialog');
  else if(newSession||previous?.status==='waiting'&&room.status==='playing'){
    document.querySelectorAll('dialog[open]').forEach(dialog=>dialog.close());enter($('game'));
  }
  if(newSession)events=(room.state?.history||[]).slice().reverse().map(e=>`#${e.turn} ${room.state.players[e.player].name} ${e.choice} · +${e.points}${e.kaputt?' KAPUTT':''}`);
  $('log').textContent=events.join('\n')||'Online room created.';
  const state=room.state,phase=state?.phase,previousPhase=previous?.state?.phase;
  const sameMatch=previous?.state?.matchId===state?.matchId;
  const shouldAnimate=!newSession&&sameMatch&&phase!==previousPhase&&['rolled','first','resolved'].includes(phase);
  if(shouldAnimate){
    busy=true;busyMessage=phase==='rolled'?'ROLLING…':'REVEALING…';render();
    if(phase==='rolled'){$('dice-stage').classList.add('rolling');displayedValues=[null,null];sfx('roll');await animation('roll');}
    else if(phase==='first')await animation('reveal',state.firstDieIndex,state.visibleDie);
    else if(lastResult)await animation('reveal',1-state.firstDieIndex,state.values[1-state.firstDieIndex]);
    if(!valid(token))return;
  }
  $('dice-stage').classList.remove('rolling');displayedValues=publicValues();scene?.setValues(displayedValues);busy=false;render();
  if(phase==='first'&&match.currentPlayer===me())enter($('decision-actions'));
  if(phase==='resolved'&&lastResult&&sameMatch&&previous?.state?.turn<state.turn)resultFeedback(lastResult);
  if(phase==='idle'&&previousPhase!=='idle')announce(`${playerLabel(match.currentPlayer)} to roll.`);
  if($('lab-dialog').open)renderLab();
}
const remote=new RemoteClient({onState:(room,changed)=>{receiveRoom(room,changed).catch(()=>announce('Screen refreshed. Please retry your move.'));},onConnection:status=>{connection={...connection,...status};if(online())render();}});
async function remoteCommand(action,details={}){
  try{
    const room=await remote.send(action,details);
    if(action==='choose'&&room?.state?.phase==='chosen'){
      const token=version;await sleep(reduced()?0:250);
      if(valid(token)&&online()&&match.phase==='chosen'&&match.currentPlayer===me())await remote.send('resolve');
    }
  }catch(error){announce(error.message);}
}
function settings(){return {mode:$('mode').value,target:+$('target').value,kaputtLimit:+$('klimit').value,startingNtb:+$('starting-ntb').value,playerName:$('player-name').value.trim()||'You',player2Name:$('player2-name').value.trim()||'Player 2'};}
function modeChanged(){
  const mode=$('mode').value,isLLM=mode.startsWith('llm_');
  $('p2-name-label').hidden=mode!=='human';$('llmsettings').hidden=!isLLM;if(isLLM)populateLLM();
  $('remote-settings').hidden=mode!=='remote';$('start-local').hidden=mode==='remote';$('setup-note').hidden=mode==='remote';
  $('resume-room').hidden=!remote.saved;
}
async function roomEntry(kind){
  if(roomBusy||remote.active)return;
  if(kind==='create'&&!$('setup-form').reportValidity())return;
  roomBusy=true;for(const id of ['create-room','join-room-btn','resume-room'])$(id).disabled=true;
  $('room-status').textContent=kind==='create'?'Creating your room…':'Joining your friend…';$('export-legacy').hidden=true;
  try{
    const s=settings();
    if(kind==='create')await remote.create({hostName:s.playerName,target:s.target,kaputtLimit:s.kaputtLimit,startingNtb:s.startingNtb});
    else await remote.join($('join-code').value.trim().toUpperCase(),s.playerName);
    $('room-status').textContent='';
  }catch(error){$('room-status').textContent=error.message;$('export-legacy').hidden=error.status!==426;if(!error.status)$('online-link').hidden=false;}
  finally{roomBusy=false;for(const id of ['create-room','join-room-btn','resume-room'])$(id).disabled=false;}
}
function newMatch(){
  if(remote.active&&!connection.fatal&&remoteRoom?.status!=='closed'){showDialog('leave-dialog');return;}
  if(remote.active){remote.detach();remoteRoom=null;setup.mode='human';match=E.createMatch(setup);displayedValues=[null,null];scene?.setValues(displayedValues);render();}
  $('player-name').value=getPlayerName();
  showDialog('setup-dialog');modeChanged();
}
let modelRequest=0;
async function refreshModels(){
  const request=++modelRequest,provider=$('llmprovider').value;if(!provider)return;
  $('llmmodel').replaceChildren(new Option('Loading models…',''));$('llmkey').value='';
  $('llmstatus').textContent=LLM.getApiKey(provider)?'Key saved in this browser.':'No key saved for this provider.';
  try{
    const models=await LLM.listModels(provider);if(request!==modelRequest)return;
    $('llmmodel').replaceChildren(...models.map(model=>new Option(model,model)));const saved=LLM.getModel(provider);
    if(models.includes(saved))$('llmmodel').value=saved;if($('llmmodel').value)LLM.setModel(provider,$('llmmodel').value);
  }catch{$('llmstatus').textContent='Could not list models. Check your provider and key, then retry.';}
}
function populateLLM(){
  if(!$('llmprovider').options.length){for(const [id,provider]of Object.entries(LLM.PROVIDERS))$('llmprovider').add(new Option(provider.name,id));const saved=Object.keys(LLM.PROVIDERS).find(id=>LLM.getApiKey(id));if(saved)$('llmprovider').value=saved;}
  $('llmtemp').value=LLM.getTemperature();refreshModels();
}
for(const [id,index]of [['die-left',0],['die-right',1]])$(id).addEventListener('click',()=>{
  if(!humanCanAct())return;
  if(online())return remoteCommand(match.phase==='rolled'?'reveal':'resolve',match.phase==='rolled'?{dieIndex:index}:{});
  if(match.phase==='rolled')revealFirst(index);else if(match.phase==='chosen'&&index!==match.firstDieIndex)resolveTurn();
});
for(const choice of ['attack','defense'])$(choice).addEventListener('click',()=>{if(humanCanAct())online()?remoteCommand('choose',{choice}):chooseAction(choice);});
$('primary-action').addEventListener('click',()=>{
  if(busy||passing)return;
  if(online()){
    if(connection.fatal)return newMatch();
    if(remoteRoom?.status==='waiting')return showDialog('lobby-dialog');
    if(remoteRoom?.status==='closed')return newMatch();
    if(match.isTerminal)return remoteCommand('rematch',{matchId:remoteRoom.state.matchId});
    if(!humanCanAct())return;
    return remoteCommand({idle:'roll',chosen:'resolve',resolved:'next'}[match.phase]);
  }
  if(match.isTerminal)return startMatch();
  if(match.phase==='idle')rollTurn();else if(match.phase==='chosen')resolveTurn();else if(match.phase==='resolved')nextTurn();
});
$('ready').addEventListener('click',()=>{passing=false;$('pass-dialog').close();render();});
$('pass-dialog').addEventListener('cancel',event=>event.preventDefault());
for(const [button,dialog]of [['open-menu','menu-dialog'],['open-rules','rules-dialog'],['open-lab','lab-dialog'],['open-room','lobby-dialog']])$(button).addEventListener('click',()=>showDialog(dialog));
$('open-setup').addEventListener('click',newMatch);
$('open-profile').addEventListener('click',()=>{$('profile-name').value=getPlayerName();showDialog('profile-dialog')});
$('save-profile').addEventListener('click',()=>{const name=$('profile-name').value.trim();if(!name)return;setPlayerName(name);setup.playerName=name;$('profile-status').textContent='Name saved as '+name;});
let lbRequest=0;function loadLeaderboard(period='all'){
  const revision=++lbRequest,status=$('lb-status'),ranking=$('lb-ranking');
  status.hidden=false;status.textContent='Loading standings…';
  fetch('/api/leaderboard?limit=50&period='+period,{cache:'no-store',signal:AbortSignal.timeout(9000)}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(d=>{
    if(revision!==lbRequest)return;if(!d.ok)throw new Error();ranking.replaceChildren();
    if(!d.players.length){status.textContent='No finished matches in this period. Play a round to get on the board.';return;}
    status.hidden=true;
    d.players.forEach((p,i)=>{const row=document.createElement('li'),top=document.createElement('div');top.className='rank-top';
      for(const[cls,text]of[['rank-number',i+1],['rank-name',p.name],['wins',`${p.wins} ${p.wins===1?'win':'wins'}`]]){const span=document.createElement('span');span.className=cls;span.textContent=text;top.append(span);}
      const stats=document.createElement('p');stats.className='rank-stats';
      for(const[val,lbl]of[[p.win_rate+'%','win rate'],[p.losses,'losses'],[p.matches_played,p.matches_played===1?'match':'matches'],[p.avg_turns,'avg turns'],[p.best_score,'best score']]){const span=document.createElement('span'),b=document.createElement('b');b.textContent=val;span.append(b,' '+lbl);stats.append(span);}
      row.append(top,stats);ranking.append(row);});
  }).catch(()=>{if(revision!==lbRequest)return;ranking.replaceChildren();status.textContent="Standings couldn't load.";});
  const badges=$('lb-badges'),bmsg=$('lb-badge-status');
  bmsg.hidden=false;bmsg.textContent='Loading badges…';
  fetch('/api/badges',{cache:'no-store',signal:AbortSignal.timeout(9000)}).then(r=>{if(!r.ok)throw new Error();return r.json()}).then(d=>{
    if(!d.ok)throw new Error();badges.replaceChildren();bmsg.hidden=!!d.badges.length;bmsg.textContent='No badges earned yet.';
    for(const badge of d.badges){const card=document.createElement('article');card.className='badge';const icon=document.createElement('img');icon.src='assets/icons/trophy-fill.svg';icon.alt='';card.append(icon);
      for(const[tag,text]of[['h3',badge.label],['p',badge.player],['small',badge.value],['small',badge.desc]]){const el=document.createElement(tag);el.textContent=text;card.append(el);}badges.append(card);}
  }).catch(()=>{bmsg.textContent="Badges couldn't load.";});
}
for(const btn of document.querySelectorAll('#leaderboard-dialog [data-period]'))btn.addEventListener('click',()=>{document.querySelectorAll('#leaderboard-dialog [data-period]').forEach(b=>b.setAttribute('aria-pressed',String(b===btn)));loadLeaderboard(btn.dataset.period);});
$('open-leaderboard').addEventListener('click',()=>{showDialog('leaderboard-dialog');loadLeaderboard();});
$('open-leaderboard-menu').addEventListener('click',()=>{showDialog('leaderboard-dialog');loadLeaderboard();});
for(const button of document.querySelectorAll('[data-close]'))button.addEventListener('click',()=>$(button.dataset.close).close());
$('toggle-sound').addEventListener('click',()=>{sound=!sound;try{localStorage.setItem('kaputt-sound',sound?'on':'off');}catch{}render();});
$('toggle-motion').addEventListener('click',()=>{toggleMotion();scene?.finish();render();});
$('mode').addEventListener('change',modeChanged);
$('setup-form').addEventListener('submit',event=>{event.preventDefault();if($('mode').value==='remote')return roomEntry('join');if($('setup-form').reportValidity())startMatch(settings());});
$('create-room').addEventListener('click',()=>roomEntry('create'));$('join-room-btn').addEventListener('click',()=>roomEntry('join'));
$('join-code').addEventListener('input',()=>{$('join-code').value=$('join-code').value.toUpperCase().replace(/[^A-Z0-9]/g,'');});
$('resume-room').addEventListener('click',()=>{remote.resume(remote.saved);$('room-status').textContent='Resuming your room…';});
$('retry-connection').addEventListener('click',()=>remote.retry().catch(error=>announce(error.message)));
$('copy-room').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(remoteRoom.code);$('lobby-status').textContent='Room code copied.';}catch{$('lobby-status').textContent=`Share this code: ${remoteRoom.code}`;}});
$('share-room').addEventListener('click',async()=>{
  const url=new URL(location.href);url.pathname='/';url.search=`?room=${remoteRoom.code}`;url.hash='';
  try{if(navigator.share)await navigator.share({title:'Play KAPUTT with me',text:`Join my KAPUTT room: ${remoteRoom.code}`,url:url.href});else{await navigator.clipboard.writeText(url.href);$('lobby-status').textContent='Invite link copied.';}}catch(error){if(error.name!=='AbortError')$('lobby-status').textContent=`Share room code ${remoteRoom.code}.`;}
});
$('leave-room').addEventListener('click',()=>showDialog('leave-dialog'));
$('confirm-leave').addEventListener('click',async()=>{
  $('confirm-leave').disabled=true;$('leave-status').textContent='Leaving…';
  try{const room=await remote.send('leave');if(!room)throw new Error('Wait for the pending move, then retry.');startMatch({...setup,mode:'human'});showDialog('setup-dialog');modeChanged();$('leave-status').textContent='';}
  catch(error){$('leave-status').textContent=error.message;}finally{$('confirm-leave').disabled=false;}
});
$('export-legacy').addEventListener('click',async()=>{
  try{const result=await remote.request(`/api/rooms/${$('join-code').value.toUpperCase()}/archive`);exportJson(result.archive,'kaputt-previous-room.json');}catch(error){$('room-status').textContent=error.message;}
});
$('llmprovider').addEventListener('change',refreshModels);$('llmmodel').addEventListener('change',()=>LLM.setModel($('llmprovider').value,$('llmmodel').value));
$('llmtemp').addEventListener('change',()=>{if($('llmtemp').checkValidity())LLM.setTemperature(+$('llmtemp').value);});
$('llmsave').addEventListener('click',async()=>{const key=$('llmkey').value.trim();if(!key)return;LLM.setApiKey($('llmprovider').value,key);$('llmkey').value='';await refreshModels();});
$('llmclear').addEventListener('click',()=>{LLM.clearAllKeys();$('llmkey').value='';refreshModels();});
$('export').addEventListener('click',()=>exportJson(payload()));$('retry-upload').addEventListener('click',retryUploads);addEventListener('online',retryUploads);
$('game').addEventListener('dice-renderer-lost',()=>{scene?.dispose();scene=null;$('dice-stage').classList.remove('has-webgl');announce('3D rendering is unavailable. Dice values remain accessible.');});
// Setup renders immediately; optional 3D loading never blocks starting a game.
displayedValues=publicValues();render();modeChanged();
const invite=new URLSearchParams(location.search).get('room');
if(invite&&/^[A-Z0-9]{4}$/i.test(invite)){$('mode').value='remote';$('join-code').value=invite.toUpperCase();modeChanged();}
if(remote.current&&!invite){$('mode').value='remote';setup.mode='remote';remote.resume(remote.current);render();}else showDialog('setup-dialog');
retryUploads();
import('./dice-scene.js').then(({DiceScene})=>{scene=new DiceScene($('dice-renderer'));const canvas=scene.renderer.domElement;const shell=$('game');shell.prepend(canvas);scene.container=shell;scene.resize();new ResizeObserver(()=>scene.resize()).observe(shell);$('dice-stage').classList.add('has-webgl');scene.setValues(displayedValues);}).catch(error=>console.warn('3D dice unavailable; accessible dice enabled.',error.message));

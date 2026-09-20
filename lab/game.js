// Mobile UI for the shared K3-E1 engine. Dice results never enter the DOM or
// renderer until they are revealed. Bot/LLM inputs are public-state snapshots.
const $ = id => document.getElementById(id);
const E = window.KaputtEngine;
const LLM = window.KaputtLLM;

// Player identity: UUID stored in localStorage, sent with all API requests
function getPlayerUUID() {
  let uuid = localStorage.getItem('kaputt-player-uuid');
  if (!uuid) {
    uuid = crypto.randomUUID();
    localStorage.setItem('kaputt-player-uuid', uuid);
  }
  return uuid;
}
const PLAYER_UUID = getPlayerUUID();

let setup = { mode: 'human', target: 100, kaputtLimit: 5, startingNtb: 1, playerName: 'You', player2Name: 'Player 2' };
let match = E.createMatch(setup);
let version = 0, busy = false, passing = false, botThinking = false;
let busyMessage = '', displayedValues = [null, null], lastResult = null;
let scene = null, botWorker = null, botCancel = null, botReason = '';
let uploaded = false, uploadStatus = '', events = ['Match started.'];
let sound = true, audioContext = null;
try { sound = localStorage.getItem('kaputt-sound') !== 'off'; } catch {}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const isBotTurn = () => setup.mode !== 'human' && match.currentPlayer === 1;
const valid = token => token === version;
const humanCanAct = () => {
  if (busy || passing || match.isTerminal) return false;
  if (setup.mode === 'remote') {
    if (!remoteRoom || remotePlayerIndex === null) return false;
    try { const s = JSON.parse(remoteRoom.current_state_json || '{}'); return s.currentPlayer === remotePlayerIndex && s.phase === 'playing'; } catch { return false; }
  }
  return !isBotTurn();
};
const playerLabel = index => {
  if (index === 1 && setup.mode !== 'human') return ($('mode').querySelector(`option[value="${setup.mode}"]`)?.textContent || 'Bot');
  return index === 0 ? (setup.playerName || 'Player 1') : (setup.player2Name || 'Player 2');
};
function announce(text) { $('game-announcement').textContent = text; }
function log(text) { events.unshift(text); $('log').textContent = events.join('\n'); }
function tone(freq, duration = .09, delay = 0, type = 'sine') {
  if (!sound) return;
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
    const start = audioContext.currentTime + delay;
    oscillator.type = type; oscillator.frequency.value = freq;
    gain.gain.setValueAtTime(.035, start); gain.gain.exponentialRampToValueAtTime(.001, start + duration);
    oscillator.connect(gain); gain.connect(audioContext.destination);
    oscillator.start(start); oscillator.stop(start + duration);
  } catch {}
}
function sfx(kind) {
  if (kind === 'roll') { for (let i = 0; i < 5; i++) tone(140 + i * 35, .035, i * .06, 'triangle'); }
  else if (kind === 'kaputt') { tone(170, .15); tone(90, .24, .1); }
  else if (kind === 'win') { [440, 550, 660, 880].forEach((f, i) => tone(f, .18, i * .08)); }
  else if (kind === 'success') { tone(440, .1); tone(660, .14, .08); }
  else tone(520, .07, 0, 'triangle');
}
function showPopup(text, kind) {
  const el = $('event-popup'), span = $('event-popup-text');
  span.textContent = text;
  el.className = `event-popup pop-${kind} show`;
  el.onanimationend = () => { el.className = 'event-popup'; };
}
function drawPenalties(id, count) {
  const root = $(id); root.replaceChildren();
  root.classList.toggle('many', setup.kaputtLimit > 5);
  for (let i = 0; i < setup.kaputtLimit; i++) {
    const dot = document.createElement('span');
    dot.className = `penalty-dot${i < count ? ' filled' : ''}`; root.append(dot);
  }
}
function renderLab() {
  const p = match.players;
  $('telemetry').textContent = `Turns ${match.turnNumber} Â· Extremes ${match.extremes} Â· Lead changes ${match.leadChanges}. P1 A/D ${p[0].attackCount}/${p[0].defenseCount} Â· P2 A/D ${p[1].attackCount}/${p[1].defenseCount}`;
  $('botwhy').textContent = botReason;
  $('upload-status').textContent = uploadStatus;
  $('matrix').replaceChildren();
  const state = match.getPublicState();
  if ([E.Phase.FIRST, E.Phase.CHOSEN].includes(match.phase)) {
    $('prob').textContent = `Visible die ${state.visibleDie} Â· Number to beat ${match.ntb}`;
    const a = E.conditionalStats(state.visibleDie, match.ntb, 'attack');
    const d = E.conditionalStats(state.visibleDie, match.ntb, 'defense');
    const pct = n => `${(n * 100).toFixed(1)}%`;
    for (const [label, av, dv] of [
      ['P(> target)', pct(a.success), pct(d.success)],
      ['P(Kaputt)', pct(a.kaputt), pct(d.kaputt)],
      ['Expected points', a.points.toFixed(2), d.points.toFixed(2)],
      ['Expected next target', a.nextNtb.toFixed(2), d.nextNtb.toFixed(2)],
      ['P(Extreme)', pct(a.extreme), pct(d.extreme)],
    ]) {
      const row = document.createElement('tr');
      for (const value of [label, av, dv]) { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); }
      $('matrix').append(row);
    }
  } else $('prob').textContent = 'Reveal one die to see conditional outcomes.';
}
function render() {
  if (setup.mode === 'remote') return;
  const state = match.getPublicState();
  const phase = match.phase;
  const me = setup.mode === 'human' ? match.currentPlayer : 0, opponent = 1 - me;
  const players = match.players;
  $('game').dataset.phase = busy ? 'animating' : phase;
  $('game').dataset.terminal = String(match.isTerminal);
  $('game').dataset.passing = String(passing);
  $('target-label').textContent = setup.target;
  document.querySelectorAll('.score-target').forEach(el => el.textContent = setup.target);
  $('opponent-name').textContent = playerLabel(opponent).toUpperCase();
  $('self-name').textContent = match.isTerminal ? (match.winner === me ? 'WINNER!' : 'GOOD GAME')
    : isBotTurn() ? setup.playerName || 'Player 1' : setup.mode === 'human' && me === 1 ? `${setup.playerName || 'Player 2'} Â· YOUR TURN` : `${setup.playerName || 'You'} Â· YOUR TURN`;
  $('opponent-score').textContent = players[opponent].score;
  $('self-score').textContent = players[me].score;
  $('opponent-kaputts').textContent = `${players[opponent].kaputt}/${setup.kaputtLimit}`;
  $('self-kaputts').textContent = `${players[me].kaputt}/${setup.kaputtLimit}`;
  drawPenalties('opponent-dots', players[opponent].kaputt);
  drawPenalties('self-dots', players[me].kaputt);
  $('ntb').textContent = match.ntb;
  $('attack-short').textContent = `Multiply Â· beat ${match.ntb}`;
  const canAct = humanCanAct();
  for (let i = 0; i < 2; i++) {
    const button = $(i === 0 ? 'die-left' : 'die-right');
    const location = i === 0 ? 'Left' : 'Right';
    const value = displayedValues[i];
    const canReveal = canAct && (phase === E.Phase.ROLLED || (phase === E.Phase.CHOSEN && i !== state.firstDieIndex));
    button.disabled = !canReveal;
    button.setAttribute('aria-label', value === null ? `${canReveal ? 'Reveal ' : ''}${location.toLowerCase()} die${canReveal ? '' : ', hidden'}` : `${location} die: ${value}`);
    button.querySelector('.die-fallback').textContent = value ?? '?';
    button.querySelector('.die-fallback').classList.toggle('revealed', value !== null);
  }
  const decisionVisible = phase === E.Phase.FIRST && !busy && !isBotTurn();
  $('decision-actions').hidden = !decisionVisible;
  $('attack').disabled = !decisionVisible || !canAct;
  $('defense').disabled = !decisionVisible || !canAct;
  const primary = $('primary-action');
  primary.hidden = decisionVisible || (!busy && !isBotTurn() && phase === E.Phase.ROLLED) || (setup.mode === 'remote' && phase === E.Phase.RESOLVED);
  primary.disabled = busy || passing || (isBotTurn() && phase !== E.Phase.RESOLVED);
  let title = 'READY TO ROLL?', detail = 'Two dice. One decision.', action = 'ROLL THE DICE';
  if (phase === E.Phase.ROLLED) { title = 'PICK A DIE TO REVEAL'; detail = 'Left or right. The choice is yours.'; }
  if (phase === E.Phase.FIRST) { title = 'CHOOSE YOUR MOVE'; detail = ''; }
  if (phase === E.Phase.CHOSEN) { title = `${match.choice.toUpperCase()} LOCKED IN`; detail = 'Your move is set. Reveal the other die.'; action = 'REVEAL SECOND DIE'; }
  if (phase === E.Phase.RESOLVED && lastResult) {
    title = lastResult.kaputt ? 'KAPUTT!' : lastResult.extreme ? `EXTREME! +${lastResult.points}` : `+${lastResult.points} POINTS`;
    detail = lastResult.kaputt ? 'No points. The target holds.' : `${match.choice === 'attack' ? 'Attack' : 'Defense'} pays off.`;
    action = setup.mode === 'remote' ? 'WAITING FOR OPPONENT' : setup.mode === 'human' ? 'PASS THE TURN' : isBotTurn() ? 'YOUR TURN' : 'NEXT TURN';
  }
  if (botThinking) { title = 'OPPONENT IS THINKING'; detail = 'Only the revealed die is visible to your opponent.'; action = 'THINKINGâ€¦'; }
  if (busy) { title = busyMessage; detail = ''; action = busyMessage; }
  if (match.isTerminal && !busy) {
    title = `${playerLabel(match.winner).toUpperCase()} WINS!`;
    detail = `${match.winReason === 'score target' ? 'Score target reached' : 'Opponent reached the Kaputt limit'} Â· ${match.turnNumber} ${match.turnNumber === 1 ? 'turn' : 'turns'}`;
    action = 'PLAY AGAIN'; primary.disabled = false; primary.hidden = false;
  }
  $('turn-title').textContent = title;
  $('turn-detail').textContent = detail;
  $('primary-label').textContent = action;
  $('toggle-sound').setAttribute('aria-pressed', String(sound));
  $('sound-label').textContent = sound ? 'Sound on' : 'Sound off';
  renderLab();
}
function publicValues() {
  const state = match.getPublicState();
  const values = [null, null];
  if (state.visibleDie !== null) values[state.firstDieIndex] = state.visibleDie;
  if (match.phase === E.Phase.RESOLVED && lastResult) values[1 - state.firstDieIndex] = lastResult.hiddenDie;
  return values;
}
async function animation(kind, index, value) {
  if (scene) return kind === 'roll' ? scene.roll() : scene.reveal(index, value);
  if (!reduceMotion()) await sleep(kind === 'roll' ? 900 : 220);
}
async function rollTurn(bot = false) {
  if (busy || passing || match.isTerminal || match.phase !== E.Phase.IDLE || (!bot && isBotTurn())) return false;
  const token = version;
  match.roll(); displayedValues = [null, null]; lastResult = null; botReason = '';
  busy = true; busyMessage = 'ROLLINGâ€¦'; $('dice-stage').classList.add('rolling'); render(); sfx('roll');
  await animation('roll');
  if (!valid(token)) return false;
  $('dice-stage').classList.remove('rolling'); busy = false; render();
  announce('Both dice are hidden. Choose the left or right die to reveal.');
  return true;
}
async function revealFirst(index, bot = false) {
  if (busy || passing || match.isTerminal || match.phase !== E.Phase.ROLLED || (!bot && isBotTurn())) return false;
  const token = version;
  const result = match.revealFirst(index);
  busy = true; busyMessage = 'REVEALINGâ€¦'; render(); sfx('reveal');
  await animation('reveal', index, result.visibleDie);
  if (!valid(token)) return false;
  displayedValues[index] = result.visibleDie; scene?.setValues(displayedValues); busy = false; render();
  announce(`${index === 0 ? 'Left' : 'Right'} die is ${result.visibleDie}. Choose Attack or Defense before revealing the other die.`);
  return true;
}
function chooseAction(choice, bot = false) {
  if (busy || passing || match.isTerminal || match.phase !== E.Phase.FIRST || (!bot && isBotTurn())) return false;
  match.choose(choice); sfx('reveal'); render();
  announce(`${choice} committed. Reveal the other die.`);
  resolveTurn(bot);
  return true;
}
async function resolveTurn(bot = false) {
  if (busy || passing || match.isTerminal || match.phase !== E.Phase.CHOSEN || (!bot && isBotTurn())) return false;
  const token = version;
  busy = true; busyMessage = 'REVEALINGâ€¦'; render();
  const event = match.revealSecond();
  event.botReason = botReason || null;
  await animation('reveal', 1 - event.firstDieIndex, event.hiddenDie);
  if (!valid(token)) return false;
  lastResult = event; displayedValues = publicValues(); scene?.setValues(displayedValues); busy = false;
  log(`#${event.turn} P${event.player + 1} ${event.choice} Â· ${event.visibleDie}/${event.hiddenDie} â†’ ${event.value} Â· +${event.points}${event.kaputt ? ' KAPUTT' : ''}`);
  render(); sfx(match.isTerminal ? 'win' : event.kaputt ? 'kaputt' : 'success');
  if (match.isTerminal) { showPopup(match.winner === (setup.mode === 'human' ? event.player : 0) ? 'YOU WIN!' : 'GAME OVER', 'win'); }
  else if (event.extreme && event.choice === 'attack') showPopup('EXTREME Â· 36', 'extreme');
  else if (event.extreme && event.choice === 'defense') showPopup('EXTREME Â· 2', 'extreme');
  else if (event.kaputt) showPopup('KAPUTT!', 'kaputt');
  else if (event.points >= 20) showPopup(`+${event.points}`, 'success');
  announce(`${event.kaputt ? 'Kaputt. No points.' : `${event.points} points.`} Number to beat ${event.ntbAfter}.${match.isTerminal ? ` ${playerLabel(match.winner)} wins.` : ''}`);
  if (match.isTerminal) uploadMatch();
  if (setup.mode === 'remote' && remoteRoom) {
    submitRemoteAction(event.choice, event.visibleDie, event.hiddenDie);
  }
  return true;
}
async function tapDie(index) {
  if (!humanCanAct()) return;
  if (match.phase === E.Phase.ROLLED) await revealFirst(index);
  else if (match.phase === E.Phase.CHOSEN && index !== match.firstDieIndex) await resolveTurn();
}
function nextTurn() {
  if (busy || match.phase !== E.Phase.RESOLVED || match.isTerminal) return;
  if (setup.mode === 'remote') return;
  match.nextTurn(); displayedValues = [null, null]; lastResult = null; botReason = '';
  scene?.setValues(displayedValues);
  if (setup.mode === 'human') {
    passing = true;
    $('pass-message').textContent = `${playerLabel(match.currentPlayer)}, youâ€™re up.`;
    render(); $('pass-dialog').showModal();
  } else { render(); if (isBotTurn()) runBot(version); }
}
function stopAsyncWork() {
  version++; scene?.cancel(); botCancel?.(); botCancel = null;
  botWorker?.terminate(); botWorker = null;
  busy = false; passing = false; botThinking = false;
  $('dice-stage').classList.remove('rolling');
}
function startMatch(nextSetup = setup) {
  stopAsyncWork();
  setup = { ...nextSetup }; match = E.createMatch(setup);
  displayedValues = [null, null]; lastResult = null; botReason = ''; uploaded = false; uploadStatus = '';
  events = []; log('Match started.'); scene?.setValues(displayedValues);
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  render(); announce('New match. Player 1 to roll.');
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
  await sleep(650); if (!valid(token)) return;
  await resolveTurn(true);
}
function payload() {
  const data = match.exportMatch(), p = data.players;
  return {
    build: 'K3-E1-ARCADE', source: setup.mode === 'human' ? 'human-human' : 'human-bot', ruleset: 'K3-E1',
    target: setup.target, kaputtLimit: setup.kaputtLimit, startingNtb: setup.startingNtb,
    playerA: 'P1', playerB: setup.mode === 'human' ? 'P2' : playerLabel(1),
    winner: data.winner === null ? null : `P${data.winner + 1}`, terminalCause: data.winReason,
    turns: data.turns, scoreA: p[0].score, scoreB: p[1].score, kaputtA: p[0].kaputt, kaputtB: p[1].kaputt,
    leadChanges: data.leadChanges, extremes: data.extremes, finalNtb: data.finalNtb,
    setup: { opponent: setup.mode, winScore: setup.target, loseAtKaputt: setup.kaputtLimit, ...setup },
    history: data.history.map(t => ({ ...t, actor: `P${t.player + 1}`, strategicHold: t.kaputt && t.ntbAfter === t.ntbBefore ? 1 : 0 })),
  };
}
async function uploadMatch() {
  if (uploaded) return; uploaded = true;
  // D1 is available on the Worker deployment; GitHub Pages/local games remain playable.
  if (!location.hostname.endsWith('.workers.dev')) return;
  const token = version; uploadStatus = 'Saving matchâ€¦'; renderLab();
  try {
    const response = await fetch('/api/matches', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload()) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json(); if (!valid(token)) return;
    uploadStatus = `Match saved: ${result.id}`;
  } catch { if (!valid(token)) return; uploadStatus = 'Match could not be saved online. Export JSON to keep it.'; }
  renderLab();
}
function showDialog(id) {
  document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
  if (id === 'lab-dialog') renderLab();
  $(id).showModal();
}
let modelRequest = 0;
async function refreshModels() {
  const request = ++modelRequest, provider = $('llmprovider').value;
  if (!provider) return;
  $('llmmodel').replaceChildren(new Option('Loading modelsâ€¦', ''));
  $('llmkey').value = '';
  $('llmstatus').textContent = LLM.getApiKey(provider) ? 'Key saved in this browser.' : 'No key saved for this provider.';
  const models = await LLM.listModels(provider);
  if (request !== modelRequest) return;
  $('llmmodel').replaceChildren(...models.map(model => new Option(model, model)));
  const saved = LLM.getModel(provider);
  if (models.includes(saved)) $('llmmodel').value = saved;
  if ($('llmmodel').value) LLM.setModel(provider, $('llmmodel').value);
}
function populateLLM() {
  if (!$('llmprovider').options.length) {
    for (const [id, provider] of Object.entries(LLM.PROVIDERS)) $('llmprovider').add(new Option(provider.name, id));
    const saved = Object.keys(LLM.PROVIDERS).find(id => LLM.getApiKey(id));
    if (saved) $('llmprovider').value = saved;
  }
  $('llmtemp').value = LLM.getTemperature(); refreshModels();
}
$('die-left').addEventListener('click', () => tapDie(0));
$('die-right').addEventListener('click', () => tapDie(1));
$('attack').addEventListener('click', () => chooseAction('attack'));
$('defense').addEventListener('click', () => chooseAction('defense'));
$('primary-action').addEventListener('click', () => {
  if (busy || passing) return;
  if (match.isTerminal) return startMatch();
  if (match.phase === E.Phase.IDLE) rollTurn();
  else if (match.phase === E.Phase.CHOSEN) resolveTurn();
  else if (match.phase === E.Phase.RESOLVED) nextTurn();
});
$('ready').addEventListener('click', () => { passing = false; $('pass-dialog').close(); render(); });
$('pass-dialog').addEventListener('cancel', event => event.preventDefault());
$('open-menu').addEventListener('click', () => showDialog('menu-dialog'));
$('open-setup').addEventListener('click', () => showDialog('setup-dialog'));
$('open-rules').addEventListener('click', () => showDialog('rules-dialog'));
$('open-lab').addEventListener('click', () => showDialog('lab-dialog'));
for (const button of document.querySelectorAll('[data-close]')) button.addEventListener('click', () => $(button.dataset.close).close());
$('toggle-sound').addEventListener('click', () => { sound = !sound; try { localStorage.setItem('kaputt-sound', sound ? 'on' : 'off'); } catch {} render(); });
$('mode').addEventListener('change', () => {
  const mode = $('mode').value;
  const isHuman = mode === 'human';
  const isLLM = mode.startsWith('llm_');
  const isRemote = mode === 'remote';
  $('llmsettings').hidden = !isLLM; if (isLLM) populateLLM();
  const p2 = $('p2-name-label'); if (p2) p2.hidden = !isHuman;
  const rs = $('remote-settings'); if (rs) rs.hidden = !isRemote;
});
$('setup-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('setup-form').reportValidity()) return;
  startMatch({ mode: $('mode').value, target: +$('target').value, kaputtLimit: +$('klimit').value, startingNtb: +$('starting-ntb').value, playerName: ($('player-name')?.value || 'You').trim() || 'You', player2Name: ($('player2-name')?.value || 'Player 2').trim() || 'Player 2' });
});
$('llmprovider').addEventListener('change', refreshModels);
$('llmmodel').addEventListener('change', () => LLM.setModel($('llmprovider').value, $('llmmodel').value));

let remotePolling = null, remoteRoom = null, remotePlayerIndex = null, remoteLastTurn = -1;

if ($('create-room')) {
  $('create-room').addEventListener('click', async () => {
    const name = ($('player-name')?.value || 'Host').trim();
    $('room-status').textContent = 'Creating room...';
    try {
      const r = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-UUID': PLAYER_UUID }, body: JSON.stringify({ hostName: name, target: +$('target').value, kaputtLimit: +$('klimit').value, startingNtb: +$('starting-ntb').value }) });
      const d = await r.json();
      if (d.ok) {
        remotePlayerIndex = 0;
        remoteLastTurn = -1;
        remoteRoom = { code: d.code, host_name: name, status: 'waiting', target: +$('target').value, kaputt_limit: +$('klimit').value, starting_ntb: +$('starting-ntb').value };
        $('room-status').textContent = `Room code: ${d.code} \u2014 share this with your opponent. Waiting for them to join...`;
        $('room-status').dataset.code = d.code;
        startRoomPolling(d.code);
      } else $('room-status').textContent = 'Error: ' + (d.error || 'Failed');
    } catch (e) { $('room-status').textContent = 'Network error.'; }
  });
}
if ($('join-room-btn')) {
  $('join-room-btn').addEventListener('click', () => {
    const jl = $('join-code-label'); if (jl) jl.hidden = !jl.hidden;
    $('room-status').textContent = 'Enter the 4-character room code.';
  });
}
if ($('join-code')) {
  $('join-code').addEventListener('input', async () => {
    const code = $('join-code').value.toUpperCase().trim();
    if (code.length !== 4) return;
    const name = ($('player-name')?.value || 'Guest').trim();
    $('room-status').textContent = 'Joining...';
    try {
      const r = await fetch(`/api/rooms/${code}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-UUID': PLAYER_UUID }, body: JSON.stringify({ guestName: name }) });
      const d = await r.json();
      if (d.ok) {
        remotePlayerIndex = d.playerIndex ?? 1;
        remoteLastTurn = -1;
        remoteRoom = { code, host_name: d.room?.host_name, guest_name: d.room?.guest_name, status: d.room?.status, current_state_json: d.room?.current_state_json, target: d.room?.target, kaputt_limit: d.room?.kaputt_limit, starting_ntb: d.room?.starting_ntb };
        if (d.room?.current_state_json) {
          const state = JSON.parse(d.room.current_state_json);
          remoteLastTurn = state.turn ?? 0;
          document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
          syncRemoteState(state, remoteRoom);
        }
        $('room-status').textContent = `Joined room ${code}! Match starting...`;
        startRoomPolling(code);
      } else $('room-status').textContent = 'Error: ' + (d.error || 'Failed to join');
    } catch (e) { $('room-status').textContent = 'Network error.'; }
  });
}

function startRoomPolling(code) {
  if (remotePolling) clearInterval(remotePolling);
  remotePolling = setInterval(() => pollRoomState(code), 1500);
  pollRoomState(code);
}

async function pollRoomState(code) {
  try {
    const r = await fetch(`/api/rooms/${code}`);
    const d = await r.json();
    if (!d.ok) return;
    const room = d.room;
    remoteRoom = room;
    if (room.status === 'waiting') {
      $('room-status').textContent = `Room ${code} \u2014 waiting for opponent to join...`;
      return;
    }
    const state = JSON.parse(room.current_state_json || '{}');
    if ((room.status === 'playing' || room.status === 'finished') && (state.turn ?? 0) > remoteLastTurn) {
      remoteLastTurn = state.turn ?? 0;
      document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
      syncRemoteState(state, room);
    }
    if (room.status === 'finished') {
      clearInterval(remotePolling); remotePolling = null;
    }
  } catch {}
}

function syncRemoteState(state, room) {
  const myIdx = remotePlayerIndex;
  const isMyTurn = state.currentPlayer === myIdx && state.phase === 'playing';
  const oppIdx = 1 - myIdx;
  const myName = state.players[myIdx]?.name || 'You';
  const oppName = state.players[oppIdx]?.name || 'Opponent';

  $('opponent-name').textContent = oppName.toUpperCase();
  $('self-name').textContent = state.phase === 'finished'
    ? (state.winner === myIdx ? 'YOU WIN!' : 'GAME OVER')
    : isMyTurn ? `${myName} \u00B7 YOUR TURN` : `${myName} \u2014 waiting`;
  $('opponent-score').textContent = state.players[oppIdx]?.score || 0;
  $('self-score').textContent = state.players[myIdx]?.score || 0;
  $('opponent-kaputts').textContent = `${state.players[oppIdx]?.kaputt || 0}/${state.kaputtLimit}`;
  $('self-kaputts').textContent = `${state.players[myIdx]?.kaputt || 0}/${state.kaputtLimit}`;
  $('ntb').textContent = state.ntb;
  $('target-label').textContent = state.target;

  if (state.lastResult) {
    const lr = state.lastResult;
    displayedValues = [lr.visibleDie, lr.hiddenDie];
    scene?.setValues(displayedValues);
    $('turn-title').textContent = lr.kaputt ? 'KAPUTT!' : lr.extreme ? `EXTREME! +${lr.points}` : `+${lr.points} POINTS`;
    $('turn-detail').textContent = lr.kaputt ? 'No points. The target holds.' : `${lr.action === 'attack' ? 'Attack' : 'Defense'} pays off.`;
    if (lr.kaputt) showPopup('KAPUTT!', 'kaputt');
    else if (lr.extreme) showPopup(`EXTREME \u00B7 ${lr.value}`, 'extreme');
    else if (lr.points >= 20) showPopup(`+${lr.points}`, 'success');
  }

  if (state.phase === 'finished') {
    $('turn-title').textContent = state.winner === myIdx ? 'YOU WIN!' : 'GAME OVER';
    $('turn-detail').textContent = state.lastResult?.winReason || '';
    showPopup(state.winner === myIdx ? 'YOU WIN!' : 'GAME OVER', state.winner === myIdx ? 'win' : 'lose');
    $('primary-action').hidden = false;
    $('primary-label').textContent = 'PLAY AGAIN';
    $('primary-action').disabled = false;
    $('decision-actions').hidden = true;
    return;
  }

  if (isMyTurn) {
    if ([E.Phase.IDLE, E.Phase.RESOLVED].includes(match.phase)) {
      match = E.createMatch({ target: state.target, kaputtLimit: state.kaputtLimit, startingNtb: state.ntb });
    }
    $('turn-title').textContent = match.phase === E.Phase.IDLE ? 'YOUR TURN' : $('turn-title').textContent;
    $('turn-detail').textContent = match.phase === E.Phase.IDLE ? 'Roll, reveal a die, choose Attack or Defense.' : $('turn-detail').textContent;
    $('primary-action').hidden = match.phase !== E.Phase.IDLE;
    $('primary-label').textContent = 'ROLL THE DICE';
    $('primary-action').disabled = match.phase !== E.Phase.IDLE;
  } else {
    $('turn-title').textContent = 'OPPONENT\u2019S TURN';
    $('turn-detail').textContent = `${oppName} is playing...`;
    $('primary-action').hidden = true;
    $('decision-actions').hidden = true;
  }
}

async function submitRemoteAction(action, visibleDie, hiddenDie) {
  if (!remoteRoom || remotePlayerIndex === null) return;
  const code = remoteRoom.code;
  try {
    const r = await fetch(`/api/rooms/${code}/action`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Player-UUID': PLAYER_UUID },
      body: JSON.stringify({ playerIndex: remotePlayerIndex, action, visibleDie, hiddenDie })
    });
    const d = await r.json();
    if (d.ok && d.state) {
      remoteRoom.current_state_json = JSON.stringify(d.state);
      remoteLastTurn = d.state.turn ?? remoteLastTurn;
      syncRemoteState(d.state, remoteRoom);
    } else {
      log('Action error: ' + (d.error || 'Unknown'));
    }
  } catch (e) { log('Network error submitting action.'); }
}
$('llmtemp').addEventListener('change', () => { if ($('llmtemp').checkValidity()) LLM.setTemperature(+$('llmtemp').value); });
$('llmsave').addEventListener('click', async () => {
  const key = $('llmkey').value.trim(); if (!key) return;
  LLM.setApiKey($('llmprovider').value, key); $('llmkey').value = ''; await refreshModels();
});
$('llmclear').addEventListener('click', () => { LLM.clearAllKeys(); $('llmkey').value = ''; refreshModels(); });
$('export').addEventListener('click', () => {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload(), null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'kaputt-k3e1-vs.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('dice-renderer').addEventListener('dice-renderer-lost', () => {
  scene?.dispose(); scene = null; $('dice-stage').classList.remove('has-webgl');
  announce('3D rendering is unavailable. Dice values remain accessible.');
});
// Importing/rendering failure must not stop the rules, keyboard controls, or game.
displayedValues = publicValues(); render();
try {
  const { DiceScene } = await import('./dice-scene.js');
  scene = new DiceScene($('dice-renderer'));
  const canvas = scene.renderer.domElement;
  const shell = $('game');
  shell.prepend(canvas);
  scene.container = shell;
  scene.resize();
  new ResizeObserver(() => scene.resize()).observe(shell);
  $('dice-stage').classList.add('has-webgl');
  displayedValues = publicValues(); scene.setValues(displayedValues); render();
} catch (error) { console.warn('3D dice unavailable; accessible dice enabled.', error.message); }
showDialog('setup-dialog');

// deploy-tick: 2026-09-20T15:37:34.9450012+02:00
export class ApiError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export const integer = (value, fallback, min, max, label) => {
  const n = value ?? fallback;
  if (!Number.isInteger(n) || n < min || n > max) throw new ApiError(`Invalid ${label}.`);
  return n;
};
export function playerName(value, fallback, maxLength = 24) {
  const name = typeof value === 'string' ? value.trim() : fallback;
  if (!name || name.length > maxLength || /[\u0000-\u001f]/.test(name)) throw new ApiError(`Use a name between 1 and ${maxLength} characters.`);
  return name;
}
export function canonicalMatch(body) {
  const m = body.match || body;
  const history = m.history || m.turnsData || [];
  if (!Array.isArray(history) || history.length > 5000) throw new ApiError('Invalid match history.');
  const winner = m.winner === 0 ? 'P1' : m.winner === 1 ? 'P2' : m.winner ?? null;
  if (![null, 'P1', 'P2'].includes(winner)) throw new ApiError('Invalid winner.');
  const result = {
    ...m, id: m.id || crypto.randomUUID(), winner, history,
    target: integer(m.target, 100, 1, 9999, 'score target'),
    kaputtLimit: integer(m.kaputtLimit, 5, 1, 20, 'Kaputt limit'),
    startingNtb: integer(m.startingNtb, 1, 0, 99, 'starting target'),
    playerA: playerName(m.playerA, 'P1', 128), playerB: playerName(m.playerB, 'P2', 128),
    turns: history.length,
    scoreA: m.scoreA ?? m.players?.[0]?.score ?? 0,
    scoreB: m.scoreB ?? m.players?.[1]?.score ?? 0,
    kaputtA: m.kaputtA ?? m.players?.[0]?.kaputt ?? m.players?.[0]?.k ?? 0,
    kaputtB: m.kaputtB ?? m.players?.[1]?.kaputt ?? m.players?.[1]?.k ?? 0,
  };
  if (typeof result.id !== 'string' || result.id.length > 100) throw new ApiError('Invalid match ID.');
  return result;
}
// The optional condition ties a remote match insert to the winning CAS receipt.
// All statements are committed in the caller's single D1 batch transaction.
export function matchStatements(db, m, condition = '1', args = []) {
  const statements = [db.prepare(`INSERT INTO matches
    (id,experiment_id,source,ruleset,target,kaputt_limit,starting_ntb,player_a,player_b,winner,terminal_cause,turns,score_a,score_b,kaputt_a,kaputt_b,lead_changes,payload_json)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${condition} ON CONFLICT(id) DO NOTHING`)
    .bind(m.id,m.experimentId||null,m.source||'human',m.ruleset||'K3-E1',m.target,m.kaputtLimit,m.startingNtb,
      m.playerA,m.playerB,m.winner,m.terminalCause||null,m.history.length,m.scoreA,m.scoreB,m.kaputtA,m.kaputtB,m.leadChanges||0,JSON.stringify(m),...args)];
  // Expand the history in SQLite: two statements even for long simulations.
  // A per-turn D1 batch would exceed the free-plan query budget on longer games.
  const history=m.history.map((t,i)=>({turn:t.turn??i+1,actor:t.actor??(Number.isInteger(t.player)?`P${t.player+1}`:'?'),
    scoreSelfBefore:t.scoreSelfBefore??t.scoreBefore?.[0]??null,scoreOpponentBefore:t.scoreOpponentBefore??t.scoreBefore?.[1]??null,
    kaputtSelfBefore:t.kaputtSelfBefore??t.kaputtBefore?.[0]??null,kaputtOpponentBefore:t.kaputtOpponentBefore??t.kaputtBefore?.[1]??null,
    ntbBefore:t.ntbBefore??t.ntb??1,visibleDie:t.visibleDie??t.a??0,hiddenDie:t.hiddenDie??t.b??0,choice:t.choice??t.action??'?',
    points:t.points??0,kaputt:t.kaputt?1:0,ntbAfter:t.ntbAfter??t.nextNtb??1,extreme:t.extreme?1:0,decisionMs:t.decisionMs??null,
    strategicHold:t.strategicHold?1:0,botReason:t.botReason??t.why??null}));
  const fields=['turn','actor','scoreSelfBefore','scoreOpponentBefore','kaputtSelfBefore','kaputtOpponentBefore','ntbBefore','visibleDie','hiddenDie','choice','points','kaputt','ntbAfter','extreme','decisionMs','strategicHold','botReason'];
  statements.push(db.prepare(`INSERT INTO turns
    (match_id,turn_no,actor,score_self_before,score_opp_before,kaputt_self_before,kaputt_opp_before,ntb_before,visible_die,hidden_die,choice,points,kaputt,ntb_after,extreme,decision_ms,strategic_hold,bot_reason)
    SELECT ?,${fields.map(f=>`json_extract(j.value,'$.${f}')`).join(',')} FROM json_each(?) j
    WHERE ${condition} AND EXISTS(SELECT 1 FROM matches WHERE id=? AND payload_json=?) ON CONFLICT(match_id,turn_no) DO NOTHING`)
    .bind(m.id,JSON.stringify(history),...args,m.id,JSON.stringify(m)));
  return statements;
}
export async function saveMatch(db, body) {
  const m = canonicalMatch(body);
  const existing = await db.prepare('SELECT payload_json FROM matches WHERE id=?').bind(m.id).first();
  if (existing && existing.payload_json !== JSON.stringify(m)) throw new ApiError('This match ID already contains a different match.',409);
  await db.batch(matchStatements(db,m));
  const saved = await db.prepare('SELECT payload_json FROM matches WHERE id=?').bind(m.id).first();
  if (saved?.payload_json !== JSON.stringify(m)) throw new ApiError('This match ID already contains a different match.',409);
  return m.id;
}
// One common dataset keeps all-time, period views, and badges consistent.
// Old rows remain untouched. A recorded lastResult winner repairs the previous
// client's wrong top-level winner on a Kaputt-limit loss when reading standings.
const completed = `WITH completed AS (
 SELECT id,player_a a,player_b b,
   COALESCE(json_extract(payload_json,'$.playerAId'),'name:'||player_a) aid,
   COALESCE(json_extract(payload_json,'$.playerBId'),'name:'||player_b) bid,
   score_a sa,score_b sb,winner,turns,created_at at
 FROM matches WHERE winner IN ('P1','P2')
 UNION ALL
 SELECT 'room-'||code,host_name,guest_name,COALESCE(host_uuid,'name:'||host_name),COALESCE(guest_uuid,'name:'||guest_name),
   json_extract(current_state_json,'$.players[0].score'),json_extract(current_state_json,'$.players[1].score'),
   CASE COALESCE(json_extract(current_state_json,'$.lastResult.winner'),json_extract(current_state_json,'$.winner')) WHEN 0 THEN 'P1' WHEN 1 THEN 'P2' END,
   json_extract(current_state_json,'$.turn'),last_updated
 FROM rooms WHERE protocol=1 AND status='finished' AND match_id IS NULL AND json_valid(current_state_json)
   AND COALESCE(json_extract(current_state_json,'$.lastResult.winner'),json_extract(current_state_json,'$.winner')) IN (0,1)
), results AS (
 SELECT id,aid identity,a name,sa score,winner='P1' won,turns,at FROM completed
 UNION ALL SELECT id,bid,b,sb,winner='P2',turns,at FROM completed
)`;
const periods = {all:'1',today:"at>=date('now','start of day')",week:"at>=date('now','-6 days','weekday 1')",month:"at>=date('now','start of month')"};
export async function leaderboard(db,limit=25,period='all') {
 if(!periods[period])throw new ApiError('Choose all, today, week, or month.');
 try {
  const rows=await db.prepare(`${completed} SELECT identity,MAX(name) name,SUM(won) wins,SUM(1-won) losses,COUNT(*) matches_played,
    SUM(score) total_points,MAX(score) best_score,ROUND(AVG(turns),1) avg_turns,ROUND(AVG(score),1) avg_score,
    ROUND(100.0*SUM(won)/COUNT(*),1) win_rate FROM results WHERE ${periods[period]}
    GROUP BY identity ORDER BY wins DESC,win_rate DESC,name LIMIT ?`).bind(limit).all();
  return rows.results;
 } catch { return []; }
}
export async function badges(db) {
 try {
  const summary=await db.prepare(`${completed} SELECT identity,MAX(name) name,SUM(won) wins,COUNT(*) matches_played,
    MIN(CASE WHEN won THEN turns END) fastest,MAX(turns) longest,MAX(score) best_score,
    ROUND(100.0*SUM(won)/COUNT(*),1) win_rate FROM results GROUP BY identity`).all();
  const turns=await db.prepare(`WITH played AS (
    SELECT CASE t.actor WHEN 'P1' THEN COALESCE(json_extract(m.payload_json,'$.playerAId'),'name:'||m.player_a) WHEN 'P2' THEN COALESCE(json_extract(m.payload_json,'$.playerBId'),'name:'||m.player_b) ELSE 'name:'||t.actor END identity,
      CASE t.actor WHEN 'P1' THEN m.player_a WHEN 'P2' THEN m.player_b ELSE t.actor END name,
      t.choice,t.extreme,t.kaputt,t.strategic_hold
    FROM turns t JOIN matches m ON m.id=t.match_id
    UNION ALL
    SELECT CASE json_extract(j.value,'$.player') WHEN 0 THEN COALESCE(r.host_uuid,'name:'||r.host_name) ELSE COALESCE(r.guest_uuid,'name:'||r.guest_name) END,
      CASE json_extract(j.value,'$.player') WHEN 0 THEN r.host_name ELSE r.guest_name END,
      COALESCE(json_extract(j.value,'$.choice'),json_extract(j.value,'$.action')),json_extract(j.value,'$.extreme'),json_extract(j.value,'$.kaputt'),json_extract(j.value,'$.kaputt')
    FROM rooms r,json_each(r.current_state_json,'$.history') j WHERE r.protocol=1 AND r.status='finished' AND r.match_id IS NULL AND json_valid(r.current_state_json)
  ) SELECT identity,MAX(name) name,SUM(choice='attack') attacks,SUM(choice='defense') defenses,SUM(extreme) extremes,SUM(kaputt) kaputts,SUM(strategic_hold) holds FROM played GROUP BY identity`).all();
  const result=[];
  const award=(id,label,desc,rows,metric,unit,min=false)=>{
    const eligible=rows.filter(r=>r[metric]!==null&&r[metric]>0).sort((a,b)=>(min?a[metric]-b[metric]:b[metric]-a[metric])||a.name.localeCompare(b.name));
    if(eligible.length)result.push({id,label,desc,player:eligible[0].name,value:`${eligible[0][metric]}${unit}`,identity:eligible[0].identity});
  };
  award('speed_demon','Speed Demon','Won in fewest turns',summary.results,'fastest',' turns',true);
  for(const [id,label,desc,metric,unit] of [
    ['berserker','Berserker','Most total attacks','attacks',' attacks'],['iron_wall','Iron Wall','Most total defenses','defenses',' defenses'],
    ['extreme_master','Extreme Master','Most Extreme events','extremes',' extremes'],['kaputt_magnet','Kaputt Magnet','Most Kaputt events suffered','kaputts',' Kaputts'],
    ['hold_champion','Hold Champion','Most strategic holds','holds',' holds']])award(id,label,desc,turns.results,metric,unit);
  award('marathon_runner','Marathon Runner','Longest match played',summary.results,'longest',' turns');
  award('high_scorer','High Scorer','Highest single-match score',summary.results,'best_score',' pts');
  award('veteran','Veteran','Most matches played',summary.results,'matches_played',' matches');
  award('undefeated','Undefeated','Highest win rate (5+ matches)',summary.results.filter(r=>r.matches_played>=5),'win_rate','%');
  return result;
 } catch { return []; }
}

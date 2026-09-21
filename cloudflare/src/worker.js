import { ApiError, integer, saveMatch, leaderboard, badges } from './persistence.js';
import { createRoom, joinRoom, pollRoom, roomAction, archiveRoom } from './rooms.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const token=request=>request.headers.get('authorization')?.replace(/^Bearer /,'');
async function body(request) {
  if (+(request.headers.get('content-length')||0)>2000000) throw new ApiError('Request is too large.',413);
  let result; try { result=await request.json(); } catch { throw new ApiError('Expected a JSON request.'); }
  if (!result || Array.isArray(result) || typeof result!=='object') throw new ApiError('Expected a JSON object.');
  return result;
}
export default {
  async fetch(request,env){
    const u=new URL(request.url),path=u.pathname;
    try {
      if(path==='/api/health') {
        await env.DB.prepare('SELECT protocol FROM rooms LIMIT 1').first();
        return json({ok:true,service:'kaputt-lab',db:true,remoteProtocol:2,build:'K3-E1-REMOTE-2'});
      }
      if(path==='/api/matches'&&request.method==='POST') return json({ok:true,id:await saveMatch(env.DB,await body(request))},201);
      if(path==='/api/experiments'&&request.method==='POST') {
        const b=await body(request),eid=b.id||crypto.randomUUID();
        await env.DB.prepare(`INSERT INTO experiments(id,kind,ruleset,target,kaputt_limit,starting_ntb,player_a,player_b,game_count,seed,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
          .bind(eid,b.kind||'batch',b.ruleset||'K3-E1',b.target||100,b.kaputtLimit||5,b.startingNtb??1,b.playerA||null,b.playerB||null,b.gameCount||1,b.seed||null,JSON.stringify(b.metadata||{})).run();
        return json({ok:true,id:eid},201);
      }
      if(path==='/api/stats') {
        const [m,t,h]=await Promise.all([
          env.DB.prepare('SELECT COUNT(*) matches, AVG(turns) avg_turns, AVG(score_a+score_b) avg_total_score FROM matches').first(),
          env.DB.prepare('SELECT choice, COUNT(*) n, AVG(kaputt) kaputt_rate, AVG(ntb_after-ntb_before) avg_ntb_delta FROM turns GROUP BY choice').all(),
          env.DB.prepare("SELECT ntb_before, COUNT(*) decisions, AVG(choice='attack') attack_rate, AVG(strategic_hold) hold_rate FROM turns GROUP BY ntb_before ORDER BY ntb_before").all()
        ]);
        return json({matches:m,choices:t.results,byNtb:h.results});
      }
      if(path==='/api/llm-proxy'&&request.method==='POST') {
        const b=await body(request); let target;
        try { target=new URL(b.url); } catch { throw new ApiError('Invalid provider URL.'); }
        if(target.protocol!=='https:' || target.port || target.username || target.password || !['api.anthropic.com','generativelanguage.googleapis.com'].includes(target.hostname)) throw new ApiError('Provider not allowed.',403);
        const response=await fetch(target,{method:b.body?'POST':'GET',headers:b.headers||{},...(b.body?{body:JSON.stringify(b.body)}:{}),redirect:'error'});
        return json(await response.json(),response.status);
      }
      if(path==='/api/rooms'&&request.method==='POST') return json({ok:true,room:await createRoom(env.DB,await body(request))},201);
      const room=path.match(/^\/api\/rooms\/([A-Z0-9]{4})(?:\/(join|action|archive))?$/);
      if(room) {
        const [,key,action]=room;
        if(action==='archive'&&request.method==='GET') return json({ok:true,archive:await archiveRoom(env.DB,key)});
        if(!action&&request.method==='GET') return json({ok:true,room:await pollRoom(env.DB,key,token(request),u.searchParams.has('since')?Number(u.searchParams.get('since')):undefined)});
        if(action==='join'&&request.method==='POST') return json({ok:true,room:await joinRoom(env.DB,key,await body(request))});
        if(action==='action'&&request.method==='POST') return json({ok:true,room:await roomAction(env.DB,key,token(request),await body(request))});
        return json({ok:false,error:'Method not allowed.'},405);
      }
      if(path==='/api/badges')return json({ok:true,badges:await badges(env.DB)});
      if(path==='/api/leaderboard') {
        const limit=integer(Number(u.searchParams.get('limit')||25),25,1,100,'limit');
        return json({ok:true,players:await leaderboard(env.DB,limit,u.searchParams.get('period')||'all')});
      }
      if(path.startsWith('/api/')) return json({ok:false,error:'Endpoint not found.'},404);
      const response=await env.ASSETS.fetch(request);
      const headers=new Headers(response.headers);
      if(/\.(?:html|js|css)$/.test(path)||path.endsWith('/'))headers.set('cache-control','no-cache');
      return new Response(response.body,{status:response.status,headers});
    } catch(error) {
      const known=error instanceof ApiError;
      return json({ok:false,error:known?error.message:'The service could not complete this request. Please retry.'},known?error.status:503);
    }
  }
};

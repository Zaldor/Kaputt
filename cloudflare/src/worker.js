import { ApiError, integer, saveMatch, leaderboard, badges, hash, randomToken } from './persistence.js';
import { createRoom, joinRoom, pollRoom, roomAction, archiveRoom } from './rooms.js';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json','cache-control':'no-store'}});
const token=request=>request.headers.get('authorization')?.replace(/^Bearer /,'');
const HEX64=/^[0-9a-f]{64}$/,EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/,USERNAME=/^[a-zA-Z0-9-]{3,16}$/;
const MAGIC_TTL=900,SESSION_TTL=2592000;
// 5 links per email per hour: tokens expire after 15 minutes, so every token
// issued within the last hour still has expires_at > now - (3600 - 900).
const RATE_WINDOW=3600-MAGIC_TTL,RATE_MAX=5;
function cookieValue(request,name){
  const header=request.headers.get('cookie');
  if(!header)return null;
  for(const part of header.split(';')){const i=part.indexOf('=');if(i>0&&part.slice(0,i).trim()===name)return part.slice(i+1).trim();}
  return null;
}
const sessionCookie=(request,value,maxAge)=>`kaputt_session=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${new URL(request.url).protocol==='https:'?'; Secure':''}`;
async function sessionUser(db,request){
  const session=cookieValue(request,'kaputt_session');
  if(!session||!HEX64.test(session))return null;
  return await db.prepare('SELECT u.id id,u.email email,u.username username FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>unixepoch()').bind(await hash(session)).first();
}
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
      if(path==='/api/auth/request'&&request.method==='POST') {
        const b=await body(request);
        const email=typeof b.email==='string'?b.email.trim().toLowerCase():'';
        if(email.length>254||!EMAIL.test(email))throw new ApiError('Enter a valid email address.');
        if(!env.RESEND_API_KEY&&env.ALLOW_AUTH_DEBUG!=='1')throw new ApiError('Email sign-in is temporarily unavailable. Please try again later.',503);
        let user=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();
        if(!user){
          const id=crypto.randomUUID();
          try{await env.DB.prepare('INSERT INTO users(id,email) VALUES(?,?)').bind(id,email).run();user={id};}
          catch{user=await env.DB.prepare('SELECT id FROM users WHERE email=?').bind(email).first();if(!user)throw new ApiError('The service could not complete this request. Please retry.',503);}
        }
        const now=Math.floor(Date.now()/1000);
        const recent=await env.DB.prepare('SELECT COUNT(*) n FROM magic_tokens WHERE user_id=? AND expires_at>?').bind(user.id,now-RATE_WINDOW).first();
        if((recent?.n??0)>=RATE_MAX)throw new ApiError('Too many sign-in requests. Please wait a while and try again.',429);
        const authLinkToken=randomToken();
        const authLinkHash=await hash(authLinkToken);
        await env.DB.prepare('INSERT INTO magic_tokens(token_hash,user_id,expires_at,used) VALUES(?,?,?,0)').bind(authLinkHash,user.id,now+MAGIC_TTL).run();
        if(env.RESEND_API_KEY){
          let mail;
          try{
            mail=await fetch('https://api.resend.com/emails',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${env.RESEND_API_KEY}`},
              body:JSON.stringify({from:env.AUTH_FROM_EMAIL,to:[email],subject:'Your KAPUTT! sign-in link',
                 text:`Sign in to KAPUTT!: ${u.origin}/?auth=${authLinkToken}\nThis link expires in 15 minutes.`})});
          }catch{
            await env.DB.prepare('DELETE FROM magic_tokens WHERE token_hash=?').bind(authLinkHash).run();
            throw new ApiError('Email sign-in is temporarily unavailable. Please try again later.',503);
          }
          if(!mail.ok){
            await env.DB.prepare('DELETE FROM magic_tokens WHERE token_hash=?').bind(authLinkHash).run();
            throw new ApiError('Email sign-in is temporarily unavailable. Please try again later.',503);
          }
        }
        const response={ok:true};
        // Local tests only: never set ALLOW_AUTH_DEBUG in production.
        if(env.ALLOW_AUTH_DEBUG==='1')response.debugToken=authLinkToken;
        return json(response);
      }
      if(path==='/api/auth/verify') {
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
        const linkToken=u.searchParams.get('token')||'';
        if(!HEX64.test(linkToken))throw new ApiError('This sign-in link is not valid.',401);
        const tokenHash=await hash(linkToken);
        const row=await env.DB.prepare('SELECT user_id,expires_at,used FROM magic_tokens WHERE token_hash=?').bind(tokenHash).first();
        if(!row)throw new ApiError('This sign-in link is not valid.',401);
        if(row.used)throw new ApiError('This sign-in link has already been used.',410);
        const now=Math.floor(Date.now()/1000);
        if(row.expires_at<=now)throw new ApiError('This sign-in link has expired.',410);
        const consumed=await env.DB.prepare('UPDATE magic_tokens SET used=1 WHERE token_hash=? AND used=0').bind(tokenHash).run();
        if(!consumed.meta.changes)throw new ApiError('This sign-in link has already been used.',410);
        const session=randomToken();
        await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await hash(session),row.user_id,now+SESSION_TTL).run();
        return new Response(null,{status:302,headers:{'location':'/','cache-control':'no-store','set-cookie':sessionCookie(request,session,SESSION_TTL)}});
      }
      if(path==='/api/auth/username'&&request.method==='POST') {
        const user=await sessionUser(env.DB,request);
        if(!user)throw new ApiError('Sign in to choose a username.',401);
        const b=await body(request);
        const username=typeof b.username==='string'?b.username.trim():'';
        if(!USERNAME.test(username))throw new ApiError('Use 3 to 16 letters, numbers, or hyphens.');
        const clash=await env.DB.prepare('SELECT id FROM users WHERE lower(username)=lower(?) AND id<>?').bind(username,user.id).first();
        if(clash)throw new ApiError('That username is already taken.',409);
        try{await env.DB.prepare('UPDATE users SET username=? WHERE id=?').bind(username,user.id).run();}
        catch{throw new ApiError('That username is already taken.',409);}
        return json({ok:true,user:{id:user.id,email:user.email,username}});
      }
      if(path==='/api/me') {
        if(request.method!=='GET')return json({ok:false,error:'Method not allowed.'},405);
        const user=await sessionUser(env.DB,request);
        if(!user)throw new ApiError('You are not signed in.',401);
        return json({ok:true,user});
      }
      if(path==='/api/auth/logout'&&request.method==='POST') {
        const session=cookieValue(request,'kaputt_session');
        if(session&&HEX64.test(session))await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(session)).run();
        return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json','cache-control':'no-store','set-cookie':sessionCookie(request,'',0)}});
      }
      if(path==='/api/matches'&&request.method==='POST') {
        const user=await sessionUser(env.DB,request);
        if(!user)throw new ApiError('Sign in to save this match. Your match stays on this device until you sign in.',401);
        return json({ok:true,id:await saveMatch(env.DB,await body(request),user)},201);
      }
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
      if(path==='/api/rooms'&&request.method==='POST') {
        const user=await sessionUser(env.DB,request);
        return json({ok:true,room:await createRoom(env.DB,await body(request),user?.id)},201);
      }
      const room=path.match(/^\/api\/rooms\/([A-Z0-9]{4})(?:\/(join|action|archive))?$/);
      if(room) {
        const [,key,action]=room;
        if(action==='archive'&&request.method==='GET') return json({ok:true,archive:await archiveRoom(env.DB,key)});
        if(!action&&request.method==='GET') return json({ok:true,room:await pollRoom(env.DB,key,token(request),u.searchParams.has('since')?Number(u.searchParams.get('since')):undefined)});
        if(action==='join'&&request.method==='POST') {
          const user=await sessionUser(env.DB,request);
          return json({ok:true,room:await joinRoom(env.DB,key,await body(request),user?.id)});
        }
        if(action==='action'&&request.method==='POST') return json({ok:true,room:await roomAction(env.DB,key,token(request),await body(request))});
        return json({ok:false,error:'Method not allowed.'},405);
      }
      if(path==='/api/badges')return json({ok:true,badges:await badges(env.DB)});
      if(path==='/api/leaderboard') {
        const limit=integer(Number(u.searchParams.get('limit')||25),25,1,100,'limit');
        return json({ok:true,players:await leaderboard(env.DB,limit,u.searchParams.get('period')||'all',u.searchParams.get('showBots')==='1')});
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

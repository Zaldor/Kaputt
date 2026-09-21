// Run from the repository root. Uses only Cloudflare's official Wrangler CLI.
// No database creation, resets, destructive migrations, or automatic restores.
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync,statSync} from 'node:fs';
import {resolve} from 'node:path';
const config='cloudflare/wrangler.toml',db='kaputt-lab';
const args=process.argv.slice(2),deploy=args.includes('--deploy');
const backupIndex=args.indexOf('--backup-dir'),backupDir=backupIndex>=0?resolve(args[backupIndex+1]||''):null;
const wrangler=resolve('node_modules/wrangler/bin/wrangler.js');
function run(argv,{capture=false}={}){
 const r=spawnSync(process.execPath,[wrangler,...argv,'--config',config],{encoding:'utf8',stdio:capture?['ignore','pipe','pipe']:'inherit',env:{...process.env,WRANGLER_SEND_METRICS:'false'},maxBuffer:20*1024*1024});
 if(r.status!==0)throw new Error(`Wrangler ${argv[0]} ${argv[1]||''} failed. ${capture?r.stderr:''}`);
 return r.stdout;
}
function query(sql){const output=run(['d1','execute',db,'--remote','--command',sql,'--json'],{capture:true});const parsed=JSON.parse(output);if(parsed.some(r=>!r.success))throw new Error('Database query failed');return parsed.flatMap(r=>r.results);}
const counts=()=>query("SELECT 'matches' name,COUNT(*) count FROM matches UNION ALL SELECT 'turns',COUNT(*) FROM turns UNION ALL SELECT 'players',COUNT(*) FROM players UNION ALL SELECT 'rooms',COUNT(*) FROM rooms UNION ALL SELECT 'experiments',COUNT(*) FROM experiments");
try{
 const toml=readFileSync(config,'utf8');if(!toml.includes('986e5b8a-e0e5-43cd-8db3-48e629fe398a'))throw new Error('Unexpected database binding. Verify the existing production database before continuing.');
 run(['whoami']);
 const before=counts(),columns=query('PRAGMA table_info(rooms)'),hasProtocol=columns.some(c=>c.name==='protocol');
 const active=query(`SELECT COUNT(*) n FROM rooms WHERE status='playing' AND last_updated>=datetime('now','-30 minutes') ${hasProtocol?'AND protocol=1':''}`)[0].n;
 console.log(JSON.stringify({before,recentLegacyGames:active},null,2));
 run(['d1','migrations','list',db,'--remote']);
 if(active)throw new Error('Recent legacy games are active. Let them finish before switching the room protocol. No changes were made.');
 if(!deploy){console.log('Read-only preflight complete. Deploy with --deploy --backup-dir /private/path after npm run check.');process.exit(0);}
 if(!backupDir||backupDir.startsWith(resolve('.')+'/lab')||backupDir===resolve('.'))throw new Error('Choose an explicit private backup directory outside public assets.');
 mkdirSync(backupDir,{recursive:true,mode:0o700});
 const prefix=resolve(backupDir,`kaputt-${new Date().toISOString().replace(/[:.]/g,'-')}`);
 writeFileSync(prefix+'-counts.json',JSON.stringify(before,null,2),{mode:0o600});
 writeFileSync(prefix+'-time-travel.json',run(['d1','time-travel','info',db,'--json'],{capture:true}),{mode:0o600});
 run(['d1','export',db,'--remote','--output',prefix+'.sql']);
 if(statSync(prefix+'.sql').size<100)throw new Error('Database export is unexpectedly empty. Deployment stopped.');
 for(const migration of ['0003_add_player_uuid.sql','0004_add_room_uuids.sql','0005_remote_protocol.sql']){
   const sql=readFileSync(`cloudflare/migrations/${migration}`,'utf8').replace(/--[^\n]*/g,'');
   if(/\b(DROP|DELETE|TRUNCATE|REPLACE)\b/i.test(sql))throw new Error('A migration contains a destructive operation. Deployment stopped.');
 }
 run(['d1','migrations','apply',db,'--remote']);
 const after=counts();for(const old of before)if((after.find(r=>r.name===old.name)?.count??-1)<old.count)throw new Error(`Row count decreased for ${old.name}. Worker deployment stopped. Review the private backup.`);
 run(['deploy']);
 const response=await fetch('https://kaputt-lab.crafthead.workers.dev/api/health',{cache:'no-store'}),health=await response.json();
 if(!response.ok||health.remoteProtocol!==2||!health.db)throw new Error('Post-deploy health verification failed. Inspect the Worker deployment before continuing.');
 console.log('Deployment healthy. Existing table row counts preserved. Private backup: '+prefix+'.sql');
}catch(error){console.error(error.message);process.exitCode=1;}

import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: { host: { type: 'string', default: '0.0.0.0' }, port: { type: 'string', default: '4173' }, strictPort: { type: 'boolean' } } });
const root = resolve('lab');
const {createLocalRuntime}=await import('./local-runtime.mjs');
const {mf}=await createLocalRuntime();
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.json': 'application/json; charset=utf-8' };
const fixture = `<script>
// This fixture is served only by the local development server, never in lab/.
const realCreateMatch = window.KaputtEngine.createMatch;
window.KaputtEngine.createMatch = function(config) {
 const game = realCreateMatch(config), players = [{score:42,kaputt:2,attackCount:4,defenseCount:2},{score:58,kaputt:1,attackCount:5,defenseCount:2}];
 return new Proxy(game,{get(target,key){
  if(key==='phase')return 'first'; if(key==='ntb')return 12; if(key==='players')return players;
  if(key==='firstDieIndex')return 0;
  if(key==='getPublicState')return ()=>({phase:'first',currentPlayer:0,ntb:12,target:100,kaputtLimit:5,visibleDie:4,firstDieIndex:0,choice:null,winner:null,players});
  return Reflect.get(target,key);
 }});
};
</script>`;
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://dev.local');
    res.setHeader('Cache-Control', 'no-store');
    if(url.pathname.startsWith('/api/')) {
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const response=await mf.dispatchFetch('http://local.test'+req.url,{method:req.method,headers:req.headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})});
      res.writeHead(response.status,Object.fromEntries(response.headers));return res.end(Buffer.from(await response.arrayBuffer()));
    }
    if (url.pathname === '/__preview') {
      const width = Math.min(1000, Math.max(280, Number(url.searchParams.get('width')) || 390));
      const height = Math.min(1400, Math.max(480, Number(url.searchParams.get('height')) || 844));
      const source = url.searchParams.has('visual') ? '/__visual' : '/';
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.end(`<!doctype html><title>KAPUTT mobile preview</title><style>body{margin:0;background:#15203d;display:grid;place-items:start center;padding:20px}iframe{border:0;display:block;width:${width}px;height:${height}px}</style><iframe id="mobile-preview" title="KAPUTT mobile game" src="${source}"></iframe>`);
    }
    if (url.pathname === '/__visual') {
      const html = await readFile(resolve(root, 'index.html'), 'utf8');
      res.setHeader('Content-Type', mime['.html']);
      return res.end(html.replace(/(<script src="engine.js">\s*<\/script>)/, '$1' + fixture));
    }
    const path = resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(root + sep)) { res.writeHead(403); return res.end('Forbidden'); }
    const info = await stat(path); if (!info.isFile()) throw new Error('Not a file');
    res.setHeader('Content-Type', mime[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end('Not found'); }
});
server.listen(Number(values.port), values.host, () => console.log(`KAPUTT preview listening on ${values.host}:${values.port}`));

for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{server.close();await mf.dispose();process.exit(0);});

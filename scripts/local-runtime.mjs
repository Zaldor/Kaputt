import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// Dev/test aid, set ONLY when constructing the Miniflare instance: local runs have
// no RESEND_API_KEY, so the Worker skips sending mail, and ALLOW_AUTH_DEBUG=1 makes
// /api/auth/request return {debugToken} so tests and `npm run dev` can complete the
// magic-link flow. It must never be configured on a deployed Worker.
export async function createLocalRuntime({allowAuthDebug=true,resendApiKey='',outboundService}={}) {
  const result=await build({entryPoints:[resolve('cloudflare/src/worker.js')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
  const bindings={...(allowAuthDebug?{ALLOW_AUTH_DEBUG:'1'}:{}),...(resendApiKey?{RESEND_API_KEY:resendApiKey,AUTH_FROM_EMAIL:'play-kaputt@no-reply.juzemaru.com'}:{})};
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-09-18',d1Databases:{DB:'kaputt-local-test'},...(Object.keys(bindings).length?{bindings}:{}),...(outboundService?{outboundService}:{})}));
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir('cloudflare/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=await readFile(`cloudflare/migrations/${name}`,'utf8');
    await db.exec(sql.replace(/--[^\n]*/g,'').replace(/\n/g,' '));
  }
  return {mf,db};
}

import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { build } from 'esbuild';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function createLocalRuntime() {
  const result=await build({entryPoints:[resolve('cloudflare/src/worker.js')],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022'});
  const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:result.outputFiles[0].text,compatibilityDate:'2026-09-18',d1Databases:{DB:'kaputt-local-test'}}));
  const db=await mf.getD1Database('DB');
  for(const name of (await readdir('cloudflare/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
    const sql=await readFile(`cloudflare/migrations/${name}`,'utf8');
    await db.exec(sql.replace(/--[^\n]*/g,'').replace(/\n/g,' '));
  }
  return {mf,db};
}

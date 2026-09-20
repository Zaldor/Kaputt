import { build } from 'esbuild';

await build({
  entryPoints: ['src/dice-scene.js'],
  outfile: 'lab/dice-scene.js',
  bundle: true,
  format: 'esm',
  minify: true,
  target: ['es2020'],
  legalComments: 'eof',
});
console.log('Built self-hosted 3D dice renderer. lab/ is ready to deploy.');

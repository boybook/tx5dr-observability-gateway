import { build } from 'esbuild';
import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.js',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  packages: 'external',
  sourcemap: true,
  minify: false,
});
await cp('package.json', 'dist/package.json');
await cp('package-lock.json', 'dist/package-lock.json');

const install = spawnSync('npm', [
  'ci',
  '--omit=dev',
  '--ignore-scripts',
  '--os=linux',
  '--cpu=x64',
], { cwd: 'dist', stdio: 'inherit' });
if (install.status !== 0) process.exit(install.status ?? 1);

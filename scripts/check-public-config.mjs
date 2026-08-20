import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const excluded = new Set(['.git', 'dist', 'node_modules']);
const textExtensions = new Set(['', '.json', '.md', '.mjs', '.sql', '.ts', '.yaml', '.yml']);
const findings = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name))) continue;
    const content = await readFile(path, 'utf8');
    const checks = [
      [/LTAI[A-Za-z0-9]{12,}/g, 'Alibaba Cloud AccessKey ID'],
      [/acs:ram::\d{6,}:role\/[A-Za-z0-9._-]+/g, 'concrete RAM role ARN'],
      [/https:\/\/[A-Za-z0-9-]+\.[a-z0-9-]+\.fcapp\.run/gi, 'concrete FC public endpoint'],
      [/oss:\/\/(?!replace-with-)[A-Za-z0-9.-]+/gi, 'concrete OSS target'],
    ];
    for (const [pattern, label] of checks) {
      if (pattern.test(content)) findings.push(`${relative(root, path)}: ${label}`);
    }
  }
}

await walk(root);

const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
for (const line of envExample.split(/\r?\n/)) {
  if (!line || line.startsWith('#')) continue;
  const [name, ...rest] = line.split('=');
  const value = rest.join('=');
  if (!value || name === 'TOKEN_SIGNING_KEY_ID') continue;
  if (!value.startsWith('replace-with-')) findings.push(`.env.example: ${name} must remain a placeholder`);
}

const serverless = await readFile(new URL('../s.yaml', import.meta.url), 'utf8');
for (const name of [
  'SLS_ENDPOINT', 'SLS_PROJECT', 'SLS_INSTALLATIONS_LOGSTORE', 'SLS_EVENTS_LOGSTORE',
  'TOKEN_SIGNING_KEY_CURRENT', 'TOKEN_SIGNING_KEY_PREVIOUS', 'INSTALLATION_HMAC_KEY',
  'FC_FUNCTION_NAME', 'FC_RUNTIME_ROLE_ARN', 'FC_RUNTIME_LOGSTORE',
]) {
  if (!serverless.includes(`env('${name}'`)) findings.push(`s.yaml: ${name} must come from the environment`);
}

if (findings.length > 0) {
  throw new Error(`Public configuration check failed:\n- ${findings.join('\n- ')}`);
}
console.log('No concrete credentials or private cloud targets found.');

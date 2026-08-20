import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const template = parse(await readFile(new URL('../infra/ros.yaml', import.meta.url), 'utf8'));
const privateParameters = [
  'ProjectName',
  'InstallationsLogstoreName',
  'EventsLogstoreName',
  'RuntimeLogstoreName',
  'ApplicationLogstoreName',
  'DiagnosticMetadataLogstoreName',
  'RuntimeRoleName',
];

for (const name of privateParameters) {
  const parameter = template?.Parameters?.[name];
  if (!parameter) throw new Error(`Missing private ROS parameter: ${name}`);
  if ('Default' in parameter) throw new Error(`Private ROS parameter must not have a default: ${name}`);
  if (parameter.NoEcho !== true) throw new Error(`Private ROS parameter must use NoEcho: ${name}`);
}

if (template?.Resources?.DiagnosticsBucket) {
  throw new Error('Diagnostics storage must remain deferred until its upload flow is implemented');
}

console.log('Infrastructure privacy invariants passed.');

import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';

const template = parse(await readFile(new URL('../infra/ros.yaml', import.meta.url), 'utf8'));
const privateParameters = [
  'ProjectName',
  'DiagnosticsBucketName',
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

const bucket = template?.Resources?.DiagnosticsBucket?.Properties;
if (bucket?.AccessControl !== 'private' || bucket?.BlockPublicAccess !== true) {
  throw new Error('The reserved diagnostics bucket must block public access');
}

console.log('Infrastructure privacy invariants passed.');

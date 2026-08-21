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
if (!bucket) throw new Error('Diagnostics bucket must be managed by the infrastructure stack');
if (bucket.AccessControl !== 'private' || bucket.BlockPublicAccess !== true) {
  throw new Error('Diagnostics bucket must remain private with public access blocked');
}
if (bucket.ServerSideEncryptionConfiguration?.SSEAlgorithm !== 'AES256') {
  throw new Error('Diagnostics bucket must use server-side encryption');
}
if (bucket.LifecycleConfiguration?.Rule?.[0]?.Expiration?.Days !== 30) {
  throw new Error('Diagnostics objects must expire after 30 days');
}

const roleStatements = template?.Resources?.GatewayRuntimeRole?.Properties?.Policies?.[0]?.PolicyDocument?.Statement ?? [];
const actions = roleStatements.flatMap((statement) => statement.Action ?? []);
for (const action of ['log:PostLogStoreLogs', 'oss:PutObject', 'oss:GetObject']) {
  if (!actions.includes(action)) throw new Error(`Runtime role is missing required action: ${action}`);
}

console.log('Infrastructure privacy invariants passed.');

import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const required = [
  'ALIYUN_REGION',
  'ROS_STACK_NAME',
  'SLS_PROJECT',
  'DIAGNOSTICS_BUCKET',
  'SLS_INSTALLATIONS_LOGSTORE',
  'SLS_EVENTS_LOGSTORE',
  'FC_RUNTIME_LOGSTORE',
  'APPLICATION_LOGSTORE',
  'DIAGNOSTIC_METADATA_LOGSTORE',
  'FC_RUNTIME_ROLE_NAME',
];

for (const name of required) {
  if (!process.env[name]) throw new Error(`Missing required deployment environment variable: ${name}`);
}

function aliyun(args, { allowNoChange = false } = {}) {
  const result = spawnSync('aliyun', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status === 0) return result.stdout ? JSON.parse(result.stdout) : {};
  const operation = args.slice(0, 2).join(' ');
  const rawError = result.stderr || result.stdout || '';
  let error;
  try {
    error = JSON.parse(rawError);
  } catch {
    const errorCode = rawError.match(/(?:ErrorCode|Code)\s*[:=]\s*([A-Za-z0-9._-]+)/i)?.[1]
      ?? rawError.match(/\b(NoPermission|Forbidden|AccessDenied|InvalidAccessKeyId|SignatureDoesNotMatch)\b/i)?.[1]
      ?? 'unknown_error';
    if (allowNoChange && errorCode === 'NotSupported') return { noChange: true };
    throw new Error(`Alibaba Cloud request failed (${operation}): ${errorCode}`);
  }
  if (allowNoChange && error.Code === 'NotSupported') return { noChange: true };
  throw new Error(`Alibaba Cloud request failed (${operation}): ${error.Code || 'unknown_error'}`);
}

const region = process.env.ALIYUN_REGION;
const stackName = process.env.ROS_STACK_NAME;
const templateBody = await readFile(new URL('../infra/ros.yaml', import.meta.url), 'utf8');
const values = [
  ['ProjectName', process.env.SLS_PROJECT],
  ['DiagnosticsBucketName', process.env.DIAGNOSTICS_BUCKET],
  ['InstallationsLogstoreName', process.env.SLS_INSTALLATIONS_LOGSTORE],
  ['EventsLogstoreName', process.env.SLS_EVENTS_LOGSTORE],
  ['RuntimeLogstoreName', process.env.FC_RUNTIME_LOGSTORE],
  ['ApplicationLogstoreName', process.env.APPLICATION_LOGSTORE],
  ['DiagnosticMetadataLogstoreName', process.env.DIAGNOSTIC_METADATA_LOGSTORE],
  ['RuntimeRoleName', process.env.FC_RUNTIME_ROLE_NAME],
];
const parameters = values.flatMap(([key, value], index) => [
  `--Parameters.${index + 1}.ParameterKey`, key,
  `--Parameters.${index + 1}.ParameterValue`, value,
]);

const listed = aliyun([
  'ros', 'ListStacks', '--RegionId', region, '--StackName.1', stackName, '--PageSize', '10',
]);
const existing = listed.Stacks?.find((stack) => stack.StackName === stackName);
if (existing?.Status === 'CREATE_ROLLBACK_COMPLETE') {
  throw new Error('ROS cannot update a stack whose initial creation rolled back; use a new stack name or delete the failed stack');
}

let stackId;
if (!existing) {
  const created = aliyun([
    'ros', 'CreateStack',
    '--RegionId', region,
    '--StackName', stackName,
    '--TemplateBody', templateBody,
    '--DeletionProtection', 'Enabled',
    '--DisableRollback', 'false',
    ...parameters,
  ]);
  stackId = created.StackId;
} else {
  stackId = existing.StackId;
  const updated = aliyun([
    'ros', 'UpdateStack',
    '--RegionId', region,
    '--StackId', stackId,
    '--TemplateBody', templateBody,
    '--UsePreviousParameters', 'false',
    ...parameters,
  ], { allowNoChange: true });
  if (updated.noChange) {
    console.log('ROS stack is already current.');
    process.exit(0);
  }
}

if (!stackId) throw new Error('ROS did not return a stack identifier');

const deadline = Date.now() + 15 * 60 * 1000;
while (Date.now() < deadline) {
  const stack = aliyun(['ros', 'GetStack', '--RegionId', region, '--StackId', stackId]);
  const status = stack.Status;
  if (status === 'CREATE_COMPLETE' || status === 'UPDATE_COMPLETE') {
    console.log('ROS stack deployment completed.');
    process.exit(0);
  }
  if (typeof status === 'string' && !status.endsWith('_IN_PROGRESS')) {
    throw new Error(`ROS stack deployment ended with status: ${status}`);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

throw new Error('Timed out waiting for the ROS stack deployment');

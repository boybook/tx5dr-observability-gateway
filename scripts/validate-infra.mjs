import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const templateBody = await readFile(new URL('../infra/ros.yaml', import.meta.url), 'utf8');
const result = spawnSync('aliyun', [
  'ros',
  'ValidateTemplate',
  '--region',
  'cn-hangzhou',
  '--TemplateBody',
  templateBody,
], { encoding: 'utf8' });

if (result.status === 0) {
  console.log('ROS template passed Alibaba Cloud validation.');
} else {
  process.stderr.write(result.stderr || result.stdout || 'ROS template validation failed.\n');
  process.exitCode = result.status ?? 1;
}

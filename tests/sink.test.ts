import { describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/config.js';

const mocks = vi.hoisted(() => ({
  clientConfig: vi.fn(),
  postLogStoreLogs: vi.fn(),
}));

vi.mock('@alicloud/log', () => ({
  default: class {
    postLogStoreLogs = mocks.postLogStoreLogs;

    constructor(config: unknown) {
      mocks.clientConfig(config);
    }
  },
}));

import { AliyunSlsSink } from '../src/sink.js';

const CONFIG: GatewayConfig = {
  SLS_ENDPOINT: 'example.invalid',
  SLS_PROJECT: 'test-project',
  SLS_INSTALLATIONS_LOGSTORE: 'installations',
  SLS_EVENTS_LOGSTORE: 'events',
  SLS_DIAGNOSTIC_METADATA_LOGSTORE: 'diagnostic-metadata',
  OSS_REGION: 'cn-hangzhou',
  OSS_BUCKET: 'private-diagnostics-bucket',
  TOKEN_SIGNING_KEY_CURRENT: 'current-signing-key-is-long-enough-123456',
  TOKEN_SIGNING_KEY_ID: 'v1',
  INSTALLATION_HMAC_KEY: 'installation-hmac-key-is-long-enough-123',
};

describe('Aliyun SLS sink', () => {
  it('uses the protobuf-capable SLS data ingestion API', async () => {
    const sink = new AliyunSlsSink(CONFIG, {
      accessKeyId: 'temporary-id',
      accessKeySecret: 'temporary-secret',
      securityToken: 'temporary-token',
    });

    await sink.putInstallation({
      timeSeconds: 1_777_000_000,
      fields: { event_name: 'installation_registered', schema_version: 1 },
    });

    expect(mocks.clientConfig).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: 'example.invalid',
      use_https: true,
      credentialsProvider: expect.any(Object),
    }));
    expect(mocks.postLogStoreLogs).toHaveBeenCalledWith(
      'test-project',
      'installations',
      {
        topic: 'tx5dr-observability',
        logs: [{
          timestamp: 1_777_000_000,
          content: {
            event_name: 'installation_registered',
            schema_version: '1',
          },
        }],
      },
    );
  });
});

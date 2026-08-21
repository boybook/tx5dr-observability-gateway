import { describe, expect, it, vi } from 'vitest';
import type { GatewayConfig } from '../src/config.js';
import type { DiagnosticUpload } from '../src/schema.js';

const mocks = vi.hoisted(() => ({
  ossOptions: vi.fn(),
  signPolicy: vi.fn(() => 'v4-signature'),
  head: vi.fn(async () => ({
    res: {
      headers: {
        'content-length': '123',
        'content-type': 'application/gzip',
        'x-oss-meta-sha256': 'a'.repeat(64),
        etag: '"object-etag"',
      },
    },
  })),
}));

vi.mock('@alicloud/credentials', () => ({
  Config: class {},
  default: class {
    async getCredential() {
      return {
        accessKeyId: 'temporary-id',
        accessKeySecret: 'temporary-secret',
        securityToken: 'temporary-token',
      };
    }
  },
}));

vi.mock('ali-oss', () => ({
  default: class {
    options: Record<string, string | boolean>;
    constructor(options: Record<string, string | boolean>) {
      this.options = options;
      mocks.ossOptions(options);
    }
    generateObjectUrl(name: string) {
      return `https://private-bucket.example.invalid/${name}`;
    }
    signPostObjectPolicyV4 = mocks.signPolicy;
    head = mocks.head;
  },
}));

import {
  AliyunOssDiagnosticStorage,
  diagnosticObjectKey,
  UploadReceiptService,
} from '../src/diagnostics.js';

const CONFIG: GatewayConfig = {
  SLS_ENDPOINT: 'example.invalid',
  SLS_PROJECT: 'test',
  SLS_INSTALLATIONS_LOGSTORE: 'installations',
  SLS_EVENTS_LOGSTORE: 'events',
  SLS_DIAGNOSTIC_METADATA_LOGSTORE: 'diagnostic-metadata',
  OSS_REGION: 'cn-hangzhou',
  OSS_BUCKET: 'private-diagnostics-bucket',
  TOKEN_SIGNING_KEY_CURRENT: 'current-signing-key-is-long-enough-123456',
  TOKEN_SIGNING_KEY_ID: 'v1',
  INSTALLATION_HMAC_KEY: 'installation-hmac-key-is-long-enough-123',
};

const UPLOAD: DiagnosticUpload = {
  schema_version: 1,
  upload_id: 'b69aa016-7de6-4f2c-a5a8-84bf7fc57f62',
  app: {
    version: '1.2.3',
    build_channel: 'release',
    build_commit: 'abcdef0',
    distribution: 'electron',
    os_family: 'darwin',
    arch: 'arm64',
  },
  source_id: 'server',
  requested_from_ms: 1_777_000_000_000,
  requested_to_ms: 1_777_000_060_000,
  included_from_ms: 1_777_000_010_000,
  included_to_ms: 1_777_000_050_000,
  line_count: 4,
  uncompressed_bytes: 456,
  compressed_bytes: 123,
  sha256: 'a'.repeat(64),
  is_test: false,
};

describe('diagnostic upload support', () => {
  it('creates a V4 POST policy fixed to one object, checksum, and exact size', async () => {
    const storage = new AliyunOssDiagnosticStorage(CONFIG);
    const result = await storage.createUploadGrant('diagnostics/v1/object.log.gz', UPLOAD, 1_777_000_060_000);
    const policy = JSON.parse(Buffer.from(result.formFields.policy, 'base64').toString('utf8'));

    expect(result.uploadUrl).toBe('https://private-bucket.example.invalid/');
    expect(result.formFields).toMatchObject({
      key: 'diagnostics/v1/object.log.gz',
      'Content-Type': 'application/gzip',
      'x-oss-meta-sha256': 'a'.repeat(64),
      'x-oss-signature': 'v4-signature',
      'x-oss-security-token': 'temporary-token',
    });
    expect(policy.conditions).toContainEqual(['content-length-range', 123, 123]);
    expect(policy.conditions).toContainEqual(['eq', '$key', 'diagnostics/v1/object.log.gz']);
    expect(mocks.ossOptions).toHaveBeenCalledWith(expect.objectContaining({ internal: false }));
  });

  it('normalizes object metadata returned by OSS HEAD', async () => {
    const result = await new AliyunOssDiagnosticStorage(CONFIG).headObject('diagnostics/v1/object.log.gz');
    expect(result).toEqual({
      size: 123,
      sha256: 'a'.repeat(64),
      contentType: 'application/gzip',
      etag: 'object-etag',
    });
    expect(mocks.ossOptions).toHaveBeenCalledWith(expect.objectContaining({ internal: true }));
  });

  it('binds receipts to installation, upload id, and expiry', () => {
    const receipts = new UploadReceiptService(CONFIG.TOKEN_SIGNING_KEY_CURRENT, 'v1');
    const now = 1_777_000_000;
    const receipt = receipts.issue({
      sub: 'installation-key-that-is-long-enough',
      object_key: 'diagnostics/v1/object.log.gz',
      upload: UPLOAD,
    }, now);

    expect(receipts.verify(receipt, 'installation-key-that-is-long-enough', UPLOAD.upload_id, now + 1).object_key)
      .toBe('diagnostics/v1/object.log.gz');
    expect(() => receipts.verify(receipt, 'different-installation-key', UPLOAD.upload_id, now + 1)).toThrow();
    expect(() => receipts.verify(receipt, 'installation-key-that-is-long-enough', UPLOAD.upload_id, now + 901)).toThrow();
  });

  it('creates partitioned keys without local paths or host data', () => {
    expect(diagnosticObjectKey('anonymous-key', UPLOAD.upload_id, Date.UTC(2026, 7, 21)))
      .toBe(`diagnostics/v1/2026/08/21/anonymous-key/${UPLOAD.upload_id}.log.gz`);
  });
});

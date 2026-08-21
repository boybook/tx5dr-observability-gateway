import Credential, { Config as CredentialConfig } from '@alicloud/credentials';
import OSS from 'ali-oss';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { GatewayConfig } from './config.js';
import type { AliyunTemporaryCredentials } from './sink.js';
import type { DiagnosticUpload } from './schema.js';

const RECEIPT_AUDIENCE = 'tx5dr-diagnostic-upload';

function credentialScope(date: string, region: string, accessKeyId: string): string {
  return `${accessKeyId}/${date}/${region.replace(/^oss-/, '')}/oss/aliyun_v4_request`;
}

export interface DiagnosticUploadGrant {
  uploadUrl: string;
  formFields: Record<string, string>;
  expiresAt: number;
}

export interface DiagnosticObjectMetadata {
  size: number;
  sha256: string;
  contentType: string;
  etag: string;
}

export interface DiagnosticStorage {
  createUploadGrant(objectKey: string, upload: DiagnosticUpload, nowMs: number): Promise<DiagnosticUploadGrant>;
  headObject(objectKey: string): Promise<DiagnosticObjectMetadata>;
}

export class AliyunOssDiagnosticStorage implements DiagnosticStorage {
  private clientPromise: Promise<OSS> | null = null;
  private readonly credential: Credential;

  constructor(
    private readonly config: GatewayConfig,
    temporaryCredentials?: AliyunTemporaryCredentials,
  ) {
    this.credential = temporaryCredentials
      ? new Credential(new CredentialConfig({ type: 'sts', ...temporaryCredentials }))
      : new Credential();
  }

  private getClient(): Promise<OSS> {
    this.clientPromise ??= this.credential.getCredential().then((current) => {
      if (!current.accessKeyId || !current.accessKeySecret) throw new Error('Missing Alibaba Cloud credentials');
      return new OSS({
        region: `oss-${this.config.OSS_REGION}`,
        bucket: this.config.OSS_BUCKET,
        accessKeyId: current.accessKeyId,
        accessKeySecret: current.accessKeySecret,
        stsToken: current.securityToken,
        secure: true,
      });
    });
    return this.clientPromise;
  }

  async createUploadGrant(objectKey: string, upload: DiagnosticUpload, nowMs: number): Promise<DiagnosticUploadGrant> {
    const client = await this.getClient();
    const issuedAt = new Date(nowMs);
    const expiresAt = nowMs + 10 * 60 * 1000;
    const formattedDate = issuedAt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const credential = credentialScope(
      formattedDate.slice(0, 8),
      client.options.region,
      client.options.accessKeyId,
    );
    const conditions: Array<Record<string, string> | [string, string, string] | [string, number, number]> = [
      { bucket: this.config.OSS_BUCKET },
      { 'x-oss-credential': credential },
      { 'x-oss-date': formattedDate },
      { 'x-oss-signature-version': 'OSS4-HMAC-SHA256' },
      ['content-length-range', upload.compressed_bytes, upload.compressed_bytes],
      ['eq', '$key', objectKey],
      ['eq', '$content-type', 'application/gzip'],
      ['eq', '$x-oss-meta-sha256', upload.sha256],
      ['eq', '$success_action_status', '204'],
    ];
    if (client.options.stsToken) conditions.push({ 'x-oss-security-token': client.options.stsToken });
    const policy = { expiration: new Date(expiresAt).toISOString(), conditions };
    const signature = client.signPostObjectPolicyV4(policy, issuedAt);
    const fields: Record<string, string> = {
      key: objectKey,
      'Content-Type': 'application/gzip',
      'x-oss-meta-sha256': upload.sha256,
      'x-oss-date': formattedDate,
      'x-oss-credential': credential,
      'x-oss-signature-version': 'OSS4-HMAC-SHA256',
      'x-oss-signature': signature,
      policy: Buffer.from(JSON.stringify(policy), 'utf8').toString('base64'),
      success_action_status: '204',
    };
    if (client.options.stsToken) fields['x-oss-security-token'] = client.options.stsToken;
    const objectUrl = new URL(client.generateObjectUrl(objectKey));
    objectUrl.pathname = '/';
    objectUrl.search = '';
    return { uploadUrl: objectUrl.toString(), formFields: fields, expiresAt };
  }

  async headObject(objectKey: string): Promise<DiagnosticObjectMetadata> {
    const result = await (await this.getClient()).head(objectKey);
    const headers = Object.fromEntries(Object.entries(result.res.headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
      size: Number(headers['content-length']),
      sha256: String(headers['x-oss-meta-sha256'] ?? ''),
      contentType: String(headers['content-type'] ?? ''),
      etag: String(headers.etag ?? '').replace(/^"|"$/g, ''),
    };
  }
}

interface UploadReceiptPayload {
  aud: typeof RECEIPT_AUDIENCE;
  sub: string;
  object_key: string;
  upload: DiagnosticUpload;
  iat: number;
  exp: number;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value: string, key: string): Buffer {
  return createHmac('sha256', key).update(value).digest();
}

export class UploadReceiptService {
  constructor(
    private readonly currentKey: string,
    private readonly currentKeyId: string,
    private readonly previousKey?: string,
  ) {}

  issue(payload: Omit<UploadReceiptPayload, 'aud' | 'iat' | 'exp'>, nowSeconds: number): string {
    const header = { alg: 'HS256', typ: 'JWT', kid: this.currentKeyId };
    const body: UploadReceiptPayload = {
      ...payload,
      aud: RECEIPT_AUDIENCE,
      iat: nowSeconds,
      exp: nowSeconds + 15 * 60,
    };
    const unsigned = `${encode(header)}.${encode(body)}`;
    return `${unsigned}.${sign(unsigned, this.currentKey).toString('base64url')}`;
  }

  verify(token: string, installationKey: string, uploadId: string, nowSeconds: number): UploadReceiptPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid_upload_receipt');
    let header: { alg?: string; typ?: string; kid?: string };
    let payload: UploadReceiptPayload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as typeof header;
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as UploadReceiptPayload;
    } catch {
      throw new Error('invalid_upload_receipt');
    }
    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('invalid_upload_receipt');
    const actual = Buffer.from(parts[2], 'base64url');
    const unsigned = `${parts[0]}.${parts[1]}`;
    const candidateKeys = header.kid === this.currentKeyId
      ? [this.currentKey, this.previousKey]
      : [this.previousKey, this.currentKey];
    const valid = candidateKeys.some((key) => {
      if (!key) return false;
      const expected = sign(unsigned, key);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (!valid
      || payload.aud !== RECEIPT_AUDIENCE
      || payload.sub !== installationKey
      || payload.upload?.upload_id !== uploadId
      || !Number.isInteger(payload.iat)
      || payload.iat > nowSeconds + 300
      || !Number.isInteger(payload.exp)
      || payload.exp <= nowSeconds) {
      throw new Error('invalid_upload_receipt');
    }
    return payload;
  }
}

export function diagnosticObjectKey(installationKey: string, uploadId: string, nowMs: number): string {
  const date = new Date(nowMs);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `diagnostics/v1/${year}/${month}/${day}/${installationKey}/${uploadId}.log.gz`;
}

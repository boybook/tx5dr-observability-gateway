import { randomUUID } from 'node:crypto';
import type { GatewayConfig } from './config.js';
import {
  DiagnosticAuthorizationSchema,
  DiagnosticCompleteSchema,
  DiagnosticUploadSchema,
  EventBatchSchema,
  RegistrationSchema,
} from './schema.js';
import { deriveInstallationKey, InstallationTokenService } from './token.js';
import { mapDiagnosticUpload, mapRegistration, mapTelemetryEvent, type TelemetrySink } from './sink.js';
import {
  diagnosticObjectKey,
  type DiagnosticStorage,
  UploadReceiptService,
} from './diagnostics.js';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

function classifyOperationalError(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/NoPermission|AccessDenied|Forbidden|Unauthorized/i.test(message)) return 'sls_permission_denied';
  if (/InvalidAccessKeyId|SignatureDoesNotMatch|SecurityToken/i.test(message)) return 'sls_credential_rejected';
  if (/ProjectNotExist/i.test(message)) return 'sls_project_not_found';
  if (/LogStoreNotExist/i.test(message)) return 'sls_logstore_not_found';
  if (/NoSuchBucket|BucketNotExist/i.test(message)) return 'oss_bucket_not_found';
  if (/NoSuchKey|ObjectNotExist/i.test(message)) return 'oss_object_not_found';
  if (/InvalidArgument|InvalidPolicyDocument/i.test(message)) return 'oss_policy_invalid';
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(message)) return 'sls_endpoint_unreachable';
  return 'sls_write_failed';
}

interface FcEvent {
  rawPath?: string;
  path?: string;
  httpMethod?: string;
  method?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    requestId?: string;
    http?: { method?: string; path?: string };
  };
}

interface FcContext {
  requestId?: string;
}

interface FcResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded: false;
}

function response(statusCode: number, body: unknown, extraHeaders: Record<string, string> = {}): FcResponse {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
    isBase64Encoded: false,
  };
}

function parseFcEvent(rawEvent: unknown): FcEvent {
  if (Buffer.isBuffer(rawEvent)) return JSON.parse(rawEvent.toString('utf8')) as FcEvent;
  if (typeof rawEvent === 'string') return JSON.parse(rawEvent) as FcEvent;
  if (rawEvent && typeof rawEvent === 'object') return rawEvent as FcEvent;
  throw new Error('invalid_event');
}

function parseJsonBody(event: FcEvent): unknown {
  const encoded = event.body ?? '';
  if (Buffer.byteLength(encoded, 'utf8') > MAX_BODY_BYTES) throw new Error('body_too_large');
  const body = event.isBase64Encoded ? Buffer.from(encoded, 'base64').toString('utf8') : encoded;
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) throw new Error('body_too_large');
  return JSON.parse(body);
}

function bearerToken(headers: Record<string, string | undefined> = {}): string | null {
  const entry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'authorization');
  const match = entry?.[1]?.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

class WarmInstanceLimiter {
  private readonly buckets = new Map<string, { count: number; windowStart: number }>();

  allow(key: string, nowMs: number, limit: number): boolean {
    const bucket = this.buckets.get(key);
    if (!bucket || nowMs - bucket.windowStart >= 60_000) {
      this.buckets.set(key, { count: 1, windowStart: nowMs });
      return true;
    }
    if (bucket.count >= limit) return false;
    bucket.count += 1;
    return true;
  }
}

export function createHandler(options: {
  config: GatewayConfig;
  sink: TelemetrySink;
  storage?: DiagnosticStorage;
  now?: () => number;
}) {
  const tokenService = new InstallationTokenService(
    options.config.TOKEN_SIGNING_KEY_CURRENT,
    options.config.TOKEN_SIGNING_KEY_ID,
    options.config.TOKEN_SIGNING_KEY_PREVIOUS,
  );
  const now = options.now ?? Date.now;
  const limiter = new WarmInstanceLimiter();
  const receiptService = new UploadReceiptService(
    options.config.TOKEN_SIGNING_KEY_CURRENT,
    options.config.TOKEN_SIGNING_KEY_ID,
    options.config.TOKEN_SIGNING_KEY_PREVIOUS,
  );

  return async function handler(rawEvent: unknown, context: FcContext = {}): Promise<FcResponse> {
    const requestId = context.requestId || randomUUID();
    try {
      const event = parseFcEvent(rawEvent);
      const method = (event.requestContext?.http?.method || event.httpMethod || event.method || 'GET').toUpperCase();
      const path = event.rawPath || event.requestContext?.http?.path || event.path || '/';

      if (method === 'GET' && path === '/healthz') {
        return response(200, { status: 'ok', service: 'tx5dr-observability-gateway', schema_version: 1 });
      }

      if (method === 'POST' && path === '/v1/installations/register') {
        const nowMs = now();
        if (!limiter.allow('registration', nowMs, 120)) {
          return response(429, { error: 'rate_limited', request_id: requestId }, { 'retry-after': '60' });
        }
        const registration = RegistrationSchema.parse(parseJsonBody(event));
        const installationKey = deriveInstallationKey(
          registration.installation_id,
          options.config.INSTALLATION_HMAC_KEY,
        );
        await options.sink.putInstallation(mapRegistration(registration, installationKey, nowMs, requestId));
        const issued = tokenService.issue(installationKey, Math.floor(nowMs / 1000));
        return response(201, {
          schema_version: 1,
          installation_key: installationKey,
          installation_token: issued.token,
          token_expires_at: new Date(issued.expiresAt * 1000).toISOString(),
          server_time_ms: nowMs,
          reporting: { heartbeat_seconds: 180, stale_after_seconds: 420 },
        });
      }

      if (method === 'POST' && path === '/v1/telemetry/events') {
        const nowMs = now();
        const token = bearerToken(event.headers);
        if (!token) return response(401, { error: 'unauthorized', request_id: requestId });
        let installationKey: string;
        try {
          installationKey = tokenService.verify(token, Math.floor(nowMs / 1000));
        } catch {
          return response(401, { error: 'unauthorized', request_id: requestId });
        }
        if (!limiter.allow(`telemetry:${installationKey}`, nowMs, 60)) {
          return response(429, { error: 'rate_limited', request_id: requestId }, { 'retry-after': '60' });
        }
        const batch = EventBatchSchema.parse(parseJsonBody(event));
        if (batch.events.some((item) => Math.abs(item.occurred_at_ms - nowMs) > MAX_CLOCK_SKEW_MS)) {
          return response(400, { error: 'event_time_out_of_range', request_id: requestId });
        }
        await options.sink.putEvents(batch.events.map((item) => (
          mapTelemetryEvent(item, batch.app, installationKey, nowMs, requestId)
        )));
        return response(202, {
          schema_version: 1,
          accepted_event_ids: batch.events.map((item) => item.event_id),
          server_time_ms: nowMs,
        });
      }

      if (method === 'POST' && path === '/v1/diagnostics/authorize') {
        const nowMs = now();
        if (!limiter.allow('diagnostic-authorization', nowMs, 120)) {
          return response(429, { error: 'rate_limited', request_id: requestId }, { 'retry-after': '60' });
        }
        const authorization = DiagnosticAuthorizationSchema.parse(parseJsonBody(event));
        const installationKey = deriveInstallationKey(
          authorization.installation_id,
          options.config.INSTALLATION_HMAC_KEY,
        );
        const issued = tokenService.issueDiagnostic(installationKey, Math.floor(nowMs / 1000));
        return response(201, {
          schema_version: 1,
          diagnostics_token: issued.token,
          token_expires_at: new Date(issued.expiresAt * 1000).toISOString(),
          server_time_ms: nowMs,
          limits: {
            max_range_seconds: 7 * 24 * 60 * 60,
            max_uncompressed_bytes: 50 * 1024 * 1024,
            max_compressed_bytes: 20 * 1024 * 1024,
            feedback_max_characters: 2000,
            upload_expires_seconds: 10 * 60,
          },
        });
      }

      if (method === 'POST' && path === '/v1/diagnostics/uploads') {
        if (!options.storage) return response(503, { error: 'temporarily_unavailable', request_id: requestId });
        const nowMs = now();
        const token = bearerToken(event.headers);
        if (!token) return response(401, { error: 'unauthorized', request_id: requestId });
        let installationKey: string;
        try {
          installationKey = tokenService.verify(token, Math.floor(nowMs / 1000), 'diagnostics:write');
        } catch {
          return response(401, { error: 'unauthorized', request_id: requestId });
        }
        if (!limiter.allow(`diagnostic-upload:${installationKey}`, nowMs, 12)) {
          return response(429, { error: 'rate_limited', request_id: requestId }, { 'retry-after': '60' });
        }
        const upload = DiagnosticUploadSchema.parse(parseJsonBody(event));
        if (upload.requested_to_ms > nowMs + 5 * 60 * 1000) {
          return response(400, { error: 'event_time_out_of_range', request_id: requestId });
        }
        const objectKey = diagnosticObjectKey(installationKey, upload.upload_id, nowMs);
        const grant = await options.storage.createUploadGrant(objectKey, upload, nowMs);
        const uploadReceipt = receiptService.issue({
          sub: installationKey,
          object_key: objectKey,
          upload,
        }, Math.floor(nowMs / 1000));
        return response(201, {
          schema_version: 1,
          upload_id: upload.upload_id,
          upload_url: grant.uploadUrl,
          form_fields: grant.formFields,
          upload_receipt: uploadReceipt,
          expires_at: new Date(grant.expiresAt).toISOString(),
        });
      }

      const completeMatch = path.match(/^\/v1\/diagnostics\/uploads\/([0-9a-f-]{36})\/complete$/i);
      if (method === 'POST' && completeMatch) {
        if (!options.storage) return response(503, { error: 'temporarily_unavailable', request_id: requestId });
        const nowMs = now();
        const token = bearerToken(event.headers);
        if (!token) return response(401, { error: 'unauthorized', request_id: requestId });
        let installationKey: string;
        try {
          installationKey = tokenService.verify(token, Math.floor(nowMs / 1000), 'diagnostics:write');
        } catch {
          return response(401, { error: 'unauthorized', request_id: requestId });
        }
        const complete = DiagnosticCompleteSchema.parse(parseJsonBody(event));
        let receipt;
        try {
          receipt = receiptService.verify(
            complete.upload_receipt,
            installationKey,
            completeMatch[1],
            Math.floor(nowMs / 1000),
          );
        } catch {
          return response(400, { error: 'invalid_upload_receipt', request_id: requestId });
        }
        const object = await options.storage.headObject(receipt.object_key);
        if (
          object.size !== receipt.upload.compressed_bytes
          || object.sha256 !== receipt.upload.sha256
          || !object.contentType.toLowerCase().startsWith('application/gzip')
        ) {
          return response(409, { error: 'uploaded_object_mismatch', request_id: requestId });
        }
        await options.sink.putDiagnostic(mapDiagnosticUpload(
          receipt.upload,
          complete,
          installationKey,
          receipt.object_key,
          object.etag,
          nowMs,
          requestId,
        ));
        return response(202, {
          schema_version: 1,
          upload_id: receipt.upload.upload_id,
          accepted_at: new Date(nowMs).toISOString(),
          retained_until: new Date(nowMs + 30 * 24 * 60 * 60 * 1000).toISOString(),
        });
      }

      return response(404, { error: 'not_found', request_id: requestId });
    } catch (error) {
      const kind = error instanceof Error ? error.message : 'unknown_error';
      if (kind === 'body_too_large') return response(413, { error: kind, request_id: requestId });
      if (kind === 'invalid_event' || error instanceof SyntaxError || (error && typeof error === 'object' && 'issues' in error)) {
        return response(400, { error: 'invalid_request', request_id: requestId });
      }
      const diagnosticCode = classifyOperationalError(error);
      console.error(JSON.stringify({ level: 'error', event: 'request_failed', request_id: requestId, error_kind: diagnosticCode }));
      return response(503, {
        error: 'temporarily_unavailable',
        diagnostic_code: diagnosticCode,
        request_id: requestId,
      }, { 'retry-after': '30' });
    }
  };
}

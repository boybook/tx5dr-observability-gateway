import { describe, expect, it } from 'vitest';
import type { GatewayConfig } from '../src/config.js';
import { createHandler } from '../src/handler.js';
import type { FlatLogRecord, TelemetrySink } from '../src/sink.js';

const NOW = Date.UTC(2026, 7, 20, 0, 0, 0);
const CONFIG: GatewayConfig = {
  SLS_ENDPOINT: 'example.invalid',
  SLS_PROJECT: 'test',
  SLS_INSTALLATIONS_LOGSTORE: 'installations',
  SLS_EVENTS_LOGSTORE: 'events',
  TOKEN_SIGNING_KEY_CURRENT: 'current-signing-key-is-long-enough-123456',
  TOKEN_SIGNING_KEY_ID: 'v1',
  INSTALLATION_HMAC_KEY: 'installation-hmac-key-is-long-enough-123',
};
const APP = {
  version: '1.2.3',
  build_channel: 'release',
  build_commit: 'abcdef0',
  distribution: 'electron',
  os_family: 'darwin',
  arch: 'arm64',
} as const;

class MemorySink implements TelemetrySink {
  installations: FlatLogRecord[] = [];
  events: FlatLogRecord[] = [];
  async putInstallation(record: FlatLogRecord) { this.installations.push(record); }
  async putEvents(records: FlatLogRecord[]) { this.events.push(...records); }
}

function request(path: string, body?: unknown, token?: string) {
  return {
    rawPath: path,
    requestContext: { http: { method: body === undefined ? 'GET' : 'POST' } },
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

describe('gateway handler', () => {
  it('returns health without loading user data', async () => {
    const handler = createHandler({ config: CONFIG, sink: new MemorySink(), now: () => NOW });
    const result = await handler(request('/healthz'), { requestId: 'health-request' });
    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body)).toMatchObject({ status: 'ok', schema_version: 1 });
  });

  it('registers an installation without storing the raw installation id', async () => {
    const sink = new MemorySink();
    const handler = createHandler({ config: CONFIG, sink, now: () => NOW });
    const installationId = 'ad3be608-5c6f-4fda-a524-48c8fa8cff4b';
    const result = await handler(request('/v1/installations/register', {
      schema_version: 1,
      registration_event_id: 'd1533337-e79f-4fc1-b550-4b8c1cf9ec79',
      installation_id: installationId,
      app: APP,
    }), { requestId: 'register-request' });

    expect(result.statusCode).toBe(201);
    const response = JSON.parse(result.body);
    expect(response.installation_token).toBeTypeOf('string');
    expect(response.installation_key).not.toContain(installationId);
    expect(JSON.stringify(sink.installations)).not.toContain(installationId);
    expect(sink.installations[0].fields).toMatchObject({
      event_name: 'installation_registered',
      app_version: '1.2.3',
      distribution: 'electron',
    });
  });

  it('accepts authenticated presence events and preserves version metadata', async () => {
    const sink = new MemorySink();
    const handler = createHandler({ config: CONFIG, sink, now: () => NOW });
    const registration = await handler(request('/v1/installations/register', {
      schema_version: 1,
      registration_event_id: 'd1533337-e79f-4fc1-b550-4b8c1cf9ec79',
      installation_id: 'ad3be608-5c6f-4fda-a524-48c8fa8cff4b',
      app: APP,
    }));
    const token = JSON.parse(registration.body).installation_token as string;
    const result = await handler(request('/v1/telemetry/events', {
      schema_version: 1,
      app: APP,
      events: [{
        event_id: '6cd4c636-ab0c-4240-af07-e5ae8efe39f8',
        event_name: 'presence_snapshot',
        occurred_at_ms: NOW,
        session_id: '09e73550-8a15-4aed-b7f0-51830752893f',
        runtime_state: 'online',
        active_connections: 3,
        uptime_seconds: 180,
        reason: 'heartbeat',
      }],
    }, token), { requestId: 'events-request' });

    expect(result.statusCode).toBe(202);
    expect(sink.events[0].fields).toMatchObject({
      event_name: 'presence_snapshot',
      app_version: '1.2.3',
      active_connections: 3,
      gateway_request_id: 'events-request',
    });
  });

  it('rejects sensitive or unknown fields', async () => {
    const handler = createHandler({ config: CONFIG, sink: new MemorySink(), now: () => NOW });
    const result = await handler(request('/v1/installations/register', {
      schema_version: 1,
      registration_event_id: 'd1533337-e79f-4fc1-b550-4b8c1cf9ec79',
      installation_id: 'ad3be608-5c6f-4fda-a524-48c8fa8cff4b',
      callsign: 'N0CALL',
      app: APP,
    }));
    expect(result.statusCode).toBe(400);
  });

  it('rejects events outside the allowed clock window', async () => {
    const sink = new MemorySink();
    const handler = createHandler({ config: CONFIG, sink, now: () => NOW });
    const registration = await handler(request('/v1/installations/register', {
      schema_version: 1,
      registration_event_id: 'd1533337-e79f-4fc1-b550-4b8c1cf9ec79',
      installation_id: 'ad3be608-5c6f-4fda-a524-48c8fa8cff4b',
      app: APP,
    }));
    const token = JSON.parse(registration.body).installation_token as string;
    const result = await handler(request('/v1/telemetry/events', {
      schema_version: 1,
      app: APP,
      events: [{
        event_id: '6cd4c636-ab0c-4240-af07-e5ae8efe39f8',
        event_name: 'session_started',
        occurred_at_ms: NOW - (25 * 60 * 60 * 1000),
        session_id: '09e73550-8a15-4aed-b7f0-51830752893f',
        runtime_state: 'online',
        active_connections: 0,
        uptime_seconds: 0,
        reason: 'startup',
      }],
    }, token));
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('event_time_out_of_range');
  });
});

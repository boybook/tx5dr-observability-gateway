import Credential, { Config as CredentialConfig } from '@alicloud/credentials';
import SlsClient from '@alicloud/log';
import type { GatewayConfig } from './config.js';
import type { AppMetadata, Registration, TelemetryEvent } from './schema.js';

export interface FlatLogRecord {
  timeSeconds: number;
  fields: Record<string, string | number>;
}

export interface TelemetrySink {
  putInstallation(record: FlatLogRecord): Promise<void>;
  putEvents(records: FlatLogRecord[]): Promise<void>;
}

export interface AliyunTemporaryCredentials {
  accessKeyId: string;
  accessKeySecret: string;
  securityToken: string;
}

export function commonFields(
  eventId: string,
  eventName: string,
  installationKey: string,
  app: AppMetadata,
  receivedAtMs: number,
  requestId: string,
): Record<string, string | number> {
  return {
    schema_version: 1,
    event_id: eventId,
    event_name: eventName,
    received_at_ms: receivedAtMs,
    gateway_request_id: requestId,
    installation_key: installationKey,
    app_version: app.version,
    build_channel: app.build_channel,
    build_commit: app.build_commit,
    distribution: app.distribution,
    os_family: app.os_family,
    arch: app.arch,
  };
}

export function mapRegistration(
  registration: Registration,
  installationKey: string,
  receivedAtMs: number,
  requestId: string,
): FlatLogRecord {
  return {
    timeSeconds: Math.floor(receivedAtMs / 1000),
    fields: commonFields(
      registration.registration_event_id,
      'installation_registered',
      installationKey,
      registration.app,
      receivedAtMs,
      requestId,
    ),
  };
}

export function mapTelemetryEvent(
  event: TelemetryEvent,
  app: AppMetadata,
  installationKey: string,
  receivedAtMs: number,
  requestId: string,
): FlatLogRecord {
  return {
    timeSeconds: Math.floor(receivedAtMs / 1000),
    fields: {
      ...commonFields(event.event_id, event.event_name, installationKey, app, receivedAtMs, requestId),
      occurred_at_ms: event.occurred_at_ms,
      session_id: event.session_id,
      runtime_state: event.runtime_state,
      active_connections: event.active_connections,
      uptime_seconds: event.uptime_seconds,
      reason: event.reason,
    },
  };
}

export class AliyunSlsSink implements TelemetrySink {
  private readonly client: SlsClient;

  constructor(
    private readonly config: GatewayConfig,
    temporaryCredentials?: AliyunTemporaryCredentials,
  ) {
    const credential = temporaryCredentials
      ? new Credential(new CredentialConfig({ type: 'sts', ...temporaryCredentials }))
      : new Credential();
    this.client = new SlsClient({
      credentialsProvider: {
        async getCredentials() {
          const current = await credential.getCredential();
          if (!current.accessKeyId || !current.accessKeySecret) {
            throw new Error('Missing Alibaba Cloud credentials');
          }
          return {
            accessKeyId: current.accessKeyId,
            accessKeySecret: current.accessKeySecret,
            securityToken: current.securityToken,
          };
        },
      },
      endpoint: config.SLS_ENDPOINT,
      use_https: true,
    });
  }

  putInstallation(record: FlatLogRecord): Promise<void> {
    return this.put(this.config.SLS_INSTALLATIONS_LOGSTORE, [record]);
  }

  putEvents(records: FlatLogRecord[]): Promise<void> {
    return this.put(this.config.SLS_EVENTS_LOGSTORE, records);
  }

  private async put(logstore: string, records: FlatLogRecord[]): Promise<void> {
    await this.client.postLogStoreLogs(this.config.SLS_PROJECT, logstore, {
      topic: 'tx5dr-observability',
      logs: records.map((record) => ({
        timestamp: record.timeSeconds,
        content: Object.fromEntries(
          Object.entries(record.fields).map(([key, value]) => [key, String(value)]),
        ),
      })),
    });
  }
}

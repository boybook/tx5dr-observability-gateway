import Credential from '@alicloud/credentials';
import SlsClient, * as $Sls from '@alicloud/sls20201230';
import * as $OpenApi from '@alicloud/openapi-client';
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

  constructor(private readonly config: GatewayConfig) {
    const credential = new Credential();
    this.client = new SlsClient(new $OpenApi.Config({
      credential,
      endpoint: config.SLS_ENDPOINT,
    }));
  }

  putInstallation(record: FlatLogRecord): Promise<void> {
    return this.put(this.config.SLS_INSTALLATIONS_LOGSTORE, [record]);
  }

  putEvents(records: FlatLogRecord[]): Promise<void> {
    return this.put(this.config.SLS_EVENTS_LOGSTORE, records);
  }

  private async put(logstore: string, records: FlatLogRecord[]): Promise<void> {
    const logItems = records.map((record) => new $Sls.LogItem({
      time: record.timeSeconds,
      contents: Object.entries(record.fields).map(([key, value]) => new $Sls.LogContent({
        key,
        value: String(value),
      })),
    }));
    await this.client.putLogs(this.config.SLS_PROJECT, logstore, new $Sls.PutLogsRequest({
      body: new $Sls.LogGroup({ topic: 'tx5dr-observability', logItems }),
    }));
  }
}

import { z } from 'zod';

const DistributionSchema = z.enum([
  'electron',
  'docker',
  'android-bridge',
  'linux-service',
  'generic-server',
  'web-dev',
]);

export const AppMetadataSchema = z.object({
  version: z.string().trim().min(1).max(64),
  build_channel: z.enum(['release', 'nightly']),
  build_commit: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  distribution: DistributionSchema,
  os_family: z.enum(['win32', 'darwin', 'linux', 'android', 'other']),
  arch: z.enum(['x64', 'arm64', 'arm', 'other']),
}).strict();

export const RegistrationSchema = z.object({
  schema_version: z.literal(1),
  registration_event_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  app: AppMetadataSchema,
}).strict();

const EventBaseSchema = z.object({
  event_id: z.string().uuid(),
  occurred_at_ms: z.number().int().positive(),
  session_id: z.string().uuid(),
  uptime_seconds: z.number().int().nonnegative().max(31_536_000),
});

const SessionStartedSchema = EventBaseSchema.extend({
  event_name: z.literal('session_started'),
  runtime_state: z.literal('online'),
  active_connections: z.number().int().nonnegative().max(100_000),
  reason: z.literal('startup'),
}).strict();

const PresenceSnapshotSchema = EventBaseSchema.extend({
  event_name: z.literal('presence_snapshot'),
  runtime_state: z.literal('online'),
  active_connections: z.number().int().nonnegative().max(100_000),
  reason: z.enum(['heartbeat', 'connection_change']),
}).strict();

const SessionEndedSchema = EventBaseSchema.extend({
  event_name: z.literal('session_ended'),
  runtime_state: z.literal('offline'),
  active_connections: z.literal(0),
  reason: z.literal('shutdown'),
}).strict();

export const TelemetryEventSchema = z.discriminatedUnion('event_name', [
  SessionStartedSchema,
  PresenceSnapshotSchema,
  SessionEndedSchema,
]);

export const EventBatchSchema = z.object({
  schema_version: z.literal(1),
  app: AppMetadataSchema,
  events: z.array(TelemetryEventSchema).min(1).max(20),
}).strict();

export type AppMetadata = z.infer<typeof AppMetadataSchema>;
export type Registration = z.infer<typeof RegistrationSchema>;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type EventBatch = z.infer<typeof EventBatchSchema>;

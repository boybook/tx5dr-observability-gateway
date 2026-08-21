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

export const DiagnosticAuthorizationSchema = z.object({
  schema_version: z.literal(1),
  authorization_event_id: z.string().uuid(),
  installation_id: z.string().uuid(),
  app: AppMetadataSchema,
}).strict();

export const DiagnosticSourceSchema = z.enum(['server', 'electron-main', 'client-tools']);

export const DiagnosticUploadSchema = z.object({
  schema_version: z.literal(1),
  upload_id: z.string().uuid(),
  app: AppMetadataSchema,
  source_id: DiagnosticSourceSchema,
  requested_from_ms: z.number().int().positive(),
  requested_to_ms: z.number().int().positive(),
  included_from_ms: z.number().int().positive(),
  included_to_ms: z.number().int().positive(),
  line_count: z.number().int().positive(),
  uncompressed_bytes: z.number().int().positive().max(50 * 1024 * 1024),
  compressed_bytes: z.number().int().positive().max(20 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  is_test: z.boolean().optional().default(false),
}).strict().superRefine((value, context) => {
  if (value.requested_to_ms <= value.requested_from_ms) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requested_to_ms'], message: 'invalid requested time range' });
  }
  if (value.requested_to_ms - value.requested_from_ms > 7 * 24 * 60 * 60 * 1000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['requested_to_ms'], message: 'requested time range exceeds seven days' });
  }
  if (value.included_to_ms < value.included_from_ms
    || value.included_from_ms < value.requested_from_ms
    || value.included_to_ms > value.requested_to_ms) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['included_to_ms'], message: 'included range must be inside requested range' });
  }
});

export const DiagnosticCompleteSchema = z.object({
  schema_version: z.literal(1),
  upload_receipt: z.string().min(32).max(16_384),
  feedback: z.string().trim().max(2000).optional(),
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
export type DiagnosticAuthorization = z.infer<typeof DiagnosticAuthorizationSchema>;
export type DiagnosticUpload = z.infer<typeof DiagnosticUploadSchema>;
export type DiagnosticComplete = z.infer<typeof DiagnosticCompleteSchema>;
export type TelemetryEvent = z.infer<typeof TelemetryEventSchema>;
export type EventBatch = z.infer<typeof EventBatchSchema>;

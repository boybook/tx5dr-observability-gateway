import { z } from 'zod';

const ConfigSchema = z.object({
  SLS_ENDPOINT: z.string().min(1),
  SLS_PROJECT: z.string().min(1),
  SLS_INSTALLATIONS_LOGSTORE: z.string().min(1),
  SLS_EVENTS_LOGSTORE: z.string().min(1),
  SLS_DIAGNOSTIC_METADATA_LOGSTORE: z.string().min(1),
  OSS_REGION: z.string().regex(/^cn-[a-z0-9-]+$/),
  OSS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  TOKEN_SIGNING_KEY_CURRENT: z.string().min(32),
  TOKEN_SIGNING_KEY_PREVIOUS: z.string().min(32).optional(),
  TOKEN_SIGNING_KEY_ID: z.string().regex(/^[A-Za-z0-9._-]{1,32}$/),
  INSTALLATION_HMAC_KEY: z.string().min(32),
});

export type GatewayConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  return ConfigSchema.parse({
    SLS_ENDPOINT: env.SLS_ENDPOINT,
    SLS_PROJECT: env.SLS_PROJECT,
    SLS_INSTALLATIONS_LOGSTORE: env.SLS_INSTALLATIONS_LOGSTORE,
    SLS_EVENTS_LOGSTORE: env.SLS_EVENTS_LOGSTORE,
    SLS_DIAGNOSTIC_METADATA_LOGSTORE: env.SLS_DIAGNOSTIC_METADATA_LOGSTORE,
    OSS_REGION: env.OSS_REGION,
    OSS_BUCKET: env.OSS_BUCKET,
    TOKEN_SIGNING_KEY_CURRENT: env.TOKEN_SIGNING_KEY_CURRENT,
    TOKEN_SIGNING_KEY_PREVIOUS: env.TOKEN_SIGNING_KEY_PREVIOUS || undefined,
    TOKEN_SIGNING_KEY_ID: env.TOKEN_SIGNING_KEY_ID ?? 'v1',
    INSTALLATION_HMAC_KEY: env.INSTALLATION_HMAC_KEY,
  });
}

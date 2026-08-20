import { loadConfig } from './config.js';
import { createHandler } from './handler.js';
import { AliyunSlsSink, type AliyunTemporaryCredentials } from './sink.js';

let productionHandler: ReturnType<typeof createHandler> | null = null;
let activeCredentials: Pick<AliyunTemporaryCredentials, 'accessKeyId' | 'securityToken'> | null | undefined;

interface FcContext {
  requestId?: string;
  credentials?: AliyunTemporaryCredentials;
}

function credentialsChanged(credentials?: AliyunTemporaryCredentials): boolean {
  if (activeCredentials === undefined) return true;
  if (!credentials) return activeCredentials !== null;
  return activeCredentials === null
    || activeCredentials.accessKeyId !== credentials.accessKeyId
    || activeCredentials.securityToken !== credentials.securityToken;
}

export async function handler(event: unknown, context: FcContext = {}) {
  if (!productionHandler || credentialsChanged(context.credentials)) {
    const config = loadConfig();
    productionHandler = createHandler({
      config,
      sink: new AliyunSlsSink(config, context.credentials),
    });
    activeCredentials = context.credentials
      ? {
          accessKeyId: context.credentials.accessKeyId,
          securityToken: context.credentials.securityToken,
        }
      : null;
  }
  return productionHandler(event, context);
}

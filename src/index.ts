import { loadConfig } from './config.js';
import { createHandler } from './handler.js';
import { AliyunSlsSink } from './sink.js';

let productionHandler: ReturnType<typeof createHandler> | null = null;

export async function handler(event: unknown, context: { requestId?: string } = {}) {
  if (!productionHandler) {
    const config = loadConfig();
    productionHandler = createHandler({ config, sink: new AliyunSlsSink(config) });
  }
  return productionHandler(event, context);
}

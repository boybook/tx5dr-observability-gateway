import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createHandler: vi.fn(),
  handler: vi.fn(),
  sinkConstructor: vi.fn(),
}));

vi.mock('../src/config.js', () => ({
  loadConfig: () => ({ test: 'config' }),
}));

vi.mock('../src/handler.js', () => ({
  createHandler: mocks.createHandler,
}));

vi.mock('../src/sink.js', () => ({
  AliyunSlsSink: class {
    constructor(...args: unknown[]) {
      mocks.sinkConstructor(...args);
    }
  },
}));

describe('FC entrypoint', () => {
  beforeEach(() => {
    mocks.createHandler.mockReturnValue(mocks.handler);
    mocks.handler.mockResolvedValue({ statusCode: 200 });
  });

  it('passes FC role credentials to the SLS sink', async () => {
    const { handler } = await import('../src/index.js');
    const credentials = {
      accessKeyId: 'temporary-id',
      accessKeySecret: 'temporary-secret',
      securityToken: 'temporary-token',
    };

    await handler({}, { requestId: 'test-request', credentials });

    expect(mocks.sinkConstructor).toHaveBeenCalledWith({ test: 'config' }, credentials);
    expect(mocks.handler).toHaveBeenCalledWith({}, { requestId: 'test-request', credentials });
  });
});

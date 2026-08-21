import { describe, expect, it } from 'vitest';
import { InstallationTokenService } from '../src/token.js';

describe('installation token scopes', () => {
  const service = new InstallationTokenService('current-signing-key-is-long-enough-123456', 'v1');

  it('keeps telemetry and short-lived diagnostic scopes separate', () => {
    const now = 1_777_000_000;
    const telemetry = service.issue('installation-key-that-is-long-enough', now).token;
    const diagnostic = service.issueDiagnostic('installation-key-that-is-long-enough', now).token;

    expect(service.verify(telemetry, now + 1)).toBe('installation-key-that-is-long-enough');
    expect(() => service.verify(telemetry, now + 1, 'diagnostics:write')).toThrow();
    expect(service.verify(diagnostic, now + 1, 'diagnostics:write')).toBe('installation-key-that-is-long-enough');
    expect(() => service.verify(diagnostic, now + 15 * 60, 'diagnostics:write')).toThrow();
  });
});

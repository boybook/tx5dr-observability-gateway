import { createHmac, timingSafeEqual } from 'node:crypto';

const ISSUER = 'tx5dr-observability-gateway';
const AUDIENCE = 'tx5dr-observability';
const TOKEN_LIFETIME_SECONDS = 365 * 24 * 60 * 60;

interface TokenPayload {
  iss: string;
  aud: string;
  sub: string;
  scope: string;
  iat: number;
  exp: number;
}

interface TokenHeader {
  alg: 'HS256';
  typ: 'JWT';
  kid: string;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(input: string, key: string): Buffer {
  return createHmac('sha256', key).update(input).digest();
}

export function deriveInstallationKey(installationId: string, hmacKey: string): string {
  return createHmac('sha256', hmacKey).update(installationId).digest('base64url');
}

export class InstallationTokenService {
  constructor(
    private readonly currentKey: string,
    private readonly currentKeyId: string,
    private readonly previousKey?: string,
  ) {}

  issue(installationKey: string, nowSeconds = Math.floor(Date.now() / 1000)): {
    token: string;
    expiresAt: number;
  } {
    const header: TokenHeader = { alg: 'HS256', typ: 'JWT', kid: this.currentKeyId };
    const payload: TokenPayload = {
      iss: ISSUER,
      aud: AUDIENCE,
      sub: installationKey,
      scope: 'telemetry:write',
      iat: nowSeconds,
      exp: nowSeconds + TOKEN_LIFETIME_SECONDS,
    };
    const unsigned = `${encodeJson(header)}.${encodeJson(payload)}`;
    const signature = sign(unsigned, this.currentKey).toString('base64url');
    return { token: `${unsigned}.${signature}`, expiresAt: payload.exp };
  }

  verify(token: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('invalid_token');

    let header: TokenHeader;
    let payload: TokenPayload;
    try {
      header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as TokenHeader;
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as TokenPayload;
    } catch {
      throw new Error('invalid_token');
    }

    if (header.alg !== 'HS256' || header.typ !== 'JWT') throw new Error('invalid_token');
    const actual = Buffer.from(parts[2], 'base64url');
    const unsigned = `${parts[0]}.${parts[1]}`;
    const candidateKeys = header.kid === this.currentKeyId
      ? [this.currentKey, this.previousKey]
      : [this.previousKey, this.currentKey];
    const validSignature = candidateKeys.some((key) => {
      if (!key) return false;
      const expected = sign(unsigned, key);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (!validSignature) throw new Error('invalid_token');
    if (
      payload.iss !== ISSUER
      || payload.aud !== AUDIENCE
      || payload.scope !== 'telemetry:write'
      || typeof payload.sub !== 'string'
      || payload.sub.length < 20
      || !Number.isInteger(payload.exp)
      || payload.exp <= nowSeconds
      || !Number.isInteger(payload.iat)
      || payload.iat > nowSeconds + 300
    ) {
      throw new Error('invalid_token');
    }
    return payload.sub;
  }
}

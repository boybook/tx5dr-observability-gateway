# TX-5DR Observability Gateway

Small Alibaba Cloud Function Compute ingress for privacy-preserving TX-5DR usage statistics. It validates a fixed event schema, replaces random local installation IDs with keyed HMACs, signs stateless installation tokens, and writes flattened records to SLS.

## Local verification

```bash
npm install
npm run check
npm run build
```

No test requires Alibaba Cloud credentials.

## Infrastructure

`infra/ros.yaml` owns the SLS Project and Logstores, indexes, and the least-privilege FC runtime role. Every physical resource name is a required deployment parameter so the public repository does not disclose storage targets. Preview the ROS stack before creating or updating it. The diagnostics upload namespace is reserved, but its private OSS Bucket is deferred until that manually initiated flow is implemented; the v1 function has no OSS permissions.

Validate the template with:

```bash
npm run infra:validate
```

## Deployment

Build first, obtain the runtime role ARN from the ROS stack output, and export the variables shown in `.env.example`. Generate two different random secrets of at least 32 bytes for token signing and installation HMAC. Never commit or print credentials, resource names, role ARNs, or storage targets. GitHub deployment stores all of them in the protected `production` Environment Secrets rather than repository variables.

```bash
npm run build
s deploy
```

The complete secret inventory, credential boundary, and automated deployment behavior are documented in `docs/deployment.md`.

The public HTTP trigger uses application-level Bearer tokens. `GET /healthz` is public; registration is unauthenticated and rate-limited; telemetry events require a signed installation token.

## Reserved namespaces

The repository and cloud resources reserve `/v1/diagnostics/uploads`, `/v1/diagnostics/uploads/{id}/complete`, and `/v1/application-logs/batches`. These routes are intentionally not active in v1.

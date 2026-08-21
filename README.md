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

`infra/ros.yaml` owns the SLS Project and Logstores, indexes, private diagnostics Bucket, and least-privilege FC runtime role. Every physical resource name is a required deployment parameter so the public repository does not disclose storage targets. Preview the ROS stack before creating or updating it. Diagnostic objects are private, encrypted, and expire after 30 days.

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

The public HTTP trigger uses application-level Bearer tokens. `GET /healthz` is public; registration and diagnostic authorization are unauthenticated and rate-limited; telemetry and diagnostic operations require separate signed scopes. Diagnostic authorization does not create an installation-count record.

## Diagnostic uploads

`POST /v1/diagnostics/authorize` issues a short-lived diagnostic token. The client then requests a bounded OSS form from `/v1/diagnostics/uploads`, uploads one gzip object directly to private OSS, and confirms it through `/v1/diagnostics/uploads/{id}/complete`. SLS receives only searchable metadata and the optional user feedback. `/v1/application-logs/batches` remains reserved for a future structured log flow.

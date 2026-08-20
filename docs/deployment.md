# Private production deployment

The repository is public, but its production topology is not. Create a protected GitHub Environment named `production` and store every value below as an Environment Secret, not as a repository variable:

- `ALIYUN_REGION`
- `ALIYUN_ACCOUNT_ID`
- `ALIYUN_OIDC_PROVIDER_ARN`
- `ALIYUN_DEPLOY_ROLE_ARN`
- `ROS_STACK_NAME`
- `SLS_ENDPOINT`
- `SLS_PROJECT`
- `SLS_INSTALLATIONS_LOGSTORE`
- `SLS_EVENTS_LOGSTORE`
- `FC_RUNTIME_LOGSTORE`
- `APPLICATION_LOGSTORE`
- `DIAGNOSTIC_METADATA_LOGSTORE`
- `DIAGNOSTICS_BUCKET`
- `FC_FUNCTION_NAME`
- `FC_RUNTIME_ROLE_NAME`
- `TOKEN_SIGNING_KEY_CURRENT`
- `TOKEN_SIGNING_KEY_PREVIOUS`
- `TOKEN_SIGNING_KEY_ID`
- `INSTALLATION_HMAC_KEY`

Use independent cryptographically random values of at least 32 bytes for the current token key and installation HMAC key. Keep the previous token key empty for the initial deployment. During rotation, move the old current key to the previous key, install a new current key, and change the key ID.

The Alibaba Cloud OIDC provider and deployment role are one-time account bootstrap resources. Their trust policy must restrict the GitHub subject to this repository and the `production` environment. The deployment role needs only the FC, ROS, SLS, OSS, and runtime-role operations exercised by this stack. Do not grant it console login or a long-lived AccessKey.

Protect the Environment with required reviewers if available. Pull requests, including fork pull requests, run only `.github/workflows/ci.yml` and cannot access production secrets. A push to `main` runs `.github/workflows/deploy.yml`, obtains a short-lived OIDC credential, updates the parameterized ROS stack, and deploys the function. Deployment output is withheld because Serverless Devs can print physical resource names.

The function's public HTTPS trigger URL is intentionally not treated as a secret: released clients must know it. It reveals neither SLS/OSS destinations nor cloud credentials.

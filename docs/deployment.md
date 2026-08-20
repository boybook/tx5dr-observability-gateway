# Private production deployment

The repository is public, but its production topology is not. Create a protected GitHub Environment named `production` and store every value below as an Environment Secret, not as a repository variable:

- `ALIYUN_REGION`
- `ALIYUN_ACCOUNT_ID`
- `ALIYUN_ACCESS_KEY_ID`
- `ALIYUN_ACCESS_KEY_SECRET`
- `SLS_ENDPOINT`
- `SLS_PROJECT`
- `SLS_INSTALLATIONS_LOGSTORE`
- `SLS_EVENTS_LOGSTORE`
- `FC_RUNTIME_LOGSTORE`
- `FC_FUNCTION_NAME`
- `FC_RUNTIME_ROLE_NAME`
- `TOKEN_SIGNING_KEY_CURRENT`
- `TOKEN_SIGNING_KEY_PREVIOUS`
- `TOKEN_SIGNING_KEY_ID`
- `INSTALLATION_HMAC_KEY`

Use independent cryptographically random values of at least 32 bytes for the current token key and installation HMAC key. Keep the previous token key empty for the initial deployment. During rotation, move the old current key to the previous key, install a new current key, and change the key ID.

Use a dedicated RAM user or narrowly scoped existing RAM user whose AccessKey permits only the FC operations exercised by this deployment and `ram:PassRole` for the existing runtime role. GitHub cannot copy or reveal a Secret from another repository, so shared credentials must be entered separately or supplied through an organization-level Secret. Rotate the AccessKey if it has been exposed outside the protected Environment Secrets interface, and never grant the RAM user console login or unrelated account-management permissions.

Provision the parameterized ROS stack once from a trusted local Alibaba Cloud CLI profile. Keep its generated names in a private local configuration file and copy only the values consumed by the function deployment into GitHub Environment Secrets. CI deliberately does not create or update SLS, OSS, or RAM resources.

Protect the Environment with required reviewers if available. Pull requests, including fork pull requests, run only `.github/workflows/ci.yml` and cannot access production secrets. Leave the non-secret Repository Variable `DEPLOY_ENABLED` unset during bootstrap; job-level conditions are evaluated before Environment variables become available. After the local ROS bootstrap and every Environment Secret are ready, set the Repository Variable to `true`. A push to `main` then runs `.github/workflows/deploy.yml`, supplies the protected AccessKey Secrets directly to Serverless Devs, and deploys only the function and HTTP trigger. Deployment output is withheld because Serverless Devs can print physical resource names.

The function's public HTTPS trigger URL is intentionally not treated as a secret: released clients must know it. It reveals neither SLS/OSS destinations nor cloud credentials.

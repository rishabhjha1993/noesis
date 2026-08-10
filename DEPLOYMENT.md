# Deploying Noesis to Railway

Noesis deploys as one full-stack Node service. `railway.json` selects Railpack, runs the existing workspace build, starts the root production command, and checks `/api/healthz` before activating a deployment.

## Required variables

- `OPENAI_API_KEY`: required for image analysis. It is read only by the API server and is never bundled into the browser.

## Optional variables

- `DATABASE_URL`: enables the existing Postgres analysis cache. Railway Postgres exposes this variable when its service is connected. Without it, analysis works with persistent caching explicitly disabled.
- `NOESIS_ACCESS_CODE`: enables the private-alpha access screen and protects the frontend and analysis API with an HttpOnly cookie. Leave absent for normal local development.
- `NOESIS_ALLOWED_ORIGIN`: comma-separated cross-origin browser origins, only if a separate trusted frontend must call the production API. Leave absent for the normal same-origin deployment.
- `LOG_LEVEL`: server log level; defaults to `info`.
- `HOST`: bind address; defaults to `0.0.0.0` and normally should not be set on Railway.
- `BASE_PATH`: frontend asset base; defaults to `/` and normally should not be set on Railway.

Railway injects `PORT`; do not set it manually there.

## Deploy

After authenticating the Railway CLI and linking a new Noesis project:

```sh
railway up
```

If Postgres caching is desired, provision Railway Postgres, connect its `DATABASE_URL` to the Noesis service, and apply the existing schema once:

```sh
railway run pnpm --filter @workspace/db run push
```

Schema creation is intentionally not part of application startup or deployment.

After a successful deployment, generate a public domain under the Noesis service's **Settings → Networking → Public Networking → Generate Domain** if Railway has not already provided one.

## Safety defaults

- Maximum decoded image size: 12 MB, enforced client- and server-side.
- Analysis starts: 6 per IP per hour.
- Concurrent analyses: existing cap of 5 jobs per process.
- Optional access-code attempts: 10 per IP per 15 minutes.
- Production CORS: same-origin unless `NOESIS_ALLOWED_ORIGIN` is explicitly configured.
- Security headers include CSP, clickjacking protection, MIME sniffing protection, referrer policy, and a restrictive permissions policy.

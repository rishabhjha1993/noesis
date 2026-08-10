# Noesis

Noesis helps people understand complex visuals. Upload an image and follow a spatially grounded walkthrough to see what you would have missed.

This repository is a standalone pnpm workspace. The production service is one Node process: Express serves the API under `/api`, the built React application, and SPA route fallbacks.

## Requirements

- Node.js 22 or 24
- pnpm
- `OPENAI_API_KEY` for real analysis
- Optional Postgres `DATABASE_URL` for the persistent analysis cache

## Local production run

```sh
pnpm install --frozen-lockfile
pnpm run build
PORT=3000 pnpm run start
```

Open <http://localhost:3000>. The start script loads a gitignored root `.env.local` when present; deployed environments use ordinary `process.env` variables.

Without `DATABASE_URL`, Noesis remains functional but logs that persistent caching is disabled. In-memory job tracking, the five-job concurrency cap, and same-image single-flight protection remain active.

## Commands

```sh
pnpm run typecheck
pnpm run test:noesis-metrics
pnpm run build
pnpm run start
```

Evaluation systems and saved reports remain under `evals/`. They are not invoked by the production service.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for Railway deployment and environment setup.

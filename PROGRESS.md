# Noesis Progress

## Current Branch

`product/noesis-vnext`

## Current Product State

The legacy Noesis experience works as a standalone full-stack Node service. The React upload/result UI, Express API, asynchronous analysis jobs and polling, deterministic evidence computation, OpenAI analysis pipeline, cache support, and evaluation infrastructure are preserved. Platform-independent production serving and minimum public-safety controls have been added locally.

## Live Deployment

- Railway project/service: `Noesis` / `noesis`
- URL: https://noesis-production-b3c2.up.railway.app/
- Last verified: 2026-08-10
- State: successful deployment, one running production instance
- Smoke checks: `/`, `/api/healthz`, SPA fallback, invalid analysis input, missing polling job, frontend assets, and upload UI passed
- Persistent Postgres cache: disabled because `DATABASE_URL` is not configured
- Access gate: implemented but disabled because `NOESIS_ACCESS_CODE` is not configured

## Current Milestone

Establish durable project memory and create a recoverable pre-Discovery V0 checkpoint.

## Completed

- Baseline instrumentation and three-fixture cold baseline.
- Socratic V1 and Socratic Quality V2 evaluation work and artifacts.
- Independent Railway-ready product shell on `product/noesis-vnext`.
- Same-process frontend/API production serving with SPA fallback.
- Upload and rate limits, concurrency preservation, sanitized errors, security headers, restrictive production CORS, and optional access gate.
- Railway deployment and live production verification.

## In Progress

- Checkpoint the currently verified standalone deployment and instrumentation changes. They remain present in the local working tree but are not yet represented by a pushed product commit.
- Discovery V0 has not started.

## Verification

Latest verified on 2026-08-10:

- Typecheck: passed across all workspace projects.
- Tests: 12/12 passed.
- Full build: passed; one existing non-fatal Vite sourcemap warning remains.
- Production: Railway deployment successful; health, root, SPA, API validation, polling validation, assets, and browser rendering passed.
- Paid production smoke call: not run during deployment verification.

## Latest Stable Commit

`31f7165` — pre-product-shell repository base (`Add image asset`). The verified deployment and evaluation changes currently exist on top of this commit in the local working tree and require their own focused checkpoint.

## Important Decisions

- Railway is the current one-service deployment target because the existing asynchronous job registry and concurrency controls are process-resident.
- The app runs without Postgres, with an explicit warning and no persistent cache; setting `DATABASE_URL` restores persistent cache behavior.
- `OPENAI_API_KEY` is configured in Railway and must remain server-only.
- `NOESIS_ACCESS_CODE` is optional. Without it, production remains public but analysis starts are rate-limited.
- Existing prompts, model allocation, reasoning levels, token limits, schemas, and legacy analysis behavior remain unchanged.
- Discovery quality must remain visually triggered and return the user to the uploaded image.

## Known Issues / Risks

- The deployed source snapshot is not yet backed by a corresponding Git commit.
- The current single-instance rate limiter and job registry are in memory; horizontal scaling would require shared durable state.
- Persistent cache is unavailable until a Postgres `DATABASE_URL` is configured.
- The optional access gate is not enabled on the public deployment.

## Next Step

Create and push a focused, verified checkpoint for the existing instrumentation and standalone Railway product-shell changes before implementing Discovery V0.

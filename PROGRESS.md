# Noesis Progress

## Current Branch

`product/noesis-vnext`

## Current Product State

The legacy Noesis experience works as a standalone full-stack Node service. The React upload/result UI, Express API, asynchronous analysis jobs and polling, deterministic evidence computation, OpenAI analysis pipeline, cache support, and evaluation infrastructure are preserved. Platform-independent production serving, minimum public-safety controls, instrumentation, and evaluation infrastructure are checkpointed in Git and deployed.

## Live Deployment

- Railway project/service: `Noesis` / `noesis`
- URL: https://noesis-production-b3c2.up.railway.app/
- Last verified: 2026-08-10
- State: successful deployment, one running production instance
- Source baseline checkpoint: `c716df0`
- Smoke checks: `/`, `/api/healthz`, SPA fallback, invalid analysis input, missing polling job, frontend assets, and upload UI passed
- Persistent Postgres cache: disabled because `DATABASE_URL` is not configured
- Access gate: implemented but disabled because `NOESIS_ACCESS_CODE` is not configured

## Current Milestone

The recoverable pre-Discovery-V0 baseline is complete. Discovery Engine V0 is the next engineering milestone and has not started.

## Completed

- Baseline instrumentation and three-fixture cold baseline.
- Socratic V1 and Socratic Quality V2 evaluation work and artifacts.
- Independent Railway-ready product shell on `product/noesis-vnext`.
- Same-process frontend/API production serving with SPA fallback.
- Upload and rate limits, concurrency preservation, sanitized errors, security headers, restrictive production CORS, and optional access gate.
- Railway deployment and live production verification.
- Pre-Discovery-V0 product shell, deployment, instrumentation, and evaluation baseline committed and pushed as `c716df0`.

## In Progress

- No implementation work is currently in progress.
- Discovery Engine V0 has not started.

## Verification

Latest verified on 2026-08-10:

- Typecheck: passed across all workspace projects.
- Tests: 12/12 passed.
- Full build: passed; one existing non-fatal Vite sourcemap warning remains.
- Local production server: `/api/healthz`, root HTML, SPA fallback, invalid analysis input, and missing polling job checks passed.
- Browser: `/` rendered the preserved legacy upload UI; `/discovery-lab` rendered the expected pre-V0 `404 - Not Found` state.
- Evaluation plumbing: the existing three-fixture baseline summary was regenerated successfully without making a paid model call.
- Staged scope, ignored-file, large-file, and secret scans passed before the product checkpoint was committed.
- Production: Railway deployment successful; health, root, SPA, API validation, polling validation, assets, and browser rendering passed.
- Paid production smoke call: not run during deployment verification.

## Latest Stable Commit

`c716df0` — Verified pre-Discovery-V0 product shell, standalone deployment, instrumentation, and evaluation baseline.

## Important Decisions

- Railway is the current one-service deployment target because the existing asynchronous job registry and concurrency controls are process-resident.
- The app runs without Postgres, with an explicit warning and no persistent cache; setting `DATABASE_URL` restores persistent cache behavior.
- `OPENAI_API_KEY` is configured in Railway and must remain server-only.
- `NOESIS_ACCESS_CODE` is optional. Without it, production remains public but analysis starts are rate-limited.
- Existing prompts, model allocation, reasoning levels, token limits, schemas, and legacy analysis behavior remain unchanged.
- Discovery quality must remain visually triggered and return the user to the uploaded image.

## Known Issues / Risks

- The current single-instance rate limiter and job registry are in memory; horizontal scaling would require shared durable state.
- Persistent cache is unavailable until a Postgres `DATABASE_URL` is configured.
- The optional access gate is not enabled on the public deployment.
- `/discovery-lab` intentionally remains unimplemented and returns the pre-V0 not-found state.
- No paid model call was made during this checkpoint verification; the existing recorded cold baseline remains the latest paid evaluation evidence.

## Next Step

Begin Discovery Engine V0 using its separately specified contracts, schemas, visual-trigger and research-gate structures, strict validation, and focused unit tests while preserving the legacy `/` experience.

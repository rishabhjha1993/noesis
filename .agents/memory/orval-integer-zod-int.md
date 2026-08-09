---
name: Orval codegen — avoid OpenAPI `integer` type
description: Declaring `type: integer` in lib/api-spec/openapi.yaml makes Orval emit `zod.int()`, which fails typecheck on this repo's Zod v3; use `type: number` instead.
---

In this workspace, `pnpm --filter @workspace/api-spec run codegen` (Orval) generates Zod schemas into `lib/api-zod/src/generated/api.ts` using the Zod v3 API. An OpenAPI schema property declared as `type: integer` is emitted as `zod.int()`, which does not exist on Zod v3 — the chained `typecheck:libs` step fails with `TS2339: Property 'int' does not exist`.

**Why:** Orval succeeded; only the downstream typecheck blew up, so the failure looked like a codegen bug. Cost one full codegen iteration.

**How to apply:** In `lib/api-spec/openapi.yaml`, declare whole-number fields as `type: number` (optionally with `minimum`) instead of `type: integer`. If a future upgrade moves the repo to Zod v4 (`zod/v4` imports in generated code), this constraint may lift — check the generated imports before reintroducing `integer`.

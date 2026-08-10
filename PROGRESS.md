# Noesis Progress

## Current Branch

`product/noesis-vnext`

## Current Product State

The legacy Noesis experience works as a standalone full-stack Node service. The React upload/result UI, Express API, asynchronous analysis jobs and polling, deterministic evidence computation, OpenAI analysis pipeline, cache support, and evaluation infrastructure are preserved. Platform-independent production serving, minimum public-safety controls, instrumentation, and evaluation infrastructure are checkpointed in Git and deployed. Discovery Engine V1 exists as the parallel, experimental branch path at `/discovery-lab`; it is committed, pushed, and qualitatively evaluated on Noordoostpolder, Minard, Pantheon, and Chuquicamata, but has not been deployed. The lab can copy a complete safe eval JSON projection of a completed run, shows safe stage-aware failure diagnostics, and permits an explicit choice between baseline V1 and the isolated batched-research Cost Experiment A. Batched validation now reports safe per-candidate reasons while preserving candidate-local citation ownership.

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

Cost Experiment A is implemented and technically verified as the isolated `discovery-engine-v1-batched-research` variant. Current `discovery-engine-v1` remains the default and fixed non-inferiority baseline. Chuquicamata showed promising batch economics, but its first batched quality result was invalidated by a source-validation contract mismatch that is now fixed. The next milestone is to rerun only the batched variant on the exact same Chuquicamata image and compare it with the retained baseline result.

## Completed

- Baseline instrumentation and three-fixture cold baseline.
- Socratic V1 and Socratic Quality V2 evaluation work and artifacts.
- Independent Railway-ready product shell on `product/noesis-vnext`.
- Same-process frontend/API production serving with SPA fallback.
- Upload and rate limits, concurrency preservation, sanitized errors, security headers, restrictive production CORS, and optional access gate.
- Railway deployment and live production verification.
- Pre-Discovery-V0 product shell, deployment, instrumentation, and evaluation baseline committed and pushed as `c716df0`.
- Discovery Engine V0 committed and pushed as `4f15645`.
- Parallel `/api/discovery` job path and direct-only `/discovery-lab` evaluation UI.
- Strict Stage 1, research-gate, research-result, Stage 3, region-reference, candidate-reference, and source-provenance validation.
- Focused Discovery V0 fixtures and mocked model-call tests requiring no paid API calls.
- Full eval JSON copy support for completed `/discovery-lab` runs, committed and pushed as `995e1cd`; no Discovery intelligence behavior changed.
- Initial qualitative V0 evaluation across a geological map, Noordoostpolder satellite imagery, and a Pantheon section.
- Discovery Engine V1 verified identity context committed and pushed as `afbfe2b`.
- Stage 1 optional visually grounded identity hypotheses and per-candidate identity-context-needed flags.
- At most one conditional Terra identity-verification operation inside Stage 2, with verified context reused only for mapped, already-approved visual questions.
- Strict verified/unverified/conflicted identity handling, source validation, anti-similarity safeguards, V1 instrumentation, safe eval artifacts, and `discovery-engine-v1` cache identity.
- Safe failed-run diagnostics and partial known-cost visibility committed and pushed as `482793c`; failed jobs now retain the failed stage/category, candidate and question ids when available, elapsed runtime, last completed stage, completed research-call metrics, attempted-call count, and all usage/cost already returned before failure.
- Structured server logs now serialize a safe error detail instead of `{}`, while the failed polling response and secondary `/discovery-lab` eval panel receive only the sanitized diagnostic projection.
- Real-world Discovery V1 baseline runs completed for Noordoostpolder, Minard, and Pantheon, establishing same-input quality and economic comparison targets for cost experiments.
- The standing cost-quality engineering principle was added to `AGENTS.md` and pushed as `740a7e6`.
- Cost Experiment A committed and pushed as `50b813b`: all research-gated candidate questions are sent in one compact Terra call after the unchanged optional identity-verification call, with strict per-candidate result and source validation.
- Baseline V1 remains the default path and retains its independent `discovery-engine-v1` cache identity; the experiment uses `discovery-engine-v1-batched-research` and can be selected explicitly in `/discovery-lab`.
- Batched research inspection, source-to-candidate mappings, identity-context mappings, API-call counts, answered/insufficient counts, stage and total cost, cost per successful analysis, cost per final discovery, and scoped failure diagnostics are available in the safe evaluation result.
- Chuquicamata A/B economics: baseline V1 used three candidate-research calls, cost about $0.150 for candidate research and $0.334 total, and took about 167 seconds; the batched variant used one candidate-research call, cost about $0.083 for candidate research and $0.277 total, and took about 131 seconds.
- The first Chuquicamata batched quality result was not judgeable because all four returned candidate ids were downgraded to `insufficient` by validation.
- Batched citation validation was fixed and pushed as `86bf1ca`. The old validator flattened citation annotations into a global raw-URL map, discarded citation spans, and required exact URL-string equality that the generation schema did not guarantee. The fix maps citations to the candidate JSON object containing their annotation span, compares only safe canonical equivalents, and preserves strict per-candidate source ownership.
- Safe batched validation issues now record candidate id, question id, category, and a fixed non-sensitive message in eval/debug output. No raw response, reasoning, prompt, stack, or secret is exposed.

## In Progress

- No implementation work is currently in progress.
- A same-image Chuquicamata batched-only rerun is pending. The existing baseline V1 result must be reused rather than rerun.

## Verification

Latest verified on 2026-08-11:

- Typecheck: passed across all workspace projects.
- Tests: 12/12 passed.
- Full build: passed; one existing non-fatal Vite sourcemap warning remains.
- Local production server: `/api/healthz`, root HTML, SPA fallback, invalid analysis input, and missing polling job checks passed.
- Browser: `/` rendered the preserved legacy upload UI; `/discovery-lab` rendered the expected pre-V0 `404 - Not Found` state.
- Evaluation plumbing: the existing three-fixture baseline summary was regenerated successfully without making a paid model call.
- Staged scope, ignored-file, large-file, and secret scans passed before the product checkpoint was committed.
- Production: Railway deployment successful; health, root, SPA, API validation, polling validation, assets, and browser rendering passed.
- Paid production smoke call: not run during deployment verification.
- Discovery V0 typecheck: passed across all workspace projects.
- Discovery V0 tests: 26/26 total repository tests passed, including 14 focused V0 contract, gate, source, route, and cache tests.
- Discovery V0 full build: passed for the API server, Noesis frontend, and mockup sandbox; the existing non-fatal Vite sourcemap warning remains.
- Discovery V0 local runtime: `/`, `/discovery-lab`, built assets, image selection, invalid Discovery requests, missing Discovery jobs, and legacy invalid-request behavior passed; browser console was clean.
- Discovery V0 paid model call: not run. Model-backed intelligence quality and real web-search output remain intentionally unevaluated until the qualitative eval.
- Eval JSON copy support: typecheck passed across all workspace projects; 29/29 repository tests passed; full build passed with the existing non-fatal Vite sourcemap warning.
- Eval JSON local runtime: a mocked fixture completed in `/discovery-lab`, the copy control reached `Copied` only after successful `JSON.parse`, the safe projection excluded reasoning-token counts and internal-only fields, and `/` still rendered the legacy upload UI without browser warnings or errors. No paid model call was made.
- Geological map V0 eval: the intended visible-trigger → question → research → discovery loop worked and produced at least two useful image-dependent discoveries; weaker filler suggested a future ranking question, but no ranking change is authorized yet.
- Noordoostpolder V0 eval: Stage 1 grounded six strong research candidates in visible engineered boundaries, parcel geometries, striped tracts, settlement structure, an isolated circle, and a bright rectilinear complex. All six Terra calls returned `insufficient`; the unresolved circular feature showed that strong visual questions can lack enough verified geographic identity. The run took about 141 seconds, cost about $0.277, used about 72k Stage 2 tokens, and produced no researched final discovery.
- Pantheon V0 eval: the first job failed transiently without a diagnosable sanitized cause; the retry succeeded. Stage 1 and the coffer-geometry discovery were strong, but research identity failures included an unsupported Church of the Holy Sepulchre match and an unrelated drawing sharing `COVPE/LONGITVDINALE` typography being treated as evidence about the uploaded figure. The successful run took about 183 seconds, cost about $0.392, and used about 108k Stage 2 tokens.
- Discovery V1 typecheck: passed across all workspace projects.
- Discovery V1 tests: 47/47 total repository tests passed, including mocked no-identity, verify-once, verified reuse, unverified/conflicted safety, exact-question restriction, source validation, typography-only rejection, downstream hypothesis withholding, eval export, legacy route, and V1 cache-isolation coverage.
- Discovery V1 full build: passed for the API server, Noesis frontend, and mockup sandbox; the existing non-fatal Vite sourcemap warning remains.
- Discovery V1 local runtime: a no-cost mocked verified-identity result completed in `/discovery-lab`; V1 identity status/reuse instrumentation rendered, `Copy full eval JSON` reached `Copied` after its `JSON.parse` guard, and `/` rendered the unchanged legacy upload UI with no browser warnings or errors.
- Discovery V1 paid model call: not run. Real identity accuracy, research answer rate, quality, latency, and cost remain intentionally unevaluated until the controlled rerun.
- Discovery failure diagnostics typecheck: passed across all workspace projects.
- Discovery failure diagnostics tests: 60/60 total repository tests passed, including 13 focused mocked checks for Stage 1, identity verification, candidate-2 research, returned partial usage, Stage 3, schema validation, source validation, timeout, safe logging, failed job status, secret/reasoning-token exclusion, and unchanged successful V1 behavior.
- Discovery failure diagnostics full build: passed for the API server, Noesis frontend, and mockup sandbox; the existing non-fatal Vite sourcemap warning remains.
- Discovery failure diagnostics local runtime: the rebuilt `/discovery-lab` upload state and legacy `/` rendered with no browser console errors. Forced failures and a successful run were exercised with local mocks; no paid model call was made.
- Safety/diff review: no production prompt, model, reasoning level, token limit, research gate, ranking, cache, or Discovery intelligence field changed. Browser diagnostics exclude raw provider errors, stacks, prompts, image data, API keys, and reasoning-token breakdowns.
- Noordoostpolder V1 baseline: approximately $0.428 total, 218 seconds, and $0.278 Stage 2 cost; five research candidates, four answered. Critical retained discoveries are the reclaimed former lakebed, IJsseloog containment depot, Urk former-island settlement, and Emmeloord deliberate radial planning.
- Minard V1 baseline: approximately $0.317 total, 160 seconds, and $0.178 Stage 2 cost; all five research questions answered. Critical retained discoveries are troop-count route width, advance/retreat color logic, the geographically anchored retreat temperature graph, and detached-corps branches. Minard carries memorization risk and is a secondary benchmark only.
- Pantheon V1 baseline: approximately $0.352 total, 164 seconds, and $0.194 Stage 2 cost; all three research questions answered. Critical retained discoveries are the equal diameter/height sphere geometry and shrinking-coffer geometric/structural design.
- Pantheon source-entailment issue: a modern paper using or reproducing a historic-looking drawing does not establish that the underlying drawing itself is a modern visualization. This known quality issue is recorded for evaluation and is not to be fixed inside Cost Experiment A.
- Cost Experiment A typecheck: passed across all workspace projects.
- Cost Experiment A tests: 78/78 total repository tests passed, including 18 focused batched-research checks for one-call gating, exact candidate/question mapping, separate verify-once identity handling, verified-context scoping, missing/invalid sibling isolation, strict source ownership and URL validation, Stage 3 contract equivalence, cache isolation, failure diagnostics, safe eval JSON, and legacy-route preservation.
- Cost Experiment A full build: passed for the API server, Noesis frontend, and mockup sandbox; the existing non-fatal Vite tooltip sourcemap warning remains.
- Cost Experiment A local runtime: `/discovery-lab` defaulted to baseline V1, switched explicitly to the batched variant, and legacy `/` rendered unchanged with no browser warnings or errors. No image was submitted and no paid model call was made.
- Cost Experiment A safety/diff review: no baseline Stage 1, candidate-research, or Stage 3 prompt; model; reasoning level; research gate; ranking; or legacy route was changed. The staged diff contained no secret-pattern matches.
- Batched validation fix typecheck: passed across all workspace projects.
- Batched validation fix tests: 85/85 total repository tests passed, including 25 focused batched cases covering all-valid, mixed valid/invalid, all-insufficient, malformed and uncited sources, provider tracking normalization, unknown/mismatched/duplicate ids, missing candidates, candidate-local citation spans, safe eval diagnostics, baseline behavior, cache identity, failure diagnostics, and legacy routing.
- Batched validation fix full build: passed for the API server, Noesis frontend, and mockup sandbox; the existing non-fatal Vite tooltip sourcemap warning remains.
- Batched validation fix safety review: strict URL, cited-evidence, referential-integrity, sibling-isolation, source-ownership, and safe-output checks remain. No paid model call was made.

## Latest Stable Commit

`86bf1ca` — strict candidate-scoped batched citation validation fix.

## Important Decisions

- Railway is the current one-service deployment target because the existing asynchronous job registry and concurrency controls are process-resident.
- The app runs without Postgres, with an explicit warning and no persistent cache; setting `DATABASE_URL` restores persistent cache behavior.
- `OPENAI_API_KEY` is configured in Railway and must remain server-only.
- `NOESIS_ACCESS_CODE` is optional. Without it, production remains public but analysis starts are rate-limited.
- Legacy prompts, model allocation, reasoning levels, token limits, schemas, and analysis behavior remain unchanged. V1 changes only the parallel Discovery prompts/contracts needed for verified identity context.
- Discovery quality must remain visually triggered and return the user to the uploaded image.
- Discovery retains exactly three conceptual stages: Sol vision grounding/question formation, selectively gated Terra web research, and text-only Sol discovery synthesis. Identity verification is a conditional substep inside Stage 2, not a fourth stage or agent.
- All three Discovery stages use medium reasoning. Stage 2 receives only Stage 1-approved text questions and never receives the image.
- Discovery V1 uses the independent `discovery-engine-v1` in-memory cache identity and cannot collide with V0 or legacy analysis cache entries.
- `/discovery-lab` remains outside normal public navigation and does not replace `/`.
- The copied eval JSON reuses the validated Discovery run structure, adds job/cache identity, and omits reasoning-token counts and internal-only fields.
- The first evidence-backed V1 hypothesis is narrow: Stage 1 already notices valuable image-specific questions, while Stage 2 often lacks verified entity, location, or object identity needed to research those questions safely and efficiently.
- Identity resolution remains a conditional substep inside Stage 2 and may only support questions already triggered by visible evidence.
- V1 runs identity verification only when a gated candidate explicitly needs it and Stage 1 supplied a grounded relevant hypothesis. Verified context is reused only for mapped questions; unverified/conflicted hypotheses are withheld from candidate research and Stage 3.
- Shared typography and generic similarity are explicitly insufficient verification bases; verified identity requires validated sources and at least one stronger exact-match basis.
- Failed Discovery jobs expose only a sanitized diagnostic projection to the browser. Raw provider error details and server-only stacks remain in redacted structured logs; prompts, request bodies, secrets, images, and reasoning-token breakdowns are not returned.
- Failure observability is measurement-only: V1 prompts, models, reasoning levels, research gate, ranking, cache identity/behavior, and successful result contracts remain unchanged.
- Current `discovery-engine-v1` quality is the fixed non-inferiority baseline for cost experiments; economic improvements do not pass if visual grounding, usefulness, unsupported-claim rate, research usefulness, source integrity, or existing evaluation dimensions regress.
- Cost Experiment A is opt-in and isolated by API variant, UI selector, engine version, and cache identity. It preserves the existing Stage 1, conditional identity verification, Stage 3 synthesis, model allocation, and medium reasoning levels.
- Batched Stage 2 sends only compact deterministic context for candidates that already passed the existing research gate. Missing or invalid individual results degrade only that candidate to `insufficient`; unknown ids, mismatched question ids, duplicate results, or malformed envelopes fail with scoped diagnostics.
- Batch source validation uses the Responses API citation annotations, including their output-text spans, rather than treating all citations as a global pool. A source can validate only the candidate object containing that citation; known provider `utm_source=chatgpt.com` decoration is normalized without accepting unrelated URLs.

## Known Issues / Risks

- The current single-instance rate limiter and job registry are in memory; horizontal scaling would require shared durable state.
- Persistent cache is unavailable until a Postgres `DATABASE_URL` is configured.
- The optional access gate is not enabled on the public deployment.
- The Railway deployment still runs the pre-V0 source checkpoint, so its `/discovery-lab` route remains unavailable until an explicit V0 deployment.
- No paid model call was made during this checkpoint verification; the existing recorded cold baseline remains the latest paid evaluation evidence.
- Discovery V0 cache and jobs are process-local; cached metrics describe the original cold run, while the polling response separately reports cache hit or miss.
- V0 Stage 3 currently receives an explicit empty deterministic-calculations list. Reusing legacy calculations would require an additional legacy evidence-extraction call, which would violate V0's three-stage constraint.
- Discovery cost instrumentation uses the existing token-pricing convention and does not add separately metered web-search tool fees, if applicable.
- Failed Discovery diagnostics remain process-local with the existing in-memory job TTL; they are not a durable run-history store.
- Shared typography, motifs, generic structures, or partial visual similarity can produce false exact-object matches; the Pantheon run demonstrates that this is a research-integrity risk rather than only a ranking problem.
- V1 identity verification is limited to one operation and one verified hypothesis per run; multiple genuinely distinct identities in one image remain outside this first implementation.
- The three current real-world V1 samples are useful but limited; Minard is memorization-prone, and broader quality judgment remains human-led.
- Pantheon demonstrated a source-entailment risk: reproduction or use by a modern source does not prove provenance of the underlying visual.
- Chuquicamata established promising cost/latency evidence for batching, but the first batched run cannot be used for quality comparison because the validation mismatch rejected every candidate. Quality remains pending the single batched-only rerun.

## Next Step

Rerun only `discovery-engine-v1-batched-research` on the exact same Chuquicamata image, then compare it with the already-recorded baseline `discovery-engine-v1` result. Do not rerun the baseline and do not optimize further before reviewing the batched result.

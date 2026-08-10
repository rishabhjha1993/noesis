# Noesis evaluation harness

The harness runs the unchanged two-pass production pipeline over local fixtures. It never copies source images into results.

```sh
OPENAI_API_KEY=... pnpm eval:noesis
OPENAI_API_KEY=... pnpm eval:noesis:socratic
OPENAI_API_KEY=... pnpm eval:noesis:socratic-quality-v2
OPENAI_API_KEY=... pnpm eval:noesis -- --manifest evals/benchmark.json --ids us-energy-sankey-2023 --mode cold
OPENAI_API_KEY=... DATABASE_URL=... pnpm eval:noesis -- --mode cached
pnpm eval:noesis:summarize -- evals/results/<run-id>/run-summary.json evals/scores/<run-id>.json
```

Cold is the default and calls the pipeline directly, bypassing the application cache. Cached mode exercises the normal persistent cache and requires `DATABASE_URL`. Each run writes `run-summary.json` and one full JSON artifact per benchmark under `evals/results/<timestamp>/`; developer artifacts include VisualEvidence and ComputedEvidence when a model run occurs.

Socratic mode is eval-only: Terra Low evidence mining, unchanged deterministic computation, three concurrent Luna Medium analysts, and a text-only Terra Medium synthesizer. It never touches the production job, cache, API, or UI paths.

Socratic Quality V2 is also eval-only: the unchanged production Sol Low evidence call, unchanged deterministic computation, concurrent Luna Medium questioner + Terra Medium explanation/context + Luna Medium critic, and an image-aware Sol High strict-structured synthesizer. The quality-first Socratic packet retains all evidence and computations except coordinates; the final Sol receives the complete originals and maps Stage 1 coordinates deterministically.

Pricing lives only in `artifacts/api-server/src/lib/modelPricing.ts`. It contains the supplied official August 2026 rates for GPT-5.6 Sol, Terra, and Luna. Unknown models produce a null estimate with a reason and never fail analysis.

Add benchmark images locally, then register them in `benchmark.json`; do not commit third-party images without appropriate rights.

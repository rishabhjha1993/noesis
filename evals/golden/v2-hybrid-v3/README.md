# Noesis V2 Hybrid v3 Golden Baseline

This directory preserves the human-accepted launch intelligence baseline for Noesis V2 Hybrid v3.

## Baseline identity

- Git tag: `noesis-v2-hybrid-v3-launch-baseline`
- Intelligence commit: `bfc83f96ec124bb759f7a11f4f1543f659322ace`
- Engine: `discovery-engine-v2-hybrid`
- Cache revision: `v2-hybrid-v3`
- Golden discovery ID: `74f39a17-7f9b-4cc9-8482-857f7418566c`
- Test case: Noordoostpolder
- Timestamp: `2026-08-15T12:39:10.546Z`

## Frozen launch architecture

```text
original image
  → GPT-5.6 Sol medium: SEE + QUESTION + unverified visual identity hypotheses
  → GPT-5.6 Luna medium + first-party OpenAI web_search: one bounded candidate-local research operation per gated candidate, maximum concurrency 3
  → GPT-5.6 Sol medium + original high-detail image: DISCOVER → RETURN TO IMAGE
  → deterministic validation
```

V2 makes no standalone identity-verification call and never calls DeepSeek. Relevant Stage-1 identity hypotheses are candidate-local unverified search leads only. Luna may establish identity only through applicable candidate-local research with validated citations. Unsupported hypotheses may not become facts. Safe candidate-local failures become `INSUFFICIENT` while siblings continue. Candidate-local source ownership and deterministic final validation remain the trust boundaries.

## Golden run outcome

| Measure                      |     Result |
| ---------------------------- | ---------: |
| Stage-1 candidates           |          5 |
| Candidate research API calls |          5 |
| Answered candidates          |          4 |
| Insufficient candidates      |          1 |
| Candidate-local failures     |          1 |
| Web-search calls             |          8 |
| Final discoveries            |          3 |
| Total latency                |  86,181 ms |
| Research wall-clock latency  |  20,912 ms |
| Maximum research concurrency |          3 |
| Model-token cost             | $0.1645254 |
| Tool cost                    |      $0.08 |
| Total known cost             | $0.2445254 |

Stage details:

- Stage 1: Sol medium; 4,201 total tokens; 43,579 ms; `$0.085655`.
- Stage 2: Luna medium; 89,652 total tokens, including 18,600 cached-input tokens; 8 searches; 48,859 ms aggregate call latency; 20,912 ms wall-clock latency; `$0.0174104` model-token cost; `$0.08` search-tool cost; `$0.0974104` known subtotal.
- Stage 3: Sol medium; 5,822 total tokens; 21,684 ms; `$0.06146`; 3 discoveries.

Candidate `cand_02` returned a malformed response and degraded safely to `INSUFFICIENT` without aborting its siblings.

Accepted discovery titles:

1. `A polder drawn at landscape scale`
2. `Two opposing water histories meet`
3. `The offshore ring is a sediment repository`

Human review determined that this run clears the current Noesis launch-quality bar. It is the qualitative reference for future architecture regressions.

## How to use this baseline

This is a reference baseline, not a requirement that future model output reproduce identical prose.

Future systems should be compared on:

1. accuracy;
2. visual dependence;
3. surprise;
4. explanatory depth;
5. specificity;
6. consequential understanding;
7. reinterpretation of the original visual;
8. research/source integrity;
9. latency;
10. cost.

The golden artifact protects product quality, not wording. Do not snapshot stochastic prose, require exact discovery text, or introduce paid evaluations into CI. Existing deterministic tests and frozen fingerprints remain the automated regression protection.

## Exact exported eval JSON

The exact exported eval JSON was not available locally when this baseline was recorded. It was not reconstructed or regenerated. When the verbatim export becomes available, preserve it without normalization at:

`evals/golden/v2-hybrid-v3/noordoostpolder-74f39a17.json`

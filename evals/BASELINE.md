# Current baseline status

The first three-fixture cold baseline completed successfully on 2026-08-09. Results are stored locally under `evals/results/2026-08-09T19-28-05-474Z/` (gitignored): average model cost was $0.32348, median total latency was 144,864 ms, Pass 2 represented 55.97% of model cost and 57.96% of model-call latency, and all three analyses succeeded.

## Observability now available

- Chat Completions currently exposes `prompt_tokens`, `completion_tokens`, and `total_tokens`; nested details may expose `cached_tokens` and `reasoning_tokens`. Raw usage is retained alongside normalized fields.
- Pass 1/Pass 2 call and parse times, deterministic compute time, cache lookup/write time, counts, payload byte sizes, image dimensions, final region count, failures, and short image hashes are recorded.
- Model pricing contains the supplied official August 2026 rates for GPT-5.6 Sol, Terra, and Luna; unknown models remain null rather than guessed.
- A cache hit cannot reproduce VisualEvidence, ComputedEvidence, or model usage because the existing cache stores only public NoesisAnalysis. This is an intentional, documented baseline observability gap and cache behavior was not changed.

## Next optimization hypotheses (not implemented)

| Rank | Hypothesis | Latency impact | Cost impact | Quality risk |
|---:|---|---|---|---|
| 1 | Reduce Pass 2 reasoning effort after measuring its share | High | High | High |
| 2 | Use a smaller/faster Pass 1 model | Medium–high | Medium–high | Medium–high (evidence recall) |
| 3 | Reduce serialized evidence sent to Pass 2 | Medium | Medium | Medium |
| 4 | Reduce image detail selectively by visual type | Medium | Medium | High (small text/spatial grounding) |
| 5 | Parallelize or consolidate pipeline work | High | Variable | High (architecture/quality behavior) |

Rankings are hypotheses only. They must be revisited after cold-run measurements and human rubric scores exist.

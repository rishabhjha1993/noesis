# Socratic Quality V2 report

Run: `2026-08-09T20-33-33-985Z`

This was a single cold eval run over the three existing fixtures. No prompt, model, schema, or pipeline tuning was performed after observing the results. “Cold” means the application cache was bypassed; the API still reported provider-side cached prompt tokens for two Sol evidence calls.

## A. Files added / modified

Added for V2:

- `evals/qualityEvidence.ts`
- `evals/socraticQualityPipeline.ts`
- `evals/tests/socraticQuality.test.ts`
- `evals/SOCRATIC-QUALITY-V2-REPORT.md`
- `evals/scores/2026-08-09T20-33-33-985Z.json` (gitignored human-review worksheet)
- `evals/results/2026-08-09T20-33-33-985Z/` (gitignored raw results)

Modified for V2:

- `evals/run.ts`
- `evals/summarize.ts`
- `evals/README.md`
- `package.json` (eval script only)

## B. Production baseline unchanged

Yes. V2 introduced no changes under `artifacts/`, and it does not use the production job, cache, API, or UI paths. It duplicates the current production Sol evidence call in eval code so it can execute exactly that call without invoking production Pass 2. An automated test verifies that the V2 Pass 1 prompt is exactly equal to the current production prompt.

The current production allocation remains Sol Low evidence → unchanged deterministic computation → Sol High final analysis.

## C. V2 exact model allocation

Exactly five calls per fixture:

1. `gpt-5.6-sol`, low reasoning, original image at high detail, production evidence prompt/schema, 8,000 completion-token ceiling.
2. `gpt-5.6-luna`, medium reasoning, text-only Socratic Questioner, strict Structured Outputs, 5,000-token ceiling.
3. `gpt-5.6-terra`, medium reasoning, text-only Explanation/Context Reasoner, strict Structured Outputs, 5,000-token ceiling.
4. `gpt-5.6-luna`, medium reasoning, text-only Intellectual Critic, strict Structured Outputs, 5,000-token ceiling.
5. `gpt-5.6-sol`, high reasoning, original image at high detail plus original evidence, original computations, and all three analyst outputs, strict Structured Outputs, 16,000-token ceiling.

Calls 2–4 execute concurrently with `Promise.allSettled`. The deterministic computation is the existing unchanged `computeEvidence` implementation. Final coordinates come only from Stage 1 candidate regions. The final schema supplies model-declared semantic alternate regions for deterministic duplicate repair; all three outputs selected unique primary regions, so no repair was used.

## D. Verification

- Typecheck: passed across all workspace projects.
- Focused instrumentation/eval tests: 10/10 passed.
- Build: passed for API server, Noesis frontend, and mockup sandbox.
- Existing non-fatal frontend sourcemap warning: `src/components/ui/tooltip.tsx` original location could not be resolved.
- Test/build environment workaround: `pnpm_config_verify_deps_before_run=` plus exact locked macOS native binaries loaded from a temporary external directory. No dependency or lockfile changed.

## E. A/B/C benchmark

### Summary

| Fixture | System | Success | Latency | Cost |
|---|---|---:|---:|---:|
| US energy Sankey | Baseline | yes | 148.534s | $0.424545 |
| US energy Sankey | Socratic V1 | yes | 48.758s | $0.139064 |
| US energy Sankey | Quality V2 | yes | 182.078s | $0.578578 |
| CERN network map | Baseline | yes | 144.864s | $0.385755 |
| CERN network map | Socratic V1 | no | 46.492s | $0.127567 spent |
| CERN network map | Quality V2 | yes | 166.709s | $0.491171 |
| Test mixed visual | Baseline | yes | 65.135s | $0.160130 |
| Test mixed visual | Socratic V1 | yes | 26.516s | $0.060439 |
| Test mixed visual | Quality V2 | yes | 125.437s | $0.226323 |

Aggregate V2: 3/3 success, average cost $0.432024, total measured cost $1.296071, average latency 158.075s, median latency 166.709s. Relative to the saved baseline aggregate, V2 cost was 33.56% higher and median latency was 15.08% higher. These are operational measurements, not quality judgments.

### US energy Sankey

**Baseline Big Takeaway**

> Only 32.1 of 93.6 quads become Energy Services, while 61.5 quads, or 65.7%, are rejected. Major contributions to rejection include 18.9 quads at electricity generation and 21.7 quads in transportation.

Baseline walkthrough insights (`why_it_matters`):

- Primary energy sources — Petroleum at 35.4 quads narrowly exceeds natural gas at 33.4 by 2 quads, and each is more than four times coal or nuclear.
- Electricity conversion and loss — Generation rejects 18.9 of its 32 input quads; that loss is about 3.8 times the 4.96 quads of electricity delivered to Residential, the largest individual sector delivery.
- Transportation input concentration — Petroleum supplies 24.8 of Transportation's 28 quads, roughly 89%, while electricity contributes only 0.02 quad.
- Sector output contrasts — Transportation sends 21.7 quads to rejection versus 5.87 to services, whereas Industrial is nearly even at 13.3 rejected and 13.1 delivered as services.
- Final energy outcomes — Rejected Energy totals 61.5 quads, 29.4 more than Energy Services at 32.1 quads and about 1.9 times as large.

**Socratic V1 Big Takeaway**

> This estimated 2023 accounting traces 93.6 Quads from primary sources through conversion and end-use sectors to two final categories: 61.5 Quads labeled Rejected Energy and 32.1 Quads labeled Energy Services. Natural gas and petroleum together supply about 74% of the stated total, while the diagram’s outcome split is its strongest system-level message; “Rejected Energy” should be read as the chart’s accounting category, not automatically as environmental harm or physical waste.

V1 walkthrough insights (`why_it_matters`):

- Establish the scope and reading direction — This prevents mixing the 93.6-Quad national estimate with a single sector, source, or individual flow.
- Identify the dominant listed sources — Because these two sources make up roughly three quarters of the stated total, shifts in either would have an outsized effect on the displayed national energy balance.
- Distinguish electricity conversion from direct fuel use — The conversion hub links multiple upstream sources to several downstream sectors, so it is essential for understanding cross-sector energy pathways without assuming unlisted flows or double counting imports.
- Compare end-use sectors using numeric labels — Industry and transportation are the largest displayed end-use sectors, making their pathways central to interpreting the composition of the energy system.
- Read the final accounting split carefully — The final split accounts for the stated total and shows that the category labeled Rejected Energy is numerically much larger than the category labeled Energy Services; interpretation beyond those labels requires the source methodology.

**Quality V2 Big Takeaway**

> According to this accounting framework, the system is shaped by both source concentration and conversion pathways: petroleum and natural gas dominate inputs, electricity generation routes more energy to rejection than delivery, and petroleum-heavy transportation has the largest sectoral rejected-energy flow. Together, these pathways leave 61.5 of 93.6 quads—about 65.7%—as rejected energy and 32.1 quads as energy services.

V2 walkthrough insights (`why_it_matters`):

- Two sources dominate the upstream system — The national flow is therefore shaped disproportionately by two sources rather than being evenly distributed across the nine source categories.
- Several sources reach users only through electricity — For nuclear, hydro, and wind, the central electricity pathway mediates both access to end-use sectors and exposure to generation-stage rejection.
- Electricity conversion is a major rejection point — The final rejected-energy total cannot be attributed only to end-use devices and processes; a major share arises upstream during electricity conversion.
- Transportation largely bypasses the electricity pathway — Transportation's scale and concentrated input mix make its energy outcome depend far more on the petroleum branch than on the electricity-generation mix shown above it.
- Sector outcomes are not uniformly efficient — Transportation contributes the largest downstream rejected-energy stream even though its total consumption is only slightly greater than Industry's.
- Most accounted energy ends in the rejected category — The diagram's central system-level result is not simply how much energy is consumed, but that nearly twice as much is assigned to rejected energy as to useful services.

### CERN network map

**Baseline Big Takeaway**

> The main chain scales sharply from BOOSTER (157 m) to PS (628 m), SPS (7 km), and LHC (27 km), while the PS and SPS also divert beams into multiple experimental branches.

Baseline walkthrough insights (`why_it_matters`):

- Injector chain — These are the compact starting stages: LEIR is labeled 78 m and BOOSTER 157 m, much smaller than the downstream rings.
- PS crossroads — The PS follows the 157 m BOOSTER and distributes beams toward the SPS, East Area, and several specialized branches.
- East Area fan-out — This is a clear example of the complex turning one PS-fed route into several parallel experimental paths.
- SPS distribution ring — The SPS is the intermediate distribution hub between the 628 m PS and the much larger 27 km LHC.
- North Area fan-out — Like the East Area, it converts one supply route into many endpoints, but its beam comes from the SPS rather than the PS.
- LHC ring and experiments — At 27 km, the LHC is nearly four times the SPS's displayed 7 km length and forms the final, largest stage of the main chain.

**Socratic V1**

No final analysis was produced. All five calls completed, then deterministic mapping rejected a duplicated primary Stage 1 region (`r_lhc`).

**Quality V2 Big Takeaway**

> CERN is depicted as a layered, multi-particle network rather than a single collider: particle-specific injectors meet around the PS/BOOSTER core, the SPS redistributes beams toward the LHC and other areas, and specialized branches serve radioactive-ion, antiproton, neutron, and electron facilities. Dates from PS in 1959 to ELENA and LINAC 4 in 2020 show newer additions remaining connected to older infrastructure.

V2 walkthrough insights (`why_it_matters`):

- Particle-specific injector routes — The complex begins with beam preparation tailored to particle type before routes join shared accelerator infrastructure.
- PS and BOOSTER as the shared routing core — Many downstream programs use a common central backbone instead of having wholly separate accelerator chains.
- SPS as an intermediate distribution stage — The SPS is not merely another ring: it links the injector backbone to both the much larger LHC and several side programs.
- Multiple experiment sites around the LHC — A single downstream ring supports several experiment locations rather than terminating at one destination.
- Experimental areas as branching destinations — The map separates machines that circulate beams from areas that distribute extracted beams among multiple endpoints.
- Specialization in the ISOLDE branch — The shared accelerator network ultimately branches into particle-specific destinations rather than serving only the LHC.

### Test mixed visual

**Baseline Big Takeaway**

> The upper structure is one continuous three-block chain, while the lower purple block is the sole isolated component. With no labels or arrows, the visual establishes connectivity but not named roles or flow direction.

Baseline walkthrough insights (`why_it_matters`):

- Left endpoint — This is one of the chain's two vertical endpoint blocks.
- Rising left connector — It establishes that the left endpoint belongs to the main three-block chain.
- Central linking block — Its two-sided connectivity makes it the bridge between the chain's endpoints.
- Descending right connector — This second link completes the continuous path across all three upper blocks.
- Right endpoint — Together with the left block, it frames the wide central block between two tall endpoints.
- Isolated lower block — It is the diagram's only visibly disconnected component, creating the main structural contrast with the three-block chain.

**Socratic V1 Big Takeaway**

> This is an unlabeled geometric layout: two tapered shapes visibly link three upper/side blocks, while the lower purple block is spatially separate. The image establishes adjacency and separation, not flow, function, or meaning.

V1 walkthrough insights (`why_it_matters`):

- Left block and apparent visual link — This establishes the first visible geometric association in the upper arrangement without claiming that anything flows between the blocks.
- Central visual junction — The layout has no direct visible tapered link from the left block to the right block; their displayed association is mediated spatially through this central block.
- Left tapered connector shape — It is concrete evidence for the apparent left-to-center linkage rather than evidence for a particular process interpretation.
- Right tapered connector shape — Together with the left tapered shape, it supports describing an undirected-looking visual chain among the left, upper-central, and right blocks.
- Separate lower block — The lower block should be kept distinct from the visibly joined upper arrangement unless external labels or context explain a relationship.

**Quality V2 Big Takeaway**

> The diagram supports one clear system-level conclusion: three nodes form a path through a sole middle bridge, while the lower node is a separate visible singleton. Direction, node identities, relationship meanings, and the reason for the isolation remain unspecified.

V2 walkthrough insights (`why_it_matters`):

- A chain, not a demonstrated flow — The bands establish connectivity, but they do not justify reading the chain as a directional process, sequence, or causal flow.
- The middle node is the sole bridge — This makes the middle node structurally critical within the depicted component, although it does not prove control, causation, or temporal precedence.
- A separate visible component — The strongest contrast is therefore topological: one three-node component versus one singleton, rather than four equally participating nodes.
- Style separates roles, not values — The styling reliably distinguishes links from nodes, but it cannot support quantitative or categorical interpretations of those visual differences.

## F. V2 stage metrics

Token columns are input / cached input / output / reasoning. Output already includes reasoning tokens.

| Fixture | Stage | Latency | Tokens | Cost |
|---|---|---:|---:|---:|
| US energy Sankey | Sol Low evidence | 61.446s | 3,433 / 2,816 / 6,038 / 91 | $0.185633 |
|  | deterministic compute | 4ms | — | — |
|  | Luna Medium questioner | 14.228s | 10,832 / 0 / 2,044 / 395 | $0.023096 |
|  | Terra Medium explanation | 18.015s | 10,833 / 0 / 1,867 / 96 | $0.055088 |
|  | Luna Medium critic | 15.662s | 10,759 / 0 / 1,937 / 708 | $0.022381 |
|  | parallel wall-clock | 18.017s | — | — |
|  | Sol High synthesis | 102.602s | 18,930 / 0 / 6,591 / 5,024 | $0.292380 |
|  | **total** | **182.078s** | 5 calls | **$0.578578** |
| CERN network map | Sol Low evidence | 54.571s | 2,794 / 1,792 / 4,644 / 188 | $0.145226 |
|  | deterministic compute | 1ms | — | — |
|  | Luna Medium questioner | 13.617s | 8,608 / 0 / 2,022 / 387 | $0.020740 |
|  | Terra Medium explanation | 17.102s | 8,609 / 0 / 1,705 / 77 | $0.047098 |
|  | Luna Medium critic | 12.820s | 8,535 / 0 / 1,497 / 54 | $0.017517 |
|  | parallel wall-clock | 17.104s | — | — |
|  | Sol High synthesis | 95.030s | 16,226 / 0 / 5,982 / 4,427 | $0.260590 |
|  | **total** | **166.709s** | 5 calls | **$0.491171** |
| Test mixed visual | Sol Low evidence | 16.786s | 1,831 / 0 / 1,287 / 130 | $0.047765 |
|  | deterministic compute | <1ms | — | — |
|  | Luna Medium questioner | 8.295s | 1,313 / 0 / 1,206 / 90 | $0.008549 |
|  | Terra Medium explanation | 9.905s | 1,314 / 0 / 953 / 0 | $0.017580 |
|  | Luna Medium critic | 8.806s | 1,240 / 0 / 964 / 66 | $0.007024 |
|  | parallel wall-clock | 9.906s | — | — |
|  | Sol High synthesis | 98.743s | 6,065 / 0 / 3,836 / 2,903 | $0.145405 |
|  | **total** | **125.437s** | 5 calls | **$0.226323** |

Payloads entering reasoning/synthesis:

| Fixture | Socratic packet | Original VisualEvidence | ComputedEvidence | Socratic outputs | Final Sol input |
|---|---:|---:|---:|---:|---:|
| US energy Sankey | 38,281 B | 24,156 B | 14,530 B | 22,156 B | 18,930 tokens |
| CERN network map | 28,427 B | 16,602 B | 12,427 B | 21,703 B | 16,226 tokens |
| Test mixed visual | 4,579 B | 4,865 B | 2 B | 15,067 B | 6,065 tokens |

The quality packet retained all Stage 1 facts, contextual text, structural observations, relationships, and computations. It omitted only candidate-region coordinates from the text-only analyst input. Original evidence and coordinates remained available to final Sol.

## G. Raw quality comparison

These are output excerpts without a quality ranking.

### 1. Sankey — dominant sources

- **Baseline:** “Petroleum at 35.4 quads narrowly exceeds natural gas at 33.4 by 2 quads, and each is more than four times coal or nuclear.”
- **V1:** “Because these two sources make up roughly three quarters of the stated total, shifts in either would have an outsized effect on the displayed national energy balance.”
- **V2:** “The national flow is therefore shaped disproportionately by two sources rather than being evenly distributed across the nine source categories.”

### 2. Sankey — electricity conversion

- **Baseline:** “Generation rejects 18.9 of its 32 input quads; that loss is about 3.8 times the 4.96 quads of electricity delivered to Residential, the largest individual sector delivery.”
- **V1:** “The conversion hub links multiple upstream sources to several downstream sectors, so it is essential for understanding cross-sector energy pathways without assuming unlisted flows or double counting imports.”
- **V2:** “The final rejected-energy total cannot be attributed only to end-use devices and processes; a major share arises upstream during electricity conversion.”

### 3. Sankey — final accounting split

- **Baseline:** “Rejected Energy totals 61.5 quads, 29.4 more than Energy Services at 32.1 quads and about 1.9 times as large.”
- **V1:** “The final split accounts for the stated total and shows that the category labeled Rejected Energy is numerically much larger than the category labeled Energy Services; interpretation beyond those labels requires the source methodology.”
- **V2:** “The light-gray total combines rejection at two stages: 18.9 quads from electricity generation plus rejected branches from every end-use sector. Because the chart applies stated accounting and efficiency conventions, this category should not be read as entirely recoverable waste.”

### 4. Mixed visual — central bridge

- **Baseline:** “Its two-sided connectivity makes it the bridge between the chain's endpoints.”
- **V1:** “The layout has no direct visible tapered link from the left block to the right block; their displayed association is mediated spatially through this central block.”
- **V2:** “This makes the middle node structurally critical within the depicted component, although it does not prove control, causation, or temporal precedence.”

### 5. Mixed visual — isolated component

- **Baseline:** “It is the diagram's only visibly disconnected component, creating the main structural contrast with the three-block chain.”
- **V1:** “The lower block should be kept distinct from the visibly joined upper arrangement unless external labels or context explain a relationship.”
- **V2:** “The strongest contrast is therefore topological: one three-node component versus one singleton, rather than four equally participating nodes.”

### 6. Mixed visual — directionality

- **Baseline:** “Read it as a visible connection, not as directional flow, because it has no arrowhead.”
- **V1:** “Arrows are absent, so the arrangement has no image-proven direction or sequence.”
- **V2:** “The bands establish connectivity, but they do not justify reading the chain as a directional process, sequence, or causal flow.”

## H. Context usage

No final V2 insight was marked contextual. The final synthesis classified:

- Sankey: big takeaway derived; 6/6 regions derived.
- CERN: big takeaway derived; 6/6 regions derived.
- Test mixed visual: big takeaway derived; 3 regions derived and 1 visual.

Therefore there are no contextual claims, confidence values, or appropriateness rationales to list. Claims about Sankey methodology/efficiency are tied to visible chart notes; the final model did not classify them as outside context.

## I. Failures / risks

- **Execution:** V2 succeeded on all three fixtures with exactly five calls each and no reported failure stage.
- **Provider prompt caching:** although application cache hits were false, Sol evidence reported 2,816 cached input tokens for Sankey and 1,792 for CERN. Test mixed visual reported zero. The run is cold with respect to Noesis, not necessarily OpenAI prompt caching.
- **Evidence variability:** the unchanged Sol extraction is stochastic. V2 Sankey extracted 59 numeric facts versus 58 in the saved baseline, with 60 computed candidates in both. V2 CERN extracted 25 numeric facts but produced 60 computations versus 2 in the baseline, reflecting different comparison-group assignments and a substantially noisier candidate set despite unchanged deterministic code.
- **Lost numeric evidence:** no obvious Sankey loss is visible in the final V2 output; it retains the major source, generation, transportation, sector-split, and final-total values. Human verification is still required.
- **Unsupported context / hallucinated causality:** no final step was tagged contextual. Derived statements such as CERN's “beam preparation tailored to particle type” and “layered expansion” should still receive human scrutiny; the output caveats what the dates and diagram do not establish.
- **Spatial grounding:** every V2 primary region id was unique, coordinates were copied deterministically from Stage 1, and the duplicate fallback was not activated. Spatial quality still requires visual human review because Stage 1 boxes themselves are model-produced.
- **Duplication:** Sankey uses six related steps around sources, conversion, sectors, and outcomes; CERN uses six around the accelerator network. Human review should decide whether those distinctions add layers or repeat the same system claim.
- **Verbosity:** V2 produced longer takeaways and six steps for both complex fixtures. The quality rubric should determine whether that extra text adds explanatory value or overwhelms the visual.
- **Context not exercised:** the allowed contextual pathway contributed zero final contextual claims, so this run cannot demonstrate whether outside domain context improves the final experience.
- **Simple visual cost:** Test mixed visual required 125.437s and $0.226323 despite containing no numeric facts; this is an operational risk, not a quality score.

## J. Human scoring

No model judged quality. The human worksheet is:

`evals/scores/2026-08-09T20-33-33-985Z.json`

All nine fields for all three fixtures are `null`, pending review. The success criterion—at least +10% overall or +1 average point in Insight Value / So-What / Big Takeaway without factual, numerical, or spatial degradation—must be decided from that human scoring.

## Artifacts

- V2 raw run: `evals/results/2026-08-09T20-33-33-985Z/run-summary.json`
- V2 summary: `evals/results/2026-08-09T20-33-33-985Z/comparison-summary.json`
- Baseline: `evals/results/2026-08-09T19-28-05-474Z/run-summary.json`
- V1: `evals/results/2026-08-09T19-56-38-852Z/run-summary.json`

The experiment's only quality question remains intentionally unanswered until human scores are entered.

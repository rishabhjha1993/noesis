# Socratic Parallel V1 evaluation

Run: `evals/results/2026-08-09T19-56-38-852Z/`<br>
Saved Sol baseline: `evals/results/2026-08-09T19-28-05-474Z/`

## Allocation

Exactly five eval-only calls per fixture: Terra Low evidence miner with the original image at high detail; unchanged deterministic computation; Luna Medium So-What, Why/Context, and Skeptic calls concurrently with text only; Terra Medium synthesis with text only. Production remains Sol Low → deterministic computation → Sol High.

## Outcome

| Benchmark | Baseline | Socratic V1 | Result |
|---|---:|---:|---|
| US energy Sankey | 148.534s / $0.424545 | 48.758s / $0.139064 | Success |
| CERN network map | 144.864s / $0.385755 | 46.492s / $0.127567 spent | Failed: duplicate Stage 1 region `r_lhc` selected by synthesizer |
| Test mixed visual | 65.135s / $0.160130 | 26.516s / $0.060439 | Success |

Successful paired runs averaged $0.099752 versus $0.292338 for their matching baselines (65.88% lower), with median latency 37.637s versus 106.835s (64.77% lower). Across all attempts, including the failed paid run, mean Socratic spend was $0.109023 and median latency was 46.492s. Success rate was 2/3.

The compact representation retained 75.17% of full evidence for the Sankey, 83.70% for CERN, and 83.06% for the mixed visual. Weighted across attempts it retained 79.72%, a 20.28% byte reduction.

## Big Takeaways

### US energy Sankey

Baseline: “Only 32.1 of 93.6 quads become Energy Services, while 61.5 quads, or 65.7%, are rejected. Major contributions to rejection include 18.9 quads at electricity generation and 21.7 quads in transportation.”

Socratic: “This estimated 2023 accounting traces 93.6 Quads from primary sources through conversion and end-use sectors to two final categories: 61.5 Quads labeled Rejected Energy and 32.1 Quads labeled Energy Services. Natural gas and petroleum together supply about 74% of the stated total, while the diagram’s outcome split is its strongest system-level message; ‘Rejected Energy’ should be read as the chart’s accounting category, not automatically as environmental harm or physical waste.”

Baseline walkthrough: primary sources; electricity conversion/loss; transportation input concentration; sector output contrasts; final outcomes.

Socratic walkthrough: scope/reading direction; dominant sources; conversion versus direct fuel use; end-use comparison; cautious final accounting split.

### CERN network map

Baseline: “The main chain scales sharply from BOOSTER (157 m) to PS (628 m), SPS (7 km), and LHC (27 km), while the PS and SPS also divert beams into multiple experimental branches.”

Socratic: no public analysis; deterministic spatial validation rejected a duplicate `r_lhc` selection after all five calls.

Baseline walkthrough: injector chain; PS crossroads; East Area fan-out; SPS distribution; North Area fan-out; LHC ring and experiments.

### Test mixed visual

Baseline: “The upper structure is one continuous three-block chain, while the lower purple block is the sole isolated component. With no labels or arrows, the visual establishes connectivity but not named roles or flow direction.”

Socratic: “This is an unlabeled geometric layout: two tapered shapes visibly link three upper/side blocks, while the lower purple block is spatially separate. The image establishes adjacency and separation, not flow, function, or meaning.”

Baseline walkthrough: left endpoint; rising connector; central linking block; descending connector; right endpoint; isolated block.

Socratic walkthrough: left block/visual link; central visual junction; left connector; right connector; separate lower block.

## Raw side-by-side excerpts

No quality judgment is assigned here; human scoring is required.

1. Baseline: “Transportation sends 21.7 quads to rejection versus 5.87 to services, whereas Industrial is nearly even at 13.3 rejected and 13.1 delivered as services.”<br>
   Socratic: “Industry and transportation are the largest displayed end-use sectors, making their pathways central to interpreting the composition of the energy system.”

2. Baseline: “Rejected Energy totals 61.5 quads, 29.4 more than Energy Services at 32.1 quads and about 1.9 times as large.”<br>
   Socratic: “The final split accounts for the stated total and shows that the category labeled Rejected Energy is numerically much larger than the category labeled Energy Services; interpretation beyond those labels requires the source methodology.”

3. Baseline: “Its two-sided connectivity makes it the bridge between the chain's endpoints.”<br>
   Socratic: “The layout has no direct visible tapered link from the left block to the right block; their displayed association is mediated spatially through this central block.”

## Risks and issues

- CERN produced no public output because the synthesizer selected `r_lhc` twice. The deterministic mapping guard correctly rejected duplicate source regions, but the five calls still cost $0.127567.
- Terra extracted 33 numeric facts for the Sankey but produced comparison grouping that yielded zero deterministic candidates, versus 60 in the saved Sol baseline. This is an evidence-quality risk; computation code was unchanged.
- Some raw analyst candidates exceeded image support, including policy/opportunity claims, an industrial “service-efficiency” conclusion, and a domestic-energy-dependence inference. The final Sankey synthesis omitted or qualified most of these, but the raw artifacts preserve them as hallucination/context risks.
- The Sankey walkthrough selected a Stage 1 title region as an orientation step. Other selected boxes were copied exactly from Stage 1; coordinate verification passed for both successful outputs. The broad source-column and tall left-block boxes reflect Stage 1 regions and should be checked by a human for tightness.
- The mixed-visual output carefully distinguishes visible adjacency from semantic connection, but terms such as “junction,” “chain,” and “transition” remain interpretive and are explicitly qualified.
- No human scores exist yet, so this run cannot answer whether explanatory depth improved. It establishes cost, latency, failure behavior, and the material to score.

Enter human scores in `evals/scores/2026-08-09T19-56-38-852Z.json`, following `evals/scores/example.json`. Score the saved baseline separately in `evals/scores/2026-08-09T19-28-05-474Z.json`. The rubric is `evals/RUBRIC.md`; nine dimensions total 45 points.

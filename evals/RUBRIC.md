# Noesis human evaluation rubric

Score each criterion from 1–5. The overall score is the sum, out of 45. Human review—not another model—is the quality ground truth.

| Criterion | 1 | 3 | 5 |
|---|---|---|---|
| Factual grounding | Claims are unsupported or contradict the visual. | Most claims are supported, with minor uncertainty or overreach. | Every material claim is specifically supported by visible evidence. |
| Numerical accuracy | Values or arithmetic are materially wrong. | Core values are right but there are minor omissions, rounding issues, or weak derivations. | Extracted values and derived calculations are consistently correct and appropriately qualified. |
| Insight value | Mostly narrates obvious content. | Some useful interpretation, but value is inconsistent. | Consistently specific, important, non-obvious insight grounded in the visual. |
| Comparative / structural reasoning | Misses or misstates important relationships. | Identifies some useful contrasts, topology, or dependencies. | Reveals the most meaningful ratios, contrasts, relationships, topology, divergence, or dependencies. |
| Spatial grounding | Boxes point to unrelated content or are unusably broad. | Most boxes locate the intended content but several are loose or overlap unnecessarily. | Boxes tightly and reliably correspond to each described region. |
| Walkthrough quality | Sequence is confusing or disconnected. | Sequence is understandable but has weak transitions or ordering. | Sequence builds a coherent, cumulative understanding of the visual. |
| Redundancy | Most steps repeat the same point. | Some overlap, but most steps add value. | Every step adds a distinct and useful layer of understanding. |
| Big takeaway quality | Restates the title or makes an unsupported claim. | Provides a supported synthesis, but it is generic or incomplete. | Synthesizes multiple parts into a strong, specific, consequential conclusion. |
| So-what / explanatory depth | Mostly describes what is visible; the natural response is frequently “so what?” | Several steps explain implications or relationships, but some remain descriptive. | Nearly every substantive step explains what changes in understanding, why it matters, or what mechanism/context makes it meaningful. |

Use `evals/scores/<run-id>.json`, following `evals/scores/example.json`. Add concise notes for questionable facts, boxes, or repeated steps.

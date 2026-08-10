import test from "node:test";
import assert from "node:assert/strict";
import { compactEvidence, evidenceCompressionMetrics } from "../compactEvidence";
import type { VisualEvidence } from "../../artifacts/api-server/src/lib/evidence";

test("compact evidence is deterministic, filters weak facts, and preserves regions", () => {
  const evidence: VisualEvidence = {
    image_type: "chart",
    apparent_purpose: "compare values",
    visual_structure: "verbose structure that is intentionally omitted",
    candidate_regions: [{ id: "r1", label: "Panel", x: 0, y: 0, width: 0.5, height: 0.5, visible_content: "bars", confidence: 0.9 }],
    numeric_facts: [
      { id: "n1", region_id: "r1", subject: "A", value: 10, unit: "%", qualifier: null, context: "verbose context", comparison_group: "g", is_total: false, confidence: 0.9 },
      { id: "n2", region_id: "r1", subject: "B", value: 4, unit: "%", qualifier: null, context: "weak", comparison_group: "g", is_total: false, confidence: 0.4 },
    ],
    categorical_facts: [],
    structural_observations: [],
    relationships: [],
  };
  const compact = compactEvidence(evidence, []);
  assert.equal(compact.regions.length, 1);
  assert.deepEqual(compact.numeric_facts.map((fact) => fact.id), ["n1"]);
  assert.equal("visual_structure" in compact, false);
  const sizes = evidenceCompressionMetrics(evidence, [], compact);
  assert.ok(sizes.full_evidence_bytes > 0);
  assert.ok(sizes.compact_evidence_bytes > 0);
  assert.equal(sizes.compression_ratio, sizes.compact_evidence_bytes / sizes.full_evidence_bytes);
});

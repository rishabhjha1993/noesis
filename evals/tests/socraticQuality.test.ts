import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { VisualEvidence } from "../../artifacts/api-server/src/lib/evidence";
import { createSocraticQualityPacket } from "../qualityEvidence";
import {
  V2_PASS1_PROMPT,
  mapQualitySynthesisToAnalysis,
  type QualitySynthesisOutput,
} from "../socraticQualityPipeline";

const evidence: VisualEvidence = {
  image_type: "diagram",
  apparent_purpose: "explain a system",
  visual_structure: "four linked areas",
  candidate_regions: ["r1", "r2", "r3", "r4"].map((id, index) => ({
    id,
    label: `Region ${index + 1}`,
    x: index * 0.2,
    y: 0.1,
    width: 0.15,
    height: 0.2,
    visible_content: `Content ${index + 1}`,
    confidence: 0.9,
  })),
  numeric_facts: [
    {
      id: "n1",
      region_id: "r1",
      subject: "A",
      value: 10,
      unit: "items",
      qualifier: null,
      context: "full context retained",
      comparison_group: null,
      is_total: false,
      confidence: 0.4,
    },
  ],
  categorical_facts: [],
  structural_observations: [],
  relationships: [],
};

test("quality packet keeps all evidence and context but removes coordinates", () => {
  const packet = createSocraticQualityPacket(evidence, []);
  assert.equal(packet.numeric_facts.length, 1);
  assert.equal(packet.numeric_facts[0]?.context, "full context retained");
  assert.equal(packet.numeric_facts[0]?.confidence, 0.4);
  assert.equal("x" in packet.regions[0]!, false);
  assert.equal(packet.visual_structure, evidence.visual_structure);
});

test("V2 Pass 1 prompt exactly matches the production prompt", () => {
  const source = readFileSync(
    path.resolve(
      __dirname,
      "../../artifacts/api-server/src/lib/analysisPipeline.ts",
    ),
    "utf8",
  );
  const match = source.match(/const PASS1_PROMPT = `([\s\S]*?)`;/);
  assert.ok(match);
  assert.equal(V2_PASS1_PROMPT, match[1]);
});

test("duplicate primary regions use declared semantic alternates deterministically", () => {
  const synthesis: QualitySynthesisOutput = {
    title: "System",
    image_type: "diagram",
    central_question: "How does it work?",
    overall_summary: "Four areas form a system.",
    big_takeaway: "The linked areas serve distinct roles.",
    big_takeaway_evidence_level: "derived",
    big_takeaway_contextual_claim: null,
    big_takeaway_contextual_confidence: null,
    big_takeaway_context_appropriateness: null,
    regions: [
      ["r1", []],
      ["r1", ["r2"]],
      ["r3", []],
      ["r4", []],
    ].map(([primary, alternates], index) => ({
      primary_source_region_id: primary as string,
      alternate_source_region_ids: alternates as string[],
      label: `Step ${index + 1}`,
      sequence_order: index + 1,
      explanation: "Visible content.",
      why_it_matters: "It changes the system reading.",
      related_source_region_ids: [],
      relationship_explanation: "It has a distinct role.",
      confidence: 0.9,
      evidence_level: "visual" as const,
      contextual_claim: null,
      contextual_confidence: null,
      context_appropriateness: null,
    })),
  };
  const result = mapQualitySynthesisToAnalysis(synthesis, evidence);
  assert.deepEqual(result.selectedSourceRegionIds, ["r1", "r2", "r3", "r4"]);
  assert.equal(result.analysis.regions[1]?.x, 0.2);
});

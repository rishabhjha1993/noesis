import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  F1_CONTROL_INSTRUCTIONS,
  F1_IDENTITY_FORMULATION_MODEL,
  F1_IDENTITY_FORMULATION_REASONING_EFFORT,
  F1_JOINT_EVIDENCE_DELTA,
  assertSafeF1IdentityFormulationOutput,
  canonicalSerializeF1Evidence,
  createF1FrozenEvidencePacket,
  createF1IdentityFormulationDryRun,
  createF1IdentityFormulationPlan,
  createF1IdentityFormulationRequests,
  executeF1IdentityFormulationReplay,
  parseF1RetainedInput,
  validateF1IdentityOutput,
  type F1IdentityFormulationClient,
} from "../discoveryIdentityFormulationReplay";

const stage1 = {
  image_summary: "PRIOR_IMAGE_SUMMARY_MUST_NOT_ENTER_FROZEN_EVIDENCE",
  regions: [
    {
      id: "r_fields",
      description: "A large rectilinear field system meets open water.",
      scope: "local" as const,
      x: 0.1,
      y: 0.1,
      width: 0.6,
      height: 0.7,
    },
    {
      id: "r_circle",
      description: "A circular water feature sits beyond a straight shoreline.",
      scope: "local" as const,
      x: 0.4,
      y: 0.8,
      width: 0.1,
      height: 0.1,
    },
  ],
  candidates: [
    {
      id: "c_boundary",
      question_id: "q_boundary",
      visual_trigger: "Straight water boundaries enclose regular parcels.",
      observation: "The shoreline and parcel grid share engineered geometry.",
      region_ids: ["r_fields"],
      investigation_question:
        "PRIOR_INVESTIGATION_QUESTION_MUST_NOT_ENTER_FROZEN_EVIDENCE",
      research_needed: true,
      research_rationale:
        "PRIOR_RESEARCH_RATIONALE_MUST_NOT_ENTER_FROZEN_EVIDENCE",
      identity_context_needed: true,
    },
    {
      id: "c_circle",
      question_id: "q_circle",
      visual_trigger: "A circular feature interrupts the surrounding water.",
      observation: "The isolated circle contrasts with straight nearby edges.",
      region_ids: ["r_circle"],
      investigation_question: "What is the circular feature?",
      research_needed: true,
      research_rationale: "Identity may explain its function.",
      identity_context_needed: true,
    },
  ],
  identity_hypotheses: [
    {
      id: "prior_identity",
      proposed_identity: "PRIOR_IDENTITY_MUST_NOT_ENTER_FROZEN_EVIDENCE",
      identity_type: "place" as const,
      visible_evidence: ["A prior synthesis that must be removed."],
      observed_labels_or_numbers: [],
      region_ids: ["r_fields"],
      confidence: 0.5,
      verification_would_help: true,
      relevant_question_ids: ["q_boundary"],
    },
  ],
};

function retainedEnvelope(stage1Value: unknown = stage1) {
  return {
    status: "done",
    discovery_id: "weak-run-id",
    result: {
      version: "discovery-engine-v1-luna-research",
      regions: stage1.regions,
      discoveries: [
        { discovery: "PRIOR_STAGE3_MUST_NOT_ENTER_FROZEN_EVIDENCE" },
      ],
      inspection: {
        stage1: stage1Value,
        identity_verification: {
          status: "verified",
          canonical_identity:
            "PRIOR_VERIFIED_IDENTITY_MUST_NOT_ENTER_FROZEN_EVIDENCE",
        },
        research_results: [
          { finding: "PRIOR_RESEARCH_MUST_NOT_ENTER_FROZEN_EVIDENCE" },
        ],
      },
      metrics: { success: true },
    },
  };
}

function input() {
  return parseF1RetainedInput(retainedEnvelope(), "weak-run-id");
}

function validHypothesis(
  proposedIdentity = "A constrained engineered landscape",
) {
  return {
    identity_hypotheses: [
      {
        id: "f1_identity",
        proposed_identity: proposedIdentity,
        identity_type: "place",
        visible_evidence: [
          "Straight water boundaries enclose regular parcels.",
          "An isolated circular feature contrasts with those boundaries.",
        ],
        observed_labels_or_numbers: [],
        region_ids: ["r_fields", "r_circle"],
        confidence: 0.7,
        verification_would_help: true,
        relevant_question_ids: ["q_boundary", "q_circle"],
      },
    ],
  };
}

function response(output: unknown, model = F1_IDENTITY_FORMULATION_MODEL) {
  return {
    model,
    output_text: JSON.stringify(output),
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 25,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 125,
    },
  };
}

test("F1 validates retained Stage 1 with the existing production contract", () => {
  const parsed = input();
  assert.equal(parsed.sourceDiscoveryId, "weak-run-id");
  assert.equal(parsed.sourceEngineVersion, "discovery-engine-v1-luna-research");
  assert.equal(parsed.stage1.candidates.length, 2);

  const malformed = structuredClone(stage1);
  malformed.candidates[0]!.region_ids = ["missing_region"];
  assert.throws(
    () => parseF1RetainedInput(retainedEnvelope(malformed), "weak-run-id"),
    /unknown region/,
  );
});

test("frozen evidence contains only the allowed observational fields", () => {
  const packet = createF1FrozenEvidencePacket(input().stage1);
  assert.deepEqual(Object.keys(packet.regions[0]!).sort(), [
    "description",
    "id",
    "scope",
  ]);
  assert.deepEqual(Object.keys(packet.candidates[0]!).sort(), [
    "id",
    "identity_context_needed",
    "observation",
    "question_id",
    "region_ids",
    "visual_trigger",
  ]);
  const serialized = canonicalSerializeF1Evidence(packet);
  assert.doesNotMatch(
    serialized,
    /PRIOR_(IDENTITY|IMAGE_SUMMARY|INVESTIGATION|RESEARCH|VERIFIED|STAGE3)/,
  );
  assert.doesNotMatch(
    serialized,
    /identity_hypotheses|identity_verification|research_results|discoveries|image_summary|investigation_question|research_rationale/,
  );
});

test("canonical evidence and its fingerprint are deterministic", () => {
  const first = createF1IdentityFormulationPlan(input());
  const second = createF1IdentityFormulationPlan(input());
  assert.equal(first.canonicalEvidence, second.canonicalEvidence);
  assert.equal(first.evidenceSha256, second.evidenceSha256);
  assert.match(first.evidenceSha256, /^[a-f0-9]{64}$/);
});

test("both arms receive byte-identical evidence and differ only by the intervention delta", () => {
  const requests = createF1IdentityFormulationRequests(
    createF1IdentityFormulationPlan(input()),
  );
  assert.equal(requests.length, 2);
  assert.equal(requests[0]!.request.input, requests[1]!.request.input);
  assert.deepEqual(requests[0]!.request.text, requests[1]!.request.text);
  assert.deepEqual(
    { ...requests[0]!.request, instructions: null },
    { ...requests[1]!.request, instructions: null },
  );
  assert.equal(requests[0]!.request.instructions, F1_CONTROL_INSTRUCTIONS);
  assert.equal(
    requests[1]!.request.instructions,
    `${F1_CONTROL_INSTRUCTIONS}\n\n${F1_JOINT_EVIDENCE_DELTA}`,
  );
  assert.doesNotMatch(
    JSON.stringify(requests),
    /Noordoostpolder|Netherlands|Flevoland|IJsseloog/i,
  );
});

test("contamination guard fails closed before any client can be called", () => {
  for (const target of [
    "Noordoostpolder",
    "netherlands",
    "FLEVoland",
    "ijsseloog",
  ]) {
    const contaminated = structuredClone(stage1);
    contaminated.candidates[0]!.observation = `Visible clue says ${target}.`;
    const parsed = parseF1RetainedInput(
      retainedEnvelope(contaminated),
      "weak-run-id",
    );
    let calls = 0;
    assert.throws(
      () => createF1IdentityFormulationPlan(parsed),
      /contaminated.*no model call/i,
    );
    assert.equal(calls, 0);
  }
});

test("dry run needs no OpenAI client and creates no result artifact", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "noesis-f1-test-"));
  const outputPath = path.join(directory, "result.json");
  try {
    const dryRun = createF1IdentityFormulationDryRun(
      createF1IdentityFormulationPlan(input(), outputPath),
    );
    assert.equal(dryRun.mode, "dry-run");
    assert.equal(dryRun.planned_api_calls, 2);
    assert.equal(dryRun.planned_tools, 0);
    assert.equal(dryRun.planned_web_search_calls, 0);
    assert.equal(dryRun.production_pipeline_involved, false);
    await assert.rejects(access(outputPath), { code: "ENOENT" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("mocked execution makes exactly two text-only Sol-medium calls", async () => {
  const requests: Parameters<
    F1IdentityFormulationClient["responses"]["create"]
  >[0][] = [];
  const client: F1IdentityFormulationClient = {
    responses: {
      create: async (request) => {
        requests.push(request);
        return response(
          requests.length === 1
            ? { identity_hypotheses: [] }
            : validHypothesis(),
        );
      },
    },
  };
  const output = await executeF1IdentityFormulationReplay(
    client,
    createF1IdentityFormulationPlan(input()),
  );
  assert.equal(requests.length, 2);
  assert.equal(output.arms.length, 2);
  assert.deepEqual(
    output.arms.map(({ arm }) => arm),
    ["control", "intervention"],
  );
  assert.equal(
    requests.every(
      (request) =>
        request.model === F1_IDENTITY_FORMULATION_MODEL &&
        request.reasoning.effort === F1_IDENTITY_FORMULATION_REASONING_EFFORT &&
        !("tools" in request) &&
        !("tool_choice" in request),
    ),
    true,
  );
  assert.equal(
    output.arms.every((arm) => arm.web_search_calls === 0),
    true,
  );
  assert.equal(output.total_tool_cost_usd, 0);
  assert.ok(Math.abs(output.total_model_token_cost_usd! - 0.00232) < 1e-12);
  assert.equal(output.total_known_cost_usd, output.total_model_token_cost_usd);
});

test("malformed or ungrounded identity references fail validation", () => {
  const plan = createF1IdentityFormulationPlan(input());
  const badRegion = validHypothesis();
  badRegion.identity_hypotheses[0]!.region_ids = ["unknown_region"];
  assert.throws(
    () => validateF1IdentityOutput(plan, badRegion),
    /unknown region/,
  );
  const badQuestion = validHypothesis();
  badQuestion.identity_hypotheses[0]!.relevant_question_ids = [
    "unknown_question",
  ];
  assert.throws(
    () => validateF1IdentityOutput(plan, badQuestion),
    /unknown question/,
  );
  assert.throws(
    () =>
      validateF1IdentityOutput(plan, { identity_hypotheses: [{ nope: true }] }),
    /invalid_type|Required|expected/i,
  );
});

test("safe experiment output rejects prompt, raw, secret, and internal fields", () => {
  assert.doesNotThrow(() =>
    assertSafeF1IdentityFormulationOutput({ arms: [], total_tool_cost_usd: 0 }),
  );
  for (const unsafe of [
    { system_prompt: "hidden" },
    { raw_response: "hidden" },
    { request_body: "hidden" },
    { environment: { value: "hidden" } },
    { note: "OPENAI_API_KEY" },
    { value: `sk-${"a".repeat(24)}` },
  ]) {
    assert.throws(
      () => assertSafeF1IdentityFormulationOutput(unsafe),
      /internal-only|secret-like/,
    );
  }
});

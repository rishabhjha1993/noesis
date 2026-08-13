import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateResearchRequestsForPlan,
  createDiscoveryResearchReplayDryRun,
  createDiscoveryResearchReplayPlan,
  executeDiscoveryResearchReplay,
  parseRetainedDiscoveryReplayInput,
} from "../discoveryResearchReplay";
import {
  DISCOVERY_REASONING_EFFORT,
  DISCOVERY_STAGE2_MODEL,
  DISCOVERY_LUNA_RESEARCH_MODEL,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";

const stage1 = {
  image_summary: "A retained visual with two research candidates.",
  regions: [
    {
      id: "r1",
      description: "The complete retained visual",
      scope: "global" as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ],
  candidates: [
    {
      id: "c1",
      question_id: "q1",
      visual_trigger: "A circular feature interrupts straight parcels.",
      observation: "The circle is geometrically distinct from its setting.",
      region_ids: ["r1"],
      investigation_question: "What is the visible circular feature?",
      research_needed: true,
      research_rationale: "Verified context may explain the anomaly.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "Two parcel systems meet at a hard boundary.",
      observation: "Their orientations visibly conflict.",
      region_ids: ["r1"],
      investigation_question: "Why do the parcel orientations differ?",
      research_needed: true,
      research_rationale: "External evidence may explain the boundary.",
      identity_context_needed: false,
    },
    {
      id: "c3",
      question_id: "q3",
      visual_trigger: "A regular grid covers the image.",
      observation: "The grid is directly visible.",
      region_ids: ["r1"],
      investigation_question: "What grid is directly visible?",
      research_needed: false,
      research_rationale: "",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "Retained verified place",
      identity_type: "place" as const,
      visible_evidence: ["The water boundary encloses regular parcels."],
      observed_labels_or_numbers: [],
      region_ids: ["r1"],
      confidence: 0.8,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ],
};

const verifiedIdentity = {
  status: "verified" as const,
  hypothesis_id: "ih1",
  canonical_identity: "Retained verified place",
  identity_type: "place" as const,
  location: "Example region",
  verification_basis: "Authoritative sources establish the exact place.",
  confidence: 0.95,
  match_evidence: [
    {
      basis: "geographic_configuration" as const,
      detail: "The exact enclosing geometry matches the retained place.",
    },
  ],
  sources: [{ title: "Identity", url: "https://example.com/identity" }],
};

function retainedEnvelope(identity: unknown = verifiedIdentity) {
  return {
    status: "done",
    cache_hit: false,
    result: {
      version: "discovery-engine-v1",
      regions: stage1.regions,
      discoveries: [
        {
          id: "d1",
          type: "global",
          title: "Visible grid",
          visual_trigger: "A regular grid covers the image.",
          observation: "The grid is directly visible.",
          discovery: "The scene is organized by a regular grid.",
          why_it_matters: "The organization structures the whole visual.",
          explanation: "This is supported directly by the retained image.",
          reinterpretation: "Look back at the repeated grid alignment.",
          region_ids: ["r1"],
          provenance: "seen",
          confidence: 0.8,
          sources: [],
        },
      ],
      inspection: {
        stage1,
        identity_verification: identity,
        research_results: [
          {
            candidate_id: "c1",
            question_id: "q1",
            question: "What is the visible circular feature?",
            status: "answered",
            finding: "RETAINED_TERRA_ANSWER_MUST_NOT_ENTER_REPLAY_INPUT",
            sources: [
              { title: "Baseline", url: "https://example.com/baseline" },
            ],
          },
          {
            candidate_id: "c2",
            question_id: "q2",
            question: "Why do the parcel orientations differ?",
            status: "insufficient",
            finding: "RETAINED_INSUFFICIENT_FINDING",
            sources: [],
          },
        ],
        discovery_candidates: { d1: ["c3"] },
      },
      metrics: {
        success: true,
        stage2: {
          calls: [
            { candidate_id: "c1", total_known_cost_usd: 0.04 },
            { candidate_id: "c2", total_known_cost_usd: 0.02 },
          ],
        },
      },
    },
  };
}

function parsed() {
  return parseRetainedDiscoveryReplayInput(
    retainedEnvelope(),
    "retained-discovery-id",
  );
}

function response(
  model: string,
  outputText: string,
  citation?: { title: string; url: string },
  webSearchCalls = 1,
) {
  return {
    model,
    output_text: outputText,
    output: [
      ...Array.from({ length: webSearchCalls }, () => ({
        type: "web_search_call",
        status: "completed",
      })),
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: citation
              ? [
                  {
                    type: "url_citation",
                    ...citation,
                    start_index: 0,
                    end_index: 8,
                  },
                ]
              : [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
      output_tokens: 25,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 125,
    },
  };
}

test("replay parses and validates the retained API envelope", () => {
  const input = parsed();
  assert.equal(input.sourceEngineVersion, "discovery-engine-v1");
  assert.equal(input.identityVerification.status, "verified");
  assert.equal(input.stage1.candidates.length, 3);
  assert.deepEqual(
    input.retainedResearchResults.map((result) => result.status),
    ["answered", "insufficient"],
  );
});

test("replay rejects failed, incomplete, or unresolved retained input", () => {
  assert.throws(
    () =>
      parseRetainedDiscoveryReplayInput(
        { ...retainedEnvelope(), status: "error" },
        "id",
      ),
    /not a successful completed job/,
  );
  const missingStage1 = retainedEnvelope();
  delete (missingStage1.result.inspection as { stage1?: unknown }).stage1;
  assert.throws(
    () => parseRetainedDiscoveryReplayInput(missingStage1, "id"),
    /does not contain Stage 1/,
  );
  for (const status of ["unverified", "conflicted"] as const) {
    assert.throws(
      () =>
        parseRetainedDiscoveryReplayInput(
          retainedEnvelope({
            ...verifiedIdentity,
            status,
            canonical_identity: null,
            identity_type: null,
            location: null,
            sources: [],
          }),
          "id",
        ),
      /requires retained verified identity context/,
    );
  }
});

test("dry-run plans only gated candidates without any OpenAI dependency", () => {
  let calls = 0;
  const plan = createDiscoveryResearchReplayPlan(
    parsed(),
    DISCOVERY_LUNA_RESEARCH_MODEL,
    "/tmp/replay.json",
  );
  const dryRun = createDiscoveryResearchReplayDryRun(plan);
  assert.equal(calls, 0);
  assert.equal(dryRun.planned_api_calls, 2);
  assert.equal(dryRun.stage1_candidate_count, 3);
  assert.deepEqual(
    dryRun.candidates.map((candidate) => [
      candidate.candidate_id,
      candidate.question_id,
      candidate.used_verified_identity_context,
    ]),
    [
      ["c1", "q1", true],
      ["c2", "q2", false],
    ],
  );
});

test("Terra and Luna replay requests differ only by candidate model", () => {
  const input = parsed();
  const terra = candidateResearchRequestsForPlan(
    createDiscoveryResearchReplayPlan(input, DISCOVERY_STAGE2_MODEL),
  );
  const luna = candidateResearchRequestsForPlan(
    createDiscoveryResearchReplayPlan(input, DISCOVERY_LUNA_RESEARCH_MODEL),
  );
  assert.equal(terra.length, 2);
  assert.deepEqual(
    terra.map((item) => ({ ...item, request: { ...item.request, model: null } })),
    luna.map((item) => ({ ...item, request: { ...item.request, model: null } })),
  );
  assert.ok(
    terra.every(
      (item) =>
        item.request.model === DISCOVERY_STAGE2_MODEL &&
        item.request.reasoning.effort === DISCOVERY_REASONING_EFFORT,
    ),
  );
  assert.ok(
    luna.every(
      (item) =>
        item.request.model === DISCOVERY_LUNA_RESEARCH_MODEL &&
        item.request.reasoning.effort === DISCOVERY_REASONING_EFFORT,
    ),
  );
  const serializedInputs = JSON.stringify(
    luna.map((item) => item.request.input),
  );
  assert.doesNotMatch(serializedInputs, /RETAINED_TERRA_ANSWER/);
  assert.doesNotMatch(serializedInputs, /RETAINED_INSUFFICIENT_FINDING/);
  assert.doesNotMatch(serializedInputs, /example\.com\/baseline/);
});

test("paid-mode executor invokes only candidate research and accounts safely", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const client = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        requests.push(request);
        const candidateOne = String(request.input).includes("CANDIDATE ID: c1");
        return candidateOne
          ? response(
              String(request.model),
              "ANSWERED: A validated replay finding.",
              { title: "Replay", url: "https://example.com/replay" },
              2,
            )
          : response(
              String(request.model),
              "INSUFFICIENT: Reliable evidence was not found.",
              undefined,
              1,
            );
      },
    },
  } as unknown as Parameters<typeof executeDiscoveryResearchReplay>[0];
  const output = await executeDiscoveryResearchReplay(
    client,
    createDiscoveryResearchReplayPlan(parsed(), DISCOVERY_LUNA_RESEARCH_MODEL),
  );
  assert.equal(requests.length, 2);
  assert.equal(output.attempted_count, 2);
  assert.equal(output.answered_count, 1);
  assert.equal(output.insufficient_count, 1);
  assert.equal(output.total_model_tokens, 250);
  assert.equal(output.total_web_search_calls, 3);
  assert.ok(
    Math.abs(output.total_model_token_cost_usd! - 0.0000928) < 1e-12,
  );
  assert.equal(output.total_tool_cost_usd, 0.03);
  assert.ok(Math.abs(output.total_known_cost_usd! - 0.0300928) < 1e-12);
  assert.deepEqual(output.candidates[0]!.validated_sources, [
    { title: "Replay", url: "https://example.com/replay" },
  ]);
  const serialized = JSON.stringify(output);
  assert.doesNotMatch(
    serialized,
    /RETAINED_TERRA_ANSWER|RETAINED_INSUFFICIENT_FINDING|raw_response|instructions|prompt|api[_-]?key|authorization|stack/i,
  );
  assert.equal(
    requests.every(
      (request) =>
        !("messages" in request) && !("text" in request) && "input" in request,
    ),
    true,
    "the replay makes candidate Responses calls only—no Stage 1, identity, or Stage 3 calls",
  );
});

test("unvalidated citations cannot produce an answered replay result", async () => {
  const client = {
    responses: {
      create: async (request: Record<string, unknown>) =>
        response(
          String(request.model),
          "ANSWERED: Unsupported result.",
          { title: "Unsafe", url: "javascript:alert(1)" },
        ),
    },
  } as unknown as Parameters<typeof executeDiscoveryResearchReplay>[0];
  const output = await executeDiscoveryResearchReplay(
    client,
    createDiscoveryResearchReplayPlan(parsed(), DISCOVERY_STAGE2_MODEL),
  );
  assert.equal(output.answered_count, 0);
  assert.equal(output.insufficient_count, 2);
  assert.equal(
    output.candidates.every((candidate) => candidate.validated_sources.length === 0),
    true,
  );
});

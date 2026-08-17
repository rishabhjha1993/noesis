import assert from "node:assert/strict";
import test from "node:test";
import {
  V2_HYBRID_FINAL_PROMPT,
  V2_HYBRID_REASONING_EFFORT,
  V2_HYBRID_STAGE1_MODEL,
  V2_HYBRID_STAGE1_PROMPT,
} from "../../artifacts/api-server/src/lib/discoveryHybridV2";
import {
  createDiscoveryStage1ReplayPlan,
  executeDiscoveryStage1Replay,
  type DiscoveryReplayChatClient,
} from "../discoveryStage1Replay";
import {
  createDiscoveryStage3ReplayPlan,
  executeDiscoveryStage3Replay,
  parseRetainedStage3ReplayInput,
} from "../discoveryStage3Replay";

const image = {
  dataUrl: "data:image/png;base64,YWJj",
  mimeType: "image/png" as const,
  sha256: "deadbeef",
  byteLength: 3,
};

const stage1 = {
  image_summary: "A landscape with two visible anomalies.",
  regions: [
    {
      id: "r1",
      description: "The complete landscape",
      scope: "global" as const,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ],
  candidates: [
    {
      id: "cand_A",
      question_id: "q_A",
      visual_trigger: "A circular feature interrupts the grid.",
      observation: "The circle is isolated beside a channel.",
      region_ids: ["r1"],
      investigation_question: "What function does the circular feature serve?",
      research_needed: true,
      research_rationale:
        "External evidence could explain the visible anomaly.",
      identity_context_needed: false,
    },
    {
      id: "cand_B",
      question_id: "q_B",
      visual_trigger: "A straight boundary divides two orientations.",
      observation: "The field axes change abruptly at the boundary.",
      region_ids: ["r1"],
      investigation_question: "Why do the orientations change here?",
      research_needed: true,
      research_rationale: "Planning history could explain the boundary.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [],
};

function chatResponse(model: string, content: unknown) {
  return {
    model,
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens: 40,
      completion_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 140,
    },
  };
}

interface Captured {
  requests: unknown[];
}

function chatClient(
  captured: Captured,
  content: unknown,
  model = "gpt-5.6-sol",
): DiscoveryReplayChatClient {
  return {
    chat: {
      completions: {
        create: async (request: unknown) => {
          captured.requests.push(request);
          return chatResponse(model, content) as never;
        },
      },
    },
  } as unknown as DiscoveryReplayChatClient;
}

// --- Stage-1-only replay ---

test("Stage-1 replay calls only Stage 1, reuses the production request, and validates", async () => {
  const captured: Captured = { requests: [] };
  const plan = createDiscoveryStage1ReplayPlan(image, null);
  const result = await executeDiscoveryStage1Replay(
    chatClient(captured, stage1),
    plan,
    image,
  );
  // exactly one chat call; the mock client has no `responses` API, so any Luna/web
  // search or Stage-3 call would have thrown.
  assert.equal(captured.requests.length, 1);
  const request = captured.requests[0] as {
    model: string;
    reasoning_effort: string;
    messages: Array<{ content: unknown }>;
  };
  assert.equal(request.model, V2_HYBRID_STAGE1_MODEL);
  assert.equal(request.reasoning_effort, V2_HYBRID_REASONING_EFFORT);
  assert.equal(request.messages[0]?.content, V2_HYBRID_STAGE1_PROMPT);
  assert.match(JSON.stringify(request.messages[1]), /image_url.*high/);
  assert.equal(result.stage1.candidates.length, 2);
  assert.equal(result.metrics.web_search_calls, 0);
  assert.equal(result.image_sha256, "deadbeef");
});

// --- Stage-3-only replay ---

function retainedV2Envelope(
  overrides: {
    version?: unknown;
    metrics?: unknown;
    inspection?: Record<string, unknown>;
  } = {},
) {
  return {
    status: "done",
    discovery_id: "kamchatka-replay",
    result: {
      version: overrides.version ?? "discovery-engine-v2-hybrid",
      regions: stage1.regions,
      metrics: overrides.metrics ?? { success: true },
      inspection: {
        stage1,
        identity_verification: null,
        discovery_candidates: {},
        research_results: [
          {
            candidate_id: "cand_A",
            question_id: "q_A",
            question: "What function does the circular feature serve?",
            status: "answered",
            finding: "Trustworthy evidence answers the question.",
            sources: [{ title: "A", url: "https://example.com/a" }],
          },
          {
            candidate_id: "cand_B",
            question_id: "q_B",
            question: "Why do the orientations change here?",
            status: "answered",
            finding: "Trustworthy evidence answers the question.",
            sources: [{ title: "B", url: "https://example.com/b" }],
          },
        ],
        ...(overrides.inspection ?? {}),
      },
    },
  };
}

function finalDiscovery(candidateIds: string[], sourceUrl: string) {
  return {
    discoveries: [
      {
        id: "d1",
        type: "local",
        title: "The circle is functional infrastructure",
        visual_trigger: "The isolated circular feature beside the channel.",
        observation: "It interrupts the rectilinear field pattern.",
        discovery: "Research explains the feature's function.",
        why_it_matters: "The anomaly belongs to the engineered system.",
        explanation: "Its geometry follows from that function.",
        reinterpretation: "Look back at the circle as working infrastructure.",
        region_ids: ["r1"],
        candidate_ids: candidateIds,
        provenance: "researched",
        confidence: 0.9,
        sources: [{ title: "S", url: sourceUrl }],
      },
    ],
  };
}

test("Stage-3 replay runs only Final Sol on a frozen packet, reuses the final request, and validates", async () => {
  const retained = parseRetainedStage3ReplayInput(retainedV2Envelope());
  const plan = createDiscoveryStage3ReplayPlan(retained, null);
  assert.equal(plan.candidates.length, 2);

  const captured: Captured = { requests: [] };
  const result = await executeDiscoveryStage3Replay(
    chatClient(captured, finalDiscovery(["cand_A"], "https://example.com/a")),
    plan,
    image,
  );
  assert.equal(captured.requests.length, 1);
  const request = captured.requests[0] as {
    messages: Array<{ content: unknown }>;
  };
  assert.equal(request.messages[0]?.content, V2_HYBRID_FINAL_PROMPT);
  assert.match(JSON.stringify(request.messages[1]), /image_url.*high/);
  assert.equal(result.outcome, "validated");
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.source_validation_detail, null);
});

test("Stage-3 replay reuses production validation: canonicalized utm parity passes", async () => {
  const retained = parseRetainedStage3ReplayInput(retainedV2Envelope());
  const plan = createDiscoveryStage3ReplayPlan(retained, null);
  const captured: Captured = { requests: [] };
  const result = await executeDiscoveryStage3Replay(
    chatClient(
      captured,
      finalDiscovery(
        ["cand_A"],
        "https://example.com/a?utm_source=chatgpt.com",
      ),
    ),
    plan,
    image,
  );
  assert.equal(result.outcome, "validated");
});

test("Stage-3 replay rejects a cross-candidate source and surfaces the safe classification", async () => {
  const retained = parseRetainedStage3ReplayInput(retainedV2Envelope());
  const plan = createDiscoveryStage3ReplayPlan(retained, null);
  const captured: Captured = { requests: [] };
  const result = await executeDiscoveryStage3Replay(
    // declares only cand_A but cites cand_B's source
    chatClient(captured, finalDiscovery(["cand_A"], "https://example.com/b")),
    plan,
    image,
  );
  assert.equal(result.outcome, "source_validation_failed");
  assert.equal(result.discoveries.length, 0);
  assert.equal(
    result.source_validation_detail?.reason,
    "CROSS_CANDIDATE_SOURCE",
  );
  assert.deepEqual(result.source_validation_detail?.owning_candidate_ids, [
    "cand_B",
  ]);
  // safe location must not carry query values
  assert.doesNotMatch(
    JSON.stringify(result.source_validation_detail),
    /SECRET/,
  );
});

test("Stage-3 replay rejects an invented source", async () => {
  const retained = parseRetainedStage3ReplayInput(retainedV2Envelope());
  const plan = createDiscoveryStage3ReplayPlan(retained, null);
  const captured: Captured = { requests: [] };
  const result = await executeDiscoveryStage3Replay(
    chatClient(captured, finalDiscovery(["cand_A"], "https://other.example/x")),
    plan,
    image,
  );
  assert.equal(result.outcome, "source_validation_failed");
  assert.equal(result.source_validation_detail?.reason, "UNKNOWN_SOURCE");
});

test("Stage-3 replay rejects malformed frozen packets", () => {
  // wrong engine version
  assert.throws(() =>
    parseRetainedStage3ReplayInput(
      retainedV2Envelope({ version: "discovery-engine-v1-frozen-3a0bca12" }),
    ),
  );
  // non-null identity_verification (V1-shaped) is rejected for the V2 replay
  assert.throws(() =>
    parseRetainedStage3ReplayInput(
      retainedV2Envelope({ inspection: { identity_verification: {} } }),
    ),
  );
  // not a successful job
  assert.throws(() =>
    parseRetainedStage3ReplayInput(
      retainedV2Envelope({ metrics: { success: false } }),
    ),
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_RESEARCH_IMAGE_DETAIL,
  addOriginalImageToCandidateResearchRequest,
  assertOriginalImageIsOnlyRequestDifference,
  candidateResearchRequestsForPlan,
  createDiscoveryResearchImageAccessExperimentPlan,
  createDiscoveryResearchReplayDryRun,
  createDiscoveryResearchReplayPlan,
  executeDiscoveryResearchImageAccessExperiment,
  executeDiscoveryResearchReplay,
  parseRetainedDiscoveryReplayInput,
} from "../discoveryResearchReplay";
import {
  DISCOVERY_REASONING_EFFORT,
  DISCOVERY_STAGE2_MODEL,
  DISCOVERY_LUNA_RESEARCH_MODEL,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { FROZEN_V1_ENGINE_VERSION } from "../../artifacts/api-server/src/lib/discoveryFrozenV1";

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

function fiveCandidateReplayInput(
  version: "discovery-engine-v1" | typeof FROZEN_V1_ENGINE_VERSION,
) {
  const candidates = Array.from({ length: 5 }, (_, index) => {
    const number = index + 1;
    return {
      id: `cand-0${number}`,
      question_id: `q${number}`,
      visual_trigger: `Visible thematic feature number ${number}.`,
      observation: `Feature ${number} has a distinct visible spatial pattern.`,
      region_ids: ["r1"],
      investigation_question: `What explains visible thematic feature ${number}?`,
      research_needed: true,
      research_rationale: `External evidence could explain visible feature ${number}.`,
      identity_context_needed: true,
    };
  });
  const fiveCandidateStage1 = {
    ...stage1,
    candidates,
    identity_hypotheses: [
      {
        ...stage1.identity_hypotheses[0]!,
        relevant_question_ids: ["q1", "q2", "q3"],
      },
    ],
  };
  return parseRetainedDiscoveryReplayInput(
    {
      status: "done",
      result: {
        version,
        regions: fiveCandidateStage1.regions,
        discoveries: [],
        inspection: {
          stage1: fiveCandidateStage1,
          identity_verification: verifiedIdentity,
          research_results: candidates.map((candidate) => ({
            candidate_id: candidate.id,
            question_id: candidate.question_id,
            question: candidate.investigation_question,
            status: "insufficient",
            finding: "Retained evidence was insufficient.",
            sources: [],
          })),
          discovery_candidates: {},
        },
        metrics: {
          success: true,
          stage2: {
            calls: candidates.map((candidate) => ({
              candidate_id: candidate.id,
              total_known_cost_usd: 0.01,
            })),
          },
        },
      },
    },
    "five-candidate-run",
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

test("image-access replay accepts the frozen V1 retained envelope", () => {
  const envelope = retainedEnvelope();
  envelope.result.version = FROZEN_V1_ENGINE_VERSION;
  const input = parseRetainedDiscoveryReplayInput(envelope, "frozen-run");
  assert.equal(input.sourceEngineVersion, FROZEN_V1_ENGINE_VERSION);
});

test("frozen replay preserves hypothesis-scoped identity context in both actual arms", async () => {
  const frozenInput = fiveCandidateReplayInput(FROZEN_V1_ENGINE_VERSION);
  const expectedApplicability = [true, true, true, false, false];
  const requestsByArm: Record<string, Array<Record<string, unknown>>> = {
    "text-only": [],
    "original-image": [],
  };
  const makeClient = (arm: "text-only" | "original-image") =>
    ({
      responses: {
        create: async (request: Record<string, unknown>) => {
          requestsByArm[arm].push(request);
          return response(
            String(request.model),
            "INSUFFICIENT: Reliable evidence was not found.",
          );
        },
      },
    }) as unknown as Parameters<
      typeof executeDiscoveryResearchImageAccessExperiment
    >[0];

  const controlPlan = createDiscoveryResearchImageAccessExperimentPlan(
    frozenInput,
    { imageAccess: "text-only", repeat: 1 },
  );
  const treatmentPlan = createDiscoveryResearchImageAccessExperimentPlan(
    frozenInput,
    {
      imageAccess: "original-image",
      repeat: 1,
      imagePath: "/tmp/explicit.png",
    },
  );
  assert.deepEqual(
    controlPlan.candidates.map((item) => item.usedVerifiedIdentityContext),
    expectedApplicability,
  );
  assert.deepEqual(
    treatmentPlan.candidates.map((item) => item.usedVerifiedIdentityContext),
    expectedApplicability,
  );

  const control = await executeDiscoveryResearchImageAccessExperiment(
    makeClient("text-only"),
    controlPlan,
    null,
  );
  const treatment = await executeDiscoveryResearchImageAccessExperiment(
    makeClient("original-image"),
    treatmentPlan,
    replayImage,
  );
  for (const output of [control, treatment]) {
    assert.deepEqual(
      output.attempts.map((attempt) => attempt.used_verified_identity_context),
      expectedApplicability,
    );
  }

  const controlRequests = requestsByArm["text-only"];
  const treatmentRequests = requestsByArm["original-image"];
  assert.equal(controlRequests.length, 5);
  assert.equal(treatmentRequests.length, 5);
  for (let index = 0; index < 5; index += 1) {
    const controlRequest = controlRequests[index]!;
    const treatmentRequest = treatmentRequests[index]!;
    const treatmentInput = treatmentRequest.input as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    assert.equal(treatmentInput.length, 1);
    assert.equal(treatmentInput[0]!.content.length, 2);
    const treatmentText = treatmentInput[0]!.content[0]!.text;
    assert.equal(treatmentText, controlRequest.input);
    assert.deepEqual(
      { ...treatmentRequest, input: treatmentText },
      controlRequest,
    );
    const text = String(controlRequest.input);
    if (index < 3) {
      assert.match(text, /VERIFIED IDENTITY CONTEXT/);
    } else {
      assert.doesNotMatch(text, /VERIFIED IDENTITY CONTEXT/);
      assert.match(text, /IDENTITY VERIFICATION STATUS: verified/);
    }
  }
});

test("mutable replay retains all identity-dependent candidate applicability", () => {
  const mutablePlan = createDiscoveryResearchImageAccessExperimentPlan(
    fiveCandidateReplayInput("discovery-engine-v1"),
    { imageAccess: "text-only", repeat: 1 },
  );
  assert.deepEqual(
    mutablePlan.candidates.map((item) => item.usedVerifiedIdentityContext),
    [true, true, true, true, true],
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
    terra.map((item) => ({
      ...item,
      request: { ...item.request, model: null },
    })),
    luna.map((item) => ({
      ...item,
      request: { ...item.request, model: null },
    })),
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
  assert.ok(Math.abs(output.total_model_token_cost_usd! - 0.0000928) < 1e-12);
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
        response(String(request.model), "ANSWERED: Unsupported result.", {
          title: "Unsafe",
          url: "javascript:alert(1)",
        }),
    },
  } as unknown as Parameters<typeof executeDiscoveryResearchReplay>[0];
  const output = await executeDiscoveryResearchReplay(
    client,
    createDiscoveryResearchReplayPlan(parsed(), DISCOVERY_STAGE2_MODEL),
  );
  assert.equal(output.answered_count, 0);
  assert.equal(output.insufficient_count, 2);
  assert.equal(
    output.candidates.every(
      (candidate) => candidate.validated_sources.length === 0,
    ),
    true,
  );
});

const replayImage = {
  dataUrl: "data:image/png;base64,iVBORw0KGgo=",
  mimeType: "image/png" as const,
  sha256: "image-sha256",
  byteLength: 8,
};

test("original-image treatment changes only the Responses input image", () => {
  const plan = createDiscoveryResearchReplayPlan(
    parsed(),
    DISCOVERY_LUNA_RESEARCH_MODEL,
  );
  for (const built of candidateResearchRequestsForPlan(plan)) {
    const treatment = addOriginalImageToCandidateResearchRequest(
      built.request,
      replayImage.dataUrl,
    );
    assertOriginalImageIsOnlyRequestDifference(built.request, treatment);
    assert.equal(built.request.model, DISCOVERY_LUNA_RESEARCH_MODEL);
    assert.equal(built.request.reasoning.effort, DISCOVERY_REASONING_EFFORT);
    assert.equal(typeof built.request.input, "string");
    const input = treatment.input as unknown as Array<{
      content: Array<Record<string, unknown>>;
    }>;
    assert.deepEqual(input[0]!.content[0], {
      type: "input_text",
      text: built.request.input,
    });
    assert.deepEqual(input[0]!.content[1], {
      type: "input_image",
      image_url: replayImage.dataUrl,
      detail: DISCOVERY_RESEARCH_IMAGE_DETAIL,
    });
    const normalizedTreatment = { ...treatment, input: built.request.input };
    assert.deepEqual(normalizedTreatment, built.request);
  }
});

test("image-access planning fails closed for missing image and invalid repeats", () => {
  assert.throws(
    () =>
      createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
        imageAccess: "original-image",
        repeat: 1,
      }),
    /--image is required/,
  );
  assert.throws(
    () =>
      createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
        imageAccess: "text-only",
        repeat: 0,
      }),
    /positive integer/,
  );
  assert.throws(
    () =>
      createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
        imageAccess: "text-only",
        repeat: 1,
        imagePath: "/tmp/not-allowed.png",
      }),
    /not accepted/,
  );
});

test("repeat=3 preserves independent arm attempts and computes aggregates", async () => {
  const requestsByArm: Record<string, Array<Record<string, unknown>>> = {
    "text-only": [],
    "original-image": [],
  };
  const makeClient = (arm: "text-only" | "original-image") =>
    ({
      responses: {
        create: async (request: Record<string, unknown>) => {
          requestsByArm[arm].push(request);
          const candidateOne = JSON.stringify(request.input).includes(
            "CANDIDATE ID: c1",
          );
          return candidateOne
            ? response(
                String(request.model),
                "ANSWERED: A validated repeat finding.",
                { title: "Repeat", url: "https://example.com/repeat" },
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
    }) as unknown as Parameters<
      typeof executeDiscoveryResearchImageAccessExperiment
    >[0];

  const textPlan = createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
    imageAccess: "text-only",
    repeat: 3,
  });
  const imagePlan = createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
    imageAccess: "original-image",
    repeat: 3,
    imagePath: "/tmp/explicit.png",
  });
  const control = await executeDiscoveryResearchImageAccessExperiment(
    makeClient("text-only"),
    textPlan,
    null,
  );
  const treatment = await executeDiscoveryResearchImageAccessExperiment(
    makeClient("original-image"),
    imagePlan,
    replayImage,
  );

  for (const output of [control, treatment]) {
    assert.equal(output.attempts.length, 6);
    assert.deepEqual(
      output.attempts.map((attempt) => attempt.repeat_index),
      [1, 1, 2, 2, 3, 3],
    );
    assert.equal(output.aggregate.total_candidate_attempts, 6);
    assert.equal(output.aggregate.answered_count, 3);
    assert.equal(output.aggregate.insufficient_count, 3);
    assert.equal(output.aggregate.answered_rate, 0.5);
    assert.equal(output.aggregate.source_validation_failures, 0);
    assert.ok(output.aggregate.mean_latency_ms! >= 0);
    assert.equal(output.aggregate.median_tool_cost_usd, 0.015);
  }
  assert.equal(
    requestsByArm["text-only"].every(
      (request) => typeof request.input === "string",
    ),
    true,
  );
  assert.equal(
    requestsByArm["original-image"].every((request) =>
      Array.isArray(request.input),
    ),
    true,
  );
  assert.equal(
    control.experiment_fingerprint,
    treatment.experiment_fingerprint,
  );
  assert.equal(treatment.image?.sha256, replayImage.sha256);
  assert.doesNotMatch(JSON.stringify(treatment), /base64|iVBORw0KGgo=/);
});

test("treatment retains production source validation and rejects arbitrary URLs", async () => {
  let calls = 0;
  const client = {
    responses: {
      create: async (request: Record<string, unknown>) => {
        calls += 1;
        return response(
          String(request.model),
          "ANSWERED: Unsupported image-assisted result.",
          { title: "Unsafe", url: "javascript:alert(1)" },
        );
      },
    },
  } as unknown as Parameters<
    typeof executeDiscoveryResearchImageAccessExperiment
  >[0];
  const output = await executeDiscoveryResearchImageAccessExperiment(
    client,
    createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
      imageAccess: "original-image",
      repeat: 1,
      imagePath: "/tmp/explicit.png",
    }),
    replayImage,
  );
  assert.equal(calls, 2);
  assert.equal(output.aggregate.answered_count, 0);
  assert.equal(output.aggregate.source_validation_failures, 2);
  assert.equal(
    output.attempts.every(
      (attempt) =>
        attempt.status === "insufficient" &&
        attempt.validated_sources.length === 0,
    ),
    true,
  );
});

test("missing treatment image fails before any model call", async () => {
  let calls = 0;
  const client = {
    responses: {
      create: async () => {
        calls += 1;
        throw new Error("must not run");
      },
    },
  } as unknown as Parameters<
    typeof executeDiscoveryResearchImageAccessExperiment
  >[0];
  await assert.rejects(
    executeDiscoveryResearchImageAccessExperiment(
      client,
      createDiscoveryResearchImageAccessExperimentPlan(parsed(), {
        imageAccess: "original-image",
        repeat: 1,
        imagePath: "/tmp/explicit.png",
      }),
      null,
    ),
    /requires a validated image/,
  );
  assert.equal(calls, 0);
});

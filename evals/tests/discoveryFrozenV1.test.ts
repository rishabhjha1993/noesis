import { createHash } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  DISCOVERY_STAGE1_JSON_SCHEMA,
  DISCOVERY_STAGE3_JSON_SCHEMA,
  type DiscoveryIdentityVerification,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_CACHE_CONTRACT_REVISION,
  computeDiscoveryCacheKey,
} from "../../artifacts/api-server/src/lib/discoveryCache";
import {
  FROZEN_V1_CACHE_REVISION,
  FROZEN_V1_ENGINE_VERSION,
  FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
  FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA,
  FROZEN_V1_REASONING_EFFORT,
  FROZEN_V1_RESEARCH_INSTRUCTIONS,
  FROZEN_V1_SOURCE_COMMIT,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE1_PROMPT,
  FROZEN_V1_STAGE2_MODEL,
  FROZEN_V1_STAGE3_MODEL,
  FROZEN_V1_STAGE3_PROMPT,
  buildFrozenV1ResearchRequest,
} from "../../artifacts/api-server/src/lib/discoveryFrozenV1";
import {
  DISCOVERY_LUNA_RESEARCH_MODEL,
  DiscoveryPipelineError,
  discoveryEngineVersionForVariant,
  discoveryModelAllocationForVariant,
  isDiscoveryEngineVariant,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import {
  DISCOVERY_ENGINE_OPTIONS,
  DISCOVERY_ENGINE_VARIANTS,
} from "../../lib/api-client-react/src/discovery";

const electronicsStage1: DiscoveryStage1 = {
  image_summary: "An electronics assembly with four distinct visible details.",
  regions: [
    {
      id: "r1",
      description: "The electronics assembly and its visible components",
      scope: "global",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ],
  candidates: Array.from({ length: 4 }, (_, index) => ({
    id: `c${index + 1}`,
    question_id: `q${index + 1}`,
    visual_trigger: `A distinct labeled electronics feature ${index + 1} is visible.`,
    observation: `Feature ${index + 1} has a specific arrangement within the assembly.`,
    region_ids: ["r1"],
    investigation_question: `What function does visible feature ${index + 1} serve here?`,
    research_needed: true,
    research_rationale:
      "External documentation could explain the function of this exact visible feature.",
    identity_context_needed: true,
  })),
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "A possible electronics assembly",
      identity_type: "object",
      visible_evidence: ["Four arranged components and labels are visible."],
      observed_labels_or_numbers: ["VISIBLE-LABEL"],
      region_ids: ["r1"],
      confidence: 0.5,
      verification_would_help: true,
      relevant_question_ids: ["q1", "q2", "q3", "q4"],
    },
  ],
};

interface CapturedRequest {
  model?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
  instructions?: unknown;
  input?: unknown;
  text?: unknown;
  messages?: Array<{ role?: unknown; content?: unknown }>;
}

function responseUsage() {
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
  };
}

function responseOutput(model: string, text: string) {
  return {
    model,
    output_text: text,
    output: [
      {
        id: "search-1",
        type: "web_search_call",
        status: "completed",
        action: { type: "search", queries: ["fixture query"] },
      },
      {
        type: "message",
        content: [{ type: "output_text", text, annotations: [] }],
      },
    ],
    usage: responseUsage(),
  };
}

function chatOutput(content: unknown) {
  return {
    model: FROZEN_V1_STAGE1_MODEL,
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens: 20,
      completion_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    },
  };
}

function unverifiedIdentity() {
  return {
    status: "unverified",
    hypothesis_id: "ih1",
    canonical_identity: null,
    identity_type: null,
    location: null,
    verification_basis: "Available evidence establishes only a broad category.",
    confidence: 0.2,
    match_evidence: [
      {
        basis: "generic_visual_similarity",
        detail: "Many electronics assemblies share this broad arrangement.",
      },
    ],
  };
}

function fakePipelineClient(
  stage1: unknown,
  responseRequests: CapturedRequest[],
  chatRequests: CapturedRequest[],
) {
  let chatCall = 0;
  return {
    chat: {
      completions: {
        create: async (request: CapturedRequest) => {
          chatRequests.push(request);
          chatCall += 1;
          return chatCall === 1
            ? chatOutput(stage1)
            : chatOutput({ discoveries: [] });
        },
      },
    },
    responses: {
      create: async (request: CapturedRequest) => {
        responseRequests.push(request);
        if (request.text) {
          return responseOutput(
            String(request.model),
            JSON.stringify(unverifiedIdentity()),
          );
        }
        return responseOutput(
          String(request.model),
          "INSUFFICIENT: Exact identity is required for a reliable answer.",
        );
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

function fingerprint(value: string | object): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

test("frozen V1 prompt and schema fingerprints match 3a0bca12 exactly", () => {
  assert.equal(
    FROZEN_V1_SOURCE_COMMIT,
    "3a0bca12ff5a3c63de5f6d2442ccd5f51a8627e2",
  );
  assert.deepEqual(
    [
      fingerprint(FROZEN_V1_STAGE1_PROMPT),
      fingerprint(FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS),
      fingerprint(FROZEN_V1_RESEARCH_INSTRUCTIONS),
      fingerprint(FROZEN_V1_STAGE3_PROMPT),
      fingerprint(FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA),
      fingerprint(DISCOVERY_STAGE1_JSON_SCHEMA),
      fingerprint(DISCOVERY_STAGE3_JSON_SCHEMA),
    ],
    [
      "050e00ac1ba7ec8eacb51d0cd048b4ffee3b86a3711b169d58e64dd039a83101",
      "46ac06550d37e719d54130e2de63119e6b9ad322b826ba629c12203609f256ad",
      "74f457370d955e9cbbea9b72dbc1c903bc8d828fe7e0bad5e3da942fd3f377db",
      "8113525ae03f94758c2128b1cfc9cdfb6c2240ab33ffd7f45bde454bf0e427f8",
      "a2f15b7353e96c80e550fb1a00b47ac03e430cf8241149c96576dc1217f1cd08",
      "9e480e86ccd08855c80665eb5558e68a59713dbf931173ace1a213a67d88dd1a",
      "3db3ee8752517f025c224ab825a01be3956a71be2ee2ad67daba5a37d7ed184c",
    ],
  );
  assert.doesNotMatch(FROZEN_V1_STAGE1_PROMPT, /discriminative clues/i);
  assert.doesNotMatch(FROZEN_V1_STAGE1_PROMPT, /combine multiple independent/i);
  assert.doesNotMatch(
    FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
    /identity-resolution|tentative leads|refine, reject, or replace/i,
  );
  assert.match(
    FROZEN_V1_RESEARCH_INSTRUCTIONS,
    /prefer INSUFFICIENT over a plausible unsupported match/,
  );
});

test("frozen V1 allocation, cache, and lab identity are explicit and isolated", () => {
  assert.deepEqual(discoveryModelAllocationForVariant("v1-frozen"), {
    stage1: FROZEN_V1_STAGE1_MODEL,
    identityVerification: FROZEN_V1_STAGE2_MODEL,
    candidateResearch: FROZEN_V1_STAGE2_MODEL,
    stage3: FROZEN_V1_STAGE3_MODEL,
  });
  assert.equal(FROZEN_V1_REASONING_EFFORT, "medium");
  assert.equal(
    discoveryEngineVersionForVariant("v1-frozen"),
    FROZEN_V1_ENGINE_VERSION,
  );
  assert.equal(isDiscoveryEngineVariant("v1-frozen"), true);
  assert.deepEqual(
    DISCOVERY_ENGINE_OPTIONS.map((option) => option.value),
    DISCOVERY_ENGINE_VARIANTS,
  );
  assert.equal(
    DISCOVERY_ENGINE_OPTIONS.find((option) => option.value === "v1-frozen")
      ?.label,
    "V1 frozen baseline",
  );
  assert.match(
    DISCOVERY_ENGINE_OPTIONS.find((option) => option.value === "v1")?.label ??
      "",
    /experimental/i,
  );
  assert.equal(
    DISCOVERY_ENGINE_OPTIONS.find(
      (option) => option.value === "v1-luna-research",
    )?.label,
    "V1 Luna candidate research (C1)",
  );

  const frozenKey = computeDiscoveryCacheKey(
    "data:image/png;base64,YWJj",
    FROZEN_V1_ENGINE_VERSION,
  ).cacheKey;
  assert.match(frozenKey, new RegExp(FROZEN_V1_CACHE_REVISION));
  assert.doesNotMatch(frozenKey, new RegExp(DISCOVERY_CACHE_CONTRACT_REVISION));
  for (const variant of [
    "v1",
    "v1-batched-research",
    "v1-luna-research",
  ] as const) {
    assert.notEqual(
      frozenKey,
      computeDiscoveryCacheKey(
        "data:image/png;base64,YWJj",
        discoveryEngineVersionForVariant(variant),
      ).cacheKey,
    );
  }
});

test("frozen V1 researches every gated electronics candidate when identity is unverified", async () => {
  const frozenResponses: CapturedRequest[] = [];
  const frozenChats: CapturedRequest[] = [];
  const currentResponses: CapturedRequest[] = [];
  const currentChats: CapturedRequest[] = [];

  const frozen = await runDiscoveryPipeline(
    fakePipelineClient(electronicsStage1, frozenResponses, frozenChats),
    "data:image/png;base64,YWJj",
    { variant: "v1-frozen" },
  );
  const current = await runDiscoveryPipeline(
    fakePipelineClient(electronicsStage1, currentResponses, currentChats),
    "data:image/png;base64,YWJj",
    { variant: "v1" },
  );

  assert.equal(frozen.version, FROZEN_V1_ENGINE_VERSION);
  assert.equal(
    frozenResponses.length,
    5,
    "one identity plus four Terra research calls",
  );
  assert.deepEqual(
    frozenResponses.map((request) => request.model),
    Array(5).fill(FROZEN_V1_STAGE2_MODEL),
  );
  assert.ok(
    frozenResponses
      .slice(1)
      .every((request) =>
        String(request.input).includes(
          "No verified identity context is available. Do not treat a hypothesis or similar object as the uploaded subject.",
        ),
      ),
  );
  assert.ok(
    frozenResponses
      .slice(1)
      .every(
        (request) => request.instructions === FROZEN_V1_RESEARCH_INSTRUCTIONS,
      ),
  );
  assert.equal(frozen.metrics.stage2.candidate_research_api_calls, 4);
  assert.equal(frozen.metrics.stage2.calls.length, 4);
  assert.equal(
    frozen.metrics.stage2.candidate_research_calls_avoided_by_identity_gate,
    undefined,
  );
  assert.equal(frozen.inspection.stage1_reconciliation, undefined);
  assert.deepEqual(
    frozenChats.map((request) => [request.model, request.reasoning_effort]),
    [
      [FROZEN_V1_STAGE1_MODEL, FROZEN_V1_REASONING_EFFORT],
      [FROZEN_V1_STAGE3_MODEL, FROZEN_V1_REASONING_EFFORT],
    ],
  );
  assert.equal(frozenChats[0]?.messages?.[0]?.content, FROZEN_V1_STAGE1_PROMPT);
  assert.equal(frozenChats[1]?.messages?.[0]?.content, FROZEN_V1_STAGE3_PROMPT);
  assert.match(
    String(frozenResponses[0]?.input),
    /STAGE 1 IDENTITY HYPOTHESES:/,
  );
  assert.doesNotMatch(
    String(frozenResponses[0]?.input),
    /STAGE 1 IDENTITY EVIDENCE PACKET|tentative_leads_not_verified_facts/,
  );
  assert.match(
    String(frozenChats[1]?.messages?.[1]?.content),
    /"status":"insufficient"/,
  );

  assert.equal(
    currentResponses.length,
    1,
    "current resolver runs but all four research calls are gated",
  );
  assert.equal(current.metrics.stage2.candidate_research_api_calls, 0);
  assert.equal(
    current.metrics.stage2.candidate_research_calls_avoided_by_identity_gate,
    4,
  );
  assert.deepEqual(current.metrics.stage2.identity_blocked_candidate_ids, [
    "c1",
    "c2",
    "c3",
    "c4",
  ]);
  assert.match(
    String(currentResponses[0]?.input),
    /STAGE 1 IDENTITY EVIDENCE PACKET/,
  );
  assert.ok(
    currentChats[0]?.messages?.[0]?.content !== FROZEN_V1_STAGE1_PROMPT,
    "the current experimental Stage-1 prompt remains separate",
  );
});

test("frozen V1 keeps historical hypothesis-scoped identity applicability", () => {
  const stage1 = structuredClone(electronicsStage1);
  stage1.identity_hypotheses[0]!.relevant_question_ids = ["q1"];
  const verified: DiscoveryIdentityVerification = {
    status: "verified",
    hypothesis_id: "ih1",
    canonical_identity: "Exact electronics assembly",
    identity_type: "object",
    location: null,
    verification_basis:
      "An authoritative source identifies the exact assembly.",
    confidence: 0.95,
    match_evidence: [
      {
        basis: "source_explicit_identification",
        detail: "The source explicitly identifies the exact assembly.",
      },
    ],
    sources: [{ title: "Identity source", url: "https://example.com/id" }],
  };

  const relevant = buildFrozenV1ResearchRequest(
    stage1,
    stage1.candidates[0]!,
    verified,
  );
  const unrelated = buildFrozenV1ResearchRequest(
    stage1,
    stage1.candidates[1]!,
    verified,
  );
  assert.equal(relevant.usedVerifiedIdentityContext, true);
  assert.match(String(relevant.request.input), /VERIFIED IDENTITY CONTEXT/);
  assert.equal(unrelated.usedVerifiedIdentityContext, false);
  assert.match(
    String(unrelated.request.input),
    /No verified identity context is available/,
  );
  assert.equal(relevant.request.model, FROZEN_V1_STAGE2_MODEL);
  assert.notEqual(relevant.request.model, DISCOVERY_LUNA_RESEARCH_MODEL);
});

test("frozen V1 rejects dangling Stage-1 references without reconciliation", async () => {
  const dangling = structuredClone(electronicsStage1);
  dangling.candidates[0]!.region_ids = ["missing-region"];
  const responseRequests: CapturedRequest[] = [];
  const chatRequests: CapturedRequest[] = [];

  await assert.rejects(
    () =>
      runDiscoveryPipeline(
        fakePipelineClient(dangling, responseRequests, chatRequests),
        "data:image/png;base64,YWJj",
        { variant: "v1-frozen" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "stage1");
      assert.equal(error.diagnostic.stage1_reconciliation, undefined);
      return true;
    },
  );
  assert.equal(chatRequests.length, 1);
  assert.equal(responseRequests.length, 0);
});

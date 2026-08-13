import test from "node:test";
import assert from "node:assert/strict";
import type { DiscoveryStage1 } from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_CACHE_CONTRACT_REVISION,
  computeDiscoveryCacheKey,
} from "../../artifacts/api-server/src/lib/discoveryCache";
import {
  DEFAULT_DISCOVERY_ENGINE_VARIANT,
  DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION,
  DISCOVERY_LUNA_RESEARCH_MODEL,
  DISCOVERY_REASONING_EFFORT,
  DISCOVERY_STAGE1_MODEL,
  DISCOVERY_STAGE2_MODEL,
  DISCOVERY_STAGE3_MODEL,
  DiscoveryPipelineError,
  discoveryModelAllocationForVariant,
  isDiscoveryEngineVariant,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { estimateModelCost } from "../../artifacts/api-server/src/lib/modelPricing";
import { createDiscoveryEvalPayload } from "../../artifacts/noesis/src/lib/discoveryEval";
import {
  DISCOVERY_ENGINE_OPTIONS,
  DISCOVERY_ENGINE_VARIANTS,
} from "../../lib/api-client-react/src/discovery";

const stage1: DiscoveryStage1 = {
  image_summary: "A visual with three grounded features.",
  regions: [
    {
      id: "r1",
      description: "Three visible features",
      scope: "global",
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
      visual_trigger: "A labeled feature is visible.",
      observation: "The label is adjacent to the feature.",
      region_ids: ["r1"],
      investigation_question: "What does the visible labeled feature indicate?",
      research_needed: true,
      research_rationale: "A source could explain the visible label.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "A second feature is visible.",
      observation: "It contrasts with the labeled feature.",
      region_ids: ["r1"],
      investigation_question: "Why does the second visible feature contrast?",
      research_needed: true,
      research_rationale: "A source could explain the visible contrast.",
      identity_context_needed: false,
    },
    {
      id: "c3",
      question_id: "q3",
      visual_trigger: "A third feature is visible.",
      observation: "It repeats across the visual.",
      region_ids: ["r1"],
      investigation_question: "Why does the third visible feature repeat?",
      research_needed: true,
      research_rationale: "A source could explain the visible repetition.",
      identity_context_needed: false,
    },
    {
      id: "c4",
      question_id: "q4",
      visual_trigger: "A fourth grounded feature is visible.",
      observation: "Its meaning is already evident from the visual.",
      region_ids: ["r1"],
      investigation_question: "What is directly visible in the fourth feature?",
      research_needed: false,
      research_rationale: "",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "A possible subject",
      identity_type: "other",
      visible_evidence: ["A label is visible."],
      observed_labels_or_numbers: ["VISIBLE LABEL"],
      region_ids: ["r1"],
      confidence: 0.55,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ],
};

interface CapturedRequest {
  model?: string;
  reasoning?: unknown;
  tools?: unknown;
  tool_choice?: unknown;
  include?: unknown;
  store?: unknown;
  max_output_tokens?: unknown;
  text?: unknown;
  instructions?: unknown;
  input?: unknown;
  messages?: unknown;
  reasoning_effort?: unknown;
  max_completion_tokens?: unknown;
  response_format?: unknown;
}

function usage() {
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
  };
}

function responsesOutput(
  model: string,
  text: string,
  citation?: { title: string; url: string },
  webSearchCalls = 1,
) {
  return {
    model,
    output_text: text,
    output: [
      ...Array.from({ length: webSearchCalls }, (_, index) => ({
        id: `search-${index}`,
        type: "web_search_call",
        status: "completed",
        action: { type: "search", queries: [`query-${index}`] },
      })),
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text,
            annotations: citation
              ? [
                  {
                    type: "url_citation",
                    ...citation,
                    start_index: 0,
                    end_index: Math.min(10, text.length),
                  },
                ]
              : [],
          },
        ],
      },
    ],
    usage: usage(),
  };
}

function chatOutput(content: unknown) {
  return {
    model: DISCOVERY_STAGE1_MODEL,
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

function candidateId(input: unknown): string {
  const match = String(input).match(/CANDIDATE ID: (c\d+)/);
  assert.ok(match, "candidate research must preserve the candidate id");
  return match[1]!;
}

function fakeClient(
  responseRequests: CapturedRequest[],
  chatRequests: CapturedRequest[],
  options: { failFirstCandidate?: boolean } = {},
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
        const model = String(request.model);
        if (request.text) {
          return responsesOutput(
            model,
            JSON.stringify({
              status: "unverified",
              hypothesis_id: "ih1",
              canonical_identity: null,
              identity_type: null,
              location: null,
              verification_basis: "The exact identity was not established.",
              confidence: 0.2,
              match_evidence: [
                {
                  basis: "generic_visual_similarity",
                  detail: "The visible evidence is not unique.",
                },
              ],
            }),
          );
        }
        if (options.failFirstCandidate) {
          throw Object.assign(new Error("provider failed"), {
            name: "APIError",
            status: 500,
          });
        }
        const id = candidateId(request.input);
        if (id === "c1") {
          return responsesOutput(
            model,
            "ANSWERED: A candidate-local cited finding.",
            { title: "Candidate one", url: "https://example.com/c1" },
            2,
          );
        }
        if (id === "c2") {
          return responsesOutput(
            model,
            "ANSWERED: An uncited claim mentioning https://example.com/c2.",
          );
        }
        return responsesOutput(
          model,
          "ANSWERED: A finding with an unsafe citation.",
          { title: "Unsafe", url: "javascript:alert(1)" },
        );
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

function withoutModel(request: CapturedRequest): CapturedRequest {
  const { model: _model, ...rest } = request;
  return rest;
}

test("C1 allocation substitutes Luna only for candidate research", () => {
  assert.deepEqual(discoveryModelAllocationForVariant("v1"), {
    stage1: DISCOVERY_STAGE1_MODEL,
    identityVerification: DISCOVERY_STAGE2_MODEL,
    candidateResearch: DISCOVERY_STAGE2_MODEL,
    stage3: DISCOVERY_STAGE3_MODEL,
  });
  assert.deepEqual(discoveryModelAllocationForVariant("v1-luna-research"), {
    stage1: DISCOVERY_STAGE1_MODEL,
    identityVerification: DISCOVERY_STAGE2_MODEL,
    candidateResearch: DISCOVERY_LUNA_RESEARCH_MODEL,
    stage3: DISCOVERY_STAGE3_MODEL,
  });
  assert.equal(
    discoveryModelAllocationForVariant("v1-batched-research").candidateResearch,
    DISCOVERY_STAGE2_MODEL,
  );
  assert.equal(DEFAULT_DISCOVERY_ENGINE_VARIANT, "v1");
});

test("lab selector exposes C1 explicitly without changing the default", () => {
  assert.deepEqual(DISCOVERY_ENGINE_VARIANTS, [
    "v1",
    "v1-batched-research",
    "v1-luna-research",
  ]);
  assert.deepEqual(
    DISCOVERY_ENGINE_OPTIONS.map((option) => option.value),
    DISCOVERY_ENGINE_VARIANTS,
  );
  assert.match(
    DISCOVERY_ENGINE_OPTIONS.find(
      (option) => option.value === "v1-luna-research",
    )?.label ?? "",
    /Luna candidate research \(C1\)/,
  );
  assert.equal(isDiscoveryEngineVariant("v1-luna-research"), true);
  assert.equal(isDiscoveryEngineVariant("v1"), true);
  assert.equal(isDiscoveryEngineVariant("v1-batched-research"), true);
  assert.equal(isDiscoveryEngineVariant("unknown"), false);
});

test("C1 preserves baseline candidate requests and source integrity", async () => {
  const baselineResponses: CapturedRequest[] = [];
  const baselineChats: CapturedRequest[] = [];
  const lunaResponses: CapturedRequest[] = [];
  const lunaChats: CapturedRequest[] = [];

  const baseline = await runDiscoveryPipeline(
    fakeClient(baselineResponses, baselineChats),
    "data:image/png;base64,YWJj",
  );
  const luna = await runDiscoveryPipeline(
    fakeClient(lunaResponses, lunaChats),
    "data:image/png;base64,YWJj",
    { variant: "v1-luna-research" },
  );

  assert.deepEqual(
    baselineResponses.map(withoutModel),
    lunaResponses.map(withoutModel),
    "prompts, question payloads, tools, limits, and schemas must be identical",
  );
  assert.deepEqual(baselineChats, lunaChats);
  assert.deepEqual(
    lunaChats.map((request) => [request.model, request.reasoning_effort]),
    [
      [DISCOVERY_STAGE1_MODEL, DISCOVERY_REASONING_EFFORT],
      [DISCOVERY_STAGE3_MODEL, DISCOVERY_REASONING_EFFORT],
    ],
  );
  assert.deepEqual(
    baselineResponses.map((request) => request.model),
    Array(4).fill(DISCOVERY_STAGE2_MODEL),
  );
  assert.deepEqual(
    lunaResponses.map((request) => request.model),
    [
      DISCOVERY_STAGE2_MODEL,
      DISCOVERY_LUNA_RESEARCH_MODEL,
      DISCOVERY_LUNA_RESEARCH_MODEL,
      DISCOVERY_LUNA_RESEARCH_MODEL,
    ],
  );
  assert.ok(
    lunaResponses.every(
      (request) =>
        request.reasoning === undefined ||
        JSON.stringify(request.reasoning) ===
          JSON.stringify({ effort: DISCOVERY_REASONING_EFFORT }),
    ),
  );
  assert.equal(luna.metrics.stage2.model, DISCOVERY_LUNA_RESEARCH_MODEL);
  assert.equal(luna.metrics.stage1.usage.model, DISCOVERY_STAGE1_MODEL);
  assert.equal(luna.metrics.stage3.usage.model, DISCOVERY_STAGE3_MODEL);
  assert.equal(
    luna.metrics.stage2.candidate_research_model,
    DISCOVERY_LUNA_RESEARCH_MODEL,
  );
  assert.equal(
    luna.metrics.stage2.identity_verification.usage?.model,
    DISCOVERY_STAGE2_MODEL,
  );
  assert.deepEqual(
    luna.metrics.stage2.calls.map((call) => call.usage.model),
    Array(3).fill(DISCOVERY_LUNA_RESEARCH_MODEL),
  );
  assert.deepEqual(
    luna.inspection.research_results.map((result) => result.status),
    ["answered", "insufficient", "insufficient"],
  );
  assert.deepEqual(luna.inspection.research_results[0]?.sources, [
    { title: "Candidate one", url: "https://example.com/c1" },
  ]);
  assert.deepEqual(luna.inspection.research_results[1]?.sources, []);
  assert.deepEqual(luna.inspection.research_results[2]?.sources, []);
  for (const [index, candidate] of stage1.candidates
    .filter((candidate) => candidate.research_needed)
    .entries()) {
    assert.equal(
      luna.inspection.research_results[index]?.question,
      candidate.investigation_question,
    );
  }
  assert.equal(luna.metrics.stage2.candidate_research_api_calls, 3);
  assert.equal(luna.metrics.research_gate_passed, 3);
  assert.equal(baseline.metrics.research_gate_passed, 3);
  assert.equal(luna.metrics.stage1_candidates, 4);
  assert.equal(luna.metrics.stage2.calls[0]?.model_token_cost_usd, 0.000044);
  assert.equal(luna.metrics.stage2.calls[0]?.web_search_calls, 2);
  assert.equal(luna.metrics.stage2.calls[0]?.tool_cost_usd, 0.02);
  assert.equal(luna.metrics.stage2.calls[0]?.total_known_cost_usd, 0.020044);
  assert.equal(luna.metrics.stage2.web_search_calls, 5);
  assert.equal(luna.metrics.stage2.model_token_cost_usd, 0.000572);
  assert.equal(luna.metrics.stage2.tool_cost_usd, 0.05);
  assert.ok(
    Math.abs(luna.metrics.stage2.total_known_cost_usd! - 0.050572) < 1e-12,
  );
  assert.ok(Math.abs(luna.metrics.stage2.cost_usd! - 0.050572) < 1e-12);
  assert.equal(luna.metrics.web_search_calls, 5);
  assert.equal(luna.metrics.model_token_cost_usd, 0.002772);
  assert.equal(luna.metrics.tool_cost_usd, 0.05);
  assert.ok(Math.abs(luna.metrics.total_known_cost_usd! - 0.052772) < 1e-12);
  assert.ok(Math.abs(luna.metrics.total_cost_usd! - 0.052772) < 1e-12);
  assert.equal(luna.metrics.stage2.batch, null);
  assert.deepEqual(luna.discoveries, baseline.discoveries);
  assert.equal(luna.version, DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION);
  const stage3Input = JSON.stringify(lunaChats[1]);
  assert.match(stage3Input, /A candidate-local cited finding/);
  assert.doesNotMatch(stage3Input, /uncited claim|unsafe citation/);

  const evalPayload = createDiscoveryEvalPayload({
    result: luna,
    discoveryId: "mock-c1-run",
    cacheHit: false,
  });
  assert.deepEqual(
    evalPayload.metrics.stage2.calls.map((call) => call.usage.model),
    Array(3).fill(DISCOVERY_LUNA_RESEARCH_MODEL),
  );
  assert.equal(evalPayload.metrics.web_search_calls, 5);
  assert.equal(evalPayload.metrics.tool_cost_usd, 0.05);
  assert.ok(
    Math.abs(evalPayload.metrics.total_known_cost_usd! - 0.052772) < 1e-12,
  );
  assert.doesNotMatch(
    JSON.stringify(evalPayload),
    /reasoning_tokens|raw_usage/,
  );
});

test("C1 has isolated cache identity and baseline/batched identities are unchanged", () => {
  const image = "data:image/png;base64,YWJj";
  const baseline = computeDiscoveryCacheKey(image).cacheKey;
  const batched = computeDiscoveryCacheKey(
    image,
    DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  ).cacheKey;
  const luna = computeDiscoveryCacheKey(
    image,
    DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION,
  ).cacheKey;
  assert.match(baseline, new RegExp(`^${DISCOVERY_ENGINE_VERSION}:`));
  assert.match(
    batched,
    new RegExp(`^${DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION}:`),
  );
  assert.match(luna, new RegExp(`^${DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION}:`));
  assert.match(baseline, new RegExp(`:${DISCOVERY_CACHE_CONTRACT_REVISION}:`));
  assert.notEqual(
    baseline,
    `${DISCOVERY_ENGINE_VERSION}:${computeDiscoveryCacheKey(image).imageHash}`,
  );
  assert.equal(new Set([baseline, batched, luna]).size, 3);
});

test("C1 provider failures surface without Terra fallback or hidden retry", async () => {
  const responses: CapturedRequest[] = [];
  await assert.rejects(
    runDiscoveryPipeline(
      fakeClient(responses, [], { failFirstCandidate: true }),
      "data:image/png;base64,YWJj",
      { variant: "v1-luna-research" },
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(
        error.diagnostic.engine_version,
        DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION,
      );
      assert.equal(error.diagnostic.failed_stage, "research");
      assert.equal(error.diagnostic.category, "api_error");
      assert.equal(
        error.diagnostic.partial_metrics.research.attempted_calls,
        1,
      );
      assert.equal(
        error.diagnostic.partial_metrics.research.known_usage?.model,
        DISCOVERY_STAGE2_MODEL,
      );
      assert.equal(
        error.diagnostic.partial_metrics.research.known_web_search_calls,
        1,
      );
      assert.equal(
        error.diagnostic.partial_metrics.research.known_model_token_cost_usd,
        0.00044,
      );
      assert.equal(
        error.diagnostic.partial_metrics.research.known_tool_cost_usd,
        0.01,
      );
      assert.equal(
        error.diagnostic.partial_metrics.research.known_total_cost_usd,
        0.01044,
      );
      return true;
    },
  );
  assert.deepEqual(
    responses.map((request) => request.model),
    [DISCOVERY_STAGE2_MODEL, DISCOVERY_LUNA_RESEARCH_MODEL],
  );
});

test("same-token cost comparison uses observed tokens, not a quality prediction", () => {
  const retainedTokens = {
    input_tokens: 100,
    cached_input_tokens: 0,
    output_tokens: 20,
  };
  const terra = estimateModelCost({
    model: DISCOVERY_STAGE2_MODEL,
    ...retainedTokens,
  }).usd;
  const luna = estimateModelCost({
    model: DISCOVERY_LUNA_RESEARCH_MODEL,
    ...retainedTokens,
  }).usd;
  assert.equal(terra, 0.00044);
  assert.equal(luna, 0.000044);
  assert.ok(Math.abs(luna! / terra! - 0.1) < Number.EPSILON);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  DISCOVERY_STAGE1_JSON_SCHEMA,
  DISCOVERY_STAGE3_JSON_SCHEMA,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DEEPSEEK_API_BASE_URL,
  DEEPSEEK_IDENTITY_SEMANTIC_REPAIR_INSTRUCTIONS,
  DEEPSEEK_V1_CACHE_REVISION,
  DEEPSEEK_V1_EFFECTIVE_REASONING_EFFORT,
  DEEPSEEK_V1_ENGINE_VERSION,
  DEEPSEEK_V1_MODEL,
  DEEPSEEK_V1_REASONING_EFFORT,
  DeepSeekDiscoveryError,
  buildDeepSeekV1IdentityRequest,
  buildDeepSeekV1ResearchRequest,
  buildDeepSeekV1Stage3Request,
  createDeepSeekResponse,
  parseDeepSeekStructuredOutput,
} from "../../artifacts/api-server/src/lib/discoveryDeepSeekV1";
import {
  FROZEN_V1_ENGINE_VERSION,
  FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
  FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA,
  FROZEN_V1_RESEARCH_INSTRUCTIONS,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE1_PROMPT,
  FROZEN_V1_STAGE3_PROMPT,
  buildFrozenV1IdentityInput,
  buildFrozenV1ResearchRequest,
} from "../../artifacts/api-server/src/lib/discoveryFrozenV1";
import {
  DiscoveryPipelineError,
  discoveryEngineVersionForVariant,
  discoveryModelAllocationForVariant,
  isDiscoveryEngineVariant,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { computeDiscoveryCacheKey } from "../../artifacts/api-server/src/lib/discoveryCache";
import { estimateModelCost } from "../../artifacts/api-server/src/lib/modelPricing";
import {
  DISCOVERY_ENGINE_OPTIONS,
  DISCOVERY_ENGINE_VARIANTS,
} from "../../lib/api-client-react/src/discovery";

const stage1: DiscoveryStage1 = {
  image_summary: "A structured landscape with two visible anomalies.",
  regions: [
    {
      id: "r1",
      description: "The complete structured landscape",
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
      visual_trigger: "A circular feature interrupts the rectilinear pattern.",
      observation: "The circle is visibly isolated beside a channel.",
      region_ids: ["r1"],
      investigation_question: "What is the circular feature?",
      research_needed: true,
      research_rationale: "Exact context could explain the visible anomaly.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "Two field grids meet at an abrupt visible angle.",
      observation: "The grid orientations differ across a straight boundary.",
      region_ids: ["r1"],
      investigation_question: "Why do the field grids change orientation?",
      research_needed: true,
      research_rationale: "External evidence could explain the boundary.",
      identity_context_needed: true,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "A specific engineered landscape",
      identity_type: "place",
      visible_evidence: ["A circular feature and rectilinear field system."],
      observed_labels_or_numbers: [],
      region_ids: ["r1"],
      confidence: 0.7,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ],
};

const verifiedIdentity = {
  status: "verified" as const,
  hypothesis_id: "ih1",
  canonical_identity: "Exact engineered landscape",
  identity_type: "place" as const,
  location: "Example region",
  verification_basis:
    "An authoritative source identifies the exact geographic configuration.",
  confidence: 0.95,
  match_evidence: [
    {
      basis: "geographic_configuration" as const,
      detail: "The authoritative map matches the exact visible configuration.",
    },
  ],
};

interface CapturedRequest {
  model?: unknown;
  reasoning?: unknown;
  reasoning_effort?: unknown;
  instructions?: unknown;
  input?: unknown;
  tools?: unknown;
  text?: { format?: { name?: unknown; schema?: unknown } };
  messages?: Array<{ role?: unknown; content?: unknown }>;
}

function responseUsage() {
  return {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
    output_tokens: 40,
    output_tokens_details: { reasoning_tokens: 10 },
    total_tokens: 140,
  };
}

function deepSeekResponse(
  outputText: string,
  options: { search?: boolean; sourceUrl?: string; searchStatus?: string } = {},
) {
  const annotations = options.sourceUrl
    ? [
        {
          type: "url_citation",
          title: "Trusted hosted-search source",
          url: options.sourceUrl,
          start_index: 0,
          end_index: 10,
        },
      ]
    : [];
  return {
    model: DEEPSEEK_V1_MODEL,
    output_text: outputText,
    output: [
      ...(options.search
        ? [
            {
              id: "search-1",
              type: "web_search_call",
              status: options.searchStatus ?? "completed",
              action: { type: "search", queries: ["fixture query"] },
            },
          ]
        : []),
      {
        type: "message",
        content: [{ type: "output_text", text: outputText, annotations }],
      },
    ],
    usage: responseUsage(),
  };
}

function solStage1Response(content: unknown) {
  return {
    model: FROZEN_V1_STAGE1_MODEL,
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 8 },
      total_tokens: 130,
    },
  };
}

function finalDiscovery(sourceUrl = "https://example.com/research-c1") {
  return {
    discoveries: [
      {
        id: "d1",
        type: "local",
        title: "The circle is functional infrastructure",
        visual_trigger: "The isolated circular feature beside the channel.",
        observation: "It interrupts the rectilinear field pattern.",
        discovery: "Research identifies a specific infrastructure function.",
        why_it_matters: "The anomaly is part of the engineered system.",
        explanation: "The researched function explains its unusual geometry.",
        reinterpretation: "Look back at the circle as working infrastructure.",
        region_ids: ["r1"],
        candidate_ids: ["c1"],
        provenance: "researched",
        confidence: 0.9,
        sources: [{ title: "Trusted hosted-search source", url: sourceUrl }],
      },
    ],
  };
}

function solClient(requests: CapturedRequest[]) {
  return {
    chat: {
      completions: {
        create: async (request: CapturedRequest) => {
          requests.push(request);
          assert.equal(requests.length, 1, "Sol must run only Stage 1");
          return solStage1Response(stage1);
        },
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

function successfulDeepSeekClient(requests: CapturedRequest[]) {
  return {
    responses: {
      create: async (request: CapturedRequest) => {
        requests.push(request);
        const formatName = request.text?.format?.name;
        if (formatName === "noesis_discovery_identity_verification") {
          return deepSeekResponse(JSON.stringify(verifiedIdentity), {
            search: true,
            sourceUrl: "https://example.com/identity",
          });
        }
        if (formatName === "noesis_discovery_stage3") {
          return deepSeekResponse(JSON.stringify(finalDiscovery()));
        }
        const candidateId = String(request.input).match(
          /CANDIDATE ID: (c\d)/,
        )?.[1];
        return deepSeekResponse(
          `ANSWERED: Supported answer for ${candidateId}.`,
          {
            search: true,
            sourceUrl: `https://example.com/research-${candidateId}`,
          },
        );
      },
    },
  } as unknown as NonNullable<
    Parameters<typeof runDiscoveryPipeline>[2]
  >["deepseekClient"];
}

function unresolvedIdentity(
  status: "unverified" | "conflicted",
  withCanonicalIdentity = false,
) {
  return {
    status,
    hypothesis_id: "ih1",
    canonical_identity: withCanonicalIdentity
      ? "Tentative engineered landscape"
      : null,
    identity_type: withCanonicalIdentity ? ("place" as const) : null,
    location: withCanonicalIdentity ? "Tentative region" : null,
    verification_basis:
      status === "unverified"
        ? "The exact place could not be verified."
        : "Trustworthy sources support conflicting exact identities.",
    confidence: status === "unverified" ? 0.2 : 0.4,
    match_evidence: [
      {
        basis: "generic_visual_similarity" as const,
        detail: "Several landscapes share this generic configuration.",
      },
    ],
  };
}

async function runDeepSeekIdentityScenario(
  initialIdentity: unknown,
  repairedIdentity?: unknown,
) {
  const requests: CapturedRequest[] = [];
  const client = {
    responses: {
      create: async (request: CapturedRequest) => {
        requests.push(request);
        const formatName = request.text?.format?.name;
        if (formatName === "noesis_discovery_identity_verification") {
          return deepSeekResponse(JSON.stringify(initialIdentity), {
            search: true,
            sourceUrl: "https://example.com/identity",
          });
        }
        if (formatName === "noesis_discovery_identity_semantic_repair") {
          return deepSeekResponse(JSON.stringify(repairedIdentity));
        }
        if (formatName === "noesis_discovery_stage3") {
          return deepSeekResponse(JSON.stringify({ discoveries: [] }));
        }
        return deepSeekResponse(
          "INSUFFICIENT: Exact identity is unavailable.",
          {
            search: true,
          },
        );
      },
    },
  } as unknown as NonNullable<
    Parameters<typeof runDiscoveryPipeline>[2]
  >["deepseekClient"];
  const result = await runDiscoveryPipeline(
    solClient([]),
    "data:image/png;base64,YWJj",
    { variant: "v1-deepseek-pro", deepseekClient: client },
  );
  return { requests, result };
}

test("DeepSeek challenger allocation, identity, cache, and lab option are isolated", () => {
  assert.equal(DEEPSEEK_API_BASE_URL, "https://api.deepseek.com");
  assert.equal(DEEPSEEK_V1_REASONING_EFFORT, "medium");
  assert.equal(DEEPSEEK_V1_EFFECTIVE_REASONING_EFFORT, "high");
  assert.deepEqual(discoveryModelAllocationForVariant("v1-deepseek-pro"), {
    stage1: FROZEN_V1_STAGE1_MODEL,
    identityVerification: DEEPSEEK_V1_MODEL,
    candidateResearch: DEEPSEEK_V1_MODEL,
    stage3: DEEPSEEK_V1_MODEL,
  });
  assert.equal(
    discoveryEngineVersionForVariant("v1-deepseek-pro"),
    DEEPSEEK_V1_ENGINE_VERSION,
  );
  assert.equal(isDiscoveryEngineVariant("v1-deepseek-pro"), true);
  assert.deepEqual(
    DISCOVERY_ENGINE_OPTIONS.map((option) => option.value),
    DISCOVERY_ENGINE_VARIANTS,
  );
  assert.match(
    DISCOVERY_ENGINE_OPTIONS.find(
      (option) => option.value === "v1-deepseek-pro",
    )?.label ?? "",
    /DeepSeek Pro.*experimental/i,
  );

  const image = "data:image/png;base64,YWJj";
  const challengerKey = computeDiscoveryCacheKey(
    image,
    DEEPSEEK_V1_ENGINE_VERSION,
  ).cacheKey;
  assert.match(challengerKey, new RegExp(DEEPSEEK_V1_CACHE_REVISION));
  assert.notEqual(
    challengerKey,
    computeDiscoveryCacheKey(image, FROZEN_V1_ENGINE_VERSION).cacheKey,
  );
});

test("DeepSeek transport reuses frozen packets, instructions, schemas, and applicability", () => {
  const gated = stage1.candidates;
  const identity = buildDeepSeekV1IdentityRequest(stage1, gated)!;
  const frozenIdentity = buildFrozenV1IdentityInput(stage1, gated)!;
  assert.equal(identity.model, DEEPSEEK_V1_MODEL);
  assert.equal(identity.input, frozenIdentity.input);
  assert.equal(
    identity.instructions,
    FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
  );
  assert.deepEqual(
    (identity.text as { format: unknown }).format,
    FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA,
  );
  assert.deepEqual(identity.reasoning, { effort: "medium" });

  const first = buildDeepSeekV1ResearchRequest(stage1, stage1.candidates[0]!, {
    ...verifiedIdentity,
    sources: [],
  });
  const second = buildDeepSeekV1ResearchRequest(stage1, stage1.candidates[1]!, {
    ...verifiedIdentity,
    sources: [],
  });
  const frozenFirst = buildFrozenV1ResearchRequest(
    stage1,
    stage1.candidates[0]!,
    { ...verifiedIdentity, sources: [] },
  );
  assert.equal(first.request.instructions, FROZEN_V1_RESEARCH_INSTRUCTIONS);
  assert.equal(first.request.input, frozenFirst.request.input);
  assert.deepEqual(first.request.tools, frozenFirst.request.tools);
  assert.deepEqual(first.request.reasoning, { effort: "medium" });
  assert.equal(first.usedVerifiedIdentityContext, true);
  assert.equal(second.usedVerifiedIdentityContext, false);
  assert.match(String(first.request.input), /VERIFIED IDENTITY CONTEXT/);
  assert.match(
    String(second.request.input),
    /No verified identity context is available/,
  );

  const stage3Request = buildDeepSeekV1Stage3Request(stage1, [], {
    ...verifiedIdentity,
    sources: [],
  });
  assert.equal(stage3Request.instructions, FROZEN_V1_STAGE3_PROMPT);
  assert.equal(stage3Request.tools, undefined);
  assert.doesNotMatch(String(stage3Request.input), /data:image|input_image/);
  assert.deepEqual(
    (stage3Request.text as { format: { schema: unknown } }).format.schema,
    DISCOVERY_STAGE3_JSON_SCHEMA.schema,
  );
  assert.deepEqual(
    DISCOVERY_STAGE1_JSON_SCHEMA.name,
    "noesis_discovery_stage1",
  );
  assert.equal(FROZEN_V1_STAGE1_PROMPT.includes("SEE → QUESTION"), true);
});

test("mocked end-to-end challenger is Sol then DeepSeek identity, per-candidate research, and Stage 3", async () => {
  const solRequests: CapturedRequest[] = [];
  const deepSeekRequests: CapturedRequest[] = [];
  const result = await runDiscoveryPipeline(
    solClient(solRequests),
    "data:image/png;base64,YWJj",
    {
      variant: "v1-deepseek-pro",
      deepseekClient: successfulDeepSeekClient(deepSeekRequests),
    },
  );

  assert.equal(result.version, DEEPSEEK_V1_ENGINE_VERSION);
  assert.equal(solRequests.length, 1);
  assert.equal(solRequests[0]?.model, FROZEN_V1_STAGE1_MODEL);
  assert.equal(solRequests[0]?.messages?.[0]?.content, FROZEN_V1_STAGE1_PROMPT);
  assert.equal(deepSeekRequests.length, 4);
  assert.ok(
    deepSeekRequests.every((request) => request.model === DEEPSEEK_V1_MODEL),
  );
  assert.equal(
    deepSeekRequests.filter((request) => request.tools !== undefined).length,
    3,
  );
  assert.equal(result.metrics.stage1.usage.provider, "openai");
  assert.equal(
    result.metrics.stage2.identity_verification.usage?.provider,
    "deepseek",
  );
  assert.ok(
    result.metrics.stage2.calls.every(
      (call) => call.usage.provider === "deepseek",
    ),
  );
  assert.equal(result.metrics.stage3.usage.provider, "deepseek");
  assert.equal(result.metrics.stage2.candidate_research_api_calls, 2);
  assert.deepEqual(
    result.metrics.stage2.calls.map(
      (call) => call.used_verified_identity_context,
    ),
    [true, false],
  );
  assert.equal(result.discoveries.length, 1);
  assert.equal(result.metrics.stage2.tool_cost_usd, null);
  assert.equal(
    result.metrics.total_known_cost_usd,
    result.metrics.model_token_cost_usd,
  );
  assert.ok((result.metrics.stage3.model_token_cost_usd ?? 0) > 0);
  assert.equal(
    result.metrics.stage2.identity_verification.semantic_repair_attempted,
    undefined,
  );
});

test("valid verified, unverified, and conflicted DeepSeek identities do not repair", async () => {
  for (const identity of [
    verifiedIdentity,
    unresolvedIdentity("unverified"),
    unresolvedIdentity("conflicted"),
  ]) {
    const { requests, result } = await runDeepSeekIdentityScenario(identity);
    assert.equal(
      requests.filter(
        (request) =>
          request.text?.format?.name ===
          "noesis_discovery_identity_semantic_repair",
      ).length,
      0,
    );
    assert.equal(
      result.metrics.stage2.identity_verification.semantic_repair_attempted,
      undefined,
    );
    assert.equal(
      result.inspection.identity_verification?.status,
      identity.status,
    );
  }
});

test("unverified and conflicted canonical contradictions receive one narrow semantic repair", async () => {
  for (const status of ["unverified", "conflicted"] as const) {
    const initial = unresolvedIdentity(status, true);
    const repaired = {
      ...initial,
      canonical_identity: null,
      identity_type: null,
      location: null,
    };
    const { requests, result } = await runDeepSeekIdentityScenario(
      initial,
      repaired,
    );
    const repairs = requests.filter(
      (request) =>
        request.text?.format?.name ===
        "noesis_discovery_identity_semantic_repair",
    );
    assert.equal(repairs.length, 1);
    assert.equal(repairs[0]?.tools, undefined);
    assert.equal(
      repairs[0]?.instructions,
      DEEPSEEK_IDENTITY_SEMANTIC_REPAIR_INSTRUCTIONS,
    );
    assert.deepEqual(repairs[0]?.text?.format?.schema, {
      ...FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA.schema,
      properties: {
        ...FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA.schema.properties,
        status: { type: "string", enum: [status] },
        canonical_identity: { type: "null" },
        identity_type: { type: "null" },
        location: { type: "null" },
      },
    });
    assert.equal(result.inspection.identity_verification?.status, status);
    assert.equal(
      result.inspection.identity_verification?.canonical_identity,
      null,
    );
    assert.equal(result.inspection.identity_verification?.identity_type, null);
    assert.equal(result.inspection.identity_verification?.location, null);
    assert.deepEqual(result.inspection.identity_verification?.sources, [
      {
        title: "Trusted hosted-search source",
        url: "https://example.com/identity",
      },
    ]);
    const identityMetrics = result.metrics.stage2.identity_verification;
    assert.equal(identityMetrics.semantic_repair_attempted, true);
    assert.equal(identityMetrics.semantic_repair_succeeded, true);
    assert.equal(identityMetrics.usage?.input_tokens, 200);
    assert.equal(identityMetrics.usage?.output_tokens, 80);
    assert.equal(identityMetrics.usage?.total_tokens, 280);
    assert.equal(identityMetrics.web_search_calls, 1);
    assert.equal(identityMetrics.tool_cost_usd, null);
    assert.ok((identityMetrics.model_token_cost_usd ?? 0) > 0);
    assert.equal(
      identityMetrics.total_known_cost_usd,
      identityMetrics.model_token_cost_usd,
    );
  }
});

test("DeepSeek identity repair cannot promote status or rewrite substantive evidence", async () => {
  const initial = unresolvedIdentity("unverified", true);
  for (const invalidRepair of [
    {
      ...initial,
      status: "verified",
    },
    {
      ...initial,
      canonical_identity: null,
      identity_type: null,
      location: null,
      verification_basis: "A different substantive conclusion was invented.",
    },
  ]) {
    await assert.rejects(
      () => runDeepSeekIdentityScenario(initial, invalidRepair),
      (error: unknown) => {
        assert.ok(error instanceof DiscoveryPipelineError);
        assert.equal(error.diagnostic.failed_stage, "identity_verification");
        assert.equal(error.diagnostic.category, "structured_output");
        assert.equal(
          error.diagnostic.partial_metrics.identity_verification
            ?.semantic_repair_attempted,
          true,
        );
        assert.equal(
          error.diagnostic.partial_metrics.identity_verification
            ?.semantic_repair_succeeded,
          false,
        );
        assert.doesNotMatch(
          JSON.stringify(error.diagnostic),
          /ORIGINAL FROZEN|PREVIOUS STRUCTURED|Tentative engineered landscape/,
        );
        return true;
      },
    );
  }
});

test("a still-contradictory repair fails after one attempt", async () => {
  const initial = unresolvedIdentity("conflicted", true);
  let calls = 0;
  await assert.rejects(
    async () => {
      const client = {
        responses: {
          create: async (request: CapturedRequest) => {
            calls += 1;
            if (
              request.text?.format?.name ===
              "noesis_discovery_identity_verification"
            ) {
              return deepSeekResponse(JSON.stringify(initial), {
                search: true,
              });
            }
            return deepSeekResponse(JSON.stringify(initial));
          },
        },
      } as unknown as NonNullable<
        Parameters<typeof runDiscoveryPipeline>[2]
      >["deepseekClient"];
      await runDiscoveryPipeline(solClient([]), "data:image/png;base64,YWJj", {
        variant: "v1-deepseek-pro",
        deepseekClient: client,
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "identity_verification");
      assert.equal(error.diagnostic.category, "structured_output");
      assert.equal(calls, 2);
      return true;
    },
  );
});

test("unrelated DeepSeek identity schema failures do not trigger semantic repair", async () => {
  for (const scenario of [
    {
      invalid: { ...unresolvedIdentity("unverified", true), confidence: 2 },
      expectedCategory: "schema_validation",
    },
    {
      invalid: {
        ...unresolvedIdentity("conflicted", true),
        hypothesis_id: "unknown-hypothesis",
      },
      expectedCategory: "internal_error",
    },
  ]) {
    let calls = 0;
    const client = {
      responses: {
        create: async () => {
          calls += 1;
          return deepSeekResponse(JSON.stringify(scenario.invalid), {
            search: true,
          });
        },
      },
    } as unknown as NonNullable<
      Parameters<typeof runDiscoveryPipeline>[2]
    >["deepseekClient"];
    await assert.rejects(
      () =>
        runDiscoveryPipeline(solClient([]), "data:image/png;base64,YWJj", {
          variant: "v1-deepseek-pro",
          deepseekClient: client,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DiscoveryPipelineError);
        assert.equal(error.diagnostic.category, scenario.expectedCategory);
        assert.equal(calls, 1);
        assert.equal(
          error.diagnostic.partial_metrics.identity_verification
            ?.semantic_repair_attempted,
          undefined,
        );
        return true;
      },
    );
  }
});

test("unresolved identity never suppresses frozen gated DeepSeek research", async () => {
  const solRequests: CapturedRequest[] = [];
  const deepSeekRequests: CapturedRequest[] = [];
  const unresolved = {
    status: "unverified",
    hypothesis_id: "ih1",
    canonical_identity: null,
    identity_type: null,
    location: null,
    verification_basis: "The exact place could not be verified.",
    confidence: 0.2,
    match_evidence: [
      {
        basis: "generic_visual_similarity",
        detail: "Several landscapes share this generic configuration.",
      },
    ],
  };
  const client = {
    responses: {
      create: async (request: CapturedRequest) => {
        deepSeekRequests.push(request);
        if (
          request.text?.format?.name ===
          "noesis_discovery_identity_verification"
        ) {
          return deepSeekResponse(JSON.stringify(unresolved), { search: true });
        }
        if (request.text?.format?.name === "noesis_discovery_stage3") {
          return deepSeekResponse(JSON.stringify({ discoveries: [] }));
        }
        return deepSeekResponse(
          "INSUFFICIENT: Exact identity is unavailable.",
          {
            search: true,
          },
        );
      },
    },
  } as unknown as NonNullable<
    Parameters<typeof runDiscoveryPipeline>[2]
  >["deepseekClient"];

  const result = await runDiscoveryPipeline(
    solClient(solRequests),
    "data:image/png;base64,YWJj",
    { variant: "v1-deepseek-pro", deepseekClient: client },
  );
  assert.equal(result.metrics.stage2.candidate_research_api_calls, 2);
  assert.equal(result.metrics.stage2.calls.length, 2);
  assert.equal(
    result.metrics.stage2.candidate_research_calls_avoided_by_identity_gate,
    undefined,
  );
  assert.ok(
    deepSeekRequests
      .filter((request) => request.text === undefined)
      .every((request) =>
        String(request.input).includes(
          "No verified identity context is available",
        ),
      ),
  );
});

test("model-typed URLs are never promoted without hosted-search citations", async () => {
  const noIdentity = structuredClone(stage1);
  noIdentity.identity_hypotheses = [];
  noIdentity.candidates = [
    { ...noIdentity.candidates[0]!, identity_context_needed: false },
  ];
  const solRequests: CapturedRequest[] = [];
  const requests: CapturedRequest[] = [];
  const client = {
    responses: {
      create: async (request: CapturedRequest) => {
        requests.push(request);
        if (request.text?.format?.name === "noesis_discovery_stage3") {
          return deepSeekResponse(JSON.stringify({ discoveries: [] }));
        }
        return deepSeekResponse(
          "ANSWERED: Claimed answer https://untrusted.example/fabricated",
          { search: true },
        );
      },
    },
  } as unknown as NonNullable<
    Parameters<typeof runDiscoveryPipeline>[2]
  >["deepseekClient"];
  const openai = {
    chat: {
      completions: {
        create: async (request: CapturedRequest) => {
          solRequests.push(request);
          return solStage1Response(noIdentity);
        },
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];

  const result = await runDiscoveryPipeline(
    openai,
    "data:image/png;base64,YWJj",
    { variant: "v1-deepseek-pro", deepseekClient: client },
  );
  assert.equal(result.inspection.research_results[0]?.status, "insufficient");
  assert.deepEqual(result.inspection.research_results[0]?.sources, []);
  assert.doesNotMatch(
    result.inspection.research_results[0]?.finding ?? "",
    /untrusted\.example/,
  );
});

test("DeepSeek structured and tool failures are safely categorized", async () => {
  assert.throws(
    () => parseDeepSeekStructuredOutput("{"),
    (error: unknown) =>
      error instanceof DeepSeekDiscoveryError &&
      error.category === "structured_output" &&
      !error.message.includes("{"),
  );

  await assert.rejects(
    () =>
      createDeepSeekResponse(
        {
          responses: {
            create: async () => deepSeekResponse("{}") as never,
          },
        } as never,
        { model: DEEPSEEK_V1_MODEL, input: "fixture" },
        true,
      ),
    (error: unknown) =>
      error instanceof DeepSeekDiscoveryError && error.category === "tool_call",
  );
  await assert.rejects(
    () =>
      createDeepSeekResponse(
        {
          responses: {
            create: async () =>
              deepSeekResponse("{}", {
                search: true,
                searchStatus: "failed",
              }) as never,
          },
        } as never,
        { model: DEEPSEEK_V1_MODEL, input: "fixture" },
        true,
      ),
    (error: unknown) =>
      error instanceof DeepSeekDiscoveryError &&
      error.category === "search_provider",
  );
});

test("malformed DeepSeek Stage 3 becomes a sanitized pipeline diagnostic", async () => {
  const requests: CapturedRequest[] = [];
  const client = successfulDeepSeekClient(requests)!;
  const originalCreate = client.responses.create.bind(client.responses);
  client.responses.create = (async (request: CapturedRequest) => {
    if (request.text?.format?.name === "noesis_discovery_stage3") {
      return deepSeekResponse("{");
    }
    return originalCreate(request as never);
  }) as typeof client.responses.create;

  await assert.rejects(
    () =>
      runDiscoveryPipeline(solClient([]), "data:image/png;base64,YWJj", {
        variant: "v1-deepseek-pro",
        deepseekClient: client,
      }),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "stage3");
      assert.equal(error.diagnostic.category, "structured_output");
      assert.doesNotMatch(error.diagnostic.message, /\{|prompt|api.?key/i);
      return true;
    },
  );
});

test("DeepSeek current token pricing separates cached and uncached input", () => {
  assert.deepEqual(
    estimateModelCost({
      model: DEEPSEEK_V1_MODEL,
      input_tokens: 1_000_000,
      cached_input_tokens: 200_000,
      output_tokens: 100_000,
    }),
    {
      usd: (800_000 * 0.435 + 200_000 * 0.003625 + 100_000 * 0.87) / 1e6,
      reason: null,
    },
  );
  assert.deepEqual(
    estimateModelCost({
      model: "unknown-deepseek-model",
      input_tokens: 1,
      cached_input_tokens: 0,
      output_tokens: 1,
    }),
    {
      usd: null,
      reason: "No pricing configured for unknown-deepseek-model",
    },
  );
});

import assert from "node:assert/strict";
import test from "node:test";
import type { DiscoveryStage1 } from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DEEPSEEK_V1_MODEL,
  type DeepSeekClient,
} from "../../artifacts/api-server/src/lib/discoveryDeepSeekV1";
import {
  V2_HYBRID_CACHE_REVISION,
  V2_HYBRID_ENGINE_VERSION,
  V2_HYBRID_FINAL_PROMPT,
  V2_HYBRID_IDENTITY_TIMEOUT_MS,
  V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
  buildV2HybridFinalRequest,
  createV2HybridIdentityRequestOptions,
} from "../../artifacts/api-server/src/lib/discoveryHybridV2";
import {
  DiscoveryPipelineError,
  discoveryEngineVersionForVariant,
  discoveryModelAllocationForVariant,
  isDiscoveryEngineVariant,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { computeDiscoveryCacheKey } from "../../artifacts/api-server/src/lib/discoveryCache";
import {
  FROZEN_V1_ENGINE_VERSION,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE1_PROMPT,
  FROZEN_V1_STAGE3_MODEL,
} from "../../artifacts/api-server/src/lib/discoveryFrozenV1";
import {
  DISCOVERY_ENGINE_OPTIONS,
  DISCOVERY_ENGINE_VARIANTS,
} from "../../lib/api-client-react/src/discovery";

const imageDataUrl = "data:image/png;base64,YWJj";

interface CapturedChatRequest {
  model?: unknown;
  reasoning_effort?: unknown;
  messages: Array<{ content?: unknown }>;
}

interface CapturedResponseRequest {
  model?: unknown;
  input?: unknown;
  text?: { format?: { name?: string } };
}

interface CapturedResponseOptions {
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal | null;
}

type IdentityMode =
  | "unverified"
  | "conflicted"
  | "verified"
  | "no_search"
  | "incomplete_search"
  | "timeout"
  | "malformed"
  | "repair_exhausted"
  | "authentication"
  | "provider_http";

const stage1: DiscoveryStage1 = {
  image_summary: "An engineered landscape with three visible anomalies.",
  regions: [
    {
      id: "r1",
      description: "The complete engineered landscape",
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
      visual_trigger: "A circular feature interrupts the field grid.",
      observation: "The circle is isolated beside a channel.",
      region_ids: ["r1"],
      investigation_question: "What function does the circular feature serve?",
      research_needed: true,
      research_rationale:
        "External evidence could explain the visible anomaly.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "A straight boundary divides two grid orientations.",
      observation: "The field axes change abruptly at the boundary.",
      region_ids: ["r1"],
      investigation_question: "Why do the field orientations change here?",
      research_needed: true,
      research_rationale:
        "Planning history could explain the visible boundary.",
      identity_context_needed: false,
    },
    {
      id: "c3",
      question_id: "q3",
      visual_trigger: "Routes visibly converge on a central settlement.",
      observation: "The convergence is more regular than nearby roads.",
      region_ids: ["r1"],
      investigation_question:
        "Was the radial route pattern deliberately planned?",
      research_needed: true,
      research_rationale: "Documented planning could reinterpret the geometry.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "A specific engineered landscape",
      identity_type: "place",
      visible_evidence: [
        "A circular feature inside a rectilinear field system.",
      ],
      observed_labels_or_numbers: [],
      region_ids: ["r1"],
      confidence: 0.6,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ],
};

const fiveCandidateStage1: DiscoveryStage1 = {
  ...stage1,
  image_summary: "An engineered landscape with five researchable features.",
  candidates: [
    ...stage1.candidates,
    {
      id: "c4",
      question_id: "q4",
      visual_trigger: "A geometric water-land boundary encloses the fields.",
      observation: "The boundary is straighter than the outer shoreline.",
      region_ids: ["r1"],
      investigation_question:
        "Is the visible boundary consistent with reclaimed-land engineering?",
      research_needed: true,
      research_rationale:
        "Engineering context could explain the visible water-land geometry.",
      identity_context_needed: true,
    },
    {
      id: "c5",
      question_id: "q5",
      visual_trigger: "Drainage lines repeat across the field blocks.",
      observation: "The lines form a coordinated landscape-scale system.",
      region_ids: ["r1"],
      investigation_question:
        "What general mechanism could produce this repeated drainage pattern?",
      research_needed: true,
      research_rationale:
        "External engineering evidence could reinterpret the repeated lines.",
      identity_context_needed: true,
    },
  ],
};

const unresolvedIdentity = {
  status: "unverified",
  hypothesis_id: "ih1",
  canonical_identity: null,
  identity_type: null,
  location: null,
  verification_basis: "The exact place could not be established safely.",
  confidence: 0.2,
  match_evidence: [
    {
      basis: "generic_visual_similarity",
      detail: "Several landscapes share this broad configuration.",
    },
  ],
};

const verifiedIdentity = {
  status: "verified" as const,
  hypothesis_id: "ih1",
  canonical_identity: "Exact engineered landscape",
  identity_type: "place" as const,
  location: "Example region",
  verification_basis: "An authoritative map identifies the configuration.",
  confidence: 0.95,
  match_evidence: [
    {
      basis: "geographic_configuration" as const,
      detail: "The mapped configuration matches the visible arrangement.",
    },
  ],
  sources: [{ title: "Identity source", url: "https://example.com/identity" }],
};

function chatResponse(content: unknown) {
  return {
    model: FROZEN_V1_STAGE1_MODEL,
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

function deepSeekResponse(
  outputText: string,
  options: {
    search?: boolean;
    searchStatus?: "completed" | "failed";
    sourceUrl?: string;
  } = {},
) {
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
              action: { type: "search", queries: ["fixture"] },
            },
          ]
        : []),
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: options.sourceUrl
              ? [
                  {
                    type: "url_citation",
                    title: `Source ${options.sourceUrl}`,
                    url: options.sourceUrl,
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
      output_tokens: 40,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 140,
    },
  };
}

function finalDiscovery(sourceUrl = "https://example.com/c1") {
  return {
    discoveries: [
      {
        id: "d1",
        type: "local",
        title: "The circle is functional infrastructure",
        visual_trigger: "The isolated circular feature beside the channel.",
        observation: "It interrupts the rectilinear field pattern.",
        discovery: "Validated research explains the feature's function.",
        why_it_matters: "The anomaly belongs to the engineered system.",
        explanation: "Its unusual geometry follows from that function.",
        reinterpretation: "Look back at the circle as working infrastructure.",
        region_ids: ["r1"],
        candidate_ids: ["c1"],
        provenance: "researched",
        confidence: 0.9,
        sources: [{ title: `Source ${sourceUrl}`, url: sourceUrl }],
      },
    ],
  };
}

function openAIClient(
  requests: CapturedChatRequest[],
  finalOutput: unknown = finalDiscovery(),
  stage1Output: DiscoveryStage1 = stage1,
) {
  return {
    chat: {
      completions: {
        create: async (request: CapturedChatRequest) => {
          requests.push(request);
          return chatResponse(
            requests.length === 1 ? stage1Output : finalOutput,
          );
        },
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

function deepSeekClient(
  requests: CapturedResponseRequest[],
  candidate2Mode: "no_search" | "uncited" | "malformed" = "no_search",
  concurrency?: { active: number; max: number },
  identityMode: IdentityMode = "unverified",
  requestOptions: CapturedResponseOptions[] = [],
) {
  return {
    responses: {
      create: async (
        request: CapturedResponseRequest,
        options?: CapturedResponseOptions,
      ) => {
        requests.push(request);
        requestOptions.push(options ?? {});
        const formatName = request.text?.format?.name;
        if (formatName === "noesis_discovery_identity_verification") {
          if (identityMode === "authentication") {
            throw Object.assign(new Error("invalid credential"), {
              status: 401,
            });
          }
          if (identityMode === "provider_http") {
            throw Object.assign(new Error("invalid provider configuration"), {
              status: 400,
            });
          }
          if (identityMode === "timeout") {
            throw Object.assign(new Error("Request was aborted."), {
              name: "APIUserAbortError",
            });
          }
          if (identityMode === "malformed") {
            return deepSeekResponse("not-json", { search: true });
          }
          if (identityMode === "no_search") {
            return deepSeekResponse(JSON.stringify(unresolvedIdentity));
          }
          if (identityMode === "incomplete_search") {
            return deepSeekResponse(JSON.stringify(unresolvedIdentity), {
              search: true,
              searchStatus: "failed",
            });
          }
          if (identityMode === "verified") {
            return deepSeekResponse(
              JSON.stringify({ ...verifiedIdentity, sources: undefined }),
              {
                search: true,
                sourceUrl: "https://example.com/identity",
              },
            );
          }
          if (identityMode === "conflicted") {
            return deepSeekResponse(
              JSON.stringify({
                ...unresolvedIdentity,
                status: "conflicted",
                verification_basis: "Sources did not resolve the identity.",
              }),
              { search: true },
            );
          }
          if (identityMode === "repair_exhausted") {
            return deepSeekResponse(
              JSON.stringify({
                ...unresolvedIdentity,
                canonical_identity: "Unsafe exact identity",
                identity_type: "place",
              }),
              { search: true },
            );
          }
          return deepSeekResponse(JSON.stringify(unresolvedIdentity), {
            search: true,
          });
        }
        if (formatName === "noesis_discovery_identity_semantic_repair") {
          return deepSeekResponse(
            JSON.stringify({
              ...unresolvedIdentity,
              canonical_identity: "Still unsafe exact identity",
              identity_type: "place",
            }),
          );
        }
        const candidateId = String(request.input).match(
          /CANDIDATE ID: (c\d)/,
        )?.[1];
        if (concurrency) {
          concurrency.active += 1;
          concurrency.max = Math.max(concurrency.max, concurrency.active);
          await new Promise((resolve) => setTimeout(resolve, 5));
          concurrency.active -= 1;
        }
        if (candidateId === "c2") {
          if (candidate2Mode === "no_search") {
            return deepSeekResponse(
              "ANSWERED: unsupported https://unsafe.example/private",
            );
          }
          if (candidate2Mode === "malformed") {
            return deepSeekResponse("Unscoped research prose", {
              search: true,
              sourceUrl: "https://example.com/unscoped",
            });
          }
          return deepSeekResponse("ANSWERED: uncited assertion", {
            search: true,
          });
        }
        return deepSeekResponse(`ANSWERED: supported ${candidateId}`, {
          search: true,
          sourceUrl: `https://example.com/${candidateId}`,
        });
      },
    },
  } as unknown as DeepSeekClient;
}

test("V2 Hybrid allocation, selector, and cache identity are isolated", () => {
  assert.equal(isDiscoveryEngineVariant("v2-hybrid"), true);
  assert.equal(
    discoveryEngineVersionForVariant("v2-hybrid"),
    V2_HYBRID_ENGINE_VERSION,
  );
  assert.deepEqual(discoveryModelAllocationForVariant("v2-hybrid"), {
    stage1: FROZEN_V1_STAGE1_MODEL,
    identityVerification: DEEPSEEK_V1_MODEL,
    candidateResearch: DEEPSEEK_V1_MODEL,
    stage3: FROZEN_V1_STAGE3_MODEL,
  });
  assert.deepEqual(
    DISCOVERY_ENGINE_OPTIONS.map((option) => option.value),
    DISCOVERY_ENGINE_VARIANTS,
  );
  assert.equal(
    DISCOVERY_ENGINE_OPTIONS.find((option) => option.value === "v2-hybrid")
      ?.label,
    "V2 Hybrid — production candidate",
  );
  const v2Key = computeDiscoveryCacheKey(
    imageDataUrl,
    V2_HYBRID_ENGINE_VERSION,
  ).cacheKey;
  assert.match(v2Key, new RegExp(V2_HYBRID_CACHE_REVISION));
  assert.notEqual(
    v2Key,
    computeDiscoveryCacheKey(imageDataUrl, FROZEN_V1_ENGINE_VERSION).cacheKey,
  );
});

test("V2 identity uses one shared 55-second no-retry deadline", async () => {
  const options = createV2HybridIdentityRequestOptions(5);
  assert.equal(V2_HYBRID_IDENTITY_TIMEOUT_MS, 55_000);
  assert.equal(options.timeout, 5);
  assert.equal(options.maxRetries, 0);
  assert.ok(options.signal);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(options.signal!.aborted, true);
});

test("real V2 identity search-provider failure degrades and all five candidates continue", async () => {
  const openAIRequests: CapturedChatRequest[] = [];
  const deepSeekRequests: CapturedResponseRequest[] = [];
  const requestOptions: CapturedResponseOptions[] = [];
  const concurrency = { active: 0, max: 0 };
  const result = await runDiscoveryPipeline(
    openAIClient(openAIRequests, finalDiscovery(), fiveCandidateStage1),
    imageDataUrl,
    {
      variant: "v2-hybrid",
      deepseekClient: deepSeekClient(
        deepSeekRequests,
        "no_search",
        concurrency,
        "incomplete_search",
        requestOptions,
      ),
    },
  );

  assert.equal(result.version, V2_HYBRID_ENGINE_VERSION);
  assert.equal(result.inspection.identity_verification, null);
  assert.deepEqual(
    {
      ran: result.metrics.stage2.identity_verification.ran,
      attempted: result.metrics.stage2.identity_verification.attempted,
      usable: result.metrics.stage2.identity_verification.usable,
      degraded: result.metrics.stage2.identity_verification.degraded,
      category: result.metrics.stage2.identity_verification.failure_category,
      status: result.metrics.stage2.identity_verification.status,
    },
    {
      ran: true,
      attempted: true,
      usable: false,
      degraded: true,
      category: "search_provider",
      status: "not_run",
    },
  );
  assert.ok(result.metrics.stage2.identity_verification.usage);
  assert.ok(
    (result.metrics.stage2.identity_verification.model_token_cost_usd ?? 0) > 0,
  );
  assert.equal(result.metrics.stage2.identity_verification.tool_cost_usd, null);

  assert.equal(deepSeekRequests.length, 6, "one identity plus five research");
  assert.equal(result.metrics.stage2.candidate_research_api_calls, 5);
  assert.equal(result.inspection.research_results.length, 5);
  assert.deepEqual(
    result.inspection.research_results.map((item) => [
      item.candidate_id,
      item.status,
    ]),
    [
      ["c1", "answered"],
      ["c2", "insufficient"],
      ["c3", "answered"],
      ["c4", "answered"],
      ["c5", "answered"],
    ],
  );
  assert.equal(concurrency.max, 3);
  assert.equal(result.metrics.stage2.research_max_concurrency, 3);

  assert.equal(requestOptions[0]?.timeout, V2_HYBRID_IDENTITY_TIMEOUT_MS);
  assert.equal(requestOptions[0]?.maxRetries, 0);
  assert.ok(requestOptions[0]?.signal);
  assert.ok(
    requestOptions.slice(1).every((options) => options.timeout === undefined),
    "candidate research timeout behavior must remain unchanged",
  );
  const c1Request = deepSeekRequests.find((request) =>
    String(request.input).includes("CANDIDATE ID: c1"),
  );
  assert.match(
    String(c1Request?.input),
    /IDENTITY VERIFICATION STATUS: not_run/,
  );
  assert.match(
    String(c1Request?.input),
    /No verified identity context is available/,
  );

  assert.equal(openAIRequests.length, 2);
  const finalRequest = JSON.stringify(openAIRequests[1]);
  assert.match(finalRequest, /image_url.*high/);
  assert.match(finalRequest, /supported c1/);
  assert.match(finalRequest, /safely marked insufficient/);
  assert.match(finalRequest, /IDENTITY VERIFICATION RESULT:\\nnull/);
  assert.doesNotMatch(
    finalRequest,
    /Exact engineered landscape|example\.com\/identity/,
  );
  assert.ok((result.metrics.total_known_cost_usd ?? 0) > 0);
  assert.equal(result.discoveries.length, 1);
});

test("V2 degrades bounded identity failures without losing known or unknown cost semantics", async () => {
  const cases: Array<{
    mode: IdentityMode;
    category: string;
    usageKnown: boolean;
  }> = [
    { mode: "no_search", category: "tool_call", usageKnown: true },
    { mode: "timeout", category: "timeout", usageKnown: false },
    {
      mode: "malformed",
      category: "structured_output",
      usageKnown: true,
    },
    {
      mode: "repair_exhausted",
      category: "structured_output",
      usageKnown: true,
    },
  ];

  for (const fixture of cases) {
    const requests: CapturedResponseRequest[] = [];
    const result = await runDiscoveryPipeline(openAIClient([]), imageDataUrl, {
      variant: "v2-hybrid",
      deepseekClient: deepSeekClient(
        requests,
        "no_search",
        undefined,
        fixture.mode,
      ),
    });
    const identity = result.metrics.stage2.identity_verification;
    assert.equal(identity.degraded, true, fixture.mode);
    assert.equal(identity.usable, false, fixture.mode);
    assert.equal(identity.failure_category, fixture.category, fixture.mode);
    assert.equal(result.inspection.identity_verification, null, fixture.mode);
    assert.equal(
      result.metrics.stage2.candidate_research_api_calls,
      3,
      fixture.mode,
    );
    assert.equal(result.discoveries.length, 1, fixture.mode);
    assert.equal(Boolean(identity.usage), fixture.usageKnown, fixture.mode);
    if (fixture.usageKnown) {
      assert.ok((identity.model_token_cost_usd ?? 0) > 0, fixture.mode);
    } else {
      assert.equal(identity.model_token_cost_usd, null, fixture.mode);
      assert.equal(identity.tool_cost_usd, null, fixture.mode);
      assert.equal(identity.total_known_cost_usd, null, fixture.mode);
      assert.ok(
        (result.metrics.total_known_cost_usd ?? 0) > 0,
        "known Sol/research subtotal must survive unknown identity cost",
      );
    }
    if (fixture.mode === "repair_exhausted") {
      assert.equal(identity.semantic_repair_attempted, true);
      assert.equal(identity.semantic_repair_succeeded, false);
      assert.equal(
        requests.filter(
          (request) =>
            request.text?.format?.name ===
            "noesis_discovery_identity_semantic_repair",
        ).length,
        1,
      );
    }
  }
});

test("valid unresolved and verified V2 identity results preserve established semantics", async () => {
  for (const mode of ["unverified", "conflicted", "verified"] as const) {
    const requests: CapturedResponseRequest[] = [];
    const result = await runDiscoveryPipeline(openAIClient([]), imageDataUrl, {
      variant: "v2-hybrid",
      deepseekClient: deepSeekClient(requests, "no_search", undefined, mode),
    });
    const identity = result.metrics.stage2.identity_verification;
    assert.equal(identity.degraded, false, mode);
    assert.equal(identity.usable, true, mode);
    assert.equal(identity.status, mode, mode);
    assert.equal(result.inspection.identity_verification?.status, mode, mode);
    const c1Request = requests.find((request) =>
      String(request.input).includes("CANDIDATE ID: c1"),
    );
    if (mode === "verified") {
      assert.match(String(c1Request?.input), /VERIFIED IDENTITY CONTEXT/);
      assert.match(String(c1Request?.input), /Exact engineered landscape/);
      assert.equal(
        result.metrics.stage2.candidate_calls_using_verified_identity,
        1,
      );
    } else {
      assert.match(
        String(c1Request?.input),
        new RegExp(`IDENTITY VERIFICATION STATUS: ${mode}`),
      );
      assert.equal(
        result.metrics.stage2.candidate_calls_using_verified_identity,
        0,
      );
    }
  }
});

test("V2 keeps authentication and global provider configuration failures fatal", async () => {
  for (const fixture of [
    { mode: "authentication", category: "authentication" },
    { mode: "provider_http", category: "provider_http" },
  ] as const) {
    const openAIRequests: CapturedChatRequest[] = [];
    const deepSeekRequests: CapturedResponseRequest[] = [];
    await assert.rejects(
      () =>
        runDiscoveryPipeline(openAIClient(openAIRequests), imageDataUrl, {
          variant: "v2-hybrid",
          deepseekClient: deepSeekClient(
            deepSeekRequests,
            "no_search",
            undefined,
            fixture.mode,
          ),
        }),
      (error: unknown) => {
        assert.ok(error instanceof DiscoveryPipelineError);
        assert.equal(error.diagnostic.failed_stage, "identity_verification");
        assert.equal(error.diagnostic.category, fixture.category);
        return true;
      },
    );
    assert.equal(openAIRequests.length, 1, fixture.mode);
    assert.equal(deepSeekRequests.length, 1, fixture.mode);
  }
});

test("V2 final Sol request is multimodal and carries only structured safe evidence", () => {
  const request = buildV2HybridFinalRequest(
    imageDataUrl,
    stage1,
    [
      {
        candidate_id: "c1",
        question_id: "q1",
        question: stage1.candidates[0]!.investigation_question,
        status: "answered",
        finding: "Validated finding",
        sources: [{ title: "C1", url: "https://example.com/c1" }],
      },
    ],
    verifiedIdentity,
  );
  assert.equal(request.model, FROZEN_V1_STAGE3_MODEL);
  assert.equal(request.reasoning_effort, "medium");
  assert.equal(request.messages[0]?.content, V2_HYBRID_FINAL_PROMPT);
  const content = request.messages[1]?.content;
  assert.ok(Array.isArray(content));
  assert.deepEqual(content?.[1], {
    type: "image_url",
    image_url: { url: imageDataUrl, detail: "high" },
  });
  const text = JSON.stringify(content?.[0]);
  assert.match(text, /Validated finding/);
  assert.match(text, /Exact engineered landscape/);
  assert.match(text, /applicable_candidate_ids/);
  assert.match(text, /c1/);
});

test("mixed V2 run survives candidate-local no-search failure and returns to the image", async () => {
  const openAIRequests: CapturedChatRequest[] = [];
  const deepSeekRequests: CapturedResponseRequest[] = [];
  const concurrency = { active: 0, max: 0 };
  const result = await runDiscoveryPipeline(
    openAIClient(openAIRequests),
    imageDataUrl,
    {
      variant: "v2-hybrid",
      deepseekClient: deepSeekClient(
        deepSeekRequests,
        "no_search",
        concurrency,
      ),
    },
  );

  assert.equal(result.version, V2_HYBRID_ENGINE_VERSION);
  assert.equal(openAIRequests.length, 2, "Sol must own Stage 1 and final only");
  assert.equal(openAIRequests[0]?.model, FROZEN_V1_STAGE1_MODEL);
  assert.equal(openAIRequests[0]?.reasoning_effort, "medium");
  assert.equal(
    openAIRequests[0]?.messages[0]?.content,
    FROZEN_V1_STAGE1_PROMPT,
  );
  assert.match(JSON.stringify(openAIRequests[0]), /image_url.*high/);
  assert.equal(openAIRequests[1]?.model, FROZEN_V1_STAGE3_MODEL);
  assert.equal(openAIRequests[1]?.reasoning_effort, "medium");
  assert.match(JSON.stringify(openAIRequests[1]), /image_url.*high/);
  assert.match(JSON.stringify(openAIRequests[1]), /supported c1/);
  assert.match(JSON.stringify(openAIRequests[1]), /supported c3/);
  assert.match(JSON.stringify(openAIRequests[1]), /safely marked insufficient/);
  assert.doesNotMatch(JSON.stringify(openAIRequests[1]), /unsafe\.example/);

  assert.equal(deepSeekRequests.length, 4);
  assert.ok(
    deepSeekRequests.every((request) => request.model === DEEPSEEK_V1_MODEL),
  );
  assert.equal(
    deepSeekRequests.filter(
      (request) =>
        request.text?.format?.name === "noesis_discovery_identity_verification",
    ).length,
    1,
  );
  assert.equal(result.inspection.identity_verification?.status, "unverified");
  assert.equal(result.metrics.stage2.candidate_research_api_calls, 3);
  assert.equal(result.metrics.stage2.answered_candidates, 2);
  assert.equal(result.metrics.stage2.insufficient_candidates, 1);
  assert.equal(result.metrics.stage2.candidate_local_failed_candidates, 1);
  assert.equal(
    result.metrics.stage2.candidate_local_failures?.[0]?.category,
    "tool_call",
  );
  assert.equal(
    result.inspection.research_results.find(
      (item) => item.candidate_id === "c2",
    )?.status,
    "insufficient",
  );
  assert.equal(result.metrics.stage2.calls.length, 3);
  assert.ok(
    (result.metrics.stage2.calls.find((call) => call.candidate_id === "c2")
      ?.model_token_cost_usd ?? 0) > 0,
  );
  assert.equal(result.metrics.stage2.tool_cost_usd, null);
  assert.ok((result.metrics.total_known_cost_usd ?? 0) > 0);
  assert.equal(
    result.metrics.stage2.research_max_concurrency,
    V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
  );
  assert.equal(concurrency.max, 3);
  assert.ok(concurrency.max <= V2_HYBRID_RESEARCH_MAX_CONCURRENCY);
  assert.ok((result.metrics.stage2.research_wall_clock_latency_ms ?? 0) >= 5);
  assert.equal(result.discoveries.length, 1);
  assert.equal(
    result.discoveries[0]?.sources[0]?.url,
    "https://example.com/c1",
  );
  assert.doesNotMatch(JSON.stringify(result), /unsafe\.example|private/);
});

test("candidate-local uncited answer does not abort or contaminate siblings", async () => {
  const result = await runDiscoveryPipeline(openAIClient([]), imageDataUrl, {
    variant: "v2-hybrid",
    deepseekClient: deepSeekClient([], "uncited"),
  });
  assert.deepEqual(
    result.inspection.research_results.map((item) => [
      item.candidate_id,
      item.status,
      item.sources.map((source) => source.url),
    ]),
    [
      ["c1", "answered", ["https://example.com/c1"]],
      ["c2", "insufficient", []],
      ["c3", "answered", ["https://example.com/c3"]],
    ],
  );
  assert.equal(
    result.metrics.stage2.candidate_local_failures?.[0]?.category,
    "source_validation",
  );
});

test("candidate-local malformed answer is discarded and safely diagnosed", async () => {
  const result = await runDiscoveryPipeline(openAIClient([]), imageDataUrl, {
    variant: "v2-hybrid",
    deepseekClient: deepSeekClient([], "malformed"),
  });
  const candidate = result.inspection.research_results.find(
    (item) => item.candidate_id === "c2",
  );
  assert.equal(candidate?.status, "insufficient");
  assert.deepEqual(candidate?.sources, []);
  assert.equal(
    result.metrics.stage2.candidate_local_failures?.[0]?.category,
    "malformed_model_output",
  );
  assert.doesNotMatch(JSON.stringify(result), /Unscoped research prose/);
});

test("V2 final validation rejects arbitrary Sol-typed sources", async () => {
  await assert.rejects(
    () =>
      runDiscoveryPipeline(
        openAIClient(
          [],
          finalDiscovery("https://untrusted.example/fabricated"),
        ),
        imageDataUrl,
        {
          variant: "v2-hybrid",
          deepseekClient: deepSeekClient([]),
        },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "validation");
      assert.equal(error.diagnostic.category, "source_validation");
      return true;
    },
  );
});

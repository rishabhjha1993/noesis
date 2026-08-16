import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscoveryStage1Schema,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  V2_HYBRID_CACHE_REVISION,
  V2_HYBRID_ENGINE_VERSION,
  V2_HYBRID_FINAL_PROMPT,
  V2_HYBRID_REASONING_EFFORT,
  V2_HYBRID_RESEARCH_INSTRUCTIONS,
  V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
  V2_HYBRID_RESEARCH_MODEL,
  V2_HYBRID_STAGE1_PROMPT,
  buildV2HybridFinalRequest,
  buildV2HybridResearchRequest,
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
  instructions?: unknown;
  reasoning?: { effort?: unknown };
  tools?: Array<{ type?: unknown; search_context_size?: unknown }>;
  tool_choice?: unknown;
  include?: unknown;
}

type CandidateMode =
  | "answered"
  | "insufficient"
  | "no_search"
  | "incomplete_search"
  | "uncited"
  | "malformed"
  | "api_error"
  | "identity_established"
  | "identity_unresolved"
  | "identity_contradicted";

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
      identity_context_needed: true,
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
      observed_labels_or_numbers: ["visible marker 1"],
      region_ids: ["r1"],
      confidence: 0.6,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
    {
      id: "ih2",
      proposed_identity: "An unrelated boundary identity",
      identity_type: "place",
      visible_evidence: ["The straight boundary."],
      observed_labels_or_numbers: [],
      region_ids: ["r1"],
      confidence: 0.4,
      verification_would_help: true,
      relevant_question_ids: ["q2"],
    },
    {
      id: "ih3",
      proposed_identity: "A disabled identity lead",
      identity_type: "place",
      visible_evidence: ["The circle."],
      observed_labels_or_numbers: [],
      region_ids: ["r1"],
      confidence: 0.2,
      verification_would_help: false,
      relevant_question_ids: [],
    },
  ],
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

function researchResponse(
  outputText: string,
  options: {
    search?: boolean;
    searchStatus?: "completed" | "failed";
    sourceUrl?: string;
  } = {},
) {
  return {
    model: V2_HYBRID_RESEARCH_MODEL,
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
      input_tokens_details: { cached_tokens: 20 },
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
        discovery:
          "Candidate-local research establishes the landscape identity and explains the feature's function.",
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

function openAIClient(options: {
  chatRequests?: CapturedChatRequest[];
  responseRequests?: CapturedResponseRequest[];
  finalOutput?: unknown;
  stage1Output?: DiscoveryStage1;
  candidateModes?: Partial<Record<string, CandidateMode>>;
  concurrency?: { active: number; max: number };
}) {
  const chatRequests = options.chatRequests ?? [];
  const responseRequests = options.responseRequests ?? [];
  const candidateModes = options.candidateModes ?? {};
  return {
    chat: {
      completions: {
        create: async (request: CapturedChatRequest) => {
          chatRequests.push(request);
          return chatResponse(
            String(request.model),
            chatRequests.length === 1
              ? (options.stage1Output ?? stage1)
              : (options.finalOutput ?? finalDiscovery()),
          );
        },
      },
    },
    responses: {
      create: async (request: CapturedResponseRequest) => {
        responseRequests.push(request);
        const candidateId = String(request.input).match(
          /CANDIDATE ID: (c\d)/,
        )?.[1];
        const mode = candidateModes[candidateId ?? ""] ?? "answered";
        if (mode === "api_error") {
          throw Object.assign(new Error("invalid OpenAI configuration"), {
            status: 401,
          });
        }
        if (options.concurrency) {
          options.concurrency.active += 1;
          options.concurrency.max = Math.max(
            options.concurrency.max,
            options.concurrency.active,
          );
          await new Promise((resolve) => setTimeout(resolve, 5));
          options.concurrency.active -= 1;
        }
        if (mode === "insufficient") {
          return researchResponse(
            "INSUFFICIENT: Trustworthy evidence did not establish the exact identity needed for this question.",
            { search: true },
          );
        }
        if (mode === "no_search") {
          return researchResponse(
            "ANSWERED: unsupported https://unsafe.example/private",
          );
        }
        if (mode === "incomplete_search") {
          return researchResponse("ANSWERED: incomplete search result", {
            search: true,
            searchStatus: "failed",
          });
        }
        if (mode === "uncited") {
          return researchResponse("ANSWERED: uncited assertion", {
            search: true,
          });
        }
        if (mode === "malformed") {
          return researchResponse("Unscoped research prose", {
            search: true,
            sourceUrl: "https://example.com/unscoped",
          });
        }
        if (mode === "identity_established") {
          return researchResponse(
            "ANSWERED: IDENTITY ESTABLISHED as A specific engineered landscape, confirmed because the visible marker matches an authoritative survey record for this exact site. Using that identity, the circular feature is the site's water-control basin.",
            { search: true, sourceUrl: "https://example.com/established" },
          );
        }
        if (mode === "identity_unresolved") {
          return researchResponse(
            "INSUFFICIENT: The exact identity remains UNRESOLVED; trustworthy sources did not connect the visible marker to the proposed landscape, and exact identity is necessary to answer safely.",
            { search: true },
          );
        }
        if (mode === "identity_contradicted") {
          return researchResponse(
            "ANSWERED: The proposed identity is CONTRADICTED by the visible marker's registry number, which matches a different, unrelated site. Without relying on that identity, the circular feature's general drainage function can still be safely described from generic engineering sources.",
            { search: true, sourceUrl: "https://example.com/contradicted" },
          );
        }
        const sourceUrl = `https://example.com/${candidateId}`;
        return researchResponse(
          `ANSWERED: Trustworthy evidence establishes A specific engineered landscape while answering ${candidateId}.`,
          { search: true, sourceUrl },
        );
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

test("V2 allocation, selector, and cache revision define the launch call graph", () => {
  assert.equal(isDiscoveryEngineVariant("v2-hybrid"), true);
  assert.equal(
    discoveryEngineVersionForVariant("v2-hybrid"),
    V2_HYBRID_ENGINE_VERSION,
  );
  assert.deepEqual(discoveryModelAllocationForVariant("v2-hybrid"), {
    stage1: FROZEN_V1_STAGE1_MODEL,
    identityVerification: "none",
    candidateResearch: V2_HYBRID_RESEARCH_MODEL,
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
  assert.equal(V2_HYBRID_CACHE_REVISION, "v2-hybrid-v4");
  const v2Key = computeDiscoveryCacheKey(
    imageDataUrl,
    V2_HYBRID_ENGINE_VERSION,
  ).cacheKey;
  assert.match(v2Key, /v2-hybrid-v4/);
  assert.doesNotMatch(v2Key, /v2-hybrid-v3/);
  assert.notEqual(
    v2Key,
    computeDiscoveryCacheKey(imageDataUrl, FROZEN_V1_ENGINE_VERSION).cacheKey,
  );
});

test("V2 Stage-1 prompt forks the frozen prompt only to raise identity-lead recall", () => {
  // The vision/region/candidate contract stays identical to the frozen reference.
  assert.match(V2_HYBRID_STAGE1_PROMPT, /SEE → QUESTION/);
  assert.match(V2_HYBRID_STAGE1_PROMPT, /identity_context_needed/);
  assert.match(
    V2_HYBRID_STAGE1_PROMPT,
    /Create highlightable regions with normalized coordinates/,
  );

  // Only the identity paragraph diverged from the immutable frozen prompt.
  assert.notEqual(V2_HYBRID_STAGE1_PROMPT, FROZEN_V1_STAGE1_PROMPT);
  assert.doesNotMatch(
    FROZEN_V1_STAGE1_PROMPT,
    /UNVERIFIED VISUAL LEAD/,
    "frozen prompt must remain untouched",
  );

  // Recall-oriented identity guidance, tied to identity-dependent candidates,
  // permitting a moderate-confidence unverified lead because Luna now verifies it.
  assert.match(
    V2_HYBRID_STAGE1_PROMPT,
    /review every candidate you marked identity_context_needed/i,
  );
  assert.match(V2_HYBRID_STAGE1_PROMPT, /UNVERIFIED VISUAL LEAD/);
  assert.match(V2_HYBRID_STAGE1_PROMPT, /moderate confidence/i);
  assert.match(V2_HYBRID_STAGE1_PROMPT, /uncertainty is expected/i);

  // Anti-hallucination guards are preserved.
  assert.match(
    V2_HYBRID_STAGE1_PROMPT,
    /empty identity_hypotheses array when the visible evidence supports no plausible specific identity/i,
  );
  assert.match(
    V2_HYBRID_STAGE1_PROMPT,
    /at most one best hypothesis per distinct subject/i,
  );
  assert.match(V2_HYBRID_STAGE1_PROMPT, /never dress a generic category/i);
});

test("V2 Luna request passes only relevant identity hypotheses as unverified leads", () => {
  const c1 = buildV2HybridResearchRequest(stage1, stage1.candidates[0]!);
  assert.equal(c1.request.model, V2_HYBRID_RESEARCH_MODEL);
  assert.deepEqual(c1.request.reasoning, { effort: "medium" });
  assert.deepEqual(c1.request.tools, [
    { type: "web_search", search_context_size: "medium" },
  ]);
  assert.equal(c1.request.tool_choice, "required");
  assert.deepEqual(c1.relevantIdentityHypothesisIds, ["ih1"]);
  assert.equal(c1.usedVerifiedIdentityContext, false);
  assert.match(String(c1.request.input), /UNVERIFIED VISUAL IDENTITY/);
  assert.match(String(c1.request.input), /A specific engineered landscape/);
  assert.match(String(c1.request.input), /visible marker 1/);
  assert.match(String(c1.request.input), /complete engineered landscape/i);
  assert.doesNotMatch(String(c1.request.input), /unrelated boundary identity/i);
  assert.doesNotMatch(String(c1.request.input), /disabled identity lead/i);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /not established facts/i);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /never assume/i);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /return INSUFFICIENT/i);

  const c2 = buildV2HybridResearchRequest(stage1, stage1.candidates[1]!);
  assert.deepEqual(c2.relevantIdentityHypothesisIds, ["ih2"]);
  assert.match(String(c2.request.input), /unrelated boundary identity/i);
  assert.doesNotMatch(
    String(c2.request.input),
    /A specific engineered landscape/,
  );
});

test("V2 keeps the strict Stage-1 schema: well-formed hypotheses parse, invariant violations still throw", () => {
  // A moderate-confidence hypothesis linked to an identity-dependent candidate is valid.
  assert.doesNotThrow(() => DiscoveryStage1Schema.parse(stage1));

  // verification_would_help true but no relevant_question_ids violates the contract and
  // must still fail closed — the recall change did not weaken validation.
  const violating: DiscoveryStage1 = {
    ...stage1,
    identity_hypotheses: [
      {
        ...stage1.identity_hypotheses[0]!,
        verification_would_help: true,
        relevant_question_ids: [],
      },
    ],
  };
  assert.throws(() => DiscoveryStage1Schema.parse(violating));
});

test("research instructions make identity resolution an explicit first responsibility with a three-way conclusion and a lookalike-safety bar", () => {
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /first responsibility/i);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /ESTABLISHED/);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /UNRESOLVED/);
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /CONTRADICTED/);
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /distinguishes it from plausible lookalikes/i,
  );
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /never enough to establish/i);
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /do not promote the hypothesis to fact/i,
  );
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /never use it in your answer/i);
});

test("research instructions demote Luna to a text-only evidence/discriminator gatherer whose identity call is provisional", () => {
  // Luna is told it has no image and cannot confirm same-object identity itself.
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /you do NOT receive the image/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /CANNOT confirm that any external source depicts THIS exact object/i,
  );
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /PROVISIONAL/);
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /authoritative identity determination is made by the final image-holding stage/i,
  );

  // Same-object support requires an explicit in-context bridge; a subject page is not one.
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /EXPLICIT BRIDGE/);
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /matching recorded part number, label, serial, or inscription/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /dedicated single-subject die-shot, gallery, archive, category, list, index, or search-result page — is NOT a bridge/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /Resemblance or family membership is plausibility, not identification/i,
  );

  // Luna must surface image-checkable discriminating attributes vs the closest alternative.
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /DISCRIMINATING ATTRIBUTES/);
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /closest plausible alternative/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /the payload the final image-holding stage uses to adjudicate/i,
  );

  // Provisional three-way conclusion; absence of proof is UNRESOLVED, not CONTRADICTED.
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /PROVISIONAL ESTABLISHED only/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /absence of proof is UNRESOLVED, not CONTRADICTED/i,
  );
  assert.match(
    V2_HYBRID_RESEARCH_INSTRUCTIONS,
    /may never promote the identity to fact/i,
  );
});

test("final prompt makes Sol the authoritative identity adjudicator that reconciles CONTRADICTED evidence rather than mechanically vetoing on it", () => {
  // (5) Final Sol remains the authoritative adjudicator over provisional research.
  assert.match(V2_HYBRID_FINAL_PROMPT, /AUTHORITATIVE identity adjudicator/);
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /candidate research did NOT see the image/i,
  );
  // Positive image corroboration required; a research assertion alone is insufficient.
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /POSITIVELY corroborate, in the visible image, a discriminating attribute/i,
  );
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /a research finding that merely asserts the identity is never enough/i,
  );
  // (1) UNRESOLVED is only absence of proof and does not veto.
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /An UNRESOLVED candidate is only absence of proof and must NOT veto/i,
  );
  // (2) CONTRADICTED is substantive negative evidence that must be reconciled.
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /A CONTRADICTED candidate is substantive negative evidence that you must take seriously and explicitly reconcile/i,
  );
  // (4) Not a mechanical veto — a resolvable contradiction may still establish identity.
  assert.match(V2_HYBRID_FINAL_PROMPT, /not an automatic mechanical veto/i);
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /clearly resolves the contradiction, you may still establish the identity/i,
  );
  assert.match(V2_HYBRID_FINAL_PROMPT, /Do not vote-count/i);
  // (3) An unresolved contradiction keeps identity unresolved.
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /the contradiction cannot be resolved that way, the identity remains UNRESOLVED/i,
  );
  // Established identity still requires an owning answered candidate's validated sources.
  assert.match(
    V2_HYBRID_FINAL_PROMPT,
    /an applicable answered candidate finding supports it with that candidate's validated sources/i,
  );
});

test("identity-dependent candidates receive the establish-or-reject-first instruction; identity-independent candidates do not", () => {
  const c1 = buildV2HybridResearchRequest(stage1, stage1.candidates[0]!);
  assert.match(
    String(c1.request.input),
    /first establish or reject the exact identity/i,
  );
  assert.match(
    String(c1.request.input),
    /ESTABLISHED \/ UNRESOLVED \/ CONTRADICTED/,
  );

  // c3 has identity_context_needed: false and no relevant hypothesis.
  const c3 = buildV2HybridResearchRequest(stage1, stage1.candidates[2]!);
  assert.deepEqual(c3.relevantIdentityHypothesisIds, []);
  assert.match(String(c3.request.input), /not needed for this question/i);
  assert.doesNotMatch(
    String(c3.request.input),
    /first establish or reject the exact identity/i,
  );
  assert.doesNotMatch(String(c3.request.input), /UNVERIFIED VISUAL IDENTITY/);
});

test("mocked end-to-end V2 is Sol image to Luna search to Sol image with no identity or DeepSeek call", async () => {
  const chatRequests: CapturedChatRequest[] = [];
  const responseRequests: CapturedResponseRequest[] = [];
  let deepSeekCalls = 0;
  const result = await runDiscoveryPipeline(
    openAIClient({
      chatRequests,
      responseRequests,
      candidateModes: { c2: "insufficient" },
    }),
    imageDataUrl,
    {
      variant: "v2-hybrid",
      deepseekClient: {
        responses: {
          create: async () => {
            deepSeekCalls += 1;
            throw new Error("DeepSeek must not be called by V2");
          },
        },
      } as never,
    },
  );

  assert.equal(deepSeekCalls, 0);
  assert.equal(chatRequests.length, 2);
  assert.equal(responseRequests.length, 3);
  assert.equal(chatRequests[0]?.model, FROZEN_V1_STAGE1_MODEL);
  assert.equal(chatRequests[0]?.reasoning_effort, "medium");
  assert.equal(chatRequests[0]?.messages[0]?.content, V2_HYBRID_STAGE1_PROMPT);
  assert.match(JSON.stringify(chatRequests[0]), /image_url.*high/);
  assert.ok(
    responseRequests.every(
      (request) =>
        request.model === V2_HYBRID_RESEARCH_MODEL &&
        request.reasoning?.effort === V2_HYBRID_REASONING_EFFORT &&
        request.tools?.[0]?.type === "web_search",
    ),
  );
  assert.equal(chatRequests[1]?.model, FROZEN_V1_STAGE3_MODEL);
  assert.equal(chatRequests[1]?.reasoning_effort, "medium");
  assert.match(JSON.stringify(chatRequests[1]), /image_url.*high/);
  assert.match(JSON.stringify(chatRequests[1]), /UNVERIFIED STAGE-1/);
  assert.match(
    JSON.stringify(chatRequests[1]),
    /A specific engineered landscape/,
  );
  assert.match(
    JSON.stringify(chatRequests[1]),
    /Trustworthy evidence establishes/,
  );

  assert.equal(result.inspection.identity_verification, null);
  assert.deepEqual(result.metrics.stage2.identity_verification, {
    ran: false,
    status: "not_run",
    usage: null,
    web_search_calls: 0,
    model_token_cost_usd: null,
    tool_cost_usd: 0,
    total_known_cost_usd: null,
    cost_usd: null,
    cost_reason: null,
  });
  assert.equal(result.metrics.stage2.candidate_research_model, "gpt-5.6-luna");
  assert.equal(
    result.metrics.stage2.candidate_calls_using_verified_identity,
    0,
  );
  assert.deepEqual(
    result.inspection.research_results.map((item) => [
      item.candidate_id,
      item.status,
    ]),
    [
      ["c1", "answered"],
      ["c2", "insufficient"],
      ["c3", "answered"],
    ],
  );
  assert.equal(result.discoveries.length, 1);
  assert.deepEqual(result.inspection.discovery_candidates.d1, ["c1"]);
  assert.equal(
    result.discoveries[0]?.sources[0]?.url,
    "https://example.com/c1",
  );
  assert.equal(result.metrics.stage2.web_search_calls, 3);
  assert.ok((result.metrics.stage2.tool_cost_usd ?? 0) > 0);
  assert.ok((result.metrics.total_known_cost_usd ?? 0) > 0);
});

test("V2 final request keeps hypotheses unverified and returns to the original image", () => {
  const request = buildV2HybridFinalRequest(imageDataUrl, stage1, [
    {
      candidate_id: "c1",
      question_id: "q1",
      question: stage1.candidates[0]!.investigation_question,
      status: "answered",
      finding: "Research established the identity for this candidate.",
      sources: [{ title: "C1", url: "https://example.com/c1" }],
    },
  ]);
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
  assert.match(text, /SAFE LUNA CANDIDATE RESEARCH RESULTS/);
  assert.match(text, /CANDIDATE RESEARCH STATUSES/);
  assert.match(text, /UNVERIFIED STAGE-1/);
  assert.match(V2_HYBRID_FINAL_PROMPT, /applicable answered candidate/i);
  assert.match(V2_HYBRID_FINAL_PROMPT, /validated sources/i);
});

test("unsupported Stage-1 identity cannot become a researched final fact", async () => {
  const unsupportedIdentityOutput = {
    discoveries: [
      {
        ...finalDiscovery().discoveries[0],
        id: "d2",
        title: "The boundary identifies the exact place",
        discovery:
          "The unverified boundary hypothesis identifies the exact place.",
        candidate_ids: ["c2"],
        sources: [],
      },
    ],
  };
  await assert.rejects(
    () =>
      runDiscoveryPipeline(
        openAIClient({
          candidateModes: { c2: "insufficient" },
          finalOutput: unsupportedIdentityOutput,
        }),
        imageDataUrl,
        { variant: "v2-hybrid" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "validation");
      assert.equal(error.diagnostic.category, "source_validation");
      return true;
    },
  );
});

test("an UNRESOLVED sibling does not block a properly answered, sourced identity discovery (unproven != disproven)", async () => {
  // c2 is UNRESOLVED (insufficient) while c1 is answered with a validated source and the
  // final output promotes an identity discovery grounded in c1. Absence of proof from a
  // sibling must NOT veto an identity the image-holder can corroborate and source. This is
  // the deterministic guard against over-conservatism; CONTRADICTED-blocking and image
  // corroboration are prompt-level rules asserted in the final-prompt contract test above.
  const result = await runDiscoveryPipeline(
    openAIClient({
      candidateModes: { c2: "insufficient" },
      finalOutput: finalDiscovery("https://example.com/c1"),
    }),
    imageDataUrl,
    { variant: "v2-hybrid" },
  );
  assert.equal(result.discoveries.length, 1);
  assert.deepEqual(result.inspection.discovery_candidates.d1, ["c1"]);
  assert.equal(
    result.discoveries[0]?.sources[0]?.url,
    "https://example.com/c1",
  );
  assert.equal(
    result.inspection.research_results.find((r) => r.candidate_id === "c2")
      ?.status,
    "insufficient",
  );
});

test("candidate-local Luna failures continue siblings with concurrency-three and source ownership", async () => {
  for (const [mode, category] of [
    ["no_search", "tool_call"],
    ["incomplete_search", "search_provider"],
    ["uncited", "source_validation"],
    ["malformed", "malformed_model_output"],
  ] as const) {
    const concurrency = { active: 0, max: 0 };
    const result = await runDiscoveryPipeline(
      openAIClient({
        candidateModes: { c2: mode },
        concurrency,
      }),
      imageDataUrl,
      { variant: "v2-hybrid" },
    );
    assert.equal(result.metrics.stage2.candidate_research_api_calls, 3, mode);
    assert.equal(result.metrics.stage2.answered_candidates, 2, mode);
    assert.equal(result.metrics.stage2.insufficient_candidates, 1, mode);
    assert.equal(
      result.metrics.stage2.candidate_local_failures?.[0]?.category,
      category,
      mode,
    );
    assert.deepEqual(
      result.inspection.research_results.find(
        (item) => item.candidate_id === "c2",
      )?.sources,
      [],
      mode,
    );
    assert.equal(
      result.inspection.research_results.find(
        (item) => item.candidate_id === "c1",
      )?.sources[0]?.url,
      "https://example.com/c1",
      mode,
    );
    assert.equal(concurrency.max, V2_HYBRID_RESEARCH_MAX_CONCURRENCY, mode);
    assert.ok(concurrency.max <= V2_HYBRID_RESEARCH_MAX_CONCURRENCY);
    assert.equal(result.metrics.stage2.research_max_concurrency, 3);
    assert.doesNotMatch(JSON.stringify(result), /unsafe\.example|private/);
  }
});

test("A: an ESTABLISHED identity conclusion carries evidence-backed sources into an answered candidate result usable downstream", async () => {
  const result = await runDiscoveryPipeline(
    openAIClient({
      candidateModes: { c1: "identity_established" },
      finalOutput: finalDiscovery("https://example.com/established"),
    }),
    imageDataUrl,
    { variant: "v2-hybrid" },
  );
  const c1Result = result.inspection.research_results.find(
    (item) => item.candidate_id === "c1",
  );
  assert.equal(c1Result?.status, "answered");
  assert.match(c1Result?.finding ?? "", /IDENTITY ESTABLISHED/);
  assert.ok((c1Result?.sources.length ?? 0) > 0);
  assert.equal(c1Result?.sources[0]?.url, "https://example.com/established");
});

test("B: an UNRESOLVED identity conclusion is not promoted to fact and safely degrades to INSUFFICIENT", async () => {
  const genericDiscoveryFromIdentityIndependentCandidate = {
    discoveries: [
      {
        ...finalDiscovery("https://example.com/c3").discoveries[0],
        id: "d3",
        candidate_ids: ["c3"],
        sources: [{ title: "Source c3", url: "https://example.com/c3" }],
      },
    ],
  };
  const result = await runDiscoveryPipeline(
    openAIClient({
      candidateModes: { c1: "identity_unresolved" },
      finalOutput: genericDiscoveryFromIdentityIndependentCandidate,
    }),
    imageDataUrl,
    { variant: "v2-hybrid" },
  );
  const c1Result = result.inspection.research_results.find(
    (item) => item.candidate_id === "c1",
  );
  assert.equal(c1Result?.status, "insufficient");
  assert.deepEqual(c1Result?.sources, []);
  assert.doesNotMatch(
    JSON.stringify(result.discoveries),
    /A specific engineered landscape is confirmed/i,
  );
});

test("C: a CONTRADICTED identity is rejected but the candidate may still answer safely at a generic, sourced level", async () => {
  const result = await runDiscoveryPipeline(
    openAIClient({
      candidateModes: { c1: "identity_contradicted" },
      finalOutput: finalDiscovery("https://example.com/contradicted"),
    }),
    imageDataUrl,
    { variant: "v2-hybrid" },
  );
  const c1Result = result.inspection.research_results.find(
    (item) => item.candidate_id === "c1",
  );
  assert.equal(c1Result?.status, "answered");
  assert.match(c1Result?.finding ?? "", /CONTRADICTED/);
  assert.doesNotMatch(c1Result?.finding ?? "", /IDENTITY ESTABLISHED/);
  assert.ok((c1Result?.sources.length ?? 0) > 0);
});

test("D: an identity-independent candidate's research is unaffected by the identity-resolution instructions", () => {
  const c3 = buildV2HybridResearchRequest(stage1, stage1.candidates[2]!);
  assert.equal(c3.relevantIdentityHypothesisIds.length, 0);
  assert.doesNotMatch(String(c3.request.input), /ESTABLISHED/);
  assert.doesNotMatch(String(c3.request.input), /UNRESOLVED/);
  assert.doesNotMatch(String(c3.request.input), /CONTRADICTED/);
});

test("E: a generic source about the proposed subject cannot substitute for candidate-local proof, and source ownership stays candidate-local", async () => {
  const concurrency = { active: 0, max: 0 };
  const result = await runDiscoveryPipeline(
    openAIClient({ candidateModes: { c2: "uncited" }, concurrency }),
    imageDataUrl,
    { variant: "v2-hybrid" },
  );
  assert.equal(
    result.metrics.stage2.candidate_local_failures?.[0]?.category,
    "source_validation",
  );
  const c2Result = result.inspection.research_results.find(
    (item) => item.candidate_id === "c2",
  );
  assert.equal(c2Result?.status, "insufficient");
  assert.deepEqual(c2Result?.sources, []);
  const c1Result = result.inspection.research_results.find(
    (item) => item.candidate_id === "c1",
  );
  assert.equal(c1Result?.sources[0]?.url, "https://example.com/c1");
  assert.match(V2_HYBRID_RESEARCH_INSTRUCTIONS, /never enough to establish/i);
});

test("global OpenAI configuration failure remains fatal", async () => {
  await assert.rejects(
    () =>
      runDiscoveryPipeline(
        openAIClient({ candidateModes: { c1: "api_error" } }),
        imageDataUrl,
        { variant: "v2-hybrid" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "research");
      assert.equal(error.diagnostic.category, "api_error");
      return true;
    },
  );
});

test("V2 final validation rejects arbitrary Sol-typed sources", async () => {
  await assert.rejects(
    () =>
      runDiscoveryPipeline(
        openAIClient({
          finalOutput: finalDiscovery("https://untrusted.example/fabricated"),
        }),
        imageDataUrl,
        { variant: "v2-hybrid" },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "validation");
      assert.equal(error.diagnostic.category, "source_validation");
      return true;
    },
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDiscoveryBatchContext,
  DiscoveryBatchValidationError,
  validateDiscoveryBatchResults,
} from "../../artifacts/api-server/src/lib/discoveryBatchResearch";
import type {
  DiscoveryCandidate,
  DiscoveryIdentityVerification,
  DiscoverySource,
  DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  DISCOVERY_ENGINE_VERSION,
  DiscoveryPipelineError,
  runBatchedSelectiveResearch,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { computeDiscoveryCacheKey } from "../../artifacts/api-server/src/lib/discoveryCache";
import { createDiscoveryEvalPayload } from "../../artifacts/noesis/src/lib/discoveryEval";
import {
  DISCOVERY_LAB_PATH,
  LEGACY_APP_PATH,
  isDiscoveryLabPath,
} from "../../artifacts/noesis/src/lib/appRoutes";

const stage1Fixture: DiscoveryStage1 = {
  image_summary: "A reclaimed landscape with contrasting planned geometry.",
  regions: [
    {
      id: "r1",
      description: "The isolated circular feature beside the waterway",
      scope: "local",
      x: 0.55,
      y: 0.6,
      width: 0.15,
      height: 0.15,
    },
    {
      id: "r2",
      description: "The radial settlement and surrounding parcels",
      scope: "local",
      x: 0.1,
      y: 0.1,
      width: 0.4,
      height: 0.4,
    },
  ],
  candidates: [
    {
      id: "c1",
      question_id: "q1",
      visual_trigger: "An isolated circle interrupts rectilinear parcels.",
      observation: "The circle sits directly beside a straight waterway.",
      region_ids: ["r1"],
      investigation_question:
        "What is the isolated circular feature and why is it located here?",
      research_needed: true,
      research_rationale:
        "Verified external evidence could explain the visible anomaly.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "Roads radiate from a compact central settlement.",
      observation: "The radial geometry contrasts with rectangular parcels.",
      region_ids: ["r2"],
      investigation_question:
        "Was the visible radial settlement deliberately planned this way?",
      research_needed: true,
      research_rationale:
        "Planning records could explain the visible geometric contrast.",
      identity_context_needed: true,
    },
    {
      id: "c3",
      question_id: "q3",
      visual_trigger: "Two adjacent parcels have visibly different widths.",
      observation: "The width difference is directly visible in the image.",
      region_ids: ["r2"],
      investigation_question:
        "How do the widths of the two visible parcels compare?",
      research_needed: false,
      research_rationale: "The image itself is sufficient for comparison.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "Noordoostpolder, Netherlands",
      identity_type: "place",
      visible_evidence: [
        "Straight enclosing waterways and rectilinear reclaimed parcels are visible.",
      ],
      observed_labels_or_numbers: ["Emmeloord"],
      region_ids: ["r1", "r2"],
      confidence: 0.8,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ],
};

const gatedCandidates = stage1Fixture.candidates.slice(0, 2);

const verifiedIdentity: DiscoveryIdentityVerification = {
  status: "verified",
  hypothesis_id: "ih1",
  canonical_identity: "Noordoostpolder",
  identity_type: "place",
  location: "Flevoland, Netherlands",
  verification_basis:
    "Authoritative geographic evidence matches the exact enclosing configuration.",
  confidence: 0.94,
  match_evidence: [
    {
      basis: "geographic_configuration",
      detail: "The enclosing waterways and planned parcel geometry match.",
    },
  ],
  sources: [{ title: "Identity source", url: "https://example.com/identity" }],
};

function noIdentityStage1(): DiscoveryStage1 {
  const stage1 = structuredClone(stage1Fixture);
  stage1.identity_hypotheses = [];
  stage1.candidates.forEach(
    (candidate) => (candidate.identity_context_needed = false),
  );
  return stage1;
}

function batchResult(
  candidate: DiscoveryCandidate,
  status: "answered" | "insufficient" = "answered",
  sourceUrl = `https://example.com/${candidate.id}`,
) {
  return {
    candidate_id: candidate.id,
    question_id: candidate.question_id,
    status,
    finding:
      status === "answered"
        ? `Supported finding for ${candidate.id}.`
        : `Evidence was insufficient for ${candidate.id}.`,
    sources:
      status === "answered"
        ? [{ title: `${candidate.id} source`, url: sourceUrl }]
        : [],
  };
}

function response(outputText: string, sourceUrls: string[] = []) {
  let citationSearchStart = 0;
  return {
    model: "gpt-5.6-terra",
    output_text: outputText,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: sourceUrls.map((url) => {
              const foundAt = outputText.indexOf(url, citationSearchStart);
              const startIndex = foundAt >= 0 ? foundAt : 0;
              const endIndex =
                foundAt >= 0
                  ? foundAt + url.length
                  : Math.min(10, outputText.length);
              citationSearchStart = endIndex;
              return {
                type: "url_citation",
                title: `Validated ${url.split("/").pop()}`,
                url,
                start_index: startIndex,
                end_index: endIndex,
              };
            }),
          },
        ],
      },
    ],
    usage: {
      input_tokens: 200,
      input_tokens_details: { cached_tokens: 20, cache_write_tokens: 0 },
      output_tokens: 80,
      output_tokens_details: { reasoning_tokens: 10 },
      total_tokens: 280,
    },
  };
}

function citationContext(input: unknown, sources: DiscoverySource[] = []) {
  const outputText = JSON.stringify(input);
  let searchStart = 0;
  return {
    output_text: outputText,
    citations: sources.map((source) => {
      const startIndex = outputText.indexOf(source.url, searchStart);
      assert.notEqual(
        startIndex,
        -1,
        `source URL missing from fixture: ${source.url}`,
      );
      searchStart = startIndex + source.url.length;
      return {
        ...source,
        start_index: startIndex,
        end_index: searchStart,
      };
    }),
  };
}

function validateBatch(input: unknown, sources: DiscoverySource[] = []) {
  return validateDiscoveryBatchResults(
    stage1Fixture,
    gatedCandidates,
    input,
    citationContext(input, sources),
  );
}

function chatResponse(content: unknown) {
  return {
    model: "gpt-5.6-sol",
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

interface CapturedResponseRequest {
  input?: unknown;
  text?: { format?: { name?: string } };
  instructions?: unknown;
}

function isIdentityRequest(request: CapturedResponseRequest): boolean {
  return (
    request.text?.format?.name === "noesis_discovery_identity_verification"
  );
}

function isBatchRequest(request: CapturedResponseRequest): boolean {
  return request.text?.format?.name === "noesis_discovery_batched_research";
}

function fakeBatchedClient(options?: {
  stage1?: DiscoveryStage1;
  identity?: "verified" | "unverified" | "conflicted";
  batchOutput?: unknown;
  batchRawOutput?: string;
  batchError?: Error;
  captured?: CapturedResponseRequest[];
  chatRequests?: Array<{ messages?: unknown }>;
}) {
  const stage1 = options?.stage1 ?? noIdentityStage1();
  let chatCall = 0;
  return {
    chat: {
      completions: {
        create: async (request: { messages?: unknown }) => {
          options?.chatRequests?.push(request);
          chatCall += 1;
          return chatCall === 1
            ? chatResponse(stage1)
            : chatResponse({ discoveries: [] });
        },
      },
    },
    responses: {
      create: async (request: CapturedResponseRequest) => {
        options?.captured?.push(request);
        if (isIdentityRequest(request)) {
          const status = options?.identity ?? "verified";
          const identity =
            status === "verified"
              ? {
                  ...verifiedIdentity,
                  sources: undefined,
                }
              : {
                  status,
                  hypothesis_id: "ih1",
                  canonical_identity: null,
                  identity_type: null,
                  location: null,
                  verification_basis:
                    status === "conflicted"
                      ? "Sources conflict about the exact location."
                      : "The exact location could not be verified.",
                  confidence: 0.25,
                  match_evidence: [
                    {
                      basis: "generic_visual_similarity",
                      detail: "Several landscapes share this geometry.",
                    },
                  ],
                };
          return response(
            JSON.stringify(identity),
            status === "verified" ? ["https://example.com/identity"] : [],
          );
        }
        assert.equal(isBatchRequest(request), true);
        if (options?.batchError) throw options.batchError;
        const output =
          options?.batchRawOutput ??
          JSON.stringify(
            options?.batchOutput ?? {
              results: [
                batchResult(stage1.candidates[0]!),
                batchResult(stage1.candidates[1]!),
              ],
            },
          );
        return response(output, [
          "https://example.com/c1",
          "https://example.com/c2",
        ]);
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

test("only research-gated candidates enter one deterministic batch", async () => {
  const captured: CapturedResponseRequest[] = [];
  const result = await runBatchedSelectiveResearch(
    fakeBatchedClient({ captured }),
    noIdentityStage1(),
  );
  const request = captured.find(isBatchRequest)!;
  const input = String(request.input);
  assert.match(input, /"candidate_id":"c1"/);
  assert.match(input, /"candidate_id":"c2"/);
  assert.doesNotMatch(input, /"candidate_id":"c3"/);
  assert.doesNotMatch(input, /image_summary|"x":|"y":/);
  assert.equal(captured.length, 1);
  assert.equal(result.candidateResearchApiCalls, 1);
  assert.equal(result.gatedCandidates, 2);
});

test("batch results preserve exact candidate and question ids", async () => {
  const result = await runBatchedSelectiveResearch(
    fakeBatchedClient(),
    noIdentityStage1(),
  );
  assert.deepEqual(
    result.results.map((item) => [item.candidate_id, item.question_id]),
    [
      ["c1", "q1"],
      ["c2", "q2"],
    ],
  );
});

test("verified identity context is included only for its mapped candidate", () => {
  const context = buildDiscoveryBatchContext(
    stage1Fixture,
    gatedCandidates,
    verifiedIdentity,
  );
  assert.equal(
    context.candidates[0]!.verified_identity?.canonical_identity,
    "Noordoostpolder",
  );
  assert.equal(context.candidates[1]!.verified_identity, null);
  assert.deepEqual(
    context.identity_context_mappings.map(
      (mapping) => mapping.used_verified_identity_context,
    ),
    [true, false],
  );
});

test("verified identity runs once and remains separate from the one batch call", async () => {
  const captured: CapturedResponseRequest[] = [];
  const result = await runBatchedSelectiveResearch(
    fakeBatchedClient({
      stage1: stage1Fixture,
      identity: "verified",
      captured,
    }),
    stage1Fixture,
  );
  assert.equal(captured.filter(isIdentityRequest).length, 1);
  assert.equal(captured.filter(isBatchRequest).length, 1);
  assert.equal(result.identityVerification.metrics.status, "verified");
  assert.deepEqual(
    result.batchInspection?.identity_context_mappings.map(
      (mapping) => mapping.used_verified_identity_context,
    ),
    [true, false],
  );
});

test("unverified and conflicted identities never enter batch candidate context", async () => {
  for (const identity of ["unverified", "conflicted"] as const) {
    const result = await runBatchedSelectiveResearch(
      fakeBatchedClient({ stage1: stage1Fixture, identity }),
      stage1Fixture,
    );
    assert.equal(
      result.batchInspection?.candidates.every(
        (candidate) => candidate.verified_identity === null,
      ),
      true,
    );
    assert.equal(result.identityVerification.metrics.status, identity);
  }
});

test("unknown candidate results are rejected", () => {
  assert.throws(
    () =>
      validateBatch({
        results: [
          { ...batchResult(gatedCandidates[0]!), candidate_id: "unknown" },
        ],
      }),
    (error) =>
      error instanceof DiscoveryBatchValidationError &&
      error.validationCategory === "unknown_candidate",
  );
});

test("mismatched question ids are rejected", () => {
  assert.throws(
    () =>
      validateBatch({
        results: [
          { ...batchResult(gatedCandidates[0]!), question_id: "other" },
        ],
      }),
    (error) =>
      error instanceof DiscoveryBatchValidationError &&
      error.validationCategory === "question_mismatch",
  );
});

test("duplicate candidate results are rejected", () => {
  const result = batchResult(gatedCandidates[0]!, "insufficient");
  assert.throws(
    () => validateBatch({ results: [result, result] }),
    (error) =>
      error instanceof DiscoveryBatchValidationError &&
      error.validationCategory === "duplicate",
  );
});

test("missing candidate results become isolated insufficient results", () => {
  const validated = validateBatch({
    results: [batchResult(gatedCandidates[0]!, "insufficient")],
  });
  assert.deepEqual(validated.missing_candidate_ids, ["c2"]);
  assert.equal(validated.results[1]!.status, "insufficient");
  assert.match(validated.results[1]!.finding, /did not return/);
});

test("one candidate can be answered while another is insufficient", () => {
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered"),
      batchResult(gatedCandidates[1]!, "insufficient"),
    ],
  };
  const validated = validateBatch(input, [
    { title: "C1", url: "https://example.com/c1" },
  ]);
  assert.deepEqual(
    validated.results.map((result) => result.status),
    ["answered", "insufficient"],
  );
});

test("valid multi-candidate answered batch preserves each cited source", () => {
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered"),
      batchResult(gatedCandidates[1]!, "answered"),
    ],
  };
  const validated = validateBatch(input, [
    { title: "C1", url: "https://example.com/c1" },
    { title: "C2", url: "https://example.com/c2" },
  ]);
  assert.deepEqual(
    validated.results.map((result) => [result.status, result.sources[0]?.url]),
    [
      ["answered", "https://example.com/c1"],
      ["answered", "https://example.com/c2"],
    ],
  );
  assert.deepEqual(validated.validation_issues, []);
});

test("all-insufficient batch accepts empty source arrays", () => {
  const validated = validateBatch({
    results: gatedCandidates.map((candidate) =>
      batchResult(candidate, "insufficient"),
    ),
  });
  assert.equal(
    validated.results.every(
      (result) =>
        result.status === "insufficient" && result.sources.length === 0,
    ),
    true,
  );
  assert.deepEqual(validated.invalid_candidate_ids, []);
});

test("one malformed sibling does not invalidate valid siblings", () => {
  const malformed = {
    ...batchResult(gatedCandidates[1]!, "answered"),
    unexpected: "field",
  };
  const input = {
    results: [batchResult(gatedCandidates[0]!, "answered"), malformed],
  };
  const validated = validateBatch(input, [
    { title: "C1", url: "https://example.com/c1" },
    { title: "C2", url: "https://example.com/c2" },
  ]);
  assert.equal(validated.results[0]!.status, "answered");
  assert.equal(validated.results[1]!.status, "insufficient");
  assert.deepEqual(validated.invalid_candidate_ids, ["c2"]);
  assert.deepEqual(validated.validation_issues, [
    {
      candidate_id: "c2",
      question_id: "q2",
      validation_category: "schema",
      safe_message:
        "The candidate result did not match the strict batch schema.",
    },
  ]);
});

test("candidate sources remain scoped and are never globally attached", () => {
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered"),
      batchResult(gatedCandidates[1]!, "insufficient"),
    ],
  };
  const validated = validateBatch(input, [
    { title: "C1", url: "https://example.com/c1" },
  ]);
  assert.equal(validated.results[0]!.sources.length, 1);
  assert.deepEqual(validated.results[1]!.sources, []);
});

test("a citation inside candidate A cannot satisfy candidate B", () => {
  const sharedUrl = "https://example.com/shared";
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered", sharedUrl),
      batchResult(gatedCandidates[1]!, "answered", sharedUrl),
    ],
  };
  const validated = validateBatch(input, [
    { title: "Scoped to C1", url: sharedUrl },
  ]);
  assert.equal(validated.results[0]!.status, "answered");
  assert.equal(validated.results[1]!.status, "insufficient");
  assert.deepEqual(validated.invalid_candidate_ids, ["c2"]);
  assert.equal(
    validated.validation_issues[0]?.validation_category,
    "source_validation",
  );
});

test("provider citation tracking does not break same-resource validation", () => {
  const modelUrl = "https://example.com/report";
  const citationUrl = "https://example.com/report?utm_source=chatgpt.com";
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered", modelUrl),
      batchResult(gatedCandidates[1]!, "insufficient"),
    ],
  };
  const outputText = JSON.stringify(input);
  const startIndex = outputText.indexOf(modelUrl);
  const validated = validateDiscoveryBatchResults(
    stage1Fixture,
    gatedCandidates,
    input,
    {
      output_text: outputText,
      citations: [
        {
          title: "Tracked citation",
          url: citationUrl,
          start_index: startIndex,
          end_index: startIndex + modelUrl.length,
        },
      ],
    },
  );
  assert.equal(validated.results[0]!.status, "answered");
  assert.equal(validated.results[0]!.sources[0]?.url, citationUrl);
});

test("invalid or uncited URLs invalidate only their candidate result", () => {
  const invalid = batchResult(gatedCandidates[0]!);
  invalid.sources = [{ title: "Unsafe", url: "javascript:alert(1)" }];
  const input = {
    results: [invalid, batchResult(gatedCandidates[1]!, "answered")],
  };
  const validated = validateBatch(input, [
    { title: "C2", url: "https://example.com/c2" },
  ]);
  assert.deepEqual(validated.invalid_candidate_ids, ["c1"]);
  assert.equal(validated.results[0]!.status, "insufficient");
  assert.deepEqual(validated.results[0]!.sources, []);
  assert.equal(validated.results[1]!.status, "answered");
  assert.deepEqual(validated.validation_issues, [
    {
      candidate_id: "c1",
      question_id: "q1",
      validation_category: "malformed_url",
      safe_message: "A source URL was not a valid HTTP(S) URL.",
    },
  ]);
});

test("an uncited HTTP source invalidates only its candidate", () => {
  const input = {
    results: [
      batchResult(gatedCandidates[0]!, "answered"),
      batchResult(gatedCandidates[1]!, "answered"),
    ],
  };
  const validated = validateBatch(input, [
    { title: "C2", url: "https://example.com/c2" },
  ]);
  assert.equal(validated.results[0]!.status, "insufficient");
  assert.equal(validated.results[1]!.status, "answered");
  assert.deepEqual(validated.validation_issues, [
    {
      candidate_id: "c1",
      question_id: "q1",
      validation_category: "source_validation",
      safe_message:
        "A claimed source was not cited within this candidate result.",
    },
  ]);
});

test("extra Terra-generated question fields are rejected per candidate", () => {
  const generated = {
    ...batchResult(gatedCandidates[0]!),
    question: "A broader model-generated question?",
  };
  const input = { results: [generated] };
  const validated = validateBatch(input, [
    { title: "C1", url: "https://example.com/c1" },
  ]);
  assert.deepEqual(validated.invalid_candidate_ids, ["c1"]);
  assert.equal(validated.results[0]!.status, "insufficient");
});

test("Stage 3 receives the same logical research artifacts in baseline and batch", async () => {
  const stage1 = noIdentityStage1();
  const batchChatRequests: Array<{ messages?: unknown }> = [];
  const batched = await runDiscoveryPipeline(
    fakeBatchedClient({ stage1, chatRequests: batchChatRequests }),
    "data:image/png;base64,YWJj",
    { variant: "v1-batched-research" },
  );

  let chatCall = 0;
  const baselineChatRequests: Array<{ messages?: unknown }> = [];
  const baseline = await runDiscoveryPipeline(
    {
      chat: {
        completions: {
          create: async (request: { messages?: unknown }) => {
            baselineChatRequests.push(request);
            chatCall += 1;
            return chatCall === 1
              ? chatResponse(stage1)
              : chatResponse({ discoveries: [] });
          },
        },
      },
      responses: {
        create: async (request: { input?: unknown }) => {
          const candidateId = String(request.input).includes("CANDIDATE ID: c1")
            ? "c1"
            : "c2";
          return response(
            "ANSWERED: Supported finding for " + candidateId + ".",
            [`https://example.com/${candidateId}`],
          );
        },
      },
    } as unknown as Parameters<typeof runDiscoveryPipeline>[0],
    "data:image/png;base64,YWJj",
  );

  assert.deepEqual(
    batched.inspection.research_results,
    baseline.inspection.research_results,
  );
  assert.match(
    JSON.stringify(batchChatRequests[1]),
    /VALIDATED RESEARCH RESULTS/,
  );
  assert.match(
    JSON.stringify(baselineChatRequests[1]),
    /VALIDATED RESEARCH RESULTS/,
  );
  assert.equal(baseline.version, DISCOVERY_ENGINE_VERSION);
  assert.equal(baseline.metrics.stage2.candidate_research_api_calls, 2);
  assert.equal(baseline.metrics.stage2.batch, null);
});

test("batched variant uses an isolated version and cache identity", async () => {
  const result = await runDiscoveryPipeline(
    fakeBatchedClient(),
    "data:image/png;base64,YWJj",
    { variant: "v1-batched-research" },
  );
  const baselineKey = computeDiscoveryCacheKey(
    "data:image/png;base64,YWJj",
  ).cacheKey;
  const batchedKey = computeDiscoveryCacheKey(
    "data:image/png;base64,YWJj",
    DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  ).cacheKey;
  assert.equal(result.version, DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION);
  assert.equal(result.metrics.engine_version, result.version);
  assert.notEqual(baselineKey, batchedKey);
  assert.match(baselineKey, /^discovery-engine-v1:/);
  assert.match(batchedKey, /^discovery-engine-v1-batched-research:/);
});

async function getBatchFailure(
  options: Parameters<typeof fakeBatchedClient>[0],
) {
  try {
    await runDiscoveryPipeline(
      fakeBatchedClient(options),
      "data:image/png;base64,YWJj",
      { variant: "v1-batched-research" },
    );
  } catch (error) {
    assert.ok(error instanceof DiscoveryPipelineError);
    return error;
  }
  throw new Error("Expected batched pipeline failure");
}

test("batched failure diagnostics distinguish API, schema, and candidate failures", async () => {
  const apiFailure = Object.assign(new Error("provider failed"), {
    name: "APIError",
    status: 500,
  });
  const api = await getBatchFailure({ batchError: apiFailure });
  assert.equal(api.diagnostic.research_failure_scope, "batch_api");
  assert.equal(api.diagnostic.partial_metrics.research.attempted_calls, 1);

  const schema = await getBatchFailure({ batchRawOutput: "not json" });
  assert.equal(schema.diagnostic.research_failure_scope, "batch_schema");
  assert.equal(schema.diagnostic.partial_metrics.known_total_tokens, 400);

  const candidate = await getBatchFailure({
    batchOutput: {
      results: [
        { ...batchResult(gatedCandidates[0]!), candidate_id: "unknown" },
      ],
    },
  });
  assert.equal(
    candidate.diagnostic.research_failure_scope,
    "candidate_validation",
  );
  assert.equal(
    candidate.diagnostic.research_validation_category,
    "unknown_candidate",
  );
  assert.equal(
    candidate.diagnostic.safe_validation_message,
    "Batched research returned an unknown candidate",
  );
  assert.equal(
    candidate.diagnostic.engine_version,
    DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  );
});

test("batched metrics and full eval JSON expose comparison fields safely", async () => {
  const result = await runDiscoveryPipeline(
    fakeBatchedClient(),
    "data:image/png;base64,YWJj",
    { variant: "v1-batched-research" },
  );
  assert.equal(result.metrics.stage2.candidate_research_api_calls, 1);
  assert.equal(result.metrics.stage2.batch?.candidate_count, 2);
  assert.equal(result.metrics.stage2.batch?.usage.input_tokens, 200);
  assert.equal(typeof result.metrics.stage2.batch?.cost_usd, "number");
  assert.equal(result.metrics.stage2.answered_candidates, 2);
  assert.equal(result.metrics.stage2.insufficient_candidates, 0);
  assert.equal(
    result.metrics.cost_per_successful_analysis_usd,
    result.metrics.total_cost_usd,
  );
  assert.equal(result.metrics.cost_per_final_discovery_usd, null);

  const payload = createDiscoveryEvalPayload({
    result,
    discoveryId: "batched-run",
    cacheHit: false,
  });
  assert.equal(payload.version, DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION);
  assert.equal(payload.inspection.research_batch?.candidates.length, 2);
  assert.equal(payload.metrics.stage2.batch?.candidate_ids.length, 2);
  assert.doesNotMatch(JSON.stringify(payload), /reasoning_tokens/);
});

test("safe per-candidate validation reasons survive eval serialization", async () => {
  const malformed = {
    ...batchResult(gatedCandidates[1]!),
    unexpected: "field",
  };
  const result = await runDiscoveryPipeline(
    fakeBatchedClient({
      batchOutput: {
        results: [batchResult(gatedCandidates[0]!), malformed],
      },
    }),
    "data:image/png;base64,YWJj",
    { variant: "v1-batched-research" },
  );
  const payload = createDiscoveryEvalPayload({
    result,
    discoveryId: "mixed-batched-run",
    cacheHit: false,
  });
  assert.deepEqual(payload.inspection.research_batch?.validation_issues, [
    {
      candidate_id: "c2",
      question_id: "q2",
      validation_category: "schema",
      safe_message:
        "The candidate result did not match the strict batch schema.",
    },
  ]);
  assert.doesNotMatch(
    JSON.stringify(payload),
    /reasoning_tokens|api[_-]?key|authorization|stack|raw_response/i,
  );
});

test("legacy root and Discovery lab routes remain distinct", () => {
  assert.equal(LEGACY_APP_PATH, "/");
  assert.equal(DISCOVERY_LAB_PATH, "/discovery-lab");
  assert.equal(isDiscoveryLabPath("/"), false);
  assert.equal(isDiscoveryLabPath("/discovery-lab"), true);
});

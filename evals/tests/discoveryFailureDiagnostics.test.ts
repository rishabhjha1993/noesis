import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscoveryPipelineError,
  classifyDiscoveryFailure,
  runDiscoveryPipeline,
  type DiscoveryFailureDiagnostic,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";
import {
  createDiscoveryErrorJob,
  discoveryErrorLogDetails,
} from "../../artifacts/api-server/src/lib/discoveryJobs";
import type { DiscoveryStage1 } from "../../artifacts/api-server/src/lib/discoveryContracts";

const stage1Fixture: DiscoveryStage1 = {
  image_summary: "A chart whose last two visible points reverse direction.",
  regions: [
    {
      id: "r1",
      description: "The final segment of the plotted line",
      scope: "local",
      x: 0.6,
      y: 0.2,
      width: 0.35,
      height: 0.55,
    },
  ],
  candidates: [
    {
      id: "c1",
      question_id: "q1",
      visual_trigger: "The penultimate point begins a visible reversal.",
      observation: "The plotted direction changes near the end of the line.",
      region_ids: ["r1"],
      investigation_question:
        "Did a documented event coincide with the first visible reversal?",
      research_needed: true,
      research_rationale:
        "A documented event could materially explain the visible change.",
      identity_context_needed: false,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger: "The final point continues the newly reversed direction.",
      observation: "The endpoint differs from the preceding local trend.",
      region_ids: ["r1"],
      investigation_question:
        "Did a second documented event coincide with the final point?",
      research_needed: true,
      research_rationale:
        "A documented event could materially explain the visible endpoint.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [],
};

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

function researchResponse() {
  return {
    model: "gpt-5.6-terra",
    output_text: "ANSWERED: A documented event coincided with the change.",
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "A documented event coincided with the change.",
            annotations: [
              {
                type: "url_citation",
                title: "Primary source",
                url: "https://example.com/source",
                start_index: 0,
                end_index: 10,
              },
            ],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    },
  };
}

function apiError(message = "Provider request failed") {
  return Object.assign(new Error(message), {
    name: "APIError",
    status: 500,
  });
}

function fakePipelineClient(options?: {
  stage1Error?: Error;
  researchErrorAt?: number;
  returnedResearchFailureAt?: number;
  stage3Error?: Error;
  stage3Output?: unknown;
  stage1?: DiscoveryStage1;
}) {
  let chatCall = 0;
  let researchCall = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          chatCall += 1;
          if (chatCall === 1) {
            if (options?.stage1Error) throw options.stage1Error;
            return chatResponse(options?.stage1 ?? stage1Fixture);
          }
          if (options?.stage3Error) throw options.stage3Error;
          return chatResponse(options?.stage3Output ?? { discoveries: [] });
        },
      },
    },
    responses: {
      create: async () => {
        researchCall += 1;
        if (researchCall === options?.researchErrorAt) throw apiError();
        const response = researchResponse();
        if (researchCall === options?.returnedResearchFailureAt) {
          Object.defineProperty(response, "output_text", {
            get() {
              throw new Error("Could not read returned output");
            },
          });
        }
        return response;
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

async function getFailure(
  client: Parameters<typeof runDiscoveryPipeline>[0],
): Promise<DiscoveryPipelineError> {
  try {
    await runDiscoveryPipeline(client, "data:image/png;base64,YWJj");
  } catch (error) {
    assert.ok(error instanceof DiscoveryPipelineError);
    return error;
  }
  throw new Error("Expected Discovery pipeline to fail");
}

test("original Error details serialize instead of collapsing to an empty object", () => {
  const details = discoveryErrorLogDetails(new Error("provider exploded"));
  assert.equal(details.name, "Error");
  assert.equal(details.message, "provider exploded");
  assert.notEqual(JSON.stringify(details), "{}");
});

test("Stage 1 API failures are classified at Stage 1", async () => {
  const failure = await getFailure(
    fakePipelineClient({ stage1Error: apiError() }),
  );
  assert.equal(failure.diagnostic.failed_stage, "stage1");
  assert.equal(failure.diagnostic.category, "api_error");
  assert.equal(failure.diagnostic.partial_metrics.stage1, null);
});

test("identity verification failures retain the identity stage", async () => {
  const identityStage1 = structuredClone(stage1Fixture);
  identityStage1.candidates[0]!.identity_context_needed = true;
  identityStage1.identity_hypotheses = [
    {
      id: "ih1",
      proposed_identity: "A specific published chart",
      identity_type: "diagram",
      visible_evidence: [
        "The chart has a distinctive final reversal and visible endpoint.",
      ],
      observed_labels_or_numbers: ["2025"],
      region_ids: ["r1"],
      confidence: 0.7,
      verification_would_help: true,
      relevant_question_ids: ["q1"],
    },
  ];
  const failure = await getFailure(
    fakePipelineClient({ stage1: identityStage1, researchErrorAt: 1 }),
  );
  assert.equal(failure.diagnostic.failed_stage, "identity_verification");
  assert.equal(failure.diagnostic.last_completed_stage, "stage1");
});

test("candidate 2 failure preserves candidate 1 metrics and exact ids", async () => {
  const failure = await getFailure(fakePipelineClient({ researchErrorAt: 2 }));
  const diagnostic = failure.diagnostic;
  assert.equal(diagnostic.failed_stage, "research");
  assert.equal(diagnostic.candidate_id, "c2");
  assert.equal(diagnostic.question_id, "q2");
  assert.equal(diagnostic.partial_metrics.research.attempted_calls, 2);
  assert.equal(
    diagnostic.partial_metrics.research.completed_calls[0]?.candidate_id,
    "c1",
  );
  assert.equal(
    diagnostic.partial_metrics.research.completed_calls[0]?.usage.total_tokens,
    120,
  );
  assert.equal(
    typeof diagnostic.partial_metrics.research.completed_calls[0]?.cost_usd,
    "number",
  );
});

test("known usage from a returned failing candidate response is retained", async () => {
  const failure = await getFailure(
    fakePipelineClient({ returnedResearchFailureAt: 2 }),
  );
  assert.equal(
    failure.diagnostic.partial_metrics.research.known_usage?.total_tokens,
    240,
  );
  assert.equal(
    failure.diagnostic.partial_metrics.research.completed_calls.length,
    1,
  );
  assert.equal(failure.diagnostic.partial_metrics.known_total_tokens, 360);
});

test("Stage 3 API failures are classified at Stage 3 with earlier totals", async () => {
  const failure = await getFailure(
    fakePipelineClient({ stage3Error: apiError() }),
  );
  assert.equal(failure.diagnostic.failed_stage, "stage3");
  assert.equal(failure.diagnostic.last_completed_stage, "research");
  assert.equal(failure.diagnostic.partial_metrics.known_total_tokens, 360);
});

test("final schema failures are classified as validation failures", async () => {
  const failure = await getFailure(fakePipelineClient({ stage3Output: {} }));
  assert.equal(failure.diagnostic.failed_stage, "validation");
  assert.equal(failure.diagnostic.category, "schema_validation");
  assert.equal(
    failure.diagnostic.partial_metrics.stage3?.usage.total_tokens,
    120,
  );
});

test("source validation failures receive the safe source category", async () => {
  const failure = await getFailure(
    fakePipelineClient({
      stage3Output: {
        discoveries: [
          {
            id: "d1",
            type: "local",
            title: "A documented ending",
            visual_trigger: "The visible final segment changes direction.",
            observation: "The last point reverses the preceding trend.",
            discovery: "A documented event coincided with the reversal.",
            why_it_matters: "It explains the visible change in direction.",
            explanation: "The timing aligns with the chart endpoint.",
            reinterpretation: "Look back at the final segment as a break.",
            region_ids: ["r1"],
            provenance: "researched",
            confidence: 0.8,
            sources: [{ title: "Unsafe", url: "javascript:alert(1)" }],
            candidate_ids: ["c1"],
          },
        ],
      },
    }),
  );
  assert.equal(failure.diagnostic.failed_stage, "validation");
  assert.equal(failure.diagnostic.category, "source_validation");
});

test("timeouts receive a safe timeout category", () => {
  assert.equal(
    classifyDiscoveryFailure(
      Object.assign(new Error("timed out"), { status: 504 }),
    ),
    "timeout",
  );
});

test("browser diagnostics exclude secrets, image payloads, stacks, and reasoning tokens", async () => {
  const failure = await getFailure(
    fakePipelineClient({ returnedResearchFailureAt: 2 }),
  );
  const serialized = JSON.stringify(failure.diagnostic);
  assert.doesNotMatch(serialized, /reasoning_tokens|stack|api[_-]?key/i);
  assert.doesNotMatch(serialized, /data:image|YWJj|test-bearer-secret/);

  const logDetails = discoveryErrorLogDetails(
    new Error(
      "Authorization: Bearer test-bearer-secret OPENAI_API_KEY=plain-secret data:image/png;base64,YWJj",
    ),
  );
  assert.doesNotMatch(
    JSON.stringify(logDetails),
    /test-bearer-secret|plain-secret|YWJj/,
  );
});

test("failed job status surfaces the safe diagnostic and generic user error", async () => {
  const failure = await getFailure(
    fakePipelineClient({ stage1Error: apiError() }),
  );
  const job = createDiscoveryErrorJob(failure, Date.now());
  assert.equal(job.status, "error");
  assert.equal(job.diagnostic.category, "api_error");
  assert.equal(
    job.error,
    "Discovery failed. Please try again or choose another image.",
  );
});

test("successful Discovery V1 output and metrics remain unchanged", async () => {
  const result = await runDiscoveryPipeline(
    fakePipelineClient(),
    "data:image/png;base64,YWJj",
  );
  assert.equal(result.version, "discovery-engine-v1");
  assert.equal(result.metrics.success, true);
  assert.equal(result.metrics.stage2.calls.length, 2);
  assert.equal(result.metrics.research_gate_passed, 2);
  assert.deepEqual(result.discoveries, []);
});

test("diagnostic JSON contains only the documented safe top-level fields", async () => {
  const failure = await getFailure(fakePipelineClient({ researchErrorAt: 1 }));
  const diagnostic: DiscoveryFailureDiagnostic = failure.diagnostic;
  assert.deepEqual(Object.keys(diagnostic).sort(), [
    "candidate_id",
    "category",
    "elapsed_ms",
    "engine_version",
    "failed_stage",
    "last_completed_stage",
    "message",
    "partial_metrics",
    "question_id",
    "stage_reached",
  ]);
});

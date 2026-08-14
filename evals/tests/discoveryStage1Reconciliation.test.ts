import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscoveryStage1DraftSchema,
  DiscoveryStage1Schema,
  reconcileDiscoveryStage1References,
  type DiscoveryStage1Draft,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_REASONING_EFFORT,
  DISCOVERY_STAGE1_MODEL,
  DiscoveryPipelineError,
  runDiscoveryPipeline,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";

const region = {
  id: "r_chart",
  description: "The declared chart plotting area",
  scope: "local" as const,
  x: 0.1,
  y: 0.1,
  width: 0.8,
  height: 0.7,
};

function regressionDraft(): DiscoveryStage1Draft {
  return {
    image_summary: "A financial chart with annotations and a horizontal test.",
    regions: [{ ...region }],
    candidates: [
      {
        id: "cand_p_annotations",
        question_id: "q_p_annotations",
        visual_trigger: "A cluster of chart annotations is visibly present.",
        observation: "The annotations surround the declared plotting area.",
        region_ids: ["r_chart", "r_platform_label", "r_range_controls"],
        investigation_question: "What do the visible chart annotations mean?",
        research_needed: false,
        research_rationale: "",
        identity_context_needed: false,
      },
      {
        id: "cand_725_test",
        question_id: "q_725_test",
        visual_trigger: "A horizontal level appears near the final candles.",
        observation: "The level is visually aligned with recent candles.",
        region_ids: ["r_final_candles", "r_725_line"],
        investigation_question: "Why is the visible horizontal level marked?",
        research_needed: false,
        research_rationale: "",
        identity_context_needed: false,
      },
    ],
    identity_hypotheses: [
      {
        id: "ih_investing_chart",
        proposed_identity: "A specific financial chart interface",
        identity_type: "figure",
        visible_evidence: [
          "Visible annotations and range controls frame the chart.",
        ],
        observed_labels_or_numbers: ["725"],
        region_ids: ["r_chart", "r_platform_label", "r_range_controls"],
        confidence: 0.6,
        verification_would_help: true,
        relevant_question_ids: ["q_p_annotations", "q_725_test"],
      },
    ],
  };
}

function reconcile(draft: DiscoveryStage1Draft) {
  const structural = DiscoveryStage1DraftSchema.parse(draft);
  const result = reconcileDiscoveryStage1References(structural);
  DiscoveryStage1Schema.parse(result.stage1);
  return result;
}

test("regression removes dangling chart references while preserving declared grounding", () => {
  const draft = regressionDraft();
  const { stage1, diagnostics } = reconcile(draft);

  assert.deepEqual(stage1.regions, [region]);
  assert.deepEqual(
    stage1.candidates.map(({ id }) => id),
    ["cand_p_annotations"],
  );
  assert.deepEqual(stage1.candidates[0]!.region_ids, ["r_chart"]);
  assert.deepEqual(stage1.identity_hypotheses[0]!.region_ids, ["r_chart"]);
  assert.deepEqual(stage1.identity_hypotheses[0]!.relevant_question_ids, [
    "q_p_annotations",
  ]);
  assert.deepEqual(diagnostics, {
    applied: true,
    unknown_candidate_region_references_removed: 4,
    candidate_ids_with_removed_region_references: [
      "cand_p_annotations",
      "cand_725_test",
    ],
    candidate_ids_dropped: ["cand_725_test"],
    unknown_hypothesis_region_references_removed: 2,
    hypothesis_ids_with_removed_region_references: ["ih_investing_chart"],
    unknown_hypothesis_question_references_removed: 1,
    hypothesis_ids_with_removed_question_references: ["ih_investing_chart"],
    hypothesis_ids_dropped: [],
  });
  assert.doesNotMatch(
    JSON.stringify(stage1),
    /r_platform_label|r_range_controls|r_final_candles|r_725_line/,
  );
});

test("candidate with mixed references survives and all-invalid candidate drops without fallback", () => {
  const draft = regressionDraft();
  const { stage1 } = reconcile(draft);
  assert.equal(stage1.candidates.length, 1);
  assert.deepEqual(stage1.candidates[0]!.region_ids, ["r_chart"]);
  assert.equal(stage1.regions.length, 1);
  assert.equal(stage1.regions[0]!.id, "r_chart");
  assert.equal(
    stage1.regions.some(({ scope }) => scope === "global"),
    false,
  );
});

test("hypotheses without valid regions or required surviving questions are dropped", () => {
  const noRegion = regressionDraft();
  noRegion.identity_hypotheses[0]!.region_ids = ["missing"];
  const noRegionResult = reconcile(noRegion);
  assert.equal(noRegionResult.stage1.identity_hypotheses.length, 0);
  assert.deepEqual(noRegionResult.diagnostics.hypothesis_ids_dropped, [
    "ih_investing_chart",
  ]);

  const noQuestion = regressionDraft();
  noQuestion.identity_hypotheses[0]!.relevant_question_ids = ["q_725_test"];
  const noQuestionResult = reconcile(noQuestion);
  assert.equal(noQuestionResult.stage1.identity_hypotheses.length, 0);
  assert.equal(
    noQuestionResult.diagnostics.unknown_hypothesis_question_references_removed,
    1,
  );
});

test("fully valid Stage 1 content is structurally unchanged", () => {
  const valid = regressionDraft();
  valid.candidates = [valid.candidates[0]!];
  valid.candidates[0]!.region_ids = ["r_chart"];
  valid.identity_hypotheses[0]!.region_ids = ["r_chart"];
  valid.identity_hypotheses[0]!.relevant_question_ids = ["q_p_annotations"];
  const { stage1, diagnostics } = reconcile(valid);
  assert.deepEqual(stage1, valid);
  assert.equal(diagnostics.applied, false);
});

test("duplicate IDs, invalid coordinates, and malformed structures still fail closed", () => {
  const duplicate = regressionDraft();
  duplicate.regions.push({ ...region });
  const reconciledDuplicate = reconcileDiscoveryStage1References(
    DiscoveryStage1DraftSchema.parse(duplicate),
  );
  assert.throws(
    () => DiscoveryStage1Schema.parse(reconciledDuplicate.stage1),
    /Duplicate region id/,
  );

  const invalidCoordinates = regressionDraft();
  invalidCoordinates.regions[0]!.x = 0.9;
  invalidCoordinates.regions[0]!.width = 0.8;
  assert.throws(
    () => DiscoveryStage1DraftSchema.parse(invalidCoordinates),
    /bounds must remain/,
  );

  assert.throws(
    () =>
      DiscoveryStage1DraftSchema.parse({
        regions: [],
        candidates: "not-an-array",
      }),
    /invalid_type|expected/i,
  );
});

interface CapturedRequest {
  model?: string;
  reasoning_effort?: string;
  messages?: unknown;
}

function chatResponse(content: unknown) {
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

function pipelineClient(stage1: unknown, events: string[]) {
  let chatCalls = 0;
  return {
    chat: {
      completions: {
        create: async (request: CapturedRequest) => {
          chatCalls += 1;
          events.push(chatCalls === 1 ? "stage1" : "stage3");
          if (chatCalls === 1) return chatResponse(stage1);
          return chatResponse({ discoveries: [] });
        },
      },
    },
    responses: {
      create: async () => {
        events.push("identity");
        return {
          model: "gpt-5.6-terra",
          output_text: JSON.stringify({
            status: "unverified",
            hypothesis_id: "ih_investing_chart",
            canonical_identity: null,
            identity_type: null,
            location: null,
            verification_basis: "The exact subject was not established.",
            confidence: 0.2,
            match_evidence: [
              {
                basis: "generic_visual_similarity",
                detail: "The visible chart structure is not unique.",
              },
            ],
          }),
          output: [],
          usage: {
            input_tokens: 100,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 20,
            output_tokens_details: { reasoning_tokens: 5 },
            total_tokens: 120,
          },
        };
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
}

test("production continues after one-call dangling-reference repair and exposes safe diagnostics", async () => {
  const events: string[] = [];
  const result = await runDiscoveryPipeline(
    pipelineClient(regressionDraft(), events),
    "data:image/png;base64,YWJj",
  );
  assert.deepEqual(events, ["stage1", "identity", "stage3"]);
  assert.equal(result.metrics.success, true);
  assert.equal(result.inspection.stage1.candidates.length, 1);
  assert.equal(
    result.inspection.stage1_reconciliation
      .unknown_candidate_region_references_removed,
    4,
  );
  assert.deepEqual(
    result.inspection.stage1_reconciliation.candidate_ids_dropped,
    ["cand_725_test"],
  );
  assert.doesNotMatch(
    JSON.stringify(result.inspection.stage1_reconciliation),
    /prompt|raw|response|secret|OPENAI_API_KEY|sk-/i,
  );
});

test("strict post-repair failure makes one Stage 1 call and invokes no downstream stage", async () => {
  const duplicate = regressionDraft();
  duplicate.regions.push({ ...region });
  const events: string[] = [];
  await assert.rejects(
    runDiscoveryPipeline(
      pipelineClient(duplicate, events),
      "data:image/png;base64,YWJj",
    ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoveryPipelineError);
      assert.equal(error.diagnostic.failed_stage, "stage1");
      assert.equal(error.diagnostic.category, "schema_validation");
      assert.equal(error.diagnostic.stage1_reconciliation?.applied, true);
      assert.equal(
        error.diagnostic.stage1_reconciliation
          ?.unknown_candidate_region_references_removed,
        4,
      );
      return true;
    },
  );
  assert.deepEqual(events, ["stage1"]);
});

test("Stage 1 production model, reasoning, and joint-evidence safeguards remain unchanged", async () => {
  const requests: CapturedRequest[] = [];
  let chatCalls = 0;
  const client = {
    chat: {
      completions: {
        create: async (request: CapturedRequest) => {
          requests.push(request);
          chatCalls += 1;
          return chatCalls === 1
            ? chatResponse(regressionDraft())
            : chatResponse({ discoveries: [] });
        },
      },
    },
    responses: {
      create: async () => ({
        model: "gpt-5.6-terra",
        output_text: JSON.stringify({
          status: "unverified",
          hypothesis_id: "ih_investing_chart",
          canonical_identity: null,
          identity_type: null,
          location: null,
          verification_basis: "The exact subject was not established.",
          confidence: 0.2,
          match_evidence: [
            {
              basis: "generic_visual_similarity",
              detail: "The visible chart structure is not unique.",
            },
          ],
        }),
        output: [],
        usage: {
          input_tokens: 100,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens: 20,
          output_tokens_details: { reasoning_tokens: 5 },
          total_tokens: 120,
        },
      }),
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];
  await runDiscoveryPipeline(client, "data:image/png;base64,YWJj");
  assert.equal(requests[0]!.model, DISCOVERY_STAGE1_MODEL);
  assert.equal(requests[0]!.reasoning_effort, DISCOVERY_REASONING_EFFORT);
  const prompt = JSON.stringify(requests[0]!.messages);
  assert.match(
    prompt,
    /Combine multiple independent visible clues when they jointly narrow the identity/,
  );
  assert.match(prompt, /stay broad rather than guessing/);
});

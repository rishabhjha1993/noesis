/// <reference lib="dom" />

import test from "node:test";
import assert from "node:assert/strict";
import type { DiscoveryRunResult } from "../../lib/api-client-react/src/discovery";
import {
  createDiscoveryEvalPayload,
  findUnsafeEvalFieldPaths,
  serializeDiscoveryEvalPayload,
} from "../../artifacts/noesis/src/lib/discoveryEval";

const resultFixture: DiscoveryRunResult = {
  version: "discovery-engine-v1",
  regions: [
    {
      id: "r1",
      description: "The final two plotted points",
      scope: "local",
      x: 0.65,
      y: 0.2,
      width: 0.3,
      height: 0.5,
    },
  ],
  discoveries: [
    {
      id: "d1",
      type: "local",
      title: "The ending reverses",
      visual_trigger: "The final line segment turns upward.",
      observation: "The last point is above the preceding point.",
      discovery: "The series ends with a reversal.",
      why_it_matters: "The endpoint changes the apparent trajectory.",
      explanation: "Compare the last segment with the segment before it.",
      reinterpretation:
        "Look back at the final bend, not just the average trend.",
      region_ids: ["r1"],
      provenance: "researched",
      confidence: 0.91,
      sources: [{ title: "Primary source", url: "https://example.com/source" }],
    },
  ],
  inspection: {
    stage1: {
      image_summary: "A chart with a visible late-series reversal.",
      regions: [
        {
          id: "r1",
          description: "The final two plotted points",
          scope: "local",
          x: 0.65,
          y: 0.2,
          width: 0.3,
          height: 0.5,
        },
      ],
      candidates: [
        {
          id: "c1",
          question_id: "q1",
          visual_trigger: "The final line segment reverses sharply upward.",
          observation:
            "The plotted series changes direction at the last point.",
          region_ids: ["r1"],
          investigation_question:
            "Did a documented event cause the visible reversal at the final point?",
          research_needed: true,
          research_rationale:
            "A verified event could explain the visible direction change.",
          identity_context_needed: true,
        },
      ],
      identity_hypotheses: [
        {
          id: "ih1",
          proposed_identity: "Example reversal chart",
          identity_type: "figure",
          visible_evidence: ["The final segment reverses sharply upward."],
          observed_labels_or_numbers: ["2026"],
          region_ids: ["r1"],
          confidence: 0.72,
          verification_would_help: true,
          relevant_question_ids: ["q1"],
        },
      ],
    },
    identity_verification: {
      status: "verified",
      hypothesis_id: "ih1",
      canonical_identity: "Example reversal chart",
      identity_type: "figure",
      location: null,
      verification_basis: "A source explicitly identifies the chart.",
      confidence: 0.94,
      match_evidence: [
        {
          basis: "source_explicit_identification",
          detail: "The source explicitly names the figure and its endpoint.",
        },
      ],
      sources: [
        { title: "Identity source", url: "https://example.com/identity" },
      ],
    },
    research_results: [
      {
        candidate_id: "c1",
        question_id: "q1",
        question:
          "Did a documented event cause the visible reversal at the final point?",
        status: "answered",
        finding: "A documented event coincided with the reversal.",
        sources: [
          { title: "Primary source", url: "https://example.com/source" },
        ],
      },
    ],
    discovery_candidates: { d1: ["c1"] },
  },
  metrics: {
    timestamp: "2026-08-10T12:00:00.000Z",
    engine_version: "discovery-engine-v1",
    success: true,
    stage1: {
      usage: {
        model: "gpt-5.6-sol",
        reasoning_effort: "medium",
        input_tokens: 100,
        cached_input_tokens: 0,
        output_tokens: 40,
        reasoning_tokens: 10,
        total_tokens: 140,
        latency_ms: 1000,
      },
      cost_usd: 0.0017,
      cost_reason: null,
    },
    stage2: {
      model: "gpt-5.6-terra",
      reasoning_effort: "medium",
      questions_sent: 1,
      latency_ms: 1600,
      usage: {
        model: "gpt-5.6-terra",
        reasoning_effort: "medium",
        input_tokens: 160,
        cached_input_tokens: 0,
        output_tokens: 60,
        reasoning_tokens: 16,
        total_tokens: 220,
        latency_ms: 1600,
      },
      cost_usd: 0.0013,
      identity_verification: {
        ran: true,
        status: "verified",
        usage: {
          model: "gpt-5.6-terra",
          reasoning_effort: "medium",
          input_tokens: 80,
          cached_input_tokens: 0,
          output_tokens: 30,
          reasoning_tokens: 8,
          total_tokens: 110,
          latency_ms: 800,
        },
        cost_usd: 0.00065,
        cost_reason: null,
      },
      candidate_calls_using_verified_identity: 1,
      calls: [
        {
          candidate_id: "c1",
          question_id: "q1",
          status: "answered",
          used_verified_identity_context: true,
          usage: {
            model: "gpt-5.6-terra",
            reasoning_effort: "medium",
            input_tokens: 80,
            cached_input_tokens: 0,
            output_tokens: 30,
            reasoning_tokens: 8,
            total_tokens: 110,
            latency_ms: 800,
          },
          cost_usd: 0.00065,
          cost_reason: null,
        },
      ],
    },
    stage3: {
      usage: {
        model: "gpt-5.6-sol",
        reasoning_effort: "medium",
        input_tokens: 200,
        cached_input_tokens: 0,
        output_tokens: 80,
        reasoning_tokens: 20,
        total_tokens: 280,
        latency_ms: 1200,
      },
      cost_usd: 0.0034,
      cost_reason: null,
      discoveries_returned: 1,
    },
    total_latency_ms: 3800,
    total_cost_usd: 0.0064,
    stage1_candidates: 1,
    research_gate_passed: 1,
    final_discoveries: 1,
  },
};

test("full eval payload preserves all validated V1 artifacts and cache identity", () => {
  const payload = createDiscoveryEvalPayload({
    result: resultFixture,
    discoveryId: "run-123",
    cacheHit: true,
  });
  assert.equal(payload.discovery_id, "run-123");
  assert.equal(payload.version, "discovery-engine-v1");
  assert.equal(payload.cache_hit, true);
  assert.deepEqual(payload.inspection.stage1, resultFixture.inspection.stage1);
  assert.deepEqual(
    payload.inspection.research_results,
    resultFixture.inspection.research_results,
  );
  assert.deepEqual(
    payload.inspection.identity_verification,
    resultFixture.inspection.identity_verification,
  );
  assert.deepEqual(payload.discoveries, resultFixture.discoveries);
  assert.equal(payload.metrics.stage2.calls[0]!.question_id, "q1");
  assert.equal(
    payload.metrics.total_cost_usd,
    resultFixture.metrics.total_cost_usd,
  );
  assert.equal("reasoning_tokens" in payload.metrics.stage1.usage, false);
  assert.equal("reasoning_tokens" in payload.metrics.stage2.usage, false);
  assert.equal(
    "reasoning_tokens" in payload.metrics.stage2.identity_verification.usage!,
    false,
  );
  assert.equal(
    "reasoning_tokens" in payload.metrics.stage2.calls[0]!.usage,
    false,
  );
  assert.equal("reasoning_tokens" in payload.metrics.stage3.usage, false);
});

test("serialized full eval JSON parses and contains no internal-only field names", () => {
  const serialized = serializeDiscoveryEvalPayload({
    result: resultFixture,
    discoveryId: "run-123",
    cacheHit: false,
  });
  const parsed: unknown = JSON.parse(serialized);
  assert.equal(findUnsafeEvalFieldPaths(parsed).length, 0);
  assert.doesNotMatch(
    serialized,
    /OPENAI_API_KEY|authorization|raw_usage|reasoning_tokens|stack_trace/,
  );
});

test("eval serialization fails closed if an internal-only field appears", () => {
  const unsafe = structuredClone(resultFixture) as DiscoveryRunResult & {
    metrics: DiscoveryRunResult["metrics"] & { stack_trace: string };
  };
  unsafe.metrics.stack_trace = "internal detail";
  assert.throws(() =>
    serializeDiscoveryEvalPayload({
      result: unsafe,
      discoveryId: "run-123",
      cacheHit: false,
    }),
  );
});

import { readFile } from "node:fs/promises";
import {
  DiscoveryIdentityVerificationSchema,
  DiscoveryStage1Schema,
  evaluateResearchGate,
  identityApplicableCandidateIds,
  validateDiscoveryOutput,
  validateResearchResults,
  type DiscoveryCandidate,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_CANDIDATE_RESEARCH_MODELS,
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_REASONING_EFFORT,
  buildDiscoveryCandidateResearchRequest,
  runDiscoveryCandidateResearchCall,
  type DiscoveryCandidateResearchModel,
  type DiscoveryResearchCallMetrics,
} from "../artifacts/api-server/src/lib/discoveryPipeline";

export const DISCOVERY_RESEARCH_REPLAY_VERSION =
  "noesis-discovery-research-replay-v1";

interface RetainedResultShape {
  version?: unknown;
  regions?: unknown;
  discoveries?: unknown;
  inspection?: unknown;
  metrics?: unknown;
}

interface RetainedEnvelopeShape {
  status?: unknown;
  discovery_id?: unknown;
  result?: unknown;
}

export interface RetainedDiscoveryReplayInput {
  sourceDiscoveryId: string;
  sourceEngineVersion: string;
  stage1: DiscoveryStage1;
  identityVerification: DiscoveryIdentityVerification;
  retainedResearchResults: DiscoveryResearchResult[];
  retainedCandidateCosts: Map<string, number | null>;
}

export interface DiscoveryResearchReplayPlanCandidate {
  candidate: DiscoveryCandidate;
  usedVerifiedIdentityContext: boolean;
  retainedStatus: "answered" | "insufficient";
  retainedTotalKnownCostUsd: number | null;
}

export interface DiscoveryResearchReplayPlan {
  input: RetainedDiscoveryReplayInput;
  model: DiscoveryCandidateResearchModel;
  candidates: DiscoveryResearchReplayPlanCandidate[];
  outputPath: string | null;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function candidateCosts(metrics: unknown): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const metricsRecord = record(metrics, "Retained result metrics are missing");
  const stage2 = record(
    metricsRecord.stage2,
    "Retained result Stage 2 metrics are missing",
  );
  if (!Array.isArray(stage2.calls)) return result;
  for (const item of stage2.calls) {
    const call = record(item, "Retained candidate-call metrics are malformed");
    const candidateId = nonEmptyString(
      call.candidate_id,
      "Retained candidate-call metrics lack a candidate id",
    );
    const cost = call.total_known_cost_usd;
    if (cost !== null && typeof cost !== "number") {
      throw new Error("Retained candidate-call cost is malformed");
    }
    result.set(candidateId, cost as number | null);
  }
  return result;
}

export function parseRetainedDiscoveryReplayInput(
  value: unknown,
  suppliedDiscoveryId?: string,
): RetainedDiscoveryReplayInput {
  const envelope = record(value, "Retained replay input must be a JSON object");
  const envelopeShape = envelope as RetainedEnvelopeShape;
  if ("status" in envelope && envelopeShape.status !== "done") {
    throw new Error("Retained replay input is not a successful completed job");
  }
  const rawResult = envelopeShape.result ?? envelope;
  const result = record(
    rawResult,
    "Retained replay input does not contain a result",
  ) as RetainedResultShape;
  if (result.version !== DISCOVERY_ENGINE_VERSION) {
    throw new Error(
      `Retained replay input must use ${DISCOVERY_ENGINE_VERSION}`,
    );
  }
  const metrics = record(result.metrics, "Retained result metrics are missing");
  if (metrics.success !== true) {
    throw new Error("Retained replay input is not a successful Discovery run");
  }
  const inspection = record(
    result.inspection,
    "Retained result inspection is missing",
  );
  if (!("stage1" in inspection)) {
    throw new Error("Retained replay input does not contain Stage 1");
  }
  const stage1 = DiscoveryStage1Schema.parse(inspection.stage1);
  if (JSON.stringify(result.regions) !== JSON.stringify(stage1.regions)) {
    throw new Error("Retained result regions do not match retained Stage 1");
  }
  const identityVerification = DiscoveryIdentityVerificationSchema.parse(
    inspection.identity_verification,
  );
  if (identityVerification.status !== "verified") {
    throw new Error(
      "Research replay requires retained verified identity context",
    );
  }
  const retainedResearchResults = validateResearchResults(
    stage1,
    inspection.research_results,
  );

  if (Array.isArray(result.discoveries)) {
    const discoveryCandidates = record(
      inspection.discovery_candidates,
      "Retained discovery-to-candidate mappings are missing",
    );
    const drafts = result.discoveries.map((item) => {
      const discovery = record(item, "Retained discovery is malformed");
      const existingCandidateIds = discovery.candidate_ids;
      return {
        ...discovery,
        candidate_ids:
          existingCandidateIds ?? discoveryCandidates[String(discovery.id)],
      };
    });
    validateDiscoveryOutput(
      stage1,
      retainedResearchResults,
      { discoveries: drafts },
      identityVerification,
    );
  }

  const embeddedDiscoveryId =
    envelopeShape.discovery_id ??
    (rawResult as Record<string, unknown>).discovery_id;
  const sourceDiscoveryId = nonEmptyString(
    suppliedDiscoveryId ?? embeddedDiscoveryId,
    "Retained input does not embed a discovery id; pass --source-discovery-id",
  );
  return {
    sourceDiscoveryId,
    sourceEngineVersion: result.version,
    stage1,
    identityVerification,
    retainedResearchResults,
    retainedCandidateCosts: candidateCosts(result.metrics),
  };
}

export async function loadRetainedDiscoveryReplayInput(
  inputPath: string,
  suppliedDiscoveryId?: string,
): Promise<RetainedDiscoveryReplayInput> {
  return parseRetainedDiscoveryReplayInput(
    JSON.parse(await readFile(inputPath, "utf8")),
    suppliedDiscoveryId,
  );
}

export function isDiscoveryCandidateResearchModel(
  value: string,
): value is DiscoveryCandidateResearchModel {
  return DISCOVERY_CANDIDATE_RESEARCH_MODELS.some((model) => model === value);
}

export function createDiscoveryResearchReplayPlan(
  input: RetainedDiscoveryReplayInput,
  model: DiscoveryCandidateResearchModel,
  outputPath?: string,
): DiscoveryResearchReplayPlan {
  const applicable = new Set(
    identityApplicableCandidateIds(input.stage1, input.identityVerification),
  );
  const retainedByCandidate = new Map(
    input.retainedResearchResults.map((result) => [result.candidate_id, result]),
  );
  const candidates = input.stage1.candidates
    .filter((candidate) => evaluateResearchGate(input.stage1, candidate).allowed)
    .map((candidate) => {
      const retained = retainedByCandidate.get(candidate.id);
      if (!retained) {
        throw new Error(
          `Retained input lacks research result for candidate ${candidate.id}`,
        );
      }
      return {
        candidate,
        usedVerifiedIdentityContext: applicable.has(candidate.id),
        retainedStatus: retained.status,
        retainedTotalKnownCostUsd:
          input.retainedCandidateCosts.get(candidate.id) ?? null,
      };
    });
  return { input, model, candidates, outputPath: outputPath ?? null };
}

export function createDiscoveryResearchReplayDryRun(
  plan: DiscoveryResearchReplayPlan,
) {
  return {
    replay_version: DISCOVERY_RESEARCH_REPLAY_VERSION,
    mode: "dry-run" as const,
    input_valid: true,
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    identity_status: plan.input.identityVerification.status,
    stage1_candidate_count: plan.input.stage1.candidates.length,
    research_gate_passed: plan.candidates.length,
    planned_api_calls: plan.candidates.length,
    selected_candidate_research_model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    output_path: plan.outputPath,
    candidates: plan.candidates.map((item) => ({
      candidate_id: item.candidate.id,
      question_id: item.candidate.question_id,
      used_verified_identity_context: item.usedVerifiedIdentityContext,
    })),
  };
}

function sumNullable(values: Array<number | null>): number | null {
  return values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
}

export async function executeDiscoveryResearchReplay(
  openai: Parameters<typeof runDiscoveryCandidateResearchCall>[0],
  plan: DiscoveryResearchReplayPlan,
) {
  const started = Date.now();
  const completed: Array<{
    result: DiscoveryResearchResult;
    call: DiscoveryResearchCallMetrics;
  }> = [];
  for (const item of plan.candidates) {
    const call = await runDiscoveryCandidateResearchCall(
      openai,
      plan.input.stage1,
      item.candidate,
      plan.input.identityVerification,
      plan.model,
    );
    completed.push(call);
  }
  const output = {
    replay_version: DISCOVERY_RESEARCH_REPLAY_VERSION,
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    selected_candidate_research_model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    retained_identity_reused: true,
    verified_identity: {
      hypothesis_id: plan.input.identityVerification.hypothesis_id,
      canonical_identity: plan.input.identityVerification.canonical_identity,
      identity_type: plan.input.identityVerification.identity_type,
      location: plan.input.identityVerification.location,
      verification_basis: plan.input.identityVerification.verification_basis,
      confidence: plan.input.identityVerification.confidence,
      validated_sources: plan.input.identityVerification.sources,
    },
    candidates: completed.map(({ result, call }, index) => ({
      candidate_id: result.candidate_id,
      question_id: result.question_id,
      approved_question: result.question,
      used_verified_identity_context: call.used_verified_identity_context,
      status: result.status,
      finding: result.finding,
      validated_sources: result.sources,
      model: call.usage.model,
      input_tokens: call.usage.input_tokens,
      cached_input_tokens: call.usage.cached_input_tokens,
      output_tokens: call.usage.output_tokens,
      reasoning_tokens: call.usage.reasoning_tokens,
      total_tokens: call.usage.total_tokens,
      latency_ms: call.usage.latency_ms,
      web_search_calls: call.web_search_calls,
      model_token_cost_usd: call.model_token_cost_usd,
      tool_cost_usd: call.tool_cost_usd,
      total_known_cost_usd: call.total_known_cost_usd,
      retained_baseline: {
        status: plan.candidates[index]!.retainedStatus,
        total_known_cost_usd:
          plan.candidates[index]!.retainedTotalKnownCostUsd,
      },
    })),
    attempted_count: completed.length,
    answered_count: completed.filter(
      ({ result }) => result.status === "answered",
    ).length,
    insufficient_count: completed.filter(
      ({ result }) => result.status === "insufficient",
    ).length,
    total_model_tokens: sumNullable(
      completed.map(({ call }) => call.usage.total_tokens),
    ),
    total_web_search_calls: completed.reduce(
      (sum, { call }) => sum + call.web_search_calls,
      0,
    ),
    total_model_token_cost_usd: sumNullable(
      completed.map(({ call }) => call.model_token_cost_usd),
    ),
    total_tool_cost_usd: completed.reduce(
      (sum, { call }) => sum + call.tool_cost_usd,
      0,
    ),
    total_known_cost_usd: sumNullable(
      completed.map(({ call }) => call.total_known_cost_usd),
    ),
    total_latency_ms: Date.now() - started,
  };
  assertSafeDiscoveryResearchReplayOutput(output);
  return output;
}

export function assertSafeDiscoveryResearchReplayOutput(value: unknown): void {
  const forbiddenKey =
    /(^|_)(api_key|authorization|cookie|environment|headers|password|private_key|prompt|raw|request|secret|stack)(_|$)/i;
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKey.test(key)) {
        throw new Error("Replay output contains an internal-only field");
      }
      visit(child);
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  if (/sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY/i.test(serialized)) {
    throw new Error("Replay output contains a secret-like value");
  }
}

export function candidateResearchRequestsForPlan(
  plan: DiscoveryResearchReplayPlan,
) {
  return plan.candidates.map((item) =>
    buildDiscoveryCandidateResearchRequest(
      plan.input.stage1,
      item.candidate,
      plan.input.identityVerification,
      plan.model,
    ),
  );
}

import { readFile } from "node:fs/promises";
import {
  DiscoverySourceValidationError,
  DiscoveryStage1Schema,
  validateDiscoveryOutput,
  validateResearchResults,
  type Discovery,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
  type DiscoverySourceValidationDetail,
} from "../artifacts/api-server/src/lib/discoveryContracts";
import {
  normalizeChatUsage,
  stageMetrics,
} from "../artifacts/api-server/src/lib/discoveryPipeline";
import {
  V2_HYBRID_ENGINE_VERSION,
  buildV2HybridFinalRequest,
} from "../artifacts/api-server/src/lib/discoveryHybridV2";
import type {
  DiscoveryReplayChatClient,
  DiscoveryReplayStageMetrics,
} from "./discoveryStage1Replay";
import type { DiscoveryResearchReplayImage } from "./discoveryResearchReplay";

export const DISCOVERY_STAGE3_REPLAY_VERSION =
  "noesis-discovery-stage3-replay-v1";

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

export interface RetainedStage3ReplayInput {
  sourceDiscoveryId: string;
  sourceEngineVersion: typeof V2_HYBRID_ENGINE_VERSION;
  stage1: DiscoveryStage1;
  researchResults: DiscoveryResearchResult[];
}

/**
 * Parse a retained SUCCESSFUL V2 Hybrid discovery envelope into a frozen Stage-3 packet.
 * Unlike the V1-oriented research-replay adapter, this requires the V2 engine and the
 * V2 identity contract (no standalone identity verification → `identity_verification`
 * must be null). Fails clearly on any missing field; never fabricates data.
 */
export function parseRetainedStage3ReplayInput(
  value: unknown,
  suppliedDiscoveryId?: string,
): RetainedStage3ReplayInput {
  const envelope = record(value, "Retained replay input must be a JSON object");
  if ("status" in envelope && envelope.status !== "done") {
    throw new Error("Retained replay input is not a successful completed job");
  }
  const rawResult = (envelope.result as unknown) ?? envelope;
  const result = record(
    rawResult,
    "Retained replay input does not contain a result",
  );
  if (result.version !== V2_HYBRID_ENGINE_VERSION) {
    throw new Error(
      `Stage-3 replay requires a ${V2_HYBRID_ENGINE_VERSION} run`,
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
  if (
    !("identity_verification" in inspection) ||
    inspection.identity_verification !== null
  ) {
    throw new Error(
      "V2 Stage-3 replay expects inspection.identity_verification to be null",
    );
  }
  if (!("research_results" in inspection)) {
    throw new Error("Retained replay input does not contain research_results");
  }
  const researchResults = validateResearchResults(
    stage1,
    inspection.research_results,
  );
  const sourceDiscoveryId = nonEmptyString(
    suppliedDiscoveryId ?? (envelope.discovery_id as unknown),
    "Retained input does not embed a discovery id; pass --source-discovery-id",
  );
  return {
    sourceDiscoveryId,
    sourceEngineVersion: V2_HYBRID_ENGINE_VERSION,
    stage1,
    researchResults,
  };
}

export async function loadRetainedStage3ReplayInput(
  inputPath: string,
  suppliedDiscoveryId?: string,
): Promise<RetainedStage3ReplayInput> {
  return parseRetainedStage3ReplayInput(
    JSON.parse(await readFile(inputPath, "utf8")),
    suppliedDiscoveryId,
  );
}

export interface DiscoveryStage3ReplayPlan {
  version: typeof DISCOVERY_STAGE3_REPLAY_VERSION;
  replay: "stage3-only";
  input: RetainedStage3ReplayInput;
  candidates: Array<{
    candidate_id: string;
    question_id: string;
    status: "answered" | "insufficient";
    source_count: number;
  }>;
  outputPath: string | null;
}

export function createDiscoveryStage3ReplayPlan(
  input: RetainedStage3ReplayInput,
  outputPath?: string | null,
): DiscoveryStage3ReplayPlan {
  const statusByCandidate = new Map(
    input.researchResults.map((result) => [result.candidate_id, result]),
  );
  return {
    version: DISCOVERY_STAGE3_REPLAY_VERSION,
    replay: "stage3-only",
    input,
    candidates: input.stage1.candidates.map((candidate) => {
      const result = statusByCandidate.get(candidate.id);
      return {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        status: result?.status ?? "insufficient",
        source_count: result?.sources.length ?? 0,
      };
    }),
    outputPath: outputPath ?? null,
  };
}

export function createDiscoveryStage3ReplayDryRun(
  plan: DiscoveryStage3ReplayPlan,
): {
  version: typeof DISCOVERY_STAGE3_REPLAY_VERSION;
  mode: "dry-run";
  source_discovery_id: string;
  engine_version: typeof V2_HYBRID_ENGINE_VERSION;
  candidates: DiscoveryStage3ReplayPlan["candidates"];
  note: string;
} {
  return {
    version: DISCOVERY_STAGE3_REPLAY_VERSION,
    mode: "dry-run",
    source_discovery_id: plan.input.sourceDiscoveryId,
    engine_version: plan.input.sourceEngineVersion,
    candidates: plan.candidates,
    note: "No model call performed. Re-run with --execute (and --image) to call Final Sol.",
  };
}

export interface DiscoveryStage3ReplayResult {
  version: typeof DISCOVERY_STAGE3_REPLAY_VERSION;
  replay: "stage3-only";
  source_discovery_id: string;
  engine_version: typeof V2_HYBRID_ENGINE_VERSION;
  image_sha256: string;
  outcome: "validated" | "source_validation_failed";
  discoveries: Discovery[];
  discovery_candidates: Record<string, string[]>;
  source_validation_detail: DiscoverySourceValidationDetail | null;
  metrics: DiscoveryReplayStageMetrics;
}

/**
 * Runs ONLY Final Sol against a frozen Stage-1 + research packet and the original image,
 * then applies the SAME production deterministic validation
 * (`validateDiscoveryOutput`) with V2 semantics (null identity). It never calls Stage 1,
 * candidate research, or web search. A candidate-local source-ownership failure is
 * surfaced through the safe `DiscoverySourceValidationError.detail`.
 */
export async function executeDiscoveryStage3Replay(
  openai: DiscoveryReplayChatClient,
  plan: DiscoveryStage3ReplayPlan,
  image: DiscoveryResearchReplayImage,
): Promise<DiscoveryStage3ReplayResult> {
  const { stage1, researchResults } = plan.input;
  const request = buildV2HybridFinalRequest(
    image.dataUrl,
    stage1,
    researchResults,
  );
  const started = Date.now();
  const response = await openai.chat.completions.create(request);
  const usage = normalizeChatUsage(response, Date.now() - started, "openai");
  const metrics = stageMetrics(usage);
  const text = response.choices[0]?.message.content;
  if (!text) throw new Error("Stage-3 replay returned an empty response");
  const parsed = JSON.parse(text);

  const safeMetrics: DiscoveryReplayStageMetrics = {
    model: usage.model,
    reasoning_effort: usage.reasoning_effort,
    input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    latency_ms: usage.latency_ms,
    web_search_calls: metrics.web_search_calls,
    model_token_cost_usd: metrics.model_token_cost_usd,
    tool_cost_usd: metrics.tool_cost_usd,
    total_known_cost_usd: metrics.total_known_cost_usd,
  };

  try {
    // V2 semantics: no identity verification → null identity, empty applicable set.
    const validated = validateDiscoveryOutput(stage1, researchResults, parsed);
    return {
      version: DISCOVERY_STAGE3_REPLAY_VERSION,
      replay: "stage3-only",
      source_discovery_id: plan.input.sourceDiscoveryId,
      engine_version: plan.input.sourceEngineVersion,
      image_sha256: image.sha256,
      outcome: "validated",
      discoveries: validated.discoveries,
      discovery_candidates: validated.discoveryCandidates,
      source_validation_detail: null,
      metrics: safeMetrics,
    };
  } catch (error) {
    if (error instanceof DiscoverySourceValidationError) {
      return {
        version: DISCOVERY_STAGE3_REPLAY_VERSION,
        replay: "stage3-only",
        source_discovery_id: plan.input.sourceDiscoveryId,
        engine_version: plan.input.sourceEngineVersion,
        image_sha256: image.sha256,
        outcome: "source_validation_failed",
        discoveries: [],
        discovery_candidates: {},
        source_validation_detail: error.detail,
        metrics: safeMetrics,
      };
    }
    throw error;
  }
}

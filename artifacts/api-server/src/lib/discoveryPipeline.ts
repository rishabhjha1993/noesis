import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import {
  DISCOVERY_IDENTITY_VERIFICATION_JSON_SCHEMA,
  DISCOVERY_STAGE1_JSON_SCHEMA,
  DISCOVERY_STAGE3_JSON_SCHEMA,
  DiscoveryStage1DraftSchema,
  DiscoveryStage1Schema,
  evaluateResearchGate,
  identityApplicableCandidateIds,
  reconcileDiscoveryStage1References,
  validateIdentityVerification,
  validateDiscoveryOutput,
  validateResearchResults,
  type Discovery,
  type DiscoveryCandidate,
  type DiscoveryInspection,
  type DiscoveryIdentityVerification,
  type DiscoveryRegion,
  type DiscoveryResearchResult,
  type DiscoverySource,
  type DiscoveryStage1,
  type DiscoveryStage1ReconciliationDiagnostics,
} from "./discoveryContracts";
import {
  DISCOVERY_BATCHED_RESEARCH_JSON_SCHEMA,
  DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
  DiscoveryBatchValidationError,
  buildDiscoveryBatchContext,
  validateDiscoveryBatchResults,
  type DiscoveryBatchCandidateContext,
  type DiscoveryBatchCitation,
  type DiscoveryBatchFailureScope,
  type DiscoveryBatchIdentityMapping,
  type DiscoveryBatchValidationCategory,
  type DiscoveryBatchValidationIssue,
} from "./discoveryBatchResearch";
import { estimateModelCost, estimateWebSearchToolCost } from "./modelPricing";
import {
  FROZEN_V1_ENGINE_VERSION,
  FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
  FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA,
  FROZEN_V1_REASONING_EFFORT,
  FROZEN_V1_RESEARCH_INSTRUCTIONS,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE1_PROMPT,
  FROZEN_V1_STAGE2_MODEL,
  FROZEN_V1_STAGE3_MODEL,
  FROZEN_V1_STAGE3_PROMPT,
  buildFrozenV1IdentityInput,
  buildFrozenV1ResearchRequest,
  buildFrozenV1Stage3Context,
  frozenV1ApplicableCandidateIds,
} from "./discoveryFrozenV1";
import {
  DEEPSEEK_V1_ENGINE_VERSION,
  DEEPSEEK_V1_MODEL,
  DEEPSEEK_V1_REASONING_EFFORT,
  DeepSeekDiscoveryError,
  buildDeepSeekIdentitySemanticRepairRequest,
  buildDeepSeekV1IdentityRequest,
  buildDeepSeekV1ResearchRequest,
  buildDeepSeekV1Stage3Request,
  createDeepSeekResponse,
  parseDeepSeekStructuredOutput,
  preservesDeepSeekIdentityRepairConclusion,
  recoverableDeepSeekIdentityContradiction,
  type DeepSeekClient,
  type DeepSeekRequestOptions,
} from "./discoveryDeepSeekV1";
import {
  V2_HYBRID_ENGINE_VERSION,
  V2_HYBRID_IDENTITY_TIMEOUT_MS,
  V2_HYBRID_REASONING_EFFORT,
  V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
  V2_HYBRID_STAGE1_MODEL,
  V2_HYBRID_STAGE3_MODEL,
  buildV2HybridFinalRequest,
  createV2HybridIdentityRequestOptions,
} from "./discoveryHybridV2";

export const DISCOVERY_ENGINE_VERSION = "discovery-engine-v1";
export const DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION =
  "discovery-engine-v1-batched-research";
export const DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION =
  "discovery-engine-v1-luna-research";
export type DiscoveryEngineVariant =
  | "v1"
  | "v1-frozen"
  | "v1-batched-research"
  | "v1-luna-research"
  | "v1-deepseek-pro"
  | "v2-hybrid";
export const DEFAULT_DISCOVERY_ENGINE_VARIANT: DiscoveryEngineVariant = "v1";
export const DISCOVERY_STAGE1_MODEL = "gpt-5.6-sol";
export const DISCOVERY_STAGE2_MODEL = "gpt-5.6-terra";
export const DISCOVERY_LUNA_RESEARCH_MODEL = "gpt-5.6-luna";
export const DISCOVERY_CANDIDATE_RESEARCH_MODELS = [
  DISCOVERY_STAGE2_MODEL,
  DISCOVERY_LUNA_RESEARCH_MODEL,
] as const;
export type DiscoveryCandidateResearchModel =
  (typeof DISCOVERY_CANDIDATE_RESEARCH_MODELS)[number];
export const DISCOVERY_STAGE3_MODEL = "gpt-5.6-sol";
export const DISCOVERY_REASONING_EFFORT = "medium";

export interface DiscoveryModelAllocation {
  stage1: string;
  identityVerification: string;
  candidateResearch: string;
  stage3: string;
}

export function discoveryModelAllocationForVariant(
  variant: DiscoveryEngineVariant,
): DiscoveryModelAllocation {
  if (variant === "v1-frozen") {
    return {
      stage1: FROZEN_V1_STAGE1_MODEL,
      identityVerification: FROZEN_V1_STAGE2_MODEL,
      candidateResearch: FROZEN_V1_STAGE2_MODEL,
      stage3: FROZEN_V1_STAGE3_MODEL,
    };
  }
  if (variant === "v1-deepseek-pro" || variant === "v2-hybrid") {
    return {
      stage1:
        variant === "v2-hybrid"
          ? V2_HYBRID_STAGE1_MODEL
          : FROZEN_V1_STAGE1_MODEL,
      identityVerification: DEEPSEEK_V1_MODEL,
      candidateResearch: DEEPSEEK_V1_MODEL,
      stage3:
        variant === "v2-hybrid" ? V2_HYBRID_STAGE3_MODEL : DEEPSEEK_V1_MODEL,
    };
  }
  return {
    stage1: DISCOVERY_STAGE1_MODEL,
    identityVerification: DISCOVERY_STAGE2_MODEL,
    candidateResearch:
      variant === "v1-luna-research"
        ? DISCOVERY_LUNA_RESEARCH_MODEL
        : DISCOVERY_STAGE2_MODEL,
    stage3: DISCOVERY_STAGE3_MODEL,
  };
}

export function discoveryEngineVersionForVariant(
  variant: DiscoveryEngineVariant,
): string {
  if (variant === "v1-frozen") return FROZEN_V1_ENGINE_VERSION;
  if (variant === "v1-batched-research") {
    return DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION;
  }
  if (variant === "v1-luna-research") {
    return DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION;
  }
  if (variant === "v1-deepseek-pro") return DEEPSEEK_V1_ENGINE_VERSION;
  if (variant === "v2-hybrid") return V2_HYBRID_ENGINE_VERSION;
  return DISCOVERY_ENGINE_VERSION;
}

export function isDiscoveryEngineVariant(
  value: unknown,
): value is DiscoveryEngineVariant {
  return (
    value === "v1" ||
    value === "v1-frozen" ||
    value === "v1-batched-research" ||
    value === "v1-luna-research" ||
    value === "v1-deepseek-pro" ||
    value === "v2-hybrid"
  );
}

const STAGE1_PROMPT = `You are Stage 1 of Noesis Discovery Engine V1: SEE → QUESTION.

Inspect the supplied image itself. Do not provide a generic description and do not use external knowledge.

Find a small set of visible features, relationships, patterns, contrasts, anomalies, labels, numbers, structures, or apparent contradictions that may materially change how a careful viewer understands this specific image. Every candidate must originate in concrete visible evidence.

Create highlightable regions with normalized coordinates (0-1, origin top-left). Use local regions for bounded visual features. For a genuinely whole-image trigger, create an explicit global region with x=0, y=0, width=1, height=1. Relational candidates may reference multiple regions; never create one huge box just to connect distant features.

For each candidate:
- use stable unique candidate and question ids;
- state the exact visual trigger and grounded observation;
- reference only declared region ids;
- ask one specific question that could deepen interpretation of this image;
- mark research_needed true only if external facts could materially explain, verify, surprise, reinterpret, or overturn the reading of the visible feature;
- explain that material value in research_rationale when research is needed;
- mark identity_context_needed true only when verified place, building, object, figure, map, artwork, diagram, or other identity is materially needed to answer the question safely.

Optionally propose a small set of identity_hypotheses. These are visual hypotheses, never verified facts. Each must include concrete visible evidence, supporting regions, any observed labels or numbers, confidence, and the exact question ids that verified identity would materially help. Return an empty identity_hypotheses array when the image does not support a useful hypothesis. Do not identify an image merely because naming the subject might be interesting.

When forming an identity hypothesis, prioritize discriminative clues over redundant clues. Consider all candidates marked identity_context_needed, especially unusual anomalies, topology, distinctive spatial relationships, labels, or numbers that could distinguish this exact subject from other members of the same broad category. Combine multiple independent visible clues when they jointly narrow the identity. State the most specific falsifiable identity those clues justify. Do not add specificity unless those clues justify it. If the evidence does not justify greater specificity, stay broad rather than guessing.

Candidates may require no research. Reject broad topic questions, generic history, and trivia that could be generated from the subject alone. Do not expose chain-of-thought; return only concise structured grounding artifacts.`;

const IDENTITY_RESOLUTION_INSTRUCTIONS = `You are the conditional identity-resolution substep inside Stage 2 of Noesis Discovery Engine V1.

You receive a compact packet of text-only visual evidence selected by Stage 1. You do not receive the image. Determine the exact place, building, object, figure, map, artwork, diagram, instrument, or other subject represented by that evidence when trustworthy external evidence can establish it. Identity is useful only as context for already-approved image-triggered questions.

Stage-1 identity hypotheses are tentative leads, not constraints or verified facts. You may refine, reject, or replace them when the combined evidence points elsewhere. Use the combination of discriminative labels, numbers, anomalies, topology, spatial relationships, geometry, configuration, and other supplied observations. Do not rely on generic category similarity and do not perform generic topic research.

Return verified only when trustworthy external evidence establishes the exact identity strongly enough to distinguish it from plausible alternatives. When status is verified, canonical_identity and identity_type must be populated. When status is unverified or conflicted, canonical_identity, identity_type, and location must all be null; describe tentative, rejected, or conflicting possibilities only in verification_basis and match_evidence. Use hypothesis_id only when the resolution remains associated with a supplied tentative lead; otherwise return null. A shared word, typography style, visual motif, broad category, generic structure, or common characteristic is insufficient. Evidence about a general convention is not evidence that a source depicts the exact same subject. Prefer unverified or conflicted over a convenient nearest match. Cite supporting claims only through web-search citations; never invent source URLs. Return only the strict JSON result.`;

const RESEARCH_INSTRUCTIONS = `You are Stage 2 of Noesis Discovery Engine V1: selectively RESEARCH.

You receive one question approved by the visual Stage 1 gate. You do not receive the image and may not choose a broader topic. Use web search only to answer the exact supplied question as narrowly and accurately as possible. Remain tied to the supplied visual trigger and observation. Do not write a topic report or add adjacent trivia. Verified identity context, when supplied, is search context only and never permission for general facts about the identified subject.

Never silently substitute a similar place, building, object, image, or figure. A shared word, typography style, motif, or generic structure does not show that an external source depicts the same object. Clearly distinguish evidence about a general convention from evidence about the exact uploaded subject. If exact identity is needed but was not verified, prefer INSUFFICIENT over a plausible unsupported match.

Begin with ANSWERED: when trustworthy sources materially answer the question. Begin with INSUFFICIENT: when reliable research cannot answer it. Keep the finding concise. Cite claims using the web-search citations supplied by the API. Never invent or type source URLs yourself.`;

const BATCHED_RESEARCH_INSTRUCTIONS = `You are the batched candidate-research operation inside Stage 2 of Noesis Discovery Engine V1.

You receive a compact text-only list of questions already approved by the visual Stage 1 research gate. You do not receive the image. Answer only the supplied questions, preserve every candidate_id and question_id exactly, and treat every candidate independently. Never invent, broaden, merge, replace, or add candidates or questions.

For each candidate, remain tied to its visual trigger and grounded observation. Return insufficient independently when trustworthy evidence is inadequate. Keep each finding and its sources scoped only to the candidate they support. Verified identity context, when present for a candidate, is search context only and is never permission for generic topic research.

Never treat visual similarity, shared labels, typography, motifs, composition, or generic structure as proof that an external source depicts the same exact place, figure, object, or image. Never infer provenance of an underlying visual merely because a modern source reproduces, uses, or discusses it. Prefer insufficient evidence over unsupported specificity.

For every answered result, include at least one HTTP(S) source URL cited by the web-search response inside that same candidate result. Copy cited URLs exactly, including their query string. An insufficient result may use an empty sources array.

Use web-search citations only. Never invent source URLs. Return only the strict JSON result.`;

const STAGE3_PROMPT = `You are Stage 3 of Noesis Discovery Engine V1: DISCOVER → RETURN TO IMAGE.

You receive text-only structured visual grounding, approved investigation candidates, optional narrowly scoped research findings, validated source metadata, and any deterministic calculations. You do not receive the image.

Act as an aggressive editor and ranker. Select only findings that genuinely cause the user to understand this image differently. Four exceptional discoveries are better than five mediocre ones; fewer than three, including zero, is valid.

For every discovery enforce:
A. VISUAL ORIGIN — identify exactly what visible evidence caused the investigation. Reject discoveries without a concrete answer.
B. IMAGE DEPENDENCE — reject external facts that remain equally interesting without the image unless they materially explain, surprise, reinterpret, verify, or overturn the reading of something visible.

Rank by accuracy, visual dependence, surprise, explanatory depth, specificity, consequential understanding, and reinterpretation. Do not summarize the inputs or pad the count.

Rules:
- candidate_ids must reference the exact Stage 1 candidates supporting the discovery.
- region_ids must reference only Stage 1 regions and should include every region needed to return attention to the image.
- provenance is researched only when candidate_ids include an answered research result or a candidate explicitly listed in the verified identity result's applicable_candidate_ids.
- researched discoveries may copy only source objects present in the supplied research or verified identity results.
- never present an unverified or conflicted identity hypothesis as fact; verified identity is not itself a discovery and may appear only when it materially explains or reinterprets something visible.
- all other discoveries must have an empty sources array.
- reinterpretation must explicitly tell the viewer what to notice or understand differently when looking back at the image.
- explanation is concise and user-facing; never expose private chain-of-thought.

Return only the strict JSON object.`;

export interface DiscoveryUsageMetrics {
  provider?: "openai" | "deepseek";
  model: string;
  reasoning_effort: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
}

export interface DiscoveryStageMetrics {
  usage: DiscoveryUsageMetrics;
  web_search_calls: number;
  model_token_cost_usd: number | null;
  tool_cost_usd: number | null;
  /** Sum of known components; not an all-in cost when tool_cost_usd is null. */
  total_known_cost_usd: number | null;
  /** Backward-compatible alias for total_known_cost_usd. */
  cost_usd: number | null;
  cost_reason: string | null;
}

type DiscoveryCostMetrics = Pick<
  DiscoveryStageMetrics,
  | "web_search_calls"
  | "model_token_cost_usd"
  | "tool_cost_usd"
  | "total_known_cost_usd"
>;

export interface DiscoveryResearchCallMetrics extends DiscoveryStageMetrics {
  candidate_id: string;
  question_id: string;
  status: "answered" | "insufficient";
  used_verified_identity_context: boolean;
  candidate_local_failure?: DiscoveryCandidateLocalFailure;
}

export type DiscoveryCandidateLocalFailureCategory =
  | "tool_call"
  | "search_provider"
  | "source_validation"
  | "schema_validation"
  | "malformed_model_output";

export interface DiscoveryCandidateLocalFailure {
  candidate_id: string;
  question_id: string;
  category: DiscoveryCandidateLocalFailureCategory;
  safe_message: string;
}

export interface DiscoveryIdentityVerificationMetrics {
  ran: boolean;
  status: "not_run" | "verified" | "unverified" | "conflicted";
  usage: DiscoveryUsageMetrics | null;
  web_search_calls: number;
  model_token_cost_usd: number | null;
  tool_cost_usd: number | null;
  total_known_cost_usd: number | null;
  cost_usd: number | null;
  cost_reason: string | null;
  semantic_repair_attempted?: boolean;
  semantic_repair_succeeded?: boolean;
  attempted?: boolean;
  usable?: boolean;
  degraded?: boolean;
  failure_category?: DiscoveryFailureCategory;
  latency_ms?: number;
}

export interface DiscoveryBatchResearchMetrics extends DiscoveryStageMetrics {
  validation_diagnostics_version?: string;
  candidate_count: number;
  candidate_ids: string[];
  question_ids: string[];
  invalid_candidate_ids: string[];
  missing_candidate_ids: string[];
  answered_candidates: number;
  insufficient_candidates: number;
  validation_issues: DiscoveryBatchValidationIssue[];
}

export interface DiscoveryBatchInspection {
  validation_diagnostics_version?: string;
  candidates: DiscoveryBatchCandidateContext[];
  identity_context_mappings: DiscoveryBatchIdentityMapping[];
  invalid_candidate_ids: string[];
  missing_candidate_ids: string[];
  validation_issues: DiscoveryBatchValidationIssue[];
}

export interface DiscoveryPipelineMetrics {
  timestamp: string;
  engine_version: string;
  success: boolean;
  stage1: DiscoveryStageMetrics;
  stage2: {
    model: string;
    candidate_research_model: string;
    reasoning_effort: string;
    questions_sent: number;
    latency_ms: number;
    usage: DiscoveryUsageMetrics;
    web_search_calls: number;
    model_token_cost_usd: number | null;
    tool_cost_usd: number | null;
    total_known_cost_usd: number | null;
    cost_usd: number | null;
    identity_verification: DiscoveryIdentityVerificationMetrics;
    identity_dependent_research_candidates?: number;
    identity_blocked_candidate_ids?: string[];
    candidate_research_calls_avoided_by_identity_gate?: number;
    identity_independent_candidate_research_api_calls?: number;
    candidate_calls_using_verified_identity: number;
    candidate_research_api_calls: number;
    answered_candidates: number;
    insufficient_candidates: number;
    candidate_local_failed_candidates?: number;
    candidate_local_failures?: DiscoveryCandidateLocalFailure[];
    research_wall_clock_latency_ms?: number;
    research_max_concurrency?: number;
    calls: DiscoveryResearchCallMetrics[];
    batch: DiscoveryBatchResearchMetrics | null;
  };
  stage3: DiscoveryStageMetrics & { discoveries_returned: number };
  total_latency_ms: number;
  web_search_calls: number;
  model_token_cost_usd: number | null;
  tool_cost_usd: number | null;
  total_known_cost_usd: number | null;
  /** Backward-compatible alias for total_known_cost_usd. */
  total_cost_usd: number | null;
  cost_per_successful_analysis_usd: number | null;
  cost_per_final_discovery_usd: number | null;
  stage1_candidates: number;
  research_gate_passed: number;
  final_discoveries: number;
}

export interface DiscoveryPipelineResult {
  version: string;
  regions: DiscoveryRegion[];
  discoveries: Discovery[];
  inspection: DiscoveryInspection & {
    research_batch?: DiscoveryBatchInspection;
  };
  metrics: DiscoveryPipelineMetrics;
}

export type DiscoveryFailureStage =
  | "stage1"
  | "identity_verification"
  | "research"
  | "stage3"
  | "validation"
  | "unknown";

export type DiscoveryFailureCategory =
  | "api_error"
  | "authentication"
  | "provider_http"
  | "rate_limit"
  | "timeout"
  | "structured_output"
  | "tool_call"
  | "search_provider"
  | "schema_validation"
  | "malformed_model_output"
  | "source_validation"
  | "network_error"
  | "internal_error"
  | "unknown";

export interface DiscoverySafeUsageMetrics {
  provider?: "openai" | "deepseek";
  model: string;
  reasoning_effort: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
}

export interface DiscoverySafeStageMetrics {
  usage: DiscoverySafeUsageMetrics;
  web_search_calls: number;
  model_token_cost_usd: number | null;
  tool_cost_usd: number | null;
  total_known_cost_usd: number | null;
  cost_usd: number | null;
  cost_reason: string | null;
}

export interface DiscoveryCompletedResearchCallMetrics extends DiscoverySafeStageMetrics {
  candidate_id: string;
  question_id: string;
  status: "answered" | "insufficient";
}

export interface DiscoveryFailureDiagnostic {
  engine_version: string;
  failed_stage: DiscoveryFailureStage;
  stage_reached: DiscoveryFailureStage;
  last_completed_stage:
    "none" | "stage1" | "identity_verification" | "research" | "stage3";
  category: DiscoveryFailureCategory;
  message: string;
  elapsed_ms: number;
  candidate_id?: string;
  question_id?: string;
  research_failure_scope?: DiscoveryBatchFailureScope;
  research_validation_category?: DiscoveryBatchValidationCategory;
  safe_validation_message?: string;
  affected_candidate_ids?: string[];
  stage1_reconciliation?: DiscoveryStage1ReconciliationDiagnostics;
  validation_diagnostics_version?: string;
  validation_issues?: DiscoveryBatchValidationIssue[];
  batch_candidate_state?: {
    attempted_candidate_ids: string[];
    answered_candidate_ids: string[];
    insufficient_candidate_ids: string[];
    invalid_candidate_ids: string[];
    missing_candidate_ids: string[];
  };
  partial_metrics: {
    stage1: DiscoverySafeStageMetrics | null;
    identity_verification:
      | (DiscoverySafeStageMetrics & {
          completed: boolean;
          status: "verified" | "unverified" | "conflicted" | null;
          semantic_repair_attempted?: boolean;
          semantic_repair_succeeded?: boolean;
          attempted?: boolean;
          usable?: boolean;
          degraded?: boolean;
          failure_category?: DiscoveryFailureCategory;
          latency_ms?: number;
        })
      | null;
    research: {
      attempted_calls: number;
      identity_dependent_candidates?: number;
      identity_blocked_candidate_ids?: string[];
      candidate_calls_avoided_by_identity_gate?: number;
      identity_independent_api_calls?: number;
      completed_calls: DiscoveryCompletedResearchCallMetrics[];
      known_usage: DiscoverySafeUsageMetrics | null;
      known_web_search_calls: number;
      known_model_token_cost_usd: number | null;
      known_tool_cost_usd: number | null;
      known_total_cost_usd: number | null;
      /** Backward-compatible alias for known_total_cost_usd. */
      known_cost_usd: number | null;
    };
    stage3: DiscoverySafeStageMetrics | null;
    known_total_tokens: number | null;
    known_web_search_calls: number;
    known_model_token_cost_usd: number | null;
    known_tool_cost_usd: number | null;
    known_total_cost_usd: number | null;
  };
}

interface DiscoveryExecutionState {
  startedAt: number;
  engineVersion: string;
  stage2AggregateModel: string;
  usesIdentityGate: boolean;
  stageReached: DiscoveryFailureStage;
  lastCompletedStage: DiscoveryFailureDiagnostic["last_completed_stage"];
  currentCandidateId?: string;
  currentQuestionId?: string;
  stage1: DiscoveryStageMetrics | null;
  stage1Reconciliation?: DiscoveryStage1ReconciliationDiagnostics;
  identityVerification:
    | (DiscoveryStageMetrics & {
        completed: boolean;
        status: "verified" | "unverified" | "conflicted" | null;
        semantic_repair_attempted?: boolean;
        semantic_repair_succeeded?: boolean;
        attempted?: boolean;
        usable?: boolean;
        degraded?: boolean;
        failure_category?: DiscoveryFailureCategory;
        latency_ms?: number;
      })
    | null;
  knownStage2Metrics: DiscoveryStageMetrics[];
  researchCalls: DiscoveryResearchCallMetrics[];
  attemptedResearchCalls: number;
  identityDependentResearchCandidates: number;
  identityBlockedCandidateIds: string[];
  candidateResearchCallsAvoidedByIdentityGate: number;
  identityIndependentCandidateResearchApiCalls: number;
  researchFailureScope?: DiscoveryBatchFailureScope;
  researchValidationCategory?: DiscoveryBatchValidationCategory;
  safeValidationMessage?: string;
  affectedCandidateIds?: string[];
  batchValidationDiagnostics?: {
    validation_diagnostics_version: string;
    validation_issues: DiscoveryBatchValidationIssue[];
    attempted_candidate_ids: string[];
    answered_candidate_ids: string[];
    insufficient_candidate_ids: string[];
    invalid_candidate_ids: string[];
    missing_candidate_ids: string[];
  };
  stage3: DiscoveryStageMetrics | null;
}

function createExecutionState(
  startedAt = Date.now(),
  engineVersion = DISCOVERY_ENGINE_VERSION,
  stage2AggregateModel = DISCOVERY_STAGE2_MODEL,
  usesIdentityGate = true,
): DiscoveryExecutionState {
  return {
    startedAt,
    engineVersion,
    stage2AggregateModel,
    usesIdentityGate,
    stageReached: "unknown",
    lastCompletedStage: "none",
    stage1: null,
    identityVerification: null,
    knownStage2Metrics: [],
    researchCalls: [],
    attemptedResearchCalls: 0,
    identityDependentResearchCandidates: 0,
    identityBlockedCandidateIds: [],
    candidateResearchCallsAvoidedByIdentityGate: 0,
    identityIndependentCandidateResearchApiCalls: 0,
    stage3: null,
  };
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyUsage(
  model: string,
  provider?: DiscoveryUsageMetrics["provider"],
): DiscoveryUsageMetrics {
  return {
    ...(provider ? { provider } : {}),
    model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    latency_ms: 0,
  };
}

function normalizeChatUsage(
  response: ChatCompletion,
  latencyMs: number,
  provider?: DiscoveryUsageMetrics["provider"],
): DiscoveryUsageMetrics {
  return {
    ...(provider ? { provider } : {}),
    model: response.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    input_tokens: integer(response.usage?.prompt_tokens),
    cached_input_tokens: integer(
      response.usage?.prompt_tokens_details?.cached_tokens,
    ),
    output_tokens: integer(response.usage?.completion_tokens),
    reasoning_tokens: integer(
      response.usage?.completion_tokens_details?.reasoning_tokens,
    ),
    total_tokens: integer(response.usage?.total_tokens),
    latency_ms: latencyMs,
  };
}

function normalizeResponseUsage(
  response: Response,
  latencyMs: number,
  provider?: DiscoveryUsageMetrics["provider"],
): DiscoveryUsageMetrics {
  return {
    ...(provider ? { provider } : {}),
    model: response.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    input_tokens: integer(response.usage?.input_tokens),
    cached_input_tokens: integer(
      response.usage?.input_tokens_details.cached_tokens,
    ),
    output_tokens: integer(response.usage?.output_tokens),
    reasoning_tokens: integer(
      response.usage?.output_tokens_details.reasoning_tokens,
    ),
    total_tokens: integer(response.usage?.total_tokens),
    latency_ms: latencyMs,
  };
}

function sumNullable(values: Array<number | null>): number | null {
  return values.every((value) => value !== null)
    ? values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
    : null;
}

function aggregateUsage(
  model: string,
  usages: DiscoveryUsageMetrics[],
): DiscoveryUsageMetrics {
  if (usages.length === 0) return emptyUsage(model);
  const actualModels = [...new Set(usages.map((usage) => usage.model))];
  const actualProviders = [
    ...new Set(usages.map((usage) => usage.provider).filter(Boolean)),
  ];
  return {
    ...(actualProviders.length === 1 &&
    usages.every((usage) => usage.provider === actualProviders[0])
      ? { provider: actualProviders[0] }
      : {}),
    model: actualModels.join("+"),
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    input_tokens: sumNullable(usages.map((usage) => usage.input_tokens)),
    cached_input_tokens: sumNullable(
      usages.map((usage) => usage.cached_input_tokens),
    ),
    output_tokens: sumNullable(usages.map((usage) => usage.output_tokens)),
    reasoning_tokens: sumNullable(
      usages.map((usage) => usage.reasoning_tokens),
    ),
    total_tokens: sumNullable(usages.map((usage) => usage.total_tokens)),
    latency_ms: usages.reduce((sum, usage) => sum + usage.latency_ms, 0),
  };
}

function countWebSearchCalls(response: Response): number {
  return response.output.filter((item) => item.type === "web_search_call")
    .length;
}

function stageMetrics(
  usage: DiscoveryUsageMetrics,
  webSearchCalls = 0,
): DiscoveryStageMetrics {
  const modelTokenCost = estimateModelCost(usage);
  const toolCost =
    usage.provider === "deepseek" && webSearchCalls > 0
      ? null
      : usage.provider === "deepseek"
        ? 0
        : estimateWebSearchToolCost(webSearchCalls);
  const totalKnownCost =
    modelTokenCost.usd === null ? null : modelTokenCost.usd + (toolCost ?? 0);
  return {
    usage,
    web_search_calls: webSearchCalls,
    model_token_cost_usd: modelTokenCost.usd,
    tool_cost_usd: toolCost,
    total_known_cost_usd: totalKnownCost,
    cost_usd: totalKnownCost,
    cost_reason: modelTokenCost.reason,
  };
}

function safeUsage(usage: DiscoveryUsageMetrics): DiscoverySafeUsageMetrics {
  return {
    ...(usage.provider ? { provider: usage.provider } : {}),
    model: usage.model,
    reasoning_effort: usage.reasoning_effort,
    input_tokens: usage.input_tokens,
    cached_input_tokens: usage.cached_input_tokens,
    output_tokens: usage.output_tokens,
    total_tokens: usage.total_tokens,
    latency_ms: usage.latency_ms,
  };
}

function safeStage(metrics: DiscoveryStageMetrics): DiscoverySafeStageMetrics {
  return {
    usage: safeUsage(metrics.usage),
    web_search_calls: metrics.web_search_calls,
    model_token_cost_usd: metrics.model_token_cost_usd,
    tool_cost_usd: metrics.tool_cost_usd,
    total_known_cost_usd: metrics.total_known_cost_usd,
    cost_usd: metrics.cost_usd,
    cost_reason: metrics.cost_reason,
  };
}

function sumKnown(values: Array<number | null>): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0
    ? null
    : known.reduce((sum, value) => sum + value, 0);
}

function errorDetails(error: unknown): {
  name: string;
  message: string;
  status: number | null;
  code: string;
} {
  if (!(error instanceof Error)) {
    return { name: "", message: "", status: null, code: "" };
  }
  const record = error as Error & {
    status?: unknown;
    code?: unknown;
    cause?: { code?: unknown };
  };
  return {
    name: error.name,
    message: error.message,
    status: integer(record.status),
    code:
      typeof record.code === "string"
        ? record.code
        : typeof record.cause?.code === "string"
          ? record.cause.code
          : "",
  };
}

export function classifyDiscoveryFailure(
  error: unknown,
): DiscoveryFailureCategory {
  if (error instanceof DeepSeekDiscoveryError) return error.category;
  const { name, message, status, code } = errorDetails(error);
  const searchable = `${name} ${message} ${code}`.toLowerCase();
  if (
    status === 408 ||
    status === 504 ||
    /timeout|timed out|aborterror|etimedout/.test(searchable)
  ) {
    return "timeout";
  }
  if (
    /econnreset|econnrefused|enotfound|eai_again|fetch failed|network/.test(
      searchable,
    )
  ) {
    return "network_error";
  }
  if (error instanceof SyntaxError) return "malformed_model_output";
  if (
    /source|citation|unsafe url|invalid url|url safety/.test(
      message.toLowerCase(),
    )
  ) {
    return "source_validation";
  }
  if (name === "ZodError" || /schema|validation/.test(searchable)) {
    return "schema_validation";
  }
  if (status !== null || /apierror|api error/.test(searchable)) {
    return "api_error";
  }
  if (error instanceof Error) return "internal_error";
  return "unknown";
}

function safeFailureMessage(category: DiscoveryFailureCategory): string {
  switch (category) {
    case "api_error":
      return "The model service returned an API error.";
    case "authentication":
      return "The configured model provider rejected authentication.";
    case "provider_http":
      return "The configured model provider returned an HTTP error.";
    case "rate_limit":
      return "The configured model provider rate limit was reached.";
    case "timeout":
      return "The model service request timed out.";
    case "structured_output":
      return "The model provider returned invalid structured output.";
    case "tool_call":
      return "The model provider did not complete the required tool call.";
    case "search_provider":
      return "The model provider's web search did not complete.";
    case "schema_validation":
      return "A model response failed structured validation.";
    case "malformed_model_output":
      return "A model response was not valid structured JSON.";
    case "source_validation":
      return "A model response failed source validation.";
    case "network_error":
      return "A network request failed.";
    case "internal_error":
      return "Discovery encountered an internal error.";
    default:
      return "Discovery failed for an unknown reason.";
  }
}

function createFailureDiagnostic(
  error: unknown,
  state: DiscoveryExecutionState,
): DiscoveryFailureDiagnostic {
  const category = classifyDiscoveryFailure(error);
  const completedResearchCalls = state.researchCalls.map((call) => ({
    candidate_id: call.candidate_id,
    question_id: call.question_id,
    status: call.status,
    ...safeStage(call),
  }));
  const knownStage2Usage =
    state.knownStage2Metrics.length > 0
      ? aggregateUsage(
          state.stage2AggregateModel,
          state.knownStage2Metrics.map((metrics) => metrics.usage),
        )
      : null;
  const knownMetrics = [
    state.stage1,
    ...state.knownStage2Metrics,
    state.stage3,
  ].filter((metrics): metrics is DiscoveryStageMetrics => metrics !== null);

  return {
    engine_version: state.engineVersion,
    failed_stage: state.stageReached,
    stage_reached: state.stageReached,
    last_completed_stage: state.lastCompletedStage,
    category,
    message: safeFailureMessage(category),
    elapsed_ms: Math.max(0, Date.now() - state.startedAt),
    ...(state.currentCandidateId
      ? { candidate_id: state.currentCandidateId }
      : {}),
    ...(state.currentQuestionId
      ? { question_id: state.currentQuestionId }
      : {}),
    ...(state.researchFailureScope
      ? { research_failure_scope: state.researchFailureScope }
      : {}),
    ...(state.researchValidationCategory
      ? { research_validation_category: state.researchValidationCategory }
      : {}),
    ...(state.safeValidationMessage
      ? { safe_validation_message: state.safeValidationMessage }
      : {}),
    ...(state.affectedCandidateIds
      ? { affected_candidate_ids: state.affectedCandidateIds }
      : {}),
    ...(state.stage1Reconciliation
      ? { stage1_reconciliation: state.stage1Reconciliation }
      : {}),
    ...(state.batchValidationDiagnostics
      ? {
          validation_diagnostics_version:
            state.batchValidationDiagnostics.validation_diagnostics_version,
          validation_issues: state.batchValidationDiagnostics.validation_issues,
          batch_candidate_state: {
            attempted_candidate_ids:
              state.batchValidationDiagnostics.attempted_candidate_ids,
            answered_candidate_ids:
              state.batchValidationDiagnostics.answered_candidate_ids,
            insufficient_candidate_ids:
              state.batchValidationDiagnostics.insufficient_candidate_ids,
            invalid_candidate_ids:
              state.batchValidationDiagnostics.invalid_candidate_ids,
            missing_candidate_ids:
              state.batchValidationDiagnostics.missing_candidate_ids,
          },
        }
      : {}),
    partial_metrics: {
      stage1: state.stage1 ? safeStage(state.stage1) : null,
      identity_verification: state.identityVerification
        ? {
            ...safeStage(state.identityVerification),
            completed: state.identityVerification.completed,
            status: state.identityVerification.status,
            ...(state.identityVerification.semantic_repair_attempted !==
            undefined
              ? {
                  semantic_repair_attempted:
                    state.identityVerification.semantic_repair_attempted,
                  semantic_repair_succeeded:
                    state.identityVerification.semantic_repair_succeeded,
                }
              : {}),
            ...(state.identityVerification.attempted !== undefined
              ? {
                  attempted: state.identityVerification.attempted,
                  usable: state.identityVerification.usable,
                  degraded: state.identityVerification.degraded,
                  failure_category: state.identityVerification.failure_category,
                  latency_ms: state.identityVerification.latency_ms,
                }
              : {}),
          }
        : null,
      research: {
        attempted_calls: state.attemptedResearchCalls,
        ...(state.usesIdentityGate
          ? {
              identity_dependent_candidates:
                state.identityDependentResearchCandidates,
              identity_blocked_candidate_ids: state.identityBlockedCandidateIds,
              candidate_calls_avoided_by_identity_gate:
                state.candidateResearchCallsAvoidedByIdentityGate,
              identity_independent_api_calls:
                state.identityIndependentCandidateResearchApiCalls,
            }
          : {}),
        completed_calls: completedResearchCalls,
        known_usage: knownStage2Usage ? safeUsage(knownStage2Usage) : null,
        known_web_search_calls: state.knownStage2Metrics.reduce(
          (sum, metrics) => sum + metrics.web_search_calls,
          0,
        ),
        known_model_token_cost_usd: sumKnown(
          state.knownStage2Metrics.map(
            (metrics) => metrics.model_token_cost_usd,
          ),
        ),
        known_tool_cost_usd: sumNullable(
          state.knownStage2Metrics.map((metrics) => metrics.tool_cost_usd),
        ),
        known_total_cost_usd: sumKnown(
          state.knownStage2Metrics.map(
            (metrics) => metrics.total_known_cost_usd,
          ),
        ),
        known_cost_usd: sumKnown(
          state.knownStage2Metrics.map((metrics) => metrics.cost_usd),
        ),
      },
      stage3: state.stage3 ? safeStage(state.stage3) : null,
      known_total_tokens: sumKnown(
        knownMetrics.map((metrics) => metrics.usage.total_tokens),
      ),
      known_web_search_calls: knownMetrics.reduce(
        (sum, metrics) => sum + metrics.web_search_calls,
        0,
      ),
      known_model_token_cost_usd: sumKnown(
        knownMetrics.map((metrics) => metrics.model_token_cost_usd),
      ),
      known_tool_cost_usd: sumNullable(
        knownMetrics.map((metrics) => metrics.tool_cost_usd),
      ),
      known_total_cost_usd: sumKnown(
        knownMetrics.map((metrics) => metrics.total_known_cost_usd),
      ),
    },
  };
}

export class DiscoveryPipelineError extends Error {
  readonly diagnostic: DiscoveryFailureDiagnostic;

  constructor(error: unknown, state: DiscoveryExecutionState) {
    const diagnostic = createFailureDiagnostic(error, state);
    super(diagnostic.message, { cause: error });
    this.name = "DiscoveryPipelineError";
    this.diagnostic = diagnostic;
  }
}

export function getDiscoveryFailureDiagnostic(
  error: unknown,
): DiscoveryFailureDiagnostic | null {
  return error instanceof DiscoveryPipelineError ? error.diagnostic : null;
}

export function createUnknownDiscoveryFailureDiagnostic(
  error: unknown,
  startedAt: number,
  engineVersion = DISCOVERY_ENGINE_VERSION,
): DiscoveryFailureDiagnostic {
  return createFailureDiagnostic(
    error,
    createExecutionState(startedAt, engineVersion),
  );
}

function extractValidatedSourceCitations(
  response: Response,
): DiscoveryBatchCitation[] {
  const citations: DiscoveryBatchCitation[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type !== "output_text") continue;
      for (const annotation of content.annotations) {
        if (annotation.type !== "url_citation") continue;
        try {
          const parsed = new URL(annotation.url);
          if (parsed.protocol !== "https:" && parsed.protocol !== "http:")
            continue;
          const title = annotation.title.trim() || parsed.hostname;
          citations.push({
            title,
            url: annotation.url,
            start_index: annotation.start_index,
            end_index: annotation.end_index,
          });
        } catch {
          // Invalid citation metadata is excluded before schema validation.
        }
      }
    }
  }
  return citations;
}

function extractValidatedSources(response: Response): DiscoverySource[] {
  const sources = new Map<string, DiscoverySource>();
  for (const citation of extractValidatedSourceCitations(response)) {
    sources.set(citation.url, { title: citation.title, url: citation.url });
  }
  return [...sources.values()];
}

function cleanResearchFinding(outputText: string): {
  declaredInsufficient: boolean;
  finding: string;
} {
  const trimmed = outputText.trim();
  const declaredInsufficient = /^INSUFFICIENT\s*:/i.test(trimmed);
  const finding = trimmed
    .replace(/^(ANSWERED|INSUFFICIENT)\s*:\s*/i, "")
    .replace(/https?:\/\/[^\s)\]}>,]+/g, "[validated source]")
    .trim();
  return {
    declaredInsufficient,
    finding: finding || "Reliable research did not return a usable answer.",
  };
}

export interface DiscoveryIdentityVerificationExecution {
  result: DiscoveryIdentityVerification | null;
  metrics: DiscoveryIdentityVerificationMetrics;
}

export interface DiscoveryResearchExecution {
  results: DiscoveryResearchResult[];
  calls: DiscoveryResearchCallMetrics[];
  identityVerification: DiscoveryIdentityVerificationExecution;
  gatedCandidates: number;
  identityDependentResearchCandidates: number;
  identityBlockedCandidateIds: string[];
  candidateResearchCallsAvoidedByIdentityGate: number;
  identityIndependentCandidateResearchApiCalls: number;
  candidateResearchApiCalls: number;
  candidateCallsUsingVerifiedIdentity: number;
  candidateLocalFailures?: DiscoveryCandidateLocalFailure[];
  researchWallClockLatencyMs?: number;
  researchMaxConcurrency?: number;
  batchMetrics: DiscoveryBatchResearchMetrics | null;
  batchInspection: DiscoveryBatchInspection | null;
}

function identityNotRun(): DiscoveryIdentityVerificationExecution {
  return {
    result: null,
    metrics: {
      ran: false,
      status: "not_run",
      usage: null,
      web_search_calls: 0,
      model_token_cost_usd: null,
      tool_cost_usd: 0,
      total_known_cost_usd: null,
      cost_usd: null,
      cost_reason: null,
    },
  };
}

export function buildDiscoveryIdentityEvidencePacket(stage1: DiscoveryStage1) {
  const regionsById = new Map(
    stage1.regions.map((region) => [region.id, region]),
  );
  const identityDependentCandidates = stage1.candidates.filter(
    (candidate) => candidate.identity_context_needed,
  );
  const relevantRegionIds = new Set([
    ...identityDependentCandidates.flatMap((candidate) => candidate.region_ids),
    ...stage1.identity_hypotheses.flatMap(
      (hypothesis) => hypothesis.region_ids,
    ),
  ]);
  const conciseRegion = (regionId: string) => {
    const region = regionsById.get(regionId);
    return region
      ? {
          id: region.id,
          description: region.description,
          scope: region.scope,
        }
      : null;
  };

  return {
    image_summary: stage1.image_summary,
    tentative_leads_not_verified_facts: stage1.identity_hypotheses.map(
      (hypothesis) => ({
        id: hypothesis.id,
        proposed_identity: hypothesis.proposed_identity,
        identity_type: hypothesis.identity_type,
        visible_evidence: hypothesis.visible_evidence,
        observed_labels_or_numbers: hypothesis.observed_labels_or_numbers,
        confidence: hypothesis.confidence,
        relevant_question_ids: hypothesis.relevant_question_ids,
        region_ids: hypothesis.region_ids,
      }),
    ),
    identity_dependent_candidates: identityDependentCandidates.map(
      (candidate) => ({
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        visual_trigger: candidate.visual_trigger,
        observation: candidate.observation,
        investigation_question: candidate.investigation_question,
        referenced_regions: candidate.region_ids
          .map(conciseRegion)
          .filter((region) => region !== null),
      }),
    ),
    relevant_regions: [...relevantRegionIds]
      .map(conciseRegion)
      .filter((region) => region !== null),
  };
}

async function runIdentityResolution(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryIdentityVerificationExecution> {
  const shouldResolveIdentity =
    stage1.identity_hypotheses.length > 0 ||
    stage1.candidates.some((candidate) => candidate.identity_context_needed);
  if (!shouldResolveIdentity) return identityNotRun();

  const evidencePacket = buildDiscoveryIdentityEvidencePacket(stage1);
  state.stageReached = "identity_verification";
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  const started = Date.now();
  const response = await openai.responses.create({
    model: DISCOVERY_STAGE2_MODEL,
    reasoning: { effort: DISCOVERY_REASONING_EFFORT },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    store: false,
    max_output_tokens: 3000,
    text: {
      format: DISCOVERY_IDENTITY_VERIFICATION_JSON_SCHEMA,
    },
    instructions: IDENTITY_RESOLUTION_INSTRUCTIONS,
    input: [
      "STAGE 1 IDENTITY EVIDENCE PACKET:",
      JSON.stringify(evidencePacket),
    ].join("\n"),
  });
  const usage = normalizeResponseUsage(response, Date.now() - started);
  const metrics = stageMetrics(usage, countWebSearchCalls(response));
  state.knownStage2Metrics.push(metrics);
  state.identityVerification = {
    ...metrics,
    completed: false,
    status: null,
  };
  const result = validateIdentityVerification(
    stage1,
    JSON.parse(response.output_text),
    extractValidatedSources(response),
  );
  state.identityVerification = {
    ...metrics,
    completed: true,
    status: result.status,
  };
  state.lastCompletedStage = "identity_verification";
  return {
    result,
    metrics: {
      ran: true,
      status: result.status,
      ...metrics,
    },
  };
}

async function runFrozenV1IdentityVerification(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  gatedCandidates: DiscoveryCandidate[],
  state: DiscoveryExecutionState,
): Promise<DiscoveryIdentityVerificationExecution> {
  const frozenInput = buildFrozenV1IdentityInput(stage1, gatedCandidates);
  if (!frozenInput) return identityNotRun();

  state.stageReached = "identity_verification";
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  const started = Date.now();
  const response = await openai.responses.create({
    model: FROZEN_V1_STAGE2_MODEL,
    reasoning: { effort: FROZEN_V1_REASONING_EFFORT },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    store: false,
    max_output_tokens: 3000,
    text: { format: FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA },
    instructions: FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
    input: frozenInput.input,
  });
  const usage = normalizeResponseUsage(response, Date.now() - started);
  const metrics = stageMetrics(usage, countWebSearchCalls(response));
  state.knownStage2Metrics.push(metrics);
  state.identityVerification = {
    ...metrics,
    completed: false,
    status: null,
  };
  const draft = JSON.parse(response.output_text) as { hypothesis_id?: unknown };
  if (typeof draft.hypothesis_id !== "string") {
    throw new Error(
      "Frozen V1 identity verification requires a Stage-1 hypothesis id",
    );
  }
  const result = validateIdentityVerification(
    stage1,
    draft,
    extractValidatedSources(response),
  );
  state.identityVerification = {
    ...metrics,
    completed: true,
    status: result.status,
  };
  state.lastCompletedStage = "identity_verification";
  return {
    result,
    metrics: {
      ran: true,
      status: result.status,
      ...metrics,
    },
  };
}

async function runDeepSeekV1IdentityVerification(
  deepseek: DeepSeekClient,
  stage1: DiscoveryStage1,
  gatedCandidates: DiscoveryCandidate[],
  state: DiscoveryExecutionState,
  requestOptions?: DeepSeekRequestOptions,
): Promise<DiscoveryIdentityVerificationExecution> {
  const request = buildDeepSeekV1IdentityRequest(stage1, gatedCandidates);
  if (!request) return identityNotRun();

  state.stageReached = "identity_verification";
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  const started = Date.now();
  const response = await createDeepSeekResponse(
    deepseek,
    request,
    true,
    requestOptions,
  );
  const usage = normalizeResponseUsage(
    response,
    Date.now() - started,
    "deepseek",
  );
  const initialMetrics = stageMetrics(usage, countWebSearchCalls(response));
  state.knownStage2Metrics.push(initialMetrics);
  state.identityVerification = {
    ...initialMetrics,
    completed: false,
    status: null,
  };
  const draft = parseDeepSeekStructuredOutput(response.output_text) as {
    hypothesis_id?: unknown;
  };
  if (typeof draft.hypothesis_id !== "string") {
    throw new DeepSeekDiscoveryError(
      "structured_output",
      "DeepSeek identity verification omitted the frozen hypothesis id",
    );
  }
  const sources = extractValidatedSources(response);
  let result: DiscoveryIdentityVerification;
  let metrics = initialMetrics;
  let semanticRepairAttempted = false;
  let semanticRepairSucceeded = false;
  try {
    result = validateIdentityVerification(stage1, draft, sources);
  } catch (error) {
    const recoverable = recoverableDeepSeekIdentityContradiction(error, draft);
    if (!recoverable) throw error;

    semanticRepairAttempted = true;
    state.identityVerification = {
      ...initialMetrics,
      completed: false,
      status: recoverable.status,
      semantic_repair_attempted: true,
      semantic_repair_succeeded: false,
    };
    const repairStarted = Date.now();
    const repairResponse = await createDeepSeekResponse(
      deepseek,
      buildDeepSeekIdentitySemanticRepairRequest(recoverable),
      false,
      requestOptions,
    );
    const repairUsage = normalizeResponseUsage(
      repairResponse,
      Date.now() - repairStarted,
      "deepseek",
    );
    const repairMetrics = stageMetrics(
      repairUsage,
      countWebSearchCalls(repairResponse),
    );
    state.knownStage2Metrics.push(repairMetrics);
    metrics = stageMetrics(
      aggregateUsage(DEEPSEEK_V1_MODEL, [usage, repairUsage]),
      initialMetrics.web_search_calls + repairMetrics.web_search_calls,
    );
    state.identityVerification = {
      ...metrics,
      completed: false,
      status: recoverable.status,
      semantic_repair_attempted: true,
      semantic_repair_succeeded: false,
    };
    const repairedDraft = parseDeepSeekStructuredOutput(
      repairResponse.output_text,
    );
    if (
      !preservesDeepSeekIdentityRepairConclusion(recoverable, repairedDraft)
    ) {
      throw new DeepSeekDiscoveryError(
        "structured_output",
        "DeepSeek identity semantic repair changed the verification conclusion",
      );
    }
    result = validateIdentityVerification(stage1, repairedDraft, sources);
    semanticRepairSucceeded = true;
  }
  state.identityVerification = {
    ...metrics,
    completed: true,
    status: result.status,
    ...(semanticRepairAttempted
      ? {
          semantic_repair_attempted: true,
          semantic_repair_succeeded: semanticRepairSucceeded,
        }
      : {}),
  };
  state.lastCompletedStage = "identity_verification";
  return {
    result,
    metrics: {
      ran: true,
      status: result.status,
      ...metrics,
      ...(semanticRepairAttempted
        ? {
            semantic_repair_attempted: true,
            semantic_repair_succeeded: semanticRepairSucceeded,
          }
        : {}),
    },
  };
}

const V2_HYBRID_DEGRADABLE_IDENTITY_FAILURES =
  new Set<DiscoveryFailureCategory>([
    "timeout",
    "tool_call",
    "search_provider",
    "structured_output",
    "schema_validation",
    "malformed_model_output",
    "source_validation",
  ]);

function identityStageMetricsFromState(
  identity: NonNullable<DiscoveryExecutionState["identityVerification"]>,
): DiscoveryStageMetrics {
  return {
    usage: identity.usage,
    web_search_calls: identity.web_search_calls,
    model_token_cost_usd: identity.model_token_cost_usd,
    tool_cost_usd: identity.tool_cost_usd,
    total_known_cost_usd: identity.total_known_cost_usd,
    cost_usd: identity.cost_usd,
    cost_reason: identity.cost_reason,
  };
}

function unknownV2IdentityStageMetrics(
  latencyMs: number,
): DiscoveryStageMetrics {
  return {
    usage: {
      ...emptyUsage(DEEPSEEK_V1_MODEL, "deepseek"),
      latency_ms: latencyMs,
    },
    web_search_calls: 0,
    model_token_cost_usd: null,
    tool_cost_usd: null,
    total_known_cost_usd: null,
    cost_usd: null,
    cost_reason:
      "Identity verification usage was unavailable after safe degradation.",
  };
}

async function runV2HybridIdentityVerification(
  deepseek: DeepSeekClient,
  stage1: DiscoveryStage1,
  gatedCandidates: DiscoveryCandidate[],
  state: DiscoveryExecutionState,
): Promise<DiscoveryIdentityVerificationExecution> {
  const started = Date.now();
  try {
    const execution = await runDeepSeekV1IdentityVerification(
      deepseek,
      stage1,
      gatedCandidates,
      state,
      createV2HybridIdentityRequestOptions(V2_HYBRID_IDENTITY_TIMEOUT_MS),
    );
    return {
      result: execution.result,
      metrics: {
        ...execution.metrics,
        attempted: execution.metrics.ran,
        usable: execution.result !== null,
        degraded: false,
        latency_ms: Date.now() - started,
      },
    };
  } catch (error) {
    const failureCategory = classifyDiscoveryFailure(error);
    if (!V2_HYBRID_DEGRADABLE_IDENTITY_FAILURES.has(failureCategory)) {
      throw error;
    }

    const latencyMs = Date.now() - started;
    const priorIdentityState = state.identityVerification;
    let knownMetrics = priorIdentityState
      ? identityStageMetricsFromState(priorIdentityState)
      : null;
    if (
      !knownMetrics &&
      error instanceof DeepSeekDiscoveryError &&
      error.response
    ) {
      knownMetrics = stageMetrics(
        normalizeResponseUsage(error.response, latencyMs, "deepseek"),
        countWebSearchCalls(error.response),
      );
      state.knownStage2Metrics.push(knownMetrics);
    }
    const stateMetrics =
      knownMetrics ?? unknownV2IdentityStageMetrics(latencyMs);
    const semanticRepair = priorIdentityState?.semantic_repair_attempted
      ? {
          semantic_repair_attempted: true,
          semantic_repair_succeeded:
            priorIdentityState.semantic_repair_succeeded ?? false,
        }
      : {};

    state.identityVerification = {
      ...stateMetrics,
      completed: true,
      status: null,
      ...semanticRepair,
      attempted: true,
      usable: false,
      degraded: true,
      failure_category: failureCategory,
      latency_ms: latencyMs,
    };
    state.lastCompletedStage = "identity_verification";

    return {
      result: null,
      metrics: {
        ran: true,
        status: "not_run",
        usage: knownMetrics?.usage ?? null,
        web_search_calls: knownMetrics?.web_search_calls ?? 0,
        model_token_cost_usd: knownMetrics?.model_token_cost_usd ?? null,
        tool_cost_usd: knownMetrics?.tool_cost_usd ?? null,
        total_known_cost_usd: knownMetrics?.total_known_cost_usd ?? null,
        cost_usd: knownMetrics?.cost_usd ?? null,
        cost_reason: knownMetrics?.cost_reason ?? stateMetrics.cost_reason,
        ...semanticRepair,
        attempted: true,
        usable: false,
        degraded: true,
        failure_category: failureCategory,
        latency_ms: latencyMs,
      },
    };
  }
}

async function runSelectiveResearchWithState(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
  candidateResearchModel: DiscoveryCandidateResearchModel = DISCOVERY_STAGE2_MODEL,
): Promise<DiscoveryResearchExecution> {
  const rawResults: DiscoveryResearchResult[] = [];
  const calls: DiscoveryResearchCallMetrics[] = [];
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const identityVerification = await runIdentityResolution(
    openai,
    stage1,
    state,
  );
  const identityApplicableCandidates = new Set(
    identityApplicableCandidateIds(stage1, identityVerification.result),
  );
  const identityDependentResearchCandidates = gatedCandidates.filter(
    (candidate) => candidate.identity_context_needed,
  );
  state.identityDependentResearchCandidates =
    identityDependentResearchCandidates.length;
  const identityBlockedCandidateIds = state.identityBlockedCandidateIds;
  state.stageReached = "research";
  for (const candidate of gatedCandidates) {
    state.currentCandidateId = candidate.id;
    state.currentQuestionId = candidate.question_id;
    if (
      candidate.identity_context_needed &&
      !identityApplicableCandidates.has(candidate.id)
    ) {
      identityBlockedCandidateIds.push(candidate.id);
      state.candidateResearchCallsAvoidedByIdentityGate += 1;
      rawResults.push({
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        question: candidate.investigation_question,
        status: "insufficient",
        finding:
          "Verified identity was required for this question but could not be established; research was skipped to avoid unsupported subject substitution.",
        sources: [],
      });
      continue;
    }
    state.attemptedResearchCalls += 1;
    if (!candidate.identity_context_needed) {
      state.identityIndependentCandidateResearchApiCalls += 1;
    }
    const completed = await runDiscoveryCandidateResearchCall(
      openai,
      stage1,
      candidate,
      identityVerification.result,
      candidateResearchModel,
      (metrics) => state.knownStage2Metrics.push(metrics),
    );
    const { result, call } = completed;
    rawResults.push(result);
    calls.push(call);
    state.researchCalls.push(call);
  }

  const results = validateResearchResults(stage1, rawResults);
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  state.lastCompletedStage = "research";
  return {
    results,
    calls,
    identityVerification,
    gatedCandidates: gatedCandidates.length,
    identityDependentResearchCandidates:
      identityDependentResearchCandidates.length,
    identityBlockedCandidateIds,
    candidateResearchCallsAvoidedByIdentityGate:
      identityBlockedCandidateIds.length,
    identityIndependentCandidateResearchApiCalls:
      state.identityIndependentCandidateResearchApiCalls,
    candidateResearchApiCalls: calls.length,
    candidateCallsUsingVerifiedIdentity: calls.filter(
      (call) => call.used_verified_identity_context,
    ).length,
    batchMetrics: null,
    batchInspection: null,
  };
}

async function runFrozenV1SelectiveResearchWithState(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryResearchExecution> {
  const rawResults: DiscoveryResearchResult[] = [];
  const calls: DiscoveryResearchCallMetrics[] = [];
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const identityVerification = await runFrozenV1IdentityVerification(
    openai,
    stage1,
    gatedCandidates,
    state,
  );

  state.stageReached = "research";
  for (const candidate of gatedCandidates) {
    state.currentCandidateId = candidate.id;
    state.currentQuestionId = candidate.question_id;
    state.attemptedResearchCalls += 1;
    const completed = await executeDiscoveryCandidateResearchCall(
      openai,
      stage1,
      candidate,
      buildFrozenV1ResearchRequest(
        stage1,
        candidate,
        identityVerification.result,
      ),
      (metrics) => state.knownStage2Metrics.push(metrics),
    );
    rawResults.push(completed.result);
    calls.push(completed.call);
    state.researchCalls.push(completed.call);
  }

  const results = validateResearchResults(stage1, rawResults);
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  state.lastCompletedStage = "research";
  return {
    results,
    calls,
    identityVerification,
    gatedCandidates: gatedCandidates.length,
    identityDependentResearchCandidates: 0,
    identityBlockedCandidateIds: [],
    candidateResearchCallsAvoidedByIdentityGate: 0,
    identityIndependentCandidateResearchApiCalls: 0,
    candidateResearchApiCalls: calls.length,
    candidateCallsUsingVerifiedIdentity: calls.filter(
      (call) => call.used_verified_identity_context,
    ).length,
    batchMetrics: null,
    batchInspection: null,
  };
}

async function runDeepSeekV1SelectiveResearchWithState(
  deepseek: DeepSeekClient,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryResearchExecution> {
  const rawResults: DiscoveryResearchResult[] = [];
  const calls: DiscoveryResearchCallMetrics[] = [];
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const identityVerification = await runDeepSeekV1IdentityVerification(
    deepseek,
    stage1,
    gatedCandidates,
    state,
  );

  state.stageReached = "research";
  for (const candidate of gatedCandidates) {
    state.currentCandidateId = candidate.id;
    state.currentQuestionId = candidate.question_id;
    state.attemptedResearchCalls += 1;
    const completed = await executeDiscoveryCandidateResearchCall(
      deepseek,
      stage1,
      candidate,
      buildDeepSeekV1ResearchRequest(
        stage1,
        candidate,
        identityVerification.result,
      ),
      (metrics) => state.knownStage2Metrics.push(metrics),
      "deepseek",
    );
    rawResults.push(completed.result);
    calls.push(completed.call);
    state.researchCalls.push(completed.call);
  }

  const results = validateResearchResults(stage1, rawResults);
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  state.lastCompletedStage = "research";
  return {
    results,
    calls,
    identityVerification,
    gatedCandidates: gatedCandidates.length,
    identityDependentResearchCandidates: 0,
    identityBlockedCandidateIds: [],
    candidateResearchCallsAvoidedByIdentityGate: 0,
    identityIndependentCandidateResearchApiCalls: 0,
    candidateResearchApiCalls: calls.length,
    candidateCallsUsingVerifiedIdentity: calls.filter(
      (call) => call.used_verified_identity_context,
    ).length,
    batchMetrics: null,
    batchInspection: null,
  };
}

function v2CandidateLocalFailure(
  error: unknown,
  candidate: DiscoveryCandidate,
): DiscoveryCandidateLocalFailure | null {
  const classified = classifyDiscoveryFailure(error);
  const category: DiscoveryFailureCategory =
    classified === "structured_output" ? "malformed_model_output" : classified;
  const safeMessages: Partial<
    Record<DiscoveryCandidateLocalFailureCategory, string>
  > = {
    tool_call:
      "The research provider did not execute the required hosted search; this candidate was safely marked insufficient.",
    search_provider:
      "The hosted search did not complete for this candidate; this candidate was safely marked insufficient.",
    source_validation:
      "The candidate response had no trustworthy candidate-local citations; this candidate was safely marked insufficient.",
    schema_validation:
      "The candidate response did not satisfy the research contract; this candidate was safely marked insufficient.",
    malformed_model_output:
      "The candidate response was not safely usable; this candidate was safely marked insufficient.",
  };
  const safeMessage =
    safeMessages[category as DiscoveryCandidateLocalFailureCategory];
  return safeMessage
    ? {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        category: category as DiscoveryCandidateLocalFailureCategory,
        safe_message: safeMessage,
      }
    : null;
}

async function executeV2HybridCandidateResearchCall(
  deepseek: DeepSeekClient,
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  identityVerification: DiscoveryIdentityVerification | null,
): Promise<{
  result: DiscoveryResearchResult;
  call: DiscoveryResearchCallMetrics;
  metrics: DiscoveryStageMetrics;
}> {
  const built = buildDeepSeekV1ResearchRequest(
    stage1,
    candidate,
    identityVerification,
  );
  const started = Date.now();
  let response: Response | undefined;
  try {
    response = await createDeepSeekResponse(deepseek, built.request, true);
    const usage = normalizeResponseUsage(
      response,
      Date.now() - started,
      "deepseek",
    );
    const metrics = stageMetrics(usage, countWebSearchCalls(response));
    const sources = extractValidatedSources(response);
    const cleaned = cleanResearchFinding(response.output_text);
    if (!/^(ANSWERED|INSUFFICIENT)\s*:/i.test(response.output_text.trim())) {
      throw new DeepSeekDiscoveryError(
        "structured_output",
        "DeepSeek candidate research omitted its required answer status",
        undefined,
        response,
      );
    }
    if (!cleaned.declaredInsufficient && sources.length === 0) {
      throw new Error(
        "Candidate research returned no validated citations for an asserted answer",
      );
    }
    const status = cleaned.declaredInsufficient ? "insufficient" : "answered";
    const result = validateResearchResults(stage1, [
      {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        question: candidate.investigation_question,
        status,
        finding: cleaned.finding,
        sources: status === "answered" ? sources : [],
      },
    ])[0]!;
    return {
      result,
      metrics,
      call: {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        status,
        used_verified_identity_context: built.usedVerifiedIdentityContext,
        ...metrics,
      },
    };
  } catch (error) {
    const localFailure = v2CandidateLocalFailure(error, candidate);
    const failedResponse =
      response ??
      (error instanceof DeepSeekDiscoveryError ? error.response : undefined);
    if (!localFailure || !failedResponse) throw error;

    const usage = normalizeResponseUsage(
      failedResponse,
      Date.now() - started,
      "deepseek",
    );
    const metrics = stageMetrics(usage, countWebSearchCalls(failedResponse));
    const result = validateResearchResults(stage1, [
      {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        question: candidate.investigation_question,
        status: "insufficient",
        finding: localFailure.safe_message,
        sources: [],
      },
    ])[0]!;
    return {
      result,
      metrics,
      call: {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        status: "insufficient",
        used_verified_identity_context: built.usedVerifiedIdentityContext,
        candidate_local_failure: localFailure,
        ...metrics,
      },
    };
  }
}

async function mapWithBoundedConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  let fatalError: unknown;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (fatalError === undefined) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= items.length) return;
        try {
          results[index] = await operation(items[index]!);
        } catch (error) {
          fatalError = error;
        }
      }
    },
  );
  await Promise.all(workers);
  if (fatalError !== undefined) throw fatalError;
  return results;
}

async function runV2HybridSelectiveResearchWithState(
  deepseek: DeepSeekClient,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryResearchExecution> {
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const identityVerification = await runV2HybridIdentityVerification(
    deepseek,
    stage1,
    gatedCandidates,
    state,
  );

  state.stageReached = "research";
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  const researchStarted = Date.now();
  const completed = await mapWithBoundedConcurrency(
    gatedCandidates,
    V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
    (candidate) => {
      state.attemptedResearchCalls += 1;
      return executeV2HybridCandidateResearchCall(
        deepseek,
        stage1,
        candidate,
        identityVerification.result,
      );
    },
  );
  const researchWallClockLatencyMs = Date.now() - researchStarted;
  const rawResults = completed.map((item) => item.result);
  const calls = completed.map((item) => item.call);
  const candidateLocalFailures = calls.flatMap((call) =>
    call.candidate_local_failure ? [call.candidate_local_failure] : [],
  );
  for (const item of completed) {
    state.knownStage2Metrics.push(item.metrics);
    state.researchCalls.push(item.call);
  }

  const results = validateResearchResults(stage1, rawResults);
  state.lastCompletedStage = "research";
  return {
    results,
    calls,
    identityVerification,
    gatedCandidates: gatedCandidates.length,
    identityDependentResearchCandidates: 0,
    identityBlockedCandidateIds: [],
    candidateResearchCallsAvoidedByIdentityGate: 0,
    identityIndependentCandidateResearchApiCalls: 0,
    candidateResearchApiCalls: calls.length,
    candidateCallsUsingVerifiedIdentity: calls.filter(
      (call) => call.used_verified_identity_context,
    ).length,
    candidateLocalFailures,
    researchWallClockLatencyMs,
    researchMaxConcurrency: V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
    batchMetrics: null,
    batchInspection: null,
  };
}

export function buildDiscoveryCandidateResearchRequest(
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  identityVerification: DiscoveryIdentityVerification | null,
  model: DiscoveryCandidateResearchModel,
) {
  const usedVerifiedIdentityContext = identityApplicableCandidateIds(
    stage1,
    identityVerification,
  ).includes(candidate.id);
  const identityContext = usedVerifiedIdentityContext
    ? [
        "VERIFIED IDENTITY CONTEXT (search context only):",
        JSON.stringify({
          canonical_identity: identityVerification?.canonical_identity,
          identity_type: identityVerification?.identity_type,
          location: identityVerification?.location,
          verification_basis: identityVerification?.verification_basis,
        }),
      ]
    : candidate.identity_context_needed
      ? [
          `IDENTITY VERIFICATION STATUS: ${identityVerification?.status ?? "not_run"}.`,
          "No verified identity context is available. Do not treat a hypothesis or similar object as the uploaded subject.",
        ]
      : ["IDENTITY CONTEXT: not needed for this question."];

  return {
    usedVerifiedIdentityContext,
    request: {
      model,
      reasoning: { effort: DISCOVERY_REASONING_EFFORT as "medium" },
      tools: [
        {
          type: "web_search" as const,
          search_context_size: "medium" as const,
        },
      ],
      tool_choice: "required" as const,
      include: ["web_search_call.action.sources" as const],
      store: false,
      max_output_tokens: 3000,
      instructions: RESEARCH_INSTRUCTIONS,
      input: [
        `CANDIDATE ID: ${candidate.id}`,
        `QUESTION ID: ${candidate.question_id}`,
        `VISIBLE TRIGGER: ${candidate.visual_trigger}`,
        `GROUNDED OBSERVATION: ${candidate.observation}`,
        `APPROVED QUESTION: ${candidate.investigation_question}`,
        `WHY RESEARCH MAY DEEPEN THE IMAGE: ${candidate.research_rationale}`,
        ...identityContext,
        "Answer only the APPROVED QUESTION above.",
      ].join("\n"),
    },
  };
}

export async function runDiscoveryCandidateResearchCall(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  identityVerification: DiscoveryIdentityVerification | null,
  model: DiscoveryCandidateResearchModel,
  onMetrics?: (metrics: DiscoveryStageMetrics) => void,
): Promise<{
  result: DiscoveryResearchResult;
  call: DiscoveryResearchCallMetrics;
  metrics: DiscoveryStageMetrics;
}> {
  const built = buildDiscoveryCandidateResearchRequest(
    stage1,
    candidate,
    identityVerification,
    model,
  );
  return executeDiscoveryCandidateResearchCall(
    openai,
    stage1,
    candidate,
    built,
    onMetrics,
  );
}

async function executeDiscoveryCandidateResearchCall(
  openai: Pick<OpenAI, "responses">,
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  built: {
    usedVerifiedIdentityContext: boolean;
    request: ResponseCreateParamsNonStreaming;
  },
  onMetrics?: (metrics: DiscoveryStageMetrics) => void,
  provider?: DiscoveryUsageMetrics["provider"],
): Promise<{
  result: DiscoveryResearchResult;
  call: DiscoveryResearchCallMetrics;
  metrics: DiscoveryStageMetrics;
}> {
  const started = Date.now();
  const response =
    provider === "deepseek"
      ? await createDeepSeekResponse(openai, built.request, true)
      : await openai.responses.create(built.request);
  const usage = normalizeResponseUsage(
    response,
    Date.now() - started,
    provider,
  );
  const metrics = stageMetrics(usage, countWebSearchCalls(response));
  onMetrics?.(metrics);
  const sources = extractValidatedSources(response);
  const cleaned = cleanResearchFinding(response.output_text);
  const status =
    cleaned.declaredInsufficient || sources.length === 0
      ? "insufficient"
      : "answered";
  const result = validateResearchResults(stage1, [
    {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      question: candidate.investigation_question,
      status,
      finding: cleaned.finding,
      sources,
    },
  ])[0]!;
  return {
    result,
    metrics,
    call: {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      status,
      used_verified_identity_context: built.usedVerifiedIdentityContext,
      ...metrics,
    },
  };
}

async function runBatchedSelectiveResearchWithState(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryResearchExecution> {
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const identityVerification = await runIdentityResolution(
    openai,
    stage1,
    state,
  );
  const identityDependentResearchCandidates = gatedCandidates.filter(
    (candidate) => candidate.identity_context_needed,
  ).length;
  state.identityDependentResearchCandidates =
    identityDependentResearchCandidates;
  const batchContext = buildDiscoveryBatchContext(
    stage1,
    gatedCandidates,
    identityVerification.result,
  );

  if (gatedCandidates.length === 0) {
    state.stageReached = "research";
    state.lastCompletedStage = "research";
    return {
      results: [],
      calls: [],
      identityVerification,
      gatedCandidates: 0,
      identityDependentResearchCandidates: 0,
      identityBlockedCandidateIds: [],
      candidateResearchCallsAvoidedByIdentityGate: 0,
      identityIndependentCandidateResearchApiCalls: 0,
      candidateResearchApiCalls: 0,
      candidateCallsUsingVerifiedIdentity: 0,
      batchMetrics: null,
      batchInspection: {
        ...batchContext,
        invalid_candidate_ids: [],
        missing_candidate_ids: [],
        validation_issues: [],
      },
    };
  }

  state.stageReached = "research";
  state.currentCandidateId = undefined;
  state.currentQuestionId = undefined;
  state.attemptedResearchCalls += 1;
  state.researchFailureScope = "batch_api";
  state.affectedCandidateIds = gatedCandidates.map((candidate) => candidate.id);
  state.batchValidationDiagnostics = {
    validation_diagnostics_version: DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
    validation_issues: [],
    attempted_candidate_ids: gatedCandidates.map((candidate) => candidate.id),
    answered_candidate_ids: [],
    insufficient_candidate_ids: [],
    invalid_candidate_ids: [],
    missing_candidate_ids: [],
  };
  const started = Date.now();
  const response = await openai.responses.create({
    model: DISCOVERY_STAGE2_MODEL,
    reasoning: { effort: DISCOVERY_REASONING_EFFORT },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    store: false,
    max_output_tokens: 3000,
    text: { format: DISCOVERY_BATCHED_RESEARCH_JSON_SCHEMA },
    instructions: BATCHED_RESEARCH_INSTRUCTIONS,
    input: [
      "APPROVED RESEARCH CANDIDATES:",
      JSON.stringify({ candidates: batchContext.candidates }),
      "Return exactly one independently scoped result per supplied candidate.",
    ].join("\n"),
  });
  const usage = normalizeResponseUsage(response, Date.now() - started);
  const metrics = stageMetrics(usage, countWebSearchCalls(response));
  state.knownStage2Metrics.push(metrics);
  state.researchFailureScope = "batch_schema";

  let validatedBatch: ReturnType<typeof validateDiscoveryBatchResults>;
  try {
    validatedBatch = validateDiscoveryBatchResults(
      stage1,
      gatedCandidates,
      JSON.parse(response.output_text),
      {
        output_text: response.output_text,
        citations: extractValidatedSourceCitations(response),
      },
    );
  } catch (error) {
    if (error instanceof DiscoveryBatchValidationError) {
      state.researchFailureScope = error.scope;
      state.researchValidationCategory = error.validationCategory;
      state.safeValidationMessage = error.message;
      state.currentCandidateId = error.candidateId;
      state.currentQuestionId = error.questionId;
      state.affectedCandidateIds = error.candidateId
        ? [error.candidateId]
        : gatedCandidates.map((candidate) => candidate.id);
      state.batchValidationDiagnostics = {
        ...state.batchValidationDiagnostics!,
        validation_issues: error.candidateId
          ? [
              {
                candidate_id: error.candidateId,
                question_id: error.questionId ?? "unknown",
                validation_category: error.validationCategory,
                safe_message: error.message,
              },
            ]
          : [],
        invalid_candidate_ids: error.candidateId ? [error.candidateId] : [],
      };
    }
    throw error;
  }

  const answeredCandidates = validatedBatch.results.filter(
    (result) => result.status === "answered",
  ).length;
  const insufficientCandidates =
    validatedBatch.results.length - answeredCandidates;
  state.batchValidationDiagnostics = {
    validation_diagnostics_version: DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
    validation_issues: validatedBatch.validation_issues,
    attempted_candidate_ids: gatedCandidates.map((candidate) => candidate.id),
    answered_candidate_ids: validatedBatch.results
      .filter((result) => result.status === "answered")
      .map((result) => result.candidate_id),
    insufficient_candidate_ids: validatedBatch.results
      .filter((result) => result.status === "insufficient")
      .map((result) => result.candidate_id),
    invalid_candidate_ids: validatedBatch.invalid_candidate_ids,
    missing_candidate_ids: validatedBatch.missing_candidate_ids,
  };
  state.researchFailureScope = undefined;
  state.researchValidationCategory = undefined;
  state.safeValidationMessage = undefined;
  state.affectedCandidateIds = undefined;
  state.lastCompletedStage = "research";
  return {
    results: validatedBatch.results,
    calls: [],
    identityVerification,
    gatedCandidates: gatedCandidates.length,
    identityDependentResearchCandidates,
    identityBlockedCandidateIds: [],
    candidateResearchCallsAvoidedByIdentityGate: 0,
    identityIndependentCandidateResearchApiCalls: 0,
    candidateResearchApiCalls: 1,
    candidateCallsUsingVerifiedIdentity:
      batchContext.identity_context_mappings.filter(
        (mapping) => mapping.used_verified_identity_context,
      ).length,
    batchMetrics: {
      ...metrics,
      candidate_count: gatedCandidates.length,
      candidate_ids: gatedCandidates.map((candidate) => candidate.id),
      question_ids: gatedCandidates.map((candidate) => candidate.question_id),
      invalid_candidate_ids: validatedBatch.invalid_candidate_ids,
      missing_candidate_ids: validatedBatch.missing_candidate_ids,
      answered_candidates: answeredCandidates,
      insufficient_candidates: insufficientCandidates,
      validation_issues: validatedBatch.validation_issues,
    },
    batchInspection: {
      ...batchContext,
      invalid_candidate_ids: validatedBatch.invalid_candidate_ids,
      missing_candidate_ids: validatedBatch.missing_candidate_ids,
      validation_issues: validatedBatch.validation_issues,
    },
  };
}

export async function runBatchedSelectiveResearch(
  openai: OpenAI,
  stage1: DiscoveryStage1,
): Promise<DiscoveryResearchExecution> {
  const state = createExecutionState(
    Date.now(),
    DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  );
  try {
    return await runBatchedSelectiveResearchWithState(openai, stage1, state);
  } catch (error) {
    throw new DiscoveryPipelineError(error, state);
  }
}

export async function runSelectiveResearch(
  openai: OpenAI,
  stage1: DiscoveryStage1,
): Promise<DiscoveryResearchExecution> {
  const state = createExecutionState();
  try {
    return await runSelectiveResearchWithState(openai, stage1, state);
  } catch (error) {
    throw new DiscoveryPipelineError(error, state);
  }
}

export function createStage3Evidence(
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  identityVerification: DiscoveryIdentityVerification | null,
) {
  const answeredResearchResults = researchResults.filter(
    (result) => result.status === "answered",
  );
  const identityContext =
    identityVerification?.status === "verified"
      ? {
          ...identityVerification,
          applicable_candidate_ids: identityApplicableCandidateIds(
            stage1,
            identityVerification,
          ),
        }
      : identityVerification
        ? { status: identityVerification.status }
        : null;
  return {
    research_results: answeredResearchResults,
    identity_verification: identityContext,
  };
}

async function runDiscoveryPipelineWithState(
  openai: OpenAI,
  deepseek: DeepSeekClient | null,
  imageDataUrl: string,
  pipelineStarted: number,
  timestamp: string,
  state: DiscoveryExecutionState,
  variant: DiscoveryEngineVariant,
): Promise<DiscoveryPipelineResult> {
  const modelAllocation = discoveryModelAllocationForVariant(variant);
  const isFrozenV1 = variant === "v1-frozen";
  const isDeepSeekV1 = variant === "v1-deepseek-pro";
  const isV2Hybrid = variant === "v2-hybrid";
  const usesFrozenV1Semantics = isFrozenV1 || isDeepSeekV1 || isV2Hybrid;
  const reasoningEffort = usesFrozenV1Semantics
    ? isV2Hybrid
      ? V2_HYBRID_REASONING_EFFORT
      : FROZEN_V1_REASONING_EFFORT
    : DISCOVERY_REASONING_EFFORT;
  state.stageReached = "stage1";
  const stage1Started = Date.now();
  const stage1Response = await openai.chat.completions.create({
    model: modelAllocation.stage1,
    reasoning_effort: reasoningEffort,
    max_completion_tokens: 10000,
    response_format: {
      type: "json_schema",
      json_schema: DISCOVERY_STAGE1_JSON_SCHEMA as unknown as {
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      },
    },
    messages: [
      {
        role: "system",
        content: usesFrozenV1Semantics
          ? FROZEN_V1_STAGE1_PROMPT
          : STAGE1_PROMPT,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Inspect this image and return only the grounded Stage 1 structure.",
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  });
  const stage1Usage = normalizeChatUsage(
    stage1Response,
    Date.now() - stage1Started,
    isDeepSeekV1 || isV2Hybrid ? "openai" : undefined,
  );
  const stage1Metrics = stageMetrics(stage1Usage);
  state.stage1 = stage1Metrics;
  const stage1Text = stage1Response.choices[0]?.message.content;
  if (!stage1Text)
    throw new Error("Discovery Stage 1 returned an empty response");
  const parsedStage1 = JSON.parse(stage1Text);
  let stage1: DiscoveryStage1;
  let stage1Reconciliation: DiscoveryStage1ReconciliationDiagnostics | null =
    null;
  if (usesFrozenV1Semantics) {
    stage1 = DiscoveryStage1Schema.parse(parsedStage1);
  } else {
    const stage1Draft = DiscoveryStage1DraftSchema.parse(parsedStage1);
    const reconciledStage1 = reconcileDiscoveryStage1References(stage1Draft);
    state.stage1Reconciliation = reconciledStage1.diagnostics;
    stage1Reconciliation = reconciledStage1.diagnostics;
    stage1 = DiscoveryStage1Schema.parse(reconciledStage1.stage1);
  }
  state.lastCompletedStage = "stage1";

  const research = isFrozenV1
    ? await runFrozenV1SelectiveResearchWithState(openai, stage1, state)
    : isDeepSeekV1
      ? await runDeepSeekV1SelectiveResearchWithState(deepseek!, stage1, state)
      : isV2Hybrid
        ? await runV2HybridSelectiveResearchWithState(deepseek!, stage1, state)
        : variant === "v1-batched-research"
          ? await runBatchedSelectiveResearchWithState(openai, stage1, state)
          : await runSelectiveResearchWithState(
              openai,
              stage1,
              state,
              modelAllocation.candidateResearch as DiscoveryCandidateResearchModel,
            );
  const stage2Usages = research.batchMetrics
    ? [research.batchMetrics.usage]
    : research.calls.map((call) => call.usage);
  if (research.identityVerification.metrics.usage) {
    stage2Usages.unshift(research.identityVerification.metrics.usage);
  }
  const stage2Usage = aggregateUsage(
    modelAllocation.candidateResearch,
    stage2Usages,
  );
  const stage2Components: DiscoveryCostMetrics[] = research.batchMetrics
    ? [research.batchMetrics]
    : [...research.calls];
  if (research.identityVerification.metrics.ran) {
    stage2Components.unshift(research.identityVerification.metrics);
  }
  const stage2WebSearchCalls = stage2Components.reduce(
    (sum, metrics) => sum + metrics.web_search_calls,
    0,
  );
  const stage2ModelTokenCosts = stage2Components.map(
    (metrics) => metrics.model_token_cost_usd,
  );
  const stage2ModelTokenCost = isV2Hybrid
    ? sumKnown(stage2ModelTokenCosts)
    : sumNullable(stage2ModelTokenCosts);
  const stage2ToolCost = sumNullable(
    stage2Components.map((metrics) => metrics.tool_cost_usd),
  );
  const stage2KnownCosts = stage2Components.map(
    (metrics) => metrics.total_known_cost_usd,
  );
  const stage2Cost = isV2Hybrid
    ? sumKnown(stage2KnownCosts)
    : sumNullable(stage2KnownCosts);

  state.stageReached = "stage3";
  const stage3Started = Date.now();
  const frozenStage3Context = usesFrozenV1Semantics
    ? buildFrozenV1Stage3Context(
        stage1,
        research.results,
        research.identityVerification.result,
      )
    : null;
  const stage3Evidence = usesFrozenV1Semantics
    ? {
        research_results: frozenStage3Context!.researchResults,
        identity_verification: frozenStage3Context!.identityContext,
      }
    : createStage3Evidence(
        stage1,
        research.results,
        research.identityVerification.result,
      );
  const stage3Grounding = usesFrozenV1Semantics
    ? frozenStage3Context!.grounding
    : {
        ...stage1,
        identity_hypotheses:
          research.identityVerification.result?.status === "verified"
            ? stage1.identity_hypotheses.filter(
                (hypothesis) =>
                  hypothesis.id ===
                  research.identityVerification.result?.hypothesis_id,
              )
            : [],
      };
  const stage3Response = isDeepSeekV1
    ? await createDeepSeekResponse(
        deepseek!,
        buildDeepSeekV1Stage3Request(
          stage1,
          research.results,
          research.identityVerification.result,
        ),
        false,
      )
    : isV2Hybrid
      ? await openai.chat.completions.create(
          buildV2HybridFinalRequest(
            imageDataUrl,
            stage1,
            research.results,
            research.identityVerification.result,
          ),
        )
      : await openai.chat.completions.create({
          model: modelAllocation.stage3,
          reasoning_effort: reasoningEffort,
          max_completion_tokens: 10000,
          response_format: {
            type: "json_schema",
            json_schema: DISCOVERY_STAGE3_JSON_SCHEMA as unknown as {
              name: string;
              strict: boolean;
              schema: Record<string, unknown>;
            },
          },
          messages: [
            {
              role: "system",
              content: isFrozenV1 ? FROZEN_V1_STAGE3_PROMPT : STAGE3_PROMPT,
            },
            {
              role: "user",
              content: [
                "STAGE 1 GROUNDING:",
                JSON.stringify(stage3Grounding),
                "",
                "DETERMINISTIC CALCULATIONS:",
                "[]",
                "",
                "VALIDATED RESEARCH RESULTS:",
                JSON.stringify(stage3Evidence.research_results),
                "",
                "IDENTITY VERIFICATION RESULT:",
                JSON.stringify(stage3Evidence.identity_verification),
              ].join("\n"),
            },
          ],
        });
  const stage3Usage = isDeepSeekV1
    ? normalizeResponseUsage(
        stage3Response as Response,
        Date.now() - stage3Started,
        "deepseek",
      )
    : normalizeChatUsage(
        stage3Response as ChatCompletion,
        Date.now() - stage3Started,
      );
  const stage3Metrics = stageMetrics(stage3Usage);
  state.stage3 = stage3Metrics;
  const stage3Text = isDeepSeekV1
    ? (stage3Response as Response).output_text
    : (stage3Response as ChatCompletion).choices[0]?.message.content;
  if (!stage3Text)
    throw new Error("Discovery Stage 3 returned an empty response");
  const parsedStage3 = isDeepSeekV1
    ? parseDeepSeekStructuredOutput(stage3Text)
    : JSON.parse(stage3Text);
  state.lastCompletedStage = "stage3";
  state.stageReached = "validation";
  const validated = validateDiscoveryOutput(
    stage1,
    research.results,
    parsedStage3,
    research.identityVerification.result,
    usesFrozenV1Semantics
      ? frozenV1ApplicableCandidateIds(
          stage1,
          research.identityVerification.result,
        )
      : undefined,
  );

  const modelTokenCosts = [
    stage1Metrics.model_token_cost_usd,
    stage2ModelTokenCost,
    stage3Metrics.model_token_cost_usd,
  ];
  const totalModelTokenCost = isV2Hybrid
    ? sumKnown(modelTokenCosts)
    : sumNullable(modelTokenCosts);
  const totalToolCost = sumNullable([
    stage1Metrics.tool_cost_usd,
    stage2ToolCost,
    stage3Metrics.tool_cost_usd,
  ]);
  const knownCosts = [
    stage1Metrics.total_known_cost_usd,
    stage2Cost,
    stage3Metrics.total_known_cost_usd,
  ];
  const totalKnownCost = isV2Hybrid
    ? sumKnown(knownCosts)
    : sumNullable(knownCosts);
  const totalWebSearchCalls =
    stage1Metrics.web_search_calls +
    stage2WebSearchCalls +
    stage3Metrics.web_search_calls;
  const engineVersion = discoveryEngineVersionForVariant(variant);
  const costPerFinalDiscovery =
    totalKnownCost !== null && validated.discoveries.length > 0
      ? totalKnownCost / validated.discoveries.length
      : null;
  const answeredCandidates = research.results.filter(
    (result) => result.status === "answered",
  ).length;
  const insufficientCandidates = research.results.length - answeredCandidates;

  return {
    version: engineVersion,
    regions: stage1.regions,
    discoveries: validated.discoveries,
    inspection: {
      stage1,
      ...(stage1Reconciliation
        ? { stage1_reconciliation: stage1Reconciliation }
        : {}),
      identity_verification: research.identityVerification.result,
      research_results: research.results,
      discovery_candidates: validated.discoveryCandidates,
      ...(research.batchInspection
        ? { research_batch: research.batchInspection }
        : {}),
    },
    metrics: {
      timestamp,
      engine_version: engineVersion,
      success: true,
      stage1: stage1Metrics,
      stage2: {
        model: modelAllocation.candidateResearch,
        candidate_research_model: modelAllocation.candidateResearch,
        reasoning_effort: DISCOVERY_REASONING_EFFORT,
        questions_sent: research.gatedCandidates,
        latency_ms: stage2Usage.latency_ms,
        usage: stage2Usage,
        web_search_calls: stage2WebSearchCalls,
        model_token_cost_usd: stage2ModelTokenCost,
        tool_cost_usd: stage2ToolCost,
        total_known_cost_usd: stage2Cost,
        cost_usd: stage2Cost,
        identity_verification: research.identityVerification.metrics,
        ...(!usesFrozenV1Semantics
          ? {
              identity_dependent_research_candidates:
                research.identityDependentResearchCandidates,
              identity_blocked_candidate_ids:
                research.identityBlockedCandidateIds,
              candidate_research_calls_avoided_by_identity_gate:
                research.candidateResearchCallsAvoidedByIdentityGate,
              identity_independent_candidate_research_api_calls:
                research.identityIndependentCandidateResearchApiCalls,
            }
          : {}),
        candidate_calls_using_verified_identity:
          research.candidateCallsUsingVerifiedIdentity,
        candidate_research_api_calls: research.candidateResearchApiCalls,
        answered_candidates: answeredCandidates,
        insufficient_candidates: insufficientCandidates,
        ...(isV2Hybrid
          ? {
              candidate_local_failed_candidates:
                research.candidateLocalFailures?.length ?? 0,
              candidate_local_failures: research.candidateLocalFailures ?? [],
              research_wall_clock_latency_ms:
                research.researchWallClockLatencyMs ?? 0,
              research_max_concurrency:
                research.researchMaxConcurrency ??
                V2_HYBRID_RESEARCH_MAX_CONCURRENCY,
            }
          : {}),
        calls: research.calls,
        batch: research.batchMetrics,
      },
      stage3: {
        ...stage3Metrics,
        discoveries_returned: validated.discoveries.length,
      },
      total_latency_ms: Date.now() - pipelineStarted,
      web_search_calls: totalWebSearchCalls,
      model_token_cost_usd: totalModelTokenCost,
      tool_cost_usd: totalToolCost,
      total_known_cost_usd: totalKnownCost,
      total_cost_usd: totalKnownCost,
      cost_per_successful_analysis_usd: totalKnownCost,
      cost_per_final_discovery_usd: costPerFinalDiscovery,
      stage1_candidates: stage1.candidates.length,
      research_gate_passed: research.gatedCandidates,
      final_discoveries: validated.discoveries.length,
    },
  };
}

export async function runDiscoveryPipeline(
  openai: OpenAI,
  imageDataUrl: string,
  options: {
    variant?: DiscoveryEngineVariant;
    deepseekClient?: DeepSeekClient;
  } = {},
): Promise<DiscoveryPipelineResult> {
  const pipelineStarted = Date.now();
  const timestamp = new Date().toISOString();
  const variant = options.variant ?? DEFAULT_DISCOVERY_ENGINE_VARIANT;
  if (
    (variant === "v1-deepseek-pro" || variant === "v2-hybrid") &&
    !options.deepseekClient
  ) {
    throw new Error(`DeepSeek client is required for ${variant}`);
  }
  const engineVersion = discoveryEngineVersionForVariant(variant);
  const modelAllocation = discoveryModelAllocationForVariant(variant);
  const state = createExecutionState(
    pipelineStarted,
    engineVersion,
    modelAllocation.candidateResearch,
    variant !== "v1-frozen" &&
      variant !== "v1-deepseek-pro" &&
      variant !== "v2-hybrid",
  );

  try {
    return await runDiscoveryPipelineWithState(
      openai,
      options.deepseekClient ?? null,
      imageDataUrl,
      pipelineStarted,
      timestamp,
      state,
      variant,
    );
  } catch (error) {
    if (error instanceof DiscoveryPipelineError) throw error;
    throw new DiscoveryPipelineError(error, state);
  }
}

import OpenAI from "openai";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type { Response } from "openai/resources/responses/responses";
import {
  DISCOVERY_IDENTITY_VERIFICATION_JSON_SCHEMA,
  DISCOVERY_STAGE1_JSON_SCHEMA,
  DISCOVERY_STAGE3_JSON_SCHEMA,
  DiscoveryStage1Schema,
  evaluateResearchGate,
  validateIdentityVerification,
  validateDiscoveryOutput,
  validateResearchResults,
  type Discovery,
  type DiscoveryInspection,
  type DiscoveryIdentityVerification,
  type DiscoveryRegion,
  type DiscoveryResearchResult,
  type DiscoverySource,
  type DiscoveryStage1,
} from "./discoveryContracts";
import {
  DISCOVERY_BATCHED_RESEARCH_JSON_SCHEMA,
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
import { estimateModelCost } from "./modelPricing";

export const DISCOVERY_ENGINE_VERSION = "discovery-engine-v1";
export const DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION =
  "discovery-engine-v1-batched-research";
export type DiscoveryEngineVariant = "v1" | "v1-batched-research";
export const DEFAULT_DISCOVERY_ENGINE_VARIANT: DiscoveryEngineVariant = "v1";
export const DISCOVERY_STAGE1_MODEL = "gpt-5.6-sol";
export const DISCOVERY_STAGE2_MODEL = "gpt-5.6-terra";
export const DISCOVERY_STAGE3_MODEL = "gpt-5.6-sol";
export const DISCOVERY_REASONING_EFFORT = "medium";

export function discoveryEngineVersionForVariant(
  variant: DiscoveryEngineVariant,
): string {
  return variant === "v1-batched-research"
    ? DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION
    : DISCOVERY_ENGINE_VERSION;
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

Candidates may require no research. Reject broad topic questions, generic history, and trivia that could be generated from the subject alone. Do not expose chain-of-thought; return only concise structured grounding artifacts.`;

const IDENTITY_VERIFICATION_INSTRUCTIONS = `You are the conditional identity-verification substep inside Stage 2 of Noesis Discovery Engine V1.

You receive text-only visual identity hypotheses from Stage 1, their concise visible evidence, observed labels or numbers, and relevant region descriptions. You do not receive the image. Use web search to verify, reject, or identify conflict in the proposed identity. Identity is useful only as context for already-approved image-triggered questions.

Return verified only when external evidence establishes the exact place, building, object, figure, map, artwork, diagram, or other identity. A shared word, typography style, visual motif, generic structure, or partial characteristic is not enough. Evidence about a general convention is not evidence that a source depicts the exact same object or figure. In particular, another plate containing similar wording does not establish that it is the uploaded plate. Prefer unverified or conflicted over a convenient nearest match. Cite supporting claims only through web-search citations; never invent source URLs. Return only the strict JSON result.`;

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
- provenance is researched only when an answered research result or verified identity result materially contributes.
- researched discoveries may copy only source objects present in the supplied research or verified identity results.
- never present an unverified or conflicted identity hypothesis as fact; verified identity is not itself a discovery and may appear only when it materially explains or reinterprets something visible.
- all other discoveries must have an empty sources array.
- reinterpretation must explicitly tell the viewer what to notice or understand differently when looking back at the image.
- explanation is concise and user-facing; never expose private chain-of-thought.

Return only the strict JSON object.`;

export interface DiscoveryUsageMetrics {
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
  cost_usd: number | null;
  cost_reason: string | null;
}

export interface DiscoveryResearchCallMetrics extends DiscoveryStageMetrics {
  candidate_id: string;
  question_id: string;
  status: "answered" | "insufficient";
  used_verified_identity_context: boolean;
}

export interface DiscoveryIdentityVerificationMetrics {
  ran: boolean;
  status: "not_run" | "verified" | "unverified" | "conflicted";
  usage: DiscoveryUsageMetrics | null;
  cost_usd: number | null;
  cost_reason: string | null;
}

export interface DiscoveryBatchResearchMetrics extends DiscoveryStageMetrics {
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
    reasoning_effort: string;
    questions_sent: number;
    latency_ms: number;
    usage: DiscoveryUsageMetrics;
    cost_usd: number | null;
    identity_verification: DiscoveryIdentityVerificationMetrics;
    candidate_calls_using_verified_identity: number;
    candidate_research_api_calls: number;
    answered_candidates: number;
    insufficient_candidates: number;
    calls: DiscoveryResearchCallMetrics[];
    batch: DiscoveryBatchResearchMetrics | null;
  };
  stage3: DiscoveryStageMetrics & { discoveries_returned: number };
  total_latency_ms: number;
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
  | "timeout"
  | "schema_validation"
  | "malformed_model_output"
  | "source_validation"
  | "network_error"
  | "internal_error"
  | "unknown";

export interface DiscoverySafeUsageMetrics {
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
  partial_metrics: {
    stage1: DiscoverySafeStageMetrics | null;
    identity_verification:
      | (DiscoverySafeStageMetrics & {
          completed: boolean;
          status: "verified" | "unverified" | "conflicted" | null;
        })
      | null;
    research: {
      attempted_calls: number;
      completed_calls: DiscoveryCompletedResearchCallMetrics[];
      known_usage: DiscoverySafeUsageMetrics | null;
      known_cost_usd: number | null;
    };
    stage3: DiscoverySafeStageMetrics | null;
    known_total_tokens: number | null;
    known_total_cost_usd: number | null;
  };
}

interface DiscoveryExecutionState {
  startedAt: number;
  engineVersion: string;
  stageReached: DiscoveryFailureStage;
  lastCompletedStage: DiscoveryFailureDiagnostic["last_completed_stage"];
  currentCandidateId?: string;
  currentQuestionId?: string;
  stage1: DiscoveryStageMetrics | null;
  identityVerification:
    | (DiscoveryStageMetrics & {
        completed: boolean;
        status: "verified" | "unverified" | "conflicted" | null;
      })
    | null;
  knownStage2Metrics: DiscoveryStageMetrics[];
  researchCalls: DiscoveryResearchCallMetrics[];
  attemptedResearchCalls: number;
  researchFailureScope?: DiscoveryBatchFailureScope;
  researchValidationCategory?: DiscoveryBatchValidationCategory;
  safeValidationMessage?: string;
  affectedCandidateIds?: string[];
  stage3: DiscoveryStageMetrics | null;
}

function createExecutionState(
  startedAt = Date.now(),
  engineVersion = DISCOVERY_ENGINE_VERSION,
): DiscoveryExecutionState {
  return {
    startedAt,
    engineVersion,
    stageReached: "unknown",
    lastCompletedStage: "none",
    stage1: null,
    identityVerification: null,
    knownStage2Metrics: [],
    researchCalls: [],
    attemptedResearchCalls: 0,
    stage3: null,
  };
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function emptyUsage(model: string): DiscoveryUsageMetrics {
  return {
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
): DiscoveryUsageMetrics {
  return {
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
): DiscoveryUsageMetrics {
  return {
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
  return {
    model,
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

function stageMetrics(usage: DiscoveryUsageMetrics): DiscoveryStageMetrics {
  const cost = estimateModelCost(usage);
  return { usage, cost_usd: cost.usd, cost_reason: cost.reason };
}

function safeUsage(usage: DiscoveryUsageMetrics): DiscoverySafeUsageMetrics {
  return {
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
    case "timeout":
      return "The model service request timed out.";
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
          DISCOVERY_STAGE2_MODEL,
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
    partial_metrics: {
      stage1: state.stage1 ? safeStage(state.stage1) : null,
      identity_verification: state.identityVerification
        ? {
            ...safeStage(state.identityVerification),
            completed: state.identityVerification.completed,
            status: state.identityVerification.status,
          }
        : null,
      research: {
        attempted_calls: state.attemptedResearchCalls,
        completed_calls: completedResearchCalls,
        known_usage: knownStage2Usage ? safeUsage(knownStage2Usage) : null,
        known_cost_usd: sumKnown(
          state.knownStage2Metrics.map((metrics) => metrics.cost_usd),
        ),
      },
      stage3: state.stage3 ? safeStage(state.stage3) : null,
      known_total_tokens: sumKnown(
        knownMetrics.map((metrics) => metrics.usage.total_tokens),
      ),
      known_total_cost_usd: sumKnown(
        knownMetrics.map((metrics) => metrics.cost_usd),
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
  candidateResearchApiCalls: number;
  candidateCallsUsingVerifiedIdentity: number;
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
      cost_usd: null,
      cost_reason: null,
    },
  };
}

async function runIdentityVerification(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  gatedQuestionIds: Set<string>,
  state: DiscoveryExecutionState,
): Promise<DiscoveryIdentityVerificationExecution> {
  const identityQuestionIds = new Set(
    stage1.candidates
      .filter(
        (candidate) =>
          gatedQuestionIds.has(candidate.question_id) &&
          candidate.identity_context_needed,
      )
      .map((candidate) => candidate.question_id),
  );
  if (identityQuestionIds.size === 0) return identityNotRun();

  const hypotheses = stage1.identity_hypotheses.filter(
    (hypothesis) =>
      hypothesis.verification_would_help &&
      hypothesis.relevant_question_ids.some((questionId) =>
        identityQuestionIds.has(questionId),
      ),
  );
  if (hypotheses.length === 0) return identityNotRun();

  const relevantCandidates = stage1.candidates.filter(
    (candidate) =>
      gatedQuestionIds.has(candidate.question_id) &&
      candidate.identity_context_needed,
  );

  const relevantRegionIds = new Set(
    hypotheses.flatMap((hypothesis) => hypothesis.region_ids),
  );
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
    instructions: IDENTITY_VERIFICATION_INSTRUCTIONS,
    input: [
      "STAGE 1 IDENTITY HYPOTHESES:",
      JSON.stringify(hypotheses),
      "",
      "RELEVANT VISIBLE REGION DESCRIPTIONS:",
      JSON.stringify(
        stage1.regions.filter((region) => relevantRegionIds.has(region.id)),
      ),
      "",
      "APPROVED QUESTIONS THAT MAY NEED IDENTITY:",
      JSON.stringify(
        relevantCandidates.map((candidate) => ({
          question_id: candidate.question_id,
          visual_trigger: candidate.visual_trigger,
          observation: candidate.observation,
          investigation_question: candidate.investigation_question,
          identity_context_needed: candidate.identity_context_needed,
        })),
      ),
    ].join("\n"),
  });
  const usage = normalizeResponseUsage(response, Date.now() - started);
  const metrics = stageMetrics(usage);
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

async function runSelectiveResearchWithState(
  openai: OpenAI,
  stage1: DiscoveryStage1,
  state: DiscoveryExecutionState,
): Promise<DiscoveryResearchExecution> {
  const rawResults: DiscoveryResearchResult[] = [];
  const calls: DiscoveryResearchCallMetrics[] = [];
  const gatedCandidates = stage1.candidates.filter(
    (candidate) => evaluateResearchGate(stage1, candidate).allowed,
  );
  const gatedQuestionIds = new Set(
    gatedCandidates.map((candidate) => candidate.question_id),
  );
  const identityVerification = await runIdentityVerification(
    openai,
    stage1,
    gatedQuestionIds,
    state,
  );
  const verifiedHypothesis =
    identityVerification.result?.status === "verified"
      ? stage1.identity_hypotheses.find(
          (hypothesis) =>
            hypothesis.id === identityVerification.result?.hypothesis_id,
        )
      : undefined;

  state.stageReached = "research";
  for (const candidate of gatedCandidates) {
    state.currentCandidateId = candidate.id;
    state.currentQuestionId = candidate.question_id;
    state.attemptedResearchCalls += 1;
    const usedVerifiedIdentityContext = Boolean(
      candidate.identity_context_needed &&
      verifiedHypothesis?.verification_would_help &&
      verifiedHypothesis.relevant_question_ids.includes(candidate.question_id),
    );
    const identityContext = usedVerifiedIdentityContext
      ? [
          "VERIFIED IDENTITY CONTEXT (search context only):",
          JSON.stringify({
            canonical_identity: identityVerification.result?.canonical_identity,
            identity_type: identityVerification.result?.identity_type,
            location: identityVerification.result?.location,
            verification_basis: identityVerification.result?.verification_basis,
          }),
        ]
      : candidate.identity_context_needed
        ? [
            `IDENTITY VERIFICATION STATUS: ${identityVerification.metrics.status}.`,
            "No verified identity context is available. Do not treat a hypothesis or similar object as the uploaded subject.",
          ]
        : ["IDENTITY CONTEXT: not needed for this question."];

    const started = Date.now();
    const response = await openai.responses.create({
      model: DISCOVERY_STAGE2_MODEL,
      reasoning: { effort: DISCOVERY_REASONING_EFFORT },
      tools: [{ type: "web_search", search_context_size: "medium" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
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
    });
    const usage = normalizeResponseUsage(response, Date.now() - started);
    const metrics = stageMetrics(usage);
    state.knownStage2Metrics.push(metrics);
    const sources = extractValidatedSources(response);
    const cleaned = cleanResearchFinding(response.output_text);
    const status =
      cleaned.declaredInsufficient || sources.length === 0
        ? "insufficient"
        : "answered";
    const result: DiscoveryResearchResult = {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      question: candidate.investigation_question,
      status,
      finding: cleaned.finding,
      sources,
    };
    rawResults.push(result);
    const call = {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      status,
      used_verified_identity_context: usedVerifiedIdentityContext,
      ...metrics,
    } satisfies DiscoveryResearchCallMetrics;
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
    candidateResearchApiCalls: calls.length,
    candidateCallsUsingVerifiedIdentity: calls.filter(
      (call) => call.used_verified_identity_context,
    ).length,
    batchMetrics: null,
    batchInspection: null,
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
  const gatedQuestionIds = new Set(
    gatedCandidates.map((candidate) => candidate.question_id),
  );
  const identityVerification = await runIdentityVerification(
    openai,
    stage1,
    gatedQuestionIds,
    state,
  );
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
  const metrics = stageMetrics(usage);
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
    }
    throw error;
  }

  const answeredCandidates = validatedBatch.results.filter(
    (result) => result.status === "answered",
  ).length;
  const insufficientCandidates =
    validatedBatch.results.length - answeredCandidates;
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
): Promise<{
  results: DiscoveryResearchResult[];
  calls: DiscoveryResearchCallMetrics[];
  identityVerification: DiscoveryIdentityVerificationExecution;
}> {
  const state = createExecutionState();
  try {
    const { results, calls, identityVerification } =
      await runSelectiveResearchWithState(openai, stage1, state);
    return { results, calls, identityVerification };
  } catch (error) {
    throw new DiscoveryPipelineError(error, state);
  }
}

async function runDiscoveryPipelineWithState(
  openai: OpenAI,
  imageDataUrl: string,
  pipelineStarted: number,
  timestamp: string,
  state: DiscoveryExecutionState,
  variant: DiscoveryEngineVariant,
): Promise<DiscoveryPipelineResult> {
  state.stageReached = "stage1";
  const stage1Started = Date.now();
  const stage1Response = await openai.chat.completions.create({
    model: DISCOVERY_STAGE1_MODEL,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
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
      { role: "system", content: STAGE1_PROMPT },
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
  );
  const stage1Metrics = stageMetrics(stage1Usage);
  state.stage1 = stage1Metrics;
  const stage1Text = stage1Response.choices[0]?.message.content;
  if (!stage1Text)
    throw new Error("Discovery Stage 1 returned an empty response");
  const stage1 = DiscoveryStage1Schema.parse(JSON.parse(stage1Text));
  state.lastCompletedStage = "stage1";

  const research =
    variant === "v1-batched-research"
      ? await runBatchedSelectiveResearchWithState(openai, stage1, state)
      : await runSelectiveResearchWithState(openai, stage1, state);
  const stage2Usages = research.batchMetrics
    ? [research.batchMetrics.usage]
    : research.calls.map((call) => call.usage);
  if (research.identityVerification.metrics.usage) {
    stage2Usages.unshift(research.identityVerification.metrics.usage);
  }
  const stage2Usage = aggregateUsage(DISCOVERY_STAGE2_MODEL, stage2Usages);
  const stage2Costs = research.batchMetrics
    ? [research.batchMetrics.cost_usd]
    : research.calls.map((call) => call.cost_usd);
  if (research.identityVerification.metrics.ran) {
    stage2Costs.unshift(research.identityVerification.metrics.cost_usd);
  }
  const stage2Cost = sumNullable(stage2Costs);

  state.stageReached = "stage3";
  const stage3Started = Date.now();
  const stage3IdentityContext =
    research.identityVerification.result?.status === "verified"
      ? research.identityVerification.result
      : research.identityVerification.result
        ? { status: research.identityVerification.result.status }
        : null;
  const stage3Grounding = {
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
  const stage3Response = await openai.chat.completions.create({
    model: DISCOVERY_STAGE3_MODEL,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
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
      { role: "system", content: STAGE3_PROMPT },
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
          JSON.stringify(research.results),
          "",
          "IDENTITY VERIFICATION RESULT:",
          JSON.stringify(stage3IdentityContext),
        ].join("\n"),
      },
    ],
  });
  const stage3Usage = normalizeChatUsage(
    stage3Response,
    Date.now() - stage3Started,
  );
  const stage3Metrics = stageMetrics(stage3Usage);
  state.stage3 = stage3Metrics;
  const stage3Text = stage3Response.choices[0]?.message.content;
  if (!stage3Text)
    throw new Error("Discovery Stage 3 returned an empty response");
  const parsedStage3 = JSON.parse(stage3Text);
  state.lastCompletedStage = "stage3";
  state.stageReached = "validation";
  const validated = validateDiscoveryOutput(
    stage1,
    research.results,
    parsedStage3,
    research.identityVerification.result,
  );

  const totalCost = sumNullable([
    stage1Metrics.cost_usd,
    stage2Cost,
    stage3Metrics.cost_usd,
  ]);
  const engineVersion = discoveryEngineVersionForVariant(variant);
  const costPerFinalDiscovery =
    totalCost !== null && validated.discoveries.length > 0
      ? totalCost / validated.discoveries.length
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
        model: DISCOVERY_STAGE2_MODEL,
        reasoning_effort: DISCOVERY_REASONING_EFFORT,
        questions_sent: research.gatedCandidates,
        latency_ms: stage2Usage.latency_ms,
        usage: stage2Usage,
        cost_usd: stage2Cost,
        identity_verification: research.identityVerification.metrics,
        candidate_calls_using_verified_identity:
          research.candidateCallsUsingVerifiedIdentity,
        candidate_research_api_calls: research.candidateResearchApiCalls,
        answered_candidates: answeredCandidates,
        insufficient_candidates: insufficientCandidates,
        calls: research.calls,
        batch: research.batchMetrics,
      },
      stage3: {
        ...stage3Metrics,
        discoveries_returned: validated.discoveries.length,
      },
      total_latency_ms: Date.now() - pipelineStarted,
      total_cost_usd: totalCost,
      cost_per_successful_analysis_usd: totalCost,
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
  options: { variant?: DiscoveryEngineVariant } = {},
): Promise<DiscoveryPipelineResult> {
  const pipelineStarted = Date.now();
  const timestamp = new Date().toISOString();
  const variant = options.variant ?? DEFAULT_DISCOVERY_ENGINE_VARIANT;
  const engineVersion = discoveryEngineVersionForVariant(variant);
  const state = createExecutionState(pipelineStarted, engineVersion);

  try {
    return await runDiscoveryPipelineWithState(
      openai,
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

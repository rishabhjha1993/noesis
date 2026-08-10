import { customFetch } from "./custom-fetch";

export type DiscoveryEngineVariant = "v1" | "v1-batched-research";

export interface DiscoveryRegion {
  id: string;
  description: string;
  scope: "local" | "global";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiscoveryCandidate {
  id: string;
  question_id: string;
  visual_trigger: string;
  observation: string;
  region_ids: string[];
  investigation_question: string;
  research_needed: boolean;
  research_rationale: string;
  identity_context_needed: boolean;
}

export interface DiscoveryIdentityHypothesis {
  id: string;
  proposed_identity: string;
  identity_type:
    | "place"
    | "building"
    | "object"
    | "figure"
    | "map"
    | "artwork"
    | "diagram"
    | "other";
  visible_evidence: string[];
  observed_labels_or_numbers: string[];
  region_ids: string[];
  confidence: number;
  verification_would_help: boolean;
  relevant_question_ids: string[];
}

export interface DiscoverySource {
  title: string;
  url: string;
}

export interface DiscoveryResearchResult {
  candidate_id: string;
  question_id: string;
  question: string;
  status: "answered" | "insufficient";
  finding: string;
  sources: DiscoverySource[];
}

export interface DiscoveryIdentityVerification {
  status: "verified" | "unverified" | "conflicted";
  hypothesis_id: string;
  canonical_identity: string | null;
  identity_type: DiscoveryIdentityHypothesis["identity_type"] | null;
  location: string | null;
  verification_basis: string;
  confidence: number;
  match_evidence: Array<{
    basis:
      | "shared_label_or_typography"
      | "generic_visual_similarity"
      | "measurement"
      | "geographic_configuration"
      | "architectural_configuration"
      | "source_explicit_identification"
      | "provenance";
    detail: string;
  }>;
  sources: DiscoverySource[];
}

export interface Discovery {
  id: string;
  type: "local" | "relational" | "global";
  title: string;
  visual_trigger: string;
  observation: string;
  discovery: string;
  why_it_matters: string;
  explanation: string;
  reinterpretation: string;
  region_ids: string[];
  provenance: "seen" | "calculated" | "derived" | "researched";
  confidence: number;
  sources: DiscoverySource[];
}

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

export interface DiscoveryBatchIdentityMapping {
  candidate_id: string;
  question_id: string;
  used_verified_identity_context: boolean;
  identity_hypothesis_id: string | null;
}

export interface DiscoveryBatchCandidateContext {
  candidate_id: string;
  question_id: string;
  investigation_question: string;
  visual_trigger: string;
  observation: string;
  observed_labels_or_numbers: string[];
  relevant_regions: Array<{
    id: string;
    description: string;
    scope: "local" | "global";
  }>;
  verified_identity: {
    canonical_identity: string | null;
    identity_type: string | null;
    location: string | null;
    verification_basis: string;
  } | null;
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

export interface DiscoveryBatchValidationIssue {
  candidate_id: string;
  question_id: string;
  validation_category:
    | "schema"
    | "question_mismatch"
    | "unknown_candidate"
    | "duplicate"
    | "source_validation"
    | "malformed_url"
    | "missing_required_field"
    | "unknown";
  safe_message: string;
}

export interface DiscoveryRunResult {
  version: string;
  regions: DiscoveryRegion[];
  discoveries: Discovery[];
  inspection: {
    stage1: {
      image_summary: string;
      regions: DiscoveryRegion[];
      candidates: DiscoveryCandidate[];
      identity_hypotheses: DiscoveryIdentityHypothesis[];
    };
    identity_verification: DiscoveryIdentityVerification | null;
    research_results: DiscoveryResearchResult[];
    discovery_candidates: Record<string, string[]>;
    research_batch?: {
      candidates: DiscoveryBatchCandidateContext[];
      identity_context_mappings: DiscoveryBatchIdentityMapping[];
      invalid_candidate_ids: string[];
      missing_candidate_ids: string[];
      validation_issues: DiscoveryBatchValidationIssue[];
    };
  };
  metrics: {
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
    stage3: DiscoveryStageMetrics & {
      discoveries_returned: number;
    };
    total_latency_ms: number;
    total_cost_usd: number | null;
    cost_per_successful_analysis_usd: number | null;
    cost_per_final_discovery_usd: number | null;
    stage1_candidates: number;
    research_gate_passed: number;
    final_discoveries: number;
  };
}

export type DiscoveryFailureStage =
  | "stage1"
  | "identity_verification"
  | "research"
  | "stage3"
  | "validation"
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

export interface DiscoveryFailureDiagnostic {
  engine_version: string;
  failed_stage: DiscoveryFailureStage;
  stage_reached: DiscoveryFailureStage;
  last_completed_stage:
    "none" | "stage1" | "identity_verification" | "research" | "stage3";
  category:
    | "api_error"
    | "timeout"
    | "schema_validation"
    | "malformed_model_output"
    | "source_validation"
    | "network_error"
    | "internal_error"
    | "unknown";
  message: string;
  elapsed_ms: number;
  candidate_id?: string;
  question_id?: string;
  research_failure_scope?:
    "batch_api" | "batch_schema" | "candidate_validation";
  research_validation_category?: DiscoveryBatchValidationIssue["validation_category"];
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
      completed_calls: Array<
        DiscoverySafeStageMetrics & {
          candidate_id: string;
          question_id: string;
          status: "answered" | "insufficient";
        }
      >;
      known_usage: DiscoverySafeUsageMetrics | null;
      known_cost_usd: number | null;
    };
    stage3: DiscoverySafeStageMetrics | null;
    known_total_tokens: number | null;
    known_total_cost_usd: number | null;
  };
}

export type DiscoveryJobStatus =
  | { status: "pending" }
  | { status: "done"; result: DiscoveryRunResult; cache_hit: boolean }
  | {
      status: "error";
      error?: string;
      diagnostic?: DiscoveryFailureDiagnostic;
    };

export async function startDiscovery(
  imageDataUrl: string,
  engineVariant: DiscoveryEngineVariant = "v1",
): Promise<string> {
  const result = await customFetch<{ discovery_id: string }>("/api/discovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image_data_url: imageDataUrl,
      engine_variant: engineVariant,
    }),
    responseType: "json",
  });
  return result.discovery_id;
}

export function getDiscoveryStatus(
  discoveryId: string,
): Promise<DiscoveryJobStatus> {
  return customFetch<DiscoveryJobStatus>(
    `/api/discovery/${encodeURIComponent(discoveryId)}`,
    { responseType: "json" },
  );
}

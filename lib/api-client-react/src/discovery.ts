import { customFetch } from "./custom-fetch";

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
      calls: DiscoveryResearchCallMetrics[];
    };
    stage3: DiscoveryStageMetrics & {
      discoveries_returned: number;
    };
    total_latency_ms: number;
    total_cost_usd: number | null;
    stage1_candidates: number;
    research_gate_passed: number;
    final_discoveries: number;
  };
}

export type DiscoveryJobStatus =
  | { status: "pending" }
  | { status: "done"; result: DiscoveryRunResult; cache_hit: boolean }
  | { status: "error"; error?: string };

export async function startDiscovery(imageDataUrl: string): Promise<string> {
  const result = await customFetch<{ discovery_id: string }>("/api/discovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data_url: imageDataUrl }),
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

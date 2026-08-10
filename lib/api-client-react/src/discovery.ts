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

interface UsageMetrics {
  model: string;
  reasoning_effort: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
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
    };
    research_results: DiscoveryResearchResult[];
    discovery_candidates: Record<string, string[]>;
  };
  metrics: {
    timestamp: string;
    engine_version: string;
    success: boolean;
    stage1: { usage: UsageMetrics; cost_usd: number | null };
    stage2: {
      model: string;
      reasoning_effort: string;
      questions_sent: number;
      latency_ms: number;
      usage: UsageMetrics;
      cost_usd: number | null;
    };
    stage3: {
      usage: UsageMetrics;
      cost_usd: number | null;
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

export async function startDiscoveryV0(imageDataUrl: string): Promise<string> {
  const result = await customFetch<{ discovery_id: string }>("/api/discovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_data_url: imageDataUrl }),
    responseType: "json",
  });
  return result.discovery_id;
}

export function getDiscoveryV0Status(
  discoveryId: string,
): Promise<DiscoveryJobStatus> {
  return customFetch<DiscoveryJobStatus>(
    `/api/discovery/${encodeURIComponent(discoveryId)}`,
    { responseType: "json" },
  );
}

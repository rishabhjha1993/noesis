import type { ChatCompletion } from "openai/resources/chat/completions";
import type { ComputedEvidence, VisualEvidence } from "./evidence";
import type { CostEstimate } from "./modelPricing";

export type FailureStage =
  | "pass1_model"
  | "pass1_parse"
  | "deterministic_compute"
  | "pass2_model"
  | "pass2_parse"
  | "cache_lookup"
  | "cache_write";

export interface ModelUsageMetrics {
  model: string;
  reasoning_effort: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  reasoning_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  raw_usage: ChatCompletion["usage"] | null;
}

export interface EvidenceMetrics {
  numeric_facts: number;
  categorical_facts: number;
  structural_observations: number;
  relationships: number;
  computed_candidates: number;
  final_walkthrough_regions: number;
  visual_evidence_bytes: number;
  computed_evidence_bytes: number;
}

export interface PipelineMetrics {
  timestamp: string;
  success: boolean;
  failure_stage: FailureStage | null;
  pass1: ModelUsageMetrics;
  pass1_parse_latency_ms: number | null;
  deterministic_compute_latency_ms: number | null;
  pass2: ModelUsageMetrics;
  pass2_parse_latency_ms: number | null;
  total_pipeline_latency_ms: number;
  image_dimensions: { width: number; height: number } | null;
  evidence: EvidenceMetrics;
  estimated_cost: CostEstimate;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function normalizeChatUsage(
  response: ChatCompletion,
  reasoningEffort: string,
  latencyMs: number,
): ModelUsageMetrics {
  const usage = response.usage;
  return {
    model: response.model,
    reasoning_effort: reasoningEffort,
    input_tokens: integer(usage?.prompt_tokens),
    cached_input_tokens: integer(usage?.prompt_tokens_details?.cached_tokens),
    output_tokens: integer(usage?.completion_tokens),
    reasoning_tokens: integer(usage?.completion_tokens_details?.reasoning_tokens),
    total_tokens: integer(usage?.total_tokens),
    latency_ms: latencyMs,
    raw_usage: usage ?? null,
  };
}

export function emptyModelUsage(model: string, effort: string): ModelUsageMetrics {
  return {
    model,
    reasoning_effort: effort,
    input_tokens: null,
    cached_input_tokens: null,
    output_tokens: null,
    reasoning_tokens: null,
    total_tokens: null,
    latency_ms: 0,
    raw_usage: null,
  };
}

export function evidenceMetrics(
  evidence: VisualEvidence | null,
  computed: ComputedEvidence[] | null,
  finalRegions: number,
): EvidenceMetrics {
  return {
    numeric_facts: evidence?.numeric_facts.length ?? 0,
    categorical_facts: evidence?.categorical_facts.length ?? 0,
    structural_observations: evidence?.structural_observations.length ?? 0,
    relationships: evidence?.relationships.length ?? 0,
    computed_candidates: computed?.length ?? 0,
    final_walkthrough_regions: finalRegions,
    visual_evidence_bytes: evidence ? Buffer.byteLength(JSON.stringify(evidence)) : 0,
    computed_evidence_bytes: computed ? Buffer.byteLength(JSON.stringify(computed)) : 0,
  };
}

/** Cheap header parsing only; unsupported/corrupt formats return null. */
export function imageDimensions(dataUrl: string): { width: number; height: number } | null {
  try {
    const comma = dataUrl.indexOf(",");
    const b = Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, "base64");
    if (b.length >= 24 && b.subarray(1, 4).toString("ascii") === "PNG") {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b.length >= 10 && (b.subarray(0, 6).toString("ascii") === "GIF87a" || b.subarray(0, 6).toString("ascii") === "GIF89a")) {
      return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) };
    }
    if (b.length >= 30 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP") {
      const kind = b.subarray(12, 16).toString("ascii");
      if (kind === "VP8X") return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    }
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
      let p = 2;
      while (p + 8 < b.length) {
        if (b[p] !== 0xff) { p++; continue; }
        const marker = b[p + 1]!;
        const len = b.readUInt16BE(p + 2);
        if (marker >= 0xc0 && marker <= 0xc3) return { width: b.readUInt16BE(p + 7), height: b.readUInt16BE(p + 5) };
        if (len < 2) break;
        p += 2 + len;
      }
    }
  } catch { /* metrics must never break analysis */ }
  return null;
}

import {
  DiscoveryStage1Schema,
  type DiscoveryStage1,
} from "../artifacts/api-server/src/lib/discoveryContracts";
import {
  normalizeChatUsage,
  stageMetrics,
} from "../artifacts/api-server/src/lib/discoveryPipeline";
import {
  V2_HYBRID_ENGINE_VERSION,
  V2_HYBRID_REASONING_EFFORT,
  V2_HYBRID_STAGE1_MODEL,
  buildV2HybridStage1Request,
} from "../artifacts/api-server/src/lib/discoveryHybridV2";
import type { DiscoveryResearchReplayImage } from "./discoveryResearchReplay";

export const DISCOVERY_STAGE1_REPLAY_VERSION =
  "noesis-discovery-stage1-replay-v1";
export const DISCOVERY_STAGE1_REPLAY_IMAGE_DETAIL = "high" as const;

// Derive the OpenAI request/response types from production helpers so the eval
// modules never import the OpenAI SDK types directly.
export type DiscoveryReplayChatRequest = ReturnType<
  typeof buildV2HybridStage1Request
>;
export type DiscoveryReplayChatResponse = Parameters<
  typeof normalizeChatUsage
>[0];

/** Minimal structural client so the harness is unit-testable with mocks. */
export interface DiscoveryReplayChatClient {
  chat: {
    completions: {
      create(
        request: DiscoveryReplayChatRequest,
      ): Promise<DiscoveryReplayChatResponse>;
    };
  };
}

export interface DiscoveryStage1ReplayPlan {
  version: typeof DISCOVERY_STAGE1_REPLAY_VERSION;
  replay: "stage1-only";
  engineVersion: typeof V2_HYBRID_ENGINE_VERSION;
  model: typeof V2_HYBRID_STAGE1_MODEL;
  reasoningEffort: typeof V2_HYBRID_REASONING_EFFORT;
  imageDetail: typeof DISCOVERY_STAGE1_REPLAY_IMAGE_DETAIL;
  imageSha256: string;
  imageByteLength: number;
  outputPath: string | null;
}

export function createDiscoveryStage1ReplayPlan(
  image: DiscoveryResearchReplayImage,
  outputPath?: string | null,
): DiscoveryStage1ReplayPlan {
  return {
    version: DISCOVERY_STAGE1_REPLAY_VERSION,
    replay: "stage1-only",
    engineVersion: V2_HYBRID_ENGINE_VERSION,
    model: V2_HYBRID_STAGE1_MODEL,
    reasoningEffort: V2_HYBRID_REASONING_EFFORT,
    imageDetail: DISCOVERY_STAGE1_REPLAY_IMAGE_DETAIL,
    imageSha256: image.sha256,
    imageByteLength: image.byteLength,
    outputPath: outputPath ?? null,
  };
}

export function createDiscoveryStage1ReplayDryRun(
  plan: DiscoveryStage1ReplayPlan,
): {
  version: typeof DISCOVERY_STAGE1_REPLAY_VERSION;
  mode: "dry-run";
  plan: DiscoveryStage1ReplayPlan;
  note: string;
} {
  return {
    version: DISCOVERY_STAGE1_REPLAY_VERSION,
    mode: "dry-run",
    plan,
    note: "No model call performed. Re-run with --execute to call Stage 1.",
  };
}

export interface DiscoveryStage1ReplayResult {
  version: typeof DISCOVERY_STAGE1_REPLAY_VERSION;
  replay: "stage1-only";
  engine_version: typeof V2_HYBRID_ENGINE_VERSION;
  image_sha256: string;
  image_byte_length: number;
  stage1: DiscoveryStage1;
  metrics: DiscoveryReplayStageMetrics;
}

export interface DiscoveryReplayStageMetrics {
  model: string;
  reasoning_effort: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  latency_ms: number;
  web_search_calls: number;
  model_token_cost_usd: number | null;
  tool_cost_usd: number | null;
  total_known_cost_usd: number | null;
}

/**
 * Runs ONLY the production V2 Stage-1 request against a supplied image, then applies the
 * strict Stage-1 schema exactly as production. It never calls research or Final Sol.
 */
export async function executeDiscoveryStage1Replay(
  openai: DiscoveryReplayChatClient,
  plan: DiscoveryStage1ReplayPlan,
  image: DiscoveryResearchReplayImage,
): Promise<DiscoveryStage1ReplayResult> {
  const request = buildV2HybridStage1Request(image.dataUrl);
  const started = Date.now();
  const response = await openai.chat.completions.create(request);
  const usage = normalizeChatUsage(response, Date.now() - started, "openai");
  const metrics = stageMetrics(usage);
  const text = response.choices[0]?.message.content;
  if (!text) throw new Error("Stage-1 replay returned an empty response");
  const stage1 = DiscoveryStage1Schema.parse(JSON.parse(text));
  return {
    version: DISCOVERY_STAGE1_REPLAY_VERSION,
    replay: "stage1-only",
    engine_version: plan.engineVersion,
    image_sha256: image.sha256,
    image_byte_length: image.byteLength,
    stage1,
    metrics: {
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
    },
  };
}

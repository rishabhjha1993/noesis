import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import {
  DISCOVERY_STAGE3_JSON_SCHEMA,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "./discoveryContracts";
import {
  FROZEN_V1_REASONING_EFFORT,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE3_MODEL,
  buildFrozenV1Stage3Context,
  frozenV1ApplicableCandidateIds,
} from "./discoveryFrozenV1";
import type { DeepSeekRequestOptions } from "./discoveryDeepSeekV1";

export const V2_HYBRID_VARIANT = "v2-hybrid";
export const V2_HYBRID_ENGINE_VERSION = "discovery-engine-v2-hybrid";
export const V2_HYBRID_CACHE_REVISION = "v2-hybrid-v2";
export const V2_HYBRID_STAGE1_MODEL = FROZEN_V1_STAGE1_MODEL;
export const V2_HYBRID_STAGE3_MODEL = FROZEN_V1_STAGE3_MODEL;
export const V2_HYBRID_REASONING_EFFORT = FROZEN_V1_REASONING_EFFORT;
export const V2_HYBRID_RESEARCH_MAX_CONCURRENCY = 3;
export const V2_HYBRID_IDENTITY_TIMEOUT_MS = 55_000;

export function createV2HybridIdentityRequestOptions(
  timeoutMs = V2_HYBRID_IDENTITY_TIMEOUT_MS,
): DeepSeekRequestOptions {
  return {
    timeout: timeoutMs,
    maxRetries: 0,
    signal: AbortSignal.timeout(timeoutMs),
  };
}

export const V2_HYBRID_FINAL_PROMPT = `You are the final Discovery stage of Noesis V2 Hybrid: DISCOVER → RETURN TO IMAGE.

You receive the original image again at high detail, validated Stage-1 visual grounding, approved candidates, safe candidate-local research results, and optional verified identity evidence. Look at the image itself while deciding what the evidence means for this specific visual.

Act as an aggressive editor and ranker. Select only discoveries that genuinely change how a user understands this image. Fewer excellent discoveries are better than padded output; zero is valid. Do not summarize all research.

For every discovery:
- begin from concrete visible evidence in the image;
- use only declared candidate_ids and region_ids;
- reject generic facts that cannot be visibly reconnected to this image;
- never present unverified or conflicted identity as fact;
- use researched provenance only when an answered candidate result or applicable verified identity materially contributes;
- copy sources only from the applicable validated research or identity evidence;
- otherwise use non-researched provenance with an empty sources array;
- make reinterpretation tell the viewer what to notice or understand differently when looking back at the image.

Research may deepen the image. Research may never leave the image behind. Do not expose chain-of-thought. Return only the strict JSON object.`;

export function buildV2HybridFinalRequest(
  imageDataUrl: string,
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  identityVerification: DiscoveryIdentityVerification | null,
): ChatCompletionCreateParamsNonStreaming {
  const frozen = buildFrozenV1Stage3Context(
    stage1,
    researchResults,
    identityVerification,
  );
  const identityContext =
    identityVerification?.status === "verified"
      ? {
          ...identityVerification,
          applicable_candidate_ids: frozenV1ApplicableCandidateIds(
            stage1,
            identityVerification,
          ),
        }
      : frozen.identityContext;

  return {
    model: V2_HYBRID_STAGE3_MODEL,
    reasoning_effort: V2_HYBRID_REASONING_EFFORT,
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
      { role: "system", content: V2_HYBRID_FINAL_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "VALIDATED STAGE 1 GROUNDING:",
              JSON.stringify(frozen.grounding),
              "",
              "SAFE CANDIDATE RESEARCH RESULTS:",
              JSON.stringify(frozen.researchResults),
              "",
              "IDENTITY VERIFICATION RESULT:",
              JSON.stringify(identityContext),
              "",
              "Return only discoveries that materially change how this original image is understood.",
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  };
}

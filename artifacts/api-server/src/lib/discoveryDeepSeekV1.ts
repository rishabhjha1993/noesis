import OpenAI from "openai";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import {
  DISCOVERY_STAGE3_JSON_SCHEMA,
  type DiscoveryCandidate,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "./discoveryContracts";
import {
  FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
  FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA,
  FROZEN_V1_REASONING_EFFORT,
  FROZEN_V1_STAGE3_PROMPT,
  buildFrozenV1IdentityInput,
  buildFrozenV1ResearchRequest,
  buildFrozenV1Stage3Context,
} from "./discoveryFrozenV1";

// Official DeepSeek API docs verified 2026-08-15:
// https://api-docs.deepseek.com/guides/responses_api
// https://api-docs.deepseek.com/guides/thinking_mode
// The Responses API supports V4 Pro, JSON-schema text formatting, and hosted
// web_search. DeepSeek maps medium reasoning to high and ignores
// search_context_size/include; those provider transport differences are kept
// isolated here while the frozen model-visible instructions and inputs remain
// unchanged.
export const DEEPSEEK_V1_VARIANT = "v1-deepseek-pro";
export const DEEPSEEK_V1_ENGINE_VERSION = "discovery-engine-v1-deepseek-pro";
export const DEEPSEEK_V1_CACHE_REVISION = "v1-deepseek-pro-v1";
export const DEEPSEEK_V1_MODEL = "deepseek-v4-pro";
export const DEEPSEEK_API_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_V1_REASONING_EFFORT = FROZEN_V1_REASONING_EFFORT;
export const DEEPSEEK_V1_EFFECTIVE_REASONING_EFFORT = "high";

export type DeepSeekClient = Pick<OpenAI, "responses">;

export type DeepSeekFailureCategory =
  | "authentication"
  | "provider_http"
  | "rate_limit"
  | "timeout"
  | "structured_output"
  | "tool_call"
  | "search_provider";

export class DeepSeekDiscoveryError extends Error {
  readonly category: DeepSeekFailureCategory;

  constructor(
    category: DeepSeekFailureCategory,
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "DeepSeekDiscoveryError";
    this.category = category;
  }
}

export function createDeepSeekClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_API_BASE_URL });
}

export function buildDeepSeekV1IdentityRequest(
  stage1: DiscoveryStage1,
  gatedCandidates: DiscoveryCandidate[],
): ResponseCreateParamsNonStreaming | null {
  const frozenInput = buildFrozenV1IdentityInput(stage1, gatedCandidates);
  if (!frozenInput) return null;
  return {
    model: DEEPSEEK_V1_MODEL,
    reasoning: { effort: DEEPSEEK_V1_REASONING_EFFORT },
    tools: [{ type: "web_search", search_context_size: "medium" }],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    store: false,
    max_output_tokens: 3000,
    text: { format: FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA },
    instructions: FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS,
    input: frozenInput.input,
  };
}

export function buildDeepSeekV1ResearchRequest(
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  identityVerification: DiscoveryIdentityVerification | null,
) {
  const frozen = buildFrozenV1ResearchRequest(
    stage1,
    candidate,
    identityVerification,
  );
  return {
    ...frozen,
    request: {
      ...frozen.request,
      model: DEEPSEEK_V1_MODEL,
    },
  };
}

export function buildDeepSeekV1Stage3Request(
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  identityVerification: DiscoveryIdentityVerification | null,
): ResponseCreateParamsNonStreaming {
  const frozen = buildFrozenV1Stage3Context(
    stage1,
    researchResults,
    identityVerification,
  );
  return {
    model: DEEPSEEK_V1_MODEL,
    reasoning: { effort: DEEPSEEK_V1_REASONING_EFFORT },
    store: false,
    max_output_tokens: 10000,
    text: {
      format: {
        type: "json_schema",
        ...DISCOVERY_STAGE3_JSON_SCHEMA,
      },
    },
    instructions: FROZEN_V1_STAGE3_PROMPT,
    input: [
      "STAGE 1 GROUNDING:",
      JSON.stringify(frozen.grounding),
      "",
      "DETERMINISTIC CALCULATIONS:",
      "[]",
      "",
      "VALIDATED RESEARCH RESULTS:",
      JSON.stringify(frozen.researchResults),
      "",
      "IDENTITY VERIFICATION RESULT:",
      JSON.stringify(frozen.identityContext),
    ].join("\n"),
  };
}

function errorStatus(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  const status = (error as Error & { status?: unknown }).status;
  return typeof status === "number" && Number.isFinite(status) ? status : null;
}

function providerFailureCategory(error: unknown): DeepSeekFailureCategory {
  const status = errorStatus(error);
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (
    status === 408 ||
    status === 504 ||
    /timeout|timed out|aborterror|etimedout/.test(message)
  ) {
    return "timeout";
  }
  return "provider_http";
}

export async function createDeepSeekResponse(
  client: DeepSeekClient,
  request: ResponseCreateParamsNonStreaming,
  expectsWebSearch: boolean,
): Promise<Response> {
  let response: Response;
  try {
    response = await client.responses.create(request);
  } catch (error) {
    throw new DeepSeekDiscoveryError(
      providerFailureCategory(error),
      "DeepSeek request failed",
      error,
    );
  }

  if (expectsWebSearch) {
    const searches = response.output.filter(
      (item) => item.type === "web_search_call",
    );
    if (searches.length === 0) {
      throw new DeepSeekDiscoveryError(
        "tool_call",
        "DeepSeek did not execute the required web-search tool",
      );
    }
    if (searches.some((item) => item.status !== "completed")) {
      throw new DeepSeekDiscoveryError(
        "search_provider",
        "DeepSeek web search did not complete",
      );
    }
  }
  return response;
}

export function parseDeepSeekStructuredOutput(outputText: string): unknown {
  try {
    return JSON.parse(outputText);
  } catch (error) {
    throw new DeepSeekDiscoveryError(
      "structured_output",
      "DeepSeek returned malformed structured JSON",
      error,
    );
  }
}

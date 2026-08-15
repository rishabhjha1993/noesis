import OpenAI from "openai";
import { ZodError } from "zod";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";
import {
  DISCOVERY_STAGE3_JSON_SCHEMA,
  DiscoveryIdentityVerificationDraftSchema,
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

export const DEEPSEEK_IDENTITY_SEMANTIC_REPAIR_INSTRUCTIONS = `Your previous identity-verification response violated one output invariant.

Preserve the substantive verification conclusion exactly. Preserve status, hypothesis_id, verification_basis, confidence, and match_evidence exactly. Do not add, remove, or reinterpret evidence. If status is unverified or conflicted, canonical_identity, identity_type, and location must all be null. Do not change status to verified. Return only the corrected strict JSON object.`;

export type DeepSeekClient = Pick<OpenAI, "responses">;

export interface DeepSeekRequestOptions {
  timeout?: number;
  maxRetries?: number;
  signal?: AbortSignal | null;
}

type DeepSeekIdentityDraft = Omit<DiscoveryIdentityVerification, "sources">;

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
  readonly response?: Response;

  constructor(
    category: DeepSeekFailureCategory,
    message: string,
    cause?: unknown,
    response?: Response,
  ) {
    super(message, { cause });
    this.name = "DeepSeekDiscoveryError";
    this.category = category;
    this.response = response;
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

export function recoverableDeepSeekIdentityContradiction(
  validationError: unknown,
  input: unknown,
): DeepSeekIdentityDraft | null {
  if (
    !(validationError instanceof ZodError) ||
    validationError.issues.length !== 1 ||
    validationError.issues[0]?.code !== "custom" ||
    validationError.issues[0]?.message !==
      "Unverified or conflicted identity cannot expose a canonical identity"
  ) {
    return null;
  }
  const parsed = DiscoveryIdentityVerificationDraftSchema.safeParse(input);
  if (!parsed.success || parsed.data.status === "verified") return null;
  return parsed.data.canonical_identity !== null ||
    parsed.data.identity_type !== null ||
    parsed.data.location !== null
    ? parsed.data
    : null;
}

export function buildDeepSeekIdentitySemanticRepairRequest(
  draft: DeepSeekIdentityDraft,
): ResponseCreateParamsNonStreaming {
  // The frozen flat schema cannot express its status-dependent null invariant
  // without conditional/combinator semantics. Keep that contract immutable and
  // constrain only this provider-specific repair response instead.
  const frozenSchema = FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA.schema;
  return {
    model: DEEPSEEK_V1_MODEL,
    reasoning: { effort: DEEPSEEK_V1_REASONING_EFFORT },
    store: false,
    max_output_tokens: 3000,
    text: {
      format: {
        type: "json_schema",
        name: "noesis_discovery_identity_semantic_repair",
        strict: true,
        schema: {
          ...frozenSchema,
          properties: {
            ...frozenSchema.properties,
            status: { type: "string", enum: [draft.status] },
            canonical_identity: { type: "null" },
            identity_type: { type: "null" },
            location: { type: "null" },
          },
        },
      },
    },
    instructions: DEEPSEEK_IDENTITY_SEMANTIC_REPAIR_INSTRUCTIONS,
    input: ["PREVIOUS STRUCTURED RESULT:", JSON.stringify(draft)].join("\n"),
  };
}

export function preservesDeepSeekIdentityRepairConclusion(
  original: DeepSeekIdentityDraft,
  repairedInput: unknown,
): repairedInput is DeepSeekIdentityDraft {
  const repaired =
    DiscoveryIdentityVerificationDraftSchema.safeParse(repairedInput);
  if (!repaired.success) return false;
  const expected: DeepSeekIdentityDraft = {
    ...original,
    canonical_identity: null,
    identity_type: null,
    location: null,
  };
  return JSON.stringify(repaired.data) === JSON.stringify(expected);
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
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  const code =
    error instanceof Error &&
    typeof (error as Error & { code?: unknown }).code === "string"
      ? (error as Error & { code: string }).code
      : "";
  const searchable = `${name} ${message} ${code}`.toLowerCase();
  if (status === 401 || status === 403) return "authentication";
  if (status === 429) return "rate_limit";
  if (
    status === 408 ||
    status === 504 ||
    /timeout|timed out|abort|aborted|etimedout/.test(searchable)
  ) {
    return "timeout";
  }
  return "provider_http";
}

export async function createDeepSeekResponse(
  client: DeepSeekClient,
  request: ResponseCreateParamsNonStreaming,
  expectsWebSearch: boolean,
  options?: DeepSeekRequestOptions,
): Promise<Response> {
  let response: Response;
  try {
    response = await client.responses.create(request, options);
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
        undefined,
        response,
      );
    }
    if (searches.some((item) => item.status !== "completed")) {
      throw new DeepSeekDiscoveryError(
        "search_provider",
        "DeepSeek web search did not complete",
        undefined,
        response,
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

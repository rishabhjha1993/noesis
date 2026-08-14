import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  DiscoveryIdentityVerificationSchema,
  DiscoveryStage1Schema,
  evaluateResearchGate,
  identityApplicableCandidateIds,
  validateDiscoveryOutput,
  validateResearchResults,
  type DiscoveryCandidate,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_CANDIDATE_RESEARCH_MODELS,
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_LUNA_RESEARCH_MODEL,
  DISCOVERY_REASONING_EFFORT,
  buildDiscoveryCandidateResearchRequest,
  runDiscoveryCandidateResearchCall,
  type DiscoveryCandidateResearchModel,
  type DiscoveryResearchCallMetrics,
} from "../artifacts/api-server/src/lib/discoveryPipeline";
import {
  FROZEN_V1_ENGINE_VERSION,
  buildFrozenV1ResearchRequest,
  frozenV1ApplicableCandidateIds,
} from "../artifacts/api-server/src/lib/discoveryFrozenV1";

export const DISCOVERY_RESEARCH_REPLAY_VERSION =
  "noesis-discovery-research-replay-v1";
export const DISCOVERY_RESEARCH_IMAGE_ACCESS_EXPERIMENT_VERSION =
  "noesis-discovery-research-image-access-v1";
export const DISCOVERY_RESEARCH_IMAGE_DETAIL = "high" as const;
export const DISCOVERY_RESEARCH_IMAGE_ACCESS_MODES = [
  "text-only",
  "original-image",
] as const;
export type DiscoveryResearchImageAccessMode =
  (typeof DISCOVERY_RESEARCH_IMAGE_ACCESS_MODES)[number];

interface RetainedResultShape {
  version?: unknown;
  regions?: unknown;
  discoveries?: unknown;
  inspection?: unknown;
  metrics?: unknown;
}

interface RetainedEnvelopeShape {
  status?: unknown;
  discovery_id?: unknown;
  result?: unknown;
}

export interface RetainedDiscoveryReplayInput {
  sourceDiscoveryId: string;
  sourceEngineVersion: string;
  stage1: DiscoveryStage1;
  identityVerification: DiscoveryIdentityVerification;
  retainedResearchResults: DiscoveryResearchResult[];
  retainedCandidateCosts: Map<string, number | null>;
}

export interface DiscoveryResearchReplayPlanCandidate {
  candidate: DiscoveryCandidate;
  usedVerifiedIdentityContext: boolean;
  retainedStatus: "answered" | "insufficient";
  retainedTotalKnownCostUsd: number | null;
}

export interface DiscoveryResearchReplayPlan {
  input: RetainedDiscoveryReplayInput;
  model: DiscoveryCandidateResearchModel;
  candidates: DiscoveryResearchReplayPlanCandidate[];
  outputPath: string | null;
}

export interface DiscoveryResearchImageAccessExperimentPlan extends DiscoveryResearchReplayPlan {
  model: typeof DISCOVERY_LUNA_RESEARCH_MODEL;
  imageAccess: DiscoveryResearchImageAccessMode;
  repeat: number;
  imagePath: string | null;
}

export interface DiscoveryResearchReplayImage {
  dataUrl: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  sha256: string;
  byteLength: number;
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, message: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(message);
  }
  return value;
}

function candidateCosts(metrics: unknown): Map<string, number | null> {
  const result = new Map<string, number | null>();
  const metricsRecord = record(metrics, "Retained result metrics are missing");
  const stage2 = record(
    metricsRecord.stage2,
    "Retained result Stage 2 metrics are missing",
  );
  if (!Array.isArray(stage2.calls)) return result;
  for (const item of stage2.calls) {
    const call = record(item, "Retained candidate-call metrics are malformed");
    const candidateId = nonEmptyString(
      call.candidate_id,
      "Retained candidate-call metrics lack a candidate id",
    );
    const cost = call.total_known_cost_usd;
    if (cost !== null && typeof cost !== "number") {
      throw new Error("Retained candidate-call cost is malformed");
    }
    result.set(candidateId, cost as number | null);
  }
  return result;
}

export function parseRetainedDiscoveryReplayInput(
  value: unknown,
  suppliedDiscoveryId?: string,
): RetainedDiscoveryReplayInput {
  const envelope = record(value, "Retained replay input must be a JSON object");
  const envelopeShape = envelope as RetainedEnvelopeShape;
  if ("status" in envelope && envelopeShape.status !== "done") {
    throw new Error("Retained replay input is not a successful completed job");
  }
  const rawResult = envelopeShape.result ?? envelope;
  const result = record(
    rawResult,
    "Retained replay input does not contain a result",
  ) as RetainedResultShape;
  if (
    result.version !== DISCOVERY_ENGINE_VERSION &&
    result.version !== FROZEN_V1_ENGINE_VERSION
  ) {
    throw new Error(
      `Retained replay input must use ${DISCOVERY_ENGINE_VERSION} or ${FROZEN_V1_ENGINE_VERSION}`,
    );
  }
  const metrics = record(result.metrics, "Retained result metrics are missing");
  if (metrics.success !== true) {
    throw new Error("Retained replay input is not a successful Discovery run");
  }
  const inspection = record(
    result.inspection,
    "Retained result inspection is missing",
  );
  if (!("stage1" in inspection)) {
    throw new Error("Retained replay input does not contain Stage 1");
  }
  const stage1 = DiscoveryStage1Schema.parse(inspection.stage1);
  if (JSON.stringify(result.regions) !== JSON.stringify(stage1.regions)) {
    throw new Error("Retained result regions do not match retained Stage 1");
  }
  const identityVerification = DiscoveryIdentityVerificationSchema.parse(
    inspection.identity_verification,
  );
  if (identityVerification.status !== "verified") {
    throw new Error(
      "Research replay requires retained verified identity context",
    );
  }
  const retainedResearchResults = validateResearchResults(
    stage1,
    inspection.research_results,
  );

  if (Array.isArray(result.discoveries)) {
    const discoveryCandidates = record(
      inspection.discovery_candidates,
      "Retained discovery-to-candidate mappings are missing",
    );
    const drafts = result.discoveries.map((item) => {
      const discovery = record(item, "Retained discovery is malformed");
      const existingCandidateIds = discovery.candidate_ids;
      return {
        ...discovery,
        candidate_ids:
          existingCandidateIds ?? discoveryCandidates[String(discovery.id)],
      };
    });
    validateDiscoveryOutput(
      stage1,
      retainedResearchResults,
      { discoveries: drafts },
      identityVerification,
    );
  }

  const embeddedDiscoveryId =
    envelopeShape.discovery_id ??
    (rawResult as Record<string, unknown>).discovery_id;
  const sourceDiscoveryId = nonEmptyString(
    suppliedDiscoveryId ?? embeddedDiscoveryId,
    "Retained input does not embed a discovery id; pass --source-discovery-id",
  );
  return {
    sourceDiscoveryId,
    sourceEngineVersion: result.version,
    stage1,
    identityVerification,
    retainedResearchResults,
    retainedCandidateCosts: candidateCosts(result.metrics),
  };
}

export async function loadRetainedDiscoveryReplayInput(
  inputPath: string,
  suppliedDiscoveryId?: string,
): Promise<RetainedDiscoveryReplayInput> {
  return parseRetainedDiscoveryReplayInput(
    JSON.parse(await readFile(inputPath, "utf8")),
    suppliedDiscoveryId,
  );
}

export function isDiscoveryCandidateResearchModel(
  value: string,
): value is DiscoveryCandidateResearchModel {
  return DISCOVERY_CANDIDATE_RESEARCH_MODELS.some((model) => model === value);
}

export function createDiscoveryResearchReplayPlan(
  input: RetainedDiscoveryReplayInput,
  model: DiscoveryCandidateResearchModel,
  outputPath?: string,
): DiscoveryResearchReplayPlan {
  const applicable = new Set(replayIdentityApplicableCandidateIds(input));
  const retainedByCandidate = new Map(
    input.retainedResearchResults.map((result) => [
      result.candidate_id,
      result,
    ]),
  );
  const candidates = input.stage1.candidates
    .filter(
      (candidate) => evaluateResearchGate(input.stage1, candidate).allowed,
    )
    .map((candidate) => {
      const retained = retainedByCandidate.get(candidate.id);
      if (!retained) {
        throw new Error(
          `Retained input lacks research result for candidate ${candidate.id}`,
        );
      }
      return {
        candidate,
        usedVerifiedIdentityContext: applicable.has(candidate.id),
        retainedStatus: retained.status,
        retainedTotalKnownCostUsd:
          input.retainedCandidateCosts.get(candidate.id) ?? null,
      };
    });
  return { input, model, candidates, outputPath: outputPath ?? null };
}

function replayIdentityApplicableCandidateIds(
  input: RetainedDiscoveryReplayInput,
): string[] {
  return input.sourceEngineVersion === FROZEN_V1_ENGINE_VERSION
    ? frozenV1ApplicableCandidateIds(input.stage1, input.identityVerification)
    : identityApplicableCandidateIds(input.stage1, input.identityVerification);
}

export function isDiscoveryResearchImageAccessMode(
  value: string,
): value is DiscoveryResearchImageAccessMode {
  return DISCOVERY_RESEARCH_IMAGE_ACCESS_MODES.some((mode) => mode === value);
}

export function createDiscoveryResearchImageAccessExperimentPlan(
  input: RetainedDiscoveryReplayInput,
  options: {
    imageAccess: DiscoveryResearchImageAccessMode;
    repeat: number;
    imagePath?: string;
    outputPath?: string;
  },
): DiscoveryResearchImageAccessExperimentPlan {
  if (!Number.isSafeInteger(options.repeat) || options.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  if (options.imageAccess === "original-image" && !options.imagePath) {
    throw new Error("--image is required with --image-access original-image");
  }
  if (options.imageAccess === "text-only" && options.imagePath) {
    throw new Error("--image is not accepted with --image-access text-only");
  }
  return {
    ...createDiscoveryResearchReplayPlan(
      input,
      DISCOVERY_LUNA_RESEARCH_MODEL,
      options.outputPath,
    ),
    model: DISCOVERY_LUNA_RESEARCH_MODEL,
    imageAccess: options.imageAccess,
    repeat: options.repeat,
    imagePath: options.imagePath ?? null,
  };
}

function imageMimeType(
  bytes: Buffer,
): DiscoveryResearchReplayImage["mimeType"] {
  if (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (
    bytes.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif";
  }
  throw new Error("--image must be a PNG, JPEG, WEBP, or non-animated GIF");
}

export async function loadDiscoveryResearchReplayImage(
  imagePath: string,
): Promise<DiscoveryResearchReplayImage> {
  const bytes = await readFile(imagePath);
  if (bytes.length === 0) throw new Error("--image is empty");
  const mimeType = imageMimeType(bytes);
  return {
    dataUrl: `data:${mimeType};base64,${bytes.toString("base64")}`,
    mimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
  };
}

type CandidateResearchRequest = ReturnType<
  typeof buildDiscoveryCandidateResearchRequest
>["request"];
type ImageCandidateResearchRequest = Omit<CandidateResearchRequest, "input"> & {
  input: Array<{
    role: "user";
    content: Array<
      | { type: "input_text"; text: string }
      | {
          type: "input_image";
          image_url: string;
          detail: typeof DISCOVERY_RESEARCH_IMAGE_DETAIL;
        }
    >;
  }>;
};

function buildDiscoveryResearchReplayCandidateRequest(
  input: RetainedDiscoveryReplayInput,
  candidate: DiscoveryCandidate,
  model: DiscoveryCandidateResearchModel,
) {
  const current = buildDiscoveryCandidateResearchRequest(
    input.stage1,
    candidate,
    input.identityVerification,
    model,
  );
  if (input.sourceEngineVersion !== FROZEN_V1_ENGINE_VERSION) return current;

  const frozen = buildFrozenV1ResearchRequest(
    input.stage1,
    candidate,
    input.identityVerification,
  );
  return {
    usedVerifiedIdentityContext: frozen.usedVerifiedIdentityContext,
    request: {
      ...current.request,
      input: frozen.request.input,
    },
  };
}

export function addOriginalImageToCandidateResearchRequest(
  request: CandidateResearchRequest,
  imageDataUrl: string,
): ImageCandidateResearchRequest {
  if (typeof request.input !== "string") {
    throw new Error("Candidate research control input is not text-only");
  }
  if (!/^data:image\/(png|jpeg|webp|gif);base64,/.test(imageDataUrl)) {
    throw new Error("Treatment image must be a supported image data URL");
  }
  return {
    ...request,
    input: [
      {
        role: "user" as const,
        content: [
          { type: "input_text" as const, text: request.input },
          {
            type: "input_image" as const,
            image_url: imageDataUrl,
            detail: DISCOVERY_RESEARCH_IMAGE_DETAIL,
          },
        ],
      },
    ],
  };
}

function treatmentText(request: ImageCandidateResearchRequest): string {
  const input = request.input as unknown;
  if (!Array.isArray(input) || input.length !== 1) {
    throw new Error("Treatment request has an unexpected input envelope");
  }
  const message = record(input[0], "Treatment request message is malformed");
  if (!Array.isArray(message.content) || message.content.length !== 2) {
    throw new Error(
      "Treatment request must contain one text and one image item",
    );
  }
  const textPart = record(
    message.content[0],
    "Treatment request text item is malformed",
  );
  const imagePart = record(
    message.content[1],
    "Treatment request image item is malformed",
  );
  if (
    textPart.type !== "input_text" ||
    typeof textPart.text !== "string" ||
    imagePart.type !== "input_image" ||
    imagePart.detail !== DISCOVERY_RESEARCH_IMAGE_DETAIL
  ) {
    throw new Error("Treatment request changed its text/image contract");
  }
  return textPart.text;
}

export function assertOriginalImageIsOnlyRequestDifference(
  control: CandidateResearchRequest,
  treatment: ImageCandidateResearchRequest,
): void {
  if (typeof control.input !== "string") {
    throw new Error("Control request must remain text-only");
  }
  if (treatmentText(treatment) !== control.input) {
    throw new Error("Treatment changed the candidate research text context");
  }
  const normalizedTreatment = { ...treatment, input: control.input };
  if (JSON.stringify(normalizedTreatment) !== JSON.stringify(control)) {
    throw new Error(
      "A non-image candidate research variable differs between arms",
    );
  }
}

export function discoveryResearchExperimentFingerprint(
  plan: DiscoveryResearchImageAccessExperimentPlan,
): string {
  const packet = {
    source_engine_version: plan.input.sourceEngineVersion,
    model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    candidates: plan.candidates.map((item) => {
      const built = buildDiscoveryResearchReplayCandidateRequest(
        plan.input,
        item.candidate,
        plan.model,
      );
      return {
        candidate_id: item.candidate.id,
        question_id: item.candidate.question_id,
        question: item.candidate.investigation_question,
        gate_allowed: true,
        used_verified_identity_context: built.usedVerifiedIdentityContext,
        request: built.request,
      };
    }),
  };
  return createHash("sha256").update(JSON.stringify(packet)).digest("hex");
}

export function createDiscoveryResearchReplayDryRun(
  plan: DiscoveryResearchReplayPlan,
) {
  return {
    replay_version: DISCOVERY_RESEARCH_REPLAY_VERSION,
    mode: "dry-run" as const,
    input_valid: true,
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    identity_status: plan.input.identityVerification.status,
    stage1_candidate_count: plan.input.stage1.candidates.length,
    research_gate_passed: plan.candidates.length,
    planned_api_calls: plan.candidates.length,
    selected_candidate_research_model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    output_path: plan.outputPath,
    candidates: plan.candidates.map((item) => ({
      candidate_id: item.candidate.id,
      question_id: item.candidate.question_id,
      used_verified_identity_context: item.usedVerifiedIdentityContext,
    })),
  };
}

export function createDiscoveryResearchImageAccessExperimentDryRun(
  plan: DiscoveryResearchImageAccessExperimentPlan,
) {
  return {
    ...createDiscoveryResearchReplayDryRun(plan),
    replay_version: DISCOVERY_RESEARCH_IMAGE_ACCESS_EXPERIMENT_VERSION,
    experiment: "candidate-research-original-image-access",
    image_access: plan.imageAccess,
    image_detail:
      plan.imageAccess === "original-image"
        ? DISCOVERY_RESEARCH_IMAGE_DETAIL
        : null,
    repeat: plan.repeat,
    planned_api_calls: plan.candidates.length * plan.repeat,
    experiment_fingerprint: discoveryResearchExperimentFingerprint(plan),
    image_path_supplied: plan.imagePath !== null,
  };
}

function sumNullable(values: Array<number | null>): number | null {
  return values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
}

export async function executeDiscoveryResearchReplay(
  openai: Parameters<typeof runDiscoveryCandidateResearchCall>[0],
  plan: DiscoveryResearchReplayPlan,
) {
  const started = Date.now();
  const completed: Array<{
    result: DiscoveryResearchResult;
    call: DiscoveryResearchCallMetrics;
  }> = [];
  for (const item of plan.candidates) {
    const replayBuilt = buildDiscoveryResearchReplayCandidateRequest(
      plan.input,
      item.candidate,
      plan.model,
    );
    const productionBuilt = buildDiscoveryCandidateResearchRequest(
      plan.input.stage1,
      item.candidate,
      plan.input.identityVerification,
      plan.model,
    );
    const wrappedOpenAI = {
      responses: {
        create: async (request: CandidateResearchRequest) => {
          if (
            JSON.stringify(request) !== JSON.stringify(productionBuilt.request)
          ) {
            throw new Error(
              "Production candidate request changed during replay",
            );
          }
          return openai.responses.create(replayBuilt.request);
        },
      },
    } as unknown as Parameters<typeof runDiscoveryCandidateResearchCall>[0];
    const call = await runDiscoveryCandidateResearchCall(
      wrappedOpenAI,
      plan.input.stage1,
      item.candidate,
      plan.input.identityVerification,
      plan.model,
    );
    completed.push({
      ...call,
      call: {
        ...call.call,
        used_verified_identity_context: replayBuilt.usedVerifiedIdentityContext,
      },
    });
  }
  const output = {
    replay_version: DISCOVERY_RESEARCH_REPLAY_VERSION,
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    selected_candidate_research_model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    retained_identity_reused: true,
    verified_identity: {
      hypothesis_id: plan.input.identityVerification.hypothesis_id,
      canonical_identity: plan.input.identityVerification.canonical_identity,
      identity_type: plan.input.identityVerification.identity_type,
      location: plan.input.identityVerification.location,
      verification_basis: plan.input.identityVerification.verification_basis,
      confidence: plan.input.identityVerification.confidence,
      validated_sources: plan.input.identityVerification.sources,
    },
    candidates: completed.map(({ result, call }, index) => ({
      candidate_id: result.candidate_id,
      question_id: result.question_id,
      approved_question: result.question,
      used_verified_identity_context: call.used_verified_identity_context,
      status: result.status,
      finding: result.finding,
      validated_sources: result.sources,
      model: call.usage.model,
      input_tokens: call.usage.input_tokens,
      cached_input_tokens: call.usage.cached_input_tokens,
      output_tokens: call.usage.output_tokens,
      reasoning_tokens: call.usage.reasoning_tokens,
      total_tokens: call.usage.total_tokens,
      latency_ms: call.usage.latency_ms,
      web_search_calls: call.web_search_calls,
      model_token_cost_usd: call.model_token_cost_usd,
      tool_cost_usd: call.tool_cost_usd,
      total_known_cost_usd: call.total_known_cost_usd,
      retained_baseline: {
        status: plan.candidates[index]!.retainedStatus,
        total_known_cost_usd: plan.candidates[index]!.retainedTotalKnownCostUsd,
      },
    })),
    attempted_count: completed.length,
    answered_count: completed.filter(
      ({ result }) => result.status === "answered",
    ).length,
    insufficient_count: completed.filter(
      ({ result }) => result.status === "insufficient",
    ).length,
    total_model_tokens: sumNullable(
      completed.map(({ call }) => call.usage.total_tokens),
    ),
    total_web_search_calls: completed.reduce(
      (sum, { call }) => sum + call.web_search_calls,
      0,
    ),
    total_model_token_cost_usd: sumNullable(
      completed.map(({ call }) => call.model_token_cost_usd),
    ),
    total_tool_cost_usd: completed.reduce(
      (sum, { call }) => sum + (call.tool_cost_usd ?? 0),
      0,
    ),
    total_known_cost_usd: sumNullable(
      completed.map(({ call }) => call.total_known_cost_usd),
    ),
    total_latency_ms: Date.now() - started,
  };
  assertSafeDiscoveryResearchReplayOutput(output);
  return output;
}

function mean(values: number[]): number | null {
  return values.length === 0
    ? null
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function completeNumbers(values: Array<number | null>): number[] | null {
  return values.every((value) => value !== null) ? (values as number[]) : null;
}

function candidateResearchRequestsForExperimentPlan(
  plan: DiscoveryResearchImageAccessExperimentPlan,
  image: DiscoveryResearchReplayImage | null,
) {
  return plan.candidates.map((item) => {
    const built = buildDiscoveryResearchReplayCandidateRequest(
      plan.input,
      item.candidate,
      plan.model,
    );
    const productionBuilt = buildDiscoveryCandidateResearchRequest(
      plan.input.stage1,
      item.candidate,
      plan.input.identityVerification,
      plan.model,
    );
    const treatment = image
      ? addOriginalImageToCandidateResearchRequest(built.request, image.dataUrl)
      : null;
    if (treatment) {
      assertOriginalImageIsOnlyRequestDifference(built.request, treatment);
    }
    return { item, built, productionBuilt, treatment };
  });
}

export async function executeDiscoveryResearchImageAccessExperiment(
  openai: Parameters<typeof runDiscoveryCandidateResearchCall>[0],
  plan: DiscoveryResearchImageAccessExperimentPlan,
  image: DiscoveryResearchReplayImage | null,
) {
  if (plan.model !== DISCOVERY_LUNA_RESEARCH_MODEL) {
    throw new Error("Image-access experiment must use gpt-5.6-luna");
  }
  if (plan.imageAccess === "original-image" && !image) {
    throw new Error(
      "Original-image mode requires a validated image before execution",
    );
  }
  if (plan.imageAccess === "text-only" && image) {
    throw new Error("Text-only mode must not receive an image");
  }

  const prepared = candidateResearchRequestsForExperimentPlan(plan, image);
  const started = Date.now();
  const attempts: Array<{
    arm: DiscoveryResearchImageAccessMode;
    repeat_index: number;
    candidate_id: string;
    question_id: string;
    approved_question: string;
    used_verified_identity_context: boolean;
    status: "answered" | "insufficient";
    finding: string;
    validated_sources: DiscoveryResearchResult["sources"];
    source_validation_failed: boolean;
    model: string;
    input_tokens: number | null;
    cached_input_tokens: number | null;
    output_tokens: number | null;
    reasoning_tokens: number | null;
    total_tokens: number | null;
    latency_ms: number;
    web_search_calls: number;
    model_token_cost_usd: number | null;
    tool_cost_usd: number;
    total_known_cost_usd: number | null;
    retained_baseline: {
      status: "answered" | "insufficient";
      total_known_cost_usd: number | null;
    };
  }> = [];

  for (let repeatIndex = 1; repeatIndex <= plan.repeat; repeatIndex += 1) {
    for (const preparedCandidate of prepared) {
      let declaredAnswered = false;
      const wrappedOpenAI = {
        responses: {
          create: async (request: CandidateResearchRequest) => {
            if (
              JSON.stringify(request) !==
              JSON.stringify(preparedCandidate.productionBuilt.request)
            ) {
              throw new Error(
                "Production candidate request changed during replay",
              );
            }
            const sentRequest =
              plan.imageAccess === "original-image"
                ? preparedCandidate.treatment!
                : preparedCandidate.built.request;
            const response = await openai.responses.create(sentRequest);
            declaredAnswered = /^\s*ANSWERED\s*:/i.test(response.output_text);
            return response;
          },
        },
      } as unknown as Parameters<typeof runDiscoveryCandidateResearchCall>[0];
      const completed = await runDiscoveryCandidateResearchCall(
        wrappedOpenAI,
        plan.input.stage1,
        preparedCandidate.item.candidate,
        plan.input.identityVerification,
        plan.model,
      );
      attempts.push({
        arm: plan.imageAccess,
        repeat_index: repeatIndex,
        candidate_id: completed.result.candidate_id,
        question_id: completed.result.question_id,
        approved_question: completed.result.question,
        used_verified_identity_context:
          preparedCandidate.built.usedVerifiedIdentityContext,
        status: completed.result.status,
        finding: completed.result.finding,
        validated_sources: completed.result.sources,
        source_validation_failed:
          declaredAnswered && completed.result.status === "insufficient",
        model: completed.call.usage.model,
        input_tokens: completed.call.usage.input_tokens,
        cached_input_tokens: completed.call.usage.cached_input_tokens,
        output_tokens: completed.call.usage.output_tokens,
        reasoning_tokens: completed.call.usage.reasoning_tokens,
        total_tokens: completed.call.usage.total_tokens,
        latency_ms: completed.call.usage.latency_ms,
        web_search_calls: completed.call.web_search_calls,
        model_token_cost_usd: completed.call.model_token_cost_usd,
        tool_cost_usd: completed.call.tool_cost_usd ?? 0,
        total_known_cost_usd: completed.call.total_known_cost_usd,
        retained_baseline: {
          status: preparedCandidate.item.retainedStatus,
          total_known_cost_usd:
            preparedCandidate.item.retainedTotalKnownCostUsd,
        },
      });
    }
  }

  const modelCosts = completeNumbers(
    attempts.map((attempt) => attempt.model_token_cost_usd),
  );
  const totalCosts = completeNumbers(
    attempts.map((attempt) => attempt.total_known_cost_usd),
  );
  const answeredCount = attempts.filter(
    (attempt) => attempt.status === "answered",
  ).length;
  const output = {
    replay_version: DISCOVERY_RESEARCH_IMAGE_ACCESS_EXPERIMENT_VERSION,
    experiment: "candidate-research-original-image-access",
    experiment_fingerprint: discoveryResearchExperimentFingerprint(plan),
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    arm: plan.imageAccess,
    repeat: plan.repeat,
    selected_candidate_research_model: plan.model,
    reasoning_effort: DISCOVERY_REASONING_EFFORT,
    image:
      image === null
        ? null
        : {
            mime_type: image.mimeType,
            sha256: image.sha256,
            byte_length: image.byteLength,
            detail: DISCOVERY_RESEARCH_IMAGE_DETAIL,
          },
    retained_identity_reused: true,
    verified_identity: {
      hypothesis_id: plan.input.identityVerification.hypothesis_id,
      canonical_identity: plan.input.identityVerification.canonical_identity,
      identity_type: plan.input.identityVerification.identity_type,
      location: plan.input.identityVerification.location,
      verification_basis: plan.input.identityVerification.verification_basis,
      confidence: plan.input.identityVerification.confidence,
      validated_sources: plan.input.identityVerification.sources,
    },
    candidate_packet: plan.candidates.map((item) => ({
      candidate_id: item.candidate.id,
      question_id: item.candidate.question_id,
      question: item.candidate.investigation_question,
      gate_allowed: true,
      identity_context_applies: item.usedVerifiedIdentityContext,
    })),
    attempts,
    aggregate: {
      arm: plan.imageAccess,
      total_candidate_attempts: attempts.length,
      answered_count: answeredCount,
      insufficient_count: attempts.length - answeredCount,
      answered_rate:
        attempts.length === 0 ? null : answeredCount / attempts.length,
      source_validation_failures: attempts.filter(
        (attempt) => attempt.source_validation_failed,
      ).length,
      mean_latency_ms: mean(attempts.map((attempt) => attempt.latency_ms)),
      median_latency_ms: median(attempts.map((attempt) => attempt.latency_ms)),
      mean_model_token_cost_usd: modelCosts ? mean(modelCosts) : null,
      median_model_token_cost_usd: modelCosts ? median(modelCosts) : null,
      mean_tool_cost_usd: mean(
        attempts.map((attempt) => attempt.tool_cost_usd),
      ),
      median_tool_cost_usd: median(
        attempts.map((attempt) => attempt.tool_cost_usd),
      ),
      mean_total_known_cost_usd: totalCosts ? mean(totalCosts) : null,
      median_total_known_cost_usd: totalCosts ? median(totalCosts) : null,
    },
    total_elapsed_ms: Date.now() - started,
  };
  assertSafeDiscoveryResearchReplayOutput(output);
  return output;
}

export function assertSafeDiscoveryResearchReplayOutput(value: unknown): void {
  const forbiddenKey =
    /(^|_)(api_key|authorization|cookie|environment|headers|password|private_key|prompt|raw|request|secret|stack)(_|$)/i;
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKey.test(key)) {
        throw new Error("Replay output contains an internal-only field");
      }
      visit(child);
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  if (/sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY/i.test(serialized)) {
    throw new Error("Replay output contains a secret-like value");
  }
}

export function candidateResearchRequestsForPlan(
  plan: DiscoveryResearchReplayPlan,
) {
  return plan.candidates.map((item) =>
    buildDiscoveryResearchReplayCandidateRequest(
      plan.input,
      item.candidate,
      plan.model,
    ),
  );
}

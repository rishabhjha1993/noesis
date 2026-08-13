import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DISCOVERY_STAGE1_JSON_SCHEMA,
  DiscoveryIdentityHypothesisSchema,
  DiscoveryStage1Schema,
  type DiscoveryIdentityHypothesis,
  type DiscoveryStage1,
} from "../artifacts/api-server/src/lib/discoveryContracts";
import {
  DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION,
  DISCOVERY_REASONING_EFFORT,
  DISCOVERY_STAGE1_MODEL,
} from "../artifacts/api-server/src/lib/discoveryPipeline";
import { estimateModelCost } from "../artifacts/api-server/src/lib/modelPricing";

export const F1_IDENTITY_FORMULATION_REPLAY_VERSION =
  "noesis-f1-frozen-evidence-identity-formulation-v1";
export const F1_IDENTITY_FORMULATION_MODEL = DISCOVERY_STAGE1_MODEL;
export const F1_IDENTITY_FORMULATION_REASONING_EFFORT =
  DISCOVERY_REASONING_EFFORT;

export const F1_CONTROL_INSTRUCTIONS = `You are an eval-only identity-formulation step for Noesis.

You receive frozen observations from an image, but not the image itself and no external research. Propose at most one useful visual identity hypothesis only when the supplied visible evidence supports one. Identity is a hypothesis, never a verified fact. Remain grounded in the supplied visible evidence and prefer uncertainty over unsupported identification. Return an empty identity_hypotheses array when the evidence is insufficient. Copy region and question identifiers exactly from the supplied packet. Do not expose chain-of-thought; return only the concise structured result.`;

export const F1_JOINT_EVIDENCE_DELTA = `Combine at least two independent visible clues that jointly narrow the identity. Propose the most specific falsifiable identity hypothesis those clues jointly justify. If the clues do not justify greater specificity, remain broad. Do not guess a proper noun merely to be specific.`;

const CONTAMINATION_TARGETS = [
  "Noordoostpolder",
  "Netherlands",
  "Flevoland",
  "IJsseloog",
] as const;

export const F1_IDENTITY_FORMULATION_JSON_SCHEMA = {
  type: "json_schema",
  name: "noesis_f1_identity_formulation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      identity_hypotheses: {
        ...DISCOVERY_STAGE1_JSON_SCHEMA.schema.properties.identity_hypotheses,
        maxItems: 1,
      },
    },
    required: ["identity_hypotheses"],
  },
} as const;

export const F1_HUMAN_EVALUATION_RUBRIC = {
  judge: "human",
  dimensions: {
    evidence_aggregation: {
      0: "Hypothesis barely reflects supplied clues.",
      1: "Uses one useful or discriminative clue.",
      2: "Combines at least two independent visible clues that materially narrow identity.",
    },
    search_readiness_falsifiability: {
      0: "Generic category that gives a verifier little to test.",
      1: "Meaningfully narrowed but still weakly discriminative.",
      2: "Concrete, constrained, falsifiable hypothesis suitable for verification.",
    },
    calibration: {
      0: "Unsupported specificity or guessing.",
      1: "Partly calibrated.",
      2: "Specificity and confidence are well matched to visible evidence.",
    },
  },
  automatic_failure:
    "A specific identity introduced primarily by unsupported guessing.",
  pass: "Intervention scores at least 5/6, beats control by at least 2 points, has no unsupported-specificity failure, and its specificity increase traces to frozen evidence.",
  fail: "Intervention stays generic, gains specificity mainly by guessing, ignores evidence, or control is clearly as good or better.",
  inconclusive:
    "Both arms are strong, both are weak, or the difference is too small to attribute confidently to the prompt delta.",
} as const;

export interface F1FrozenEvidencePacket {
  regions: Array<{
    id: string;
    description: string;
    scope: "local" | "global";
  }>;
  candidates: Array<{
    id: string;
    question_id: string;
    visual_trigger: string;
    observation: string;
    region_ids: string[];
    identity_context_needed: boolean;
  }>;
}

export interface F1RetainedInput {
  sourceDiscoveryId: string;
  sourceEngineVersion: string;
  stage1: DiscoveryStage1;
}

export interface F1IdentityFormulationPlan {
  input: F1RetainedInput;
  frozenEvidence: F1FrozenEvidencePacket;
  canonicalEvidence: string;
  evidenceSha256: string;
  outputPath: string | null;
}

export interface F1IdentityFormulationRequest {
  model: string;
  reasoning: { effort: string };
  store: false;
  max_output_tokens: number;
  text: { format: typeof F1_IDENTITY_FORMULATION_JSON_SCHEMA };
  instructions: string;
  input: string;
}

export interface F1IdentityFormulationClient {
  responses: {
    create(request: F1IdentityFormulationRequest): Promise<{
      model: string;
      output_text: string;
      usage?: {
        input_tokens?: number | null;
        input_tokens_details?: { cached_tokens?: number | null };
        output_tokens?: number | null;
        output_tokens_details?: { reasoning_tokens?: number | null };
        total_tokens?: number | null;
      };
    }>;
  };
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

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

export function canonicalSerializeF1Evidence(
  packet: F1FrozenEvidencePacket,
): string {
  return JSON.stringify(canonicalValue(packet));
}

export function createF1FrozenEvidencePacket(
  stage1: DiscoveryStage1,
): F1FrozenEvidencePacket {
  return {
    regions: stage1.regions.map(({ id, description, scope }) => ({
      id,
      description,
      scope,
    })),
    candidates: stage1.candidates.map(
      ({
        id,
        question_id,
        visual_trigger,
        observation,
        region_ids,
        identity_context_needed,
      }) => ({
        id,
        question_id,
        visual_trigger,
        observation,
        region_ids: [...region_ids],
        identity_context_needed,
      }),
    ),
  };
}

export function assertF1Uncontaminated(value: string): void {
  const lower = value.toLowerCase();
  if (
    CONTAMINATION_TARGETS.some((target) => lower.includes(target.toLowerCase()))
  ) {
    throw new Error(
      "F1 retained evidence is contaminated by a known target identity; no model call is permitted",
    );
  }
}

const SUPPORTED_ENGINE_VERSIONS = new Set([
  DISCOVERY_ENGINE_VERSION,
  DISCOVERY_BATCHED_RESEARCH_ENGINE_VERSION,
  DISCOVERY_LUNA_RESEARCH_ENGINE_VERSION,
]);

export function parseF1RetainedInput(
  value: unknown,
  suppliedDiscoveryId?: string,
): F1RetainedInput {
  const envelope = record(value, "F1 retained input must be a JSON object");
  if ("status" in envelope && envelope.status !== "done") {
    throw new Error("F1 retained input is not a successful completed job");
  }
  const rawResult = envelope.result ?? envelope;
  const result = record(
    rawResult,
    "F1 retained input does not contain a result",
  );
  const sourceEngineVersion = nonEmptyString(
    result.version,
    "F1 retained result lacks an engine version",
  );
  if (!SUPPORTED_ENGINE_VERSIONS.has(sourceEngineVersion)) {
    throw new Error("F1 retained result is not a supported Discovery V1 run");
  }
  const metrics = record(
    result.metrics,
    "F1 retained result metrics are missing",
  );
  if (metrics.success !== true) {
    throw new Error("F1 retained input is not a successful Discovery run");
  }
  const inspection = record(
    result.inspection,
    "F1 retained result inspection is missing",
  );
  if (!("stage1" in inspection)) {
    throw new Error("F1 retained input does not contain Stage 1");
  }
  const stage1 = DiscoveryStage1Schema.parse(inspection.stage1);
  if (JSON.stringify(result.regions) !== JSON.stringify(stage1.regions)) {
    throw new Error("F1 retained result regions do not match retained Stage 1");
  }

  const embeddedDiscoveryId =
    envelope.discovery_id ??
    (rawResult as Record<string, unknown>).discovery_id;
  if (
    suppliedDiscoveryId &&
    typeof embeddedDiscoveryId === "string" &&
    embeddedDiscoveryId !== suppliedDiscoveryId
  ) {
    throw new Error(
      "Supplied source discovery id does not match retained input",
    );
  }
  const sourceDiscoveryId = nonEmptyString(
    suppliedDiscoveryId ?? embeddedDiscoveryId,
    "F1 retained input does not embed a discovery id; pass --source-discovery-id",
  );
  return { sourceDiscoveryId, sourceEngineVersion, stage1 };
}

export async function loadF1RetainedInput(
  inputPath: string,
  suppliedDiscoveryId?: string,
): Promise<F1RetainedInput> {
  return parseF1RetainedInput(
    JSON.parse(await readFile(inputPath, "utf8")),
    suppliedDiscoveryId,
  );
}

export function createF1IdentityFormulationPlan(
  input: F1RetainedInput,
  outputPath?: string,
): F1IdentityFormulationPlan {
  const frozenEvidence = createF1FrozenEvidencePacket(input.stage1);
  const canonicalEvidence = canonicalSerializeF1Evidence(frozenEvidence);
  assertF1Uncontaminated(canonicalEvidence);
  assertF1Uncontaminated(F1_CONTROL_INSTRUCTIONS);
  assertF1Uncontaminated(F1_JOINT_EVIDENCE_DELTA);
  return {
    input,
    frozenEvidence,
    canonicalEvidence,
    evidenceSha256: createHash("sha256")
      .update(canonicalEvidence)
      .digest("hex"),
    outputPath: outputPath ?? null,
  };
}

function requestForArm(
  plan: F1IdentityFormulationPlan,
  arm: "control" | "intervention",
): F1IdentityFormulationRequest {
  const instructions =
    arm === "control"
      ? F1_CONTROL_INSTRUCTIONS
      : `${F1_CONTROL_INSTRUCTIONS}\n\n${F1_JOINT_EVIDENCE_DELTA}`;
  const input = `FROZEN VISIBLE EVIDENCE PACKET:\n${plan.canonicalEvidence}`;
  assertF1Uncontaminated(instructions);
  assertF1Uncontaminated(input);
  return {
    model: F1_IDENTITY_FORMULATION_MODEL,
    reasoning: { effort: F1_IDENTITY_FORMULATION_REASONING_EFFORT },
    store: false,
    max_output_tokens: 2500,
    text: { format: F1_IDENTITY_FORMULATION_JSON_SCHEMA },
    instructions,
    input,
  };
}

export function createF1IdentityFormulationRequests(
  plan: F1IdentityFormulationPlan,
) {
  return [
    { arm: "control" as const, request: requestForArm(plan, "control") },
    {
      arm: "intervention" as const,
      request: requestForArm(plan, "intervention"),
    },
  ];
}

export function createF1IdentityFormulationDryRun(
  plan: F1IdentityFormulationPlan,
) {
  return {
    replay_version: F1_IDENTITY_FORMULATION_REPLAY_VERSION,
    experiment: "F1 — Frozen-Evidence Joint Identity Formulation",
    mode: "dry-run" as const,
    retained_input_valid: true,
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    stage1_candidate_count: plan.input.stage1.candidates.length,
    frozen_evidence_sha256: plan.evidenceSha256,
    contamination_check: "passed" as const,
    selected_model: F1_IDENTITY_FORMULATION_MODEL,
    reasoning_effort: F1_IDENTITY_FORMULATION_REASONING_EFFORT,
    arms: ["control", "intervention"] as const,
    planned_api_calls: 2,
    planned_tools: 0,
    planned_web_search_calls: 0,
    output_path: plan.outputPath,
    production_pipeline_involved: false,
    paid_result_exists: false,
    human_evaluation: F1_HUMAN_EVALUATION_RUBRIC,
  };
}

export function validateF1IdentityOutput(
  plan: F1IdentityFormulationPlan,
  value: unknown,
): { identity_hypotheses: DiscoveryIdentityHypothesis[] } {
  const output = record(value, "F1 identity output must be an object");
  if (Object.keys(output).length !== 1 || !("identity_hypotheses" in output)) {
    throw new Error("F1 identity output has unexpected fields");
  }
  if (!Array.isArray(output.identity_hypotheses)) {
    throw new Error("F1 identity_hypotheses must be an array");
  }
  if (output.identity_hypotheses.length > 1) {
    throw new Error("F1 identity output may contain at most one hypothesis");
  }
  const parsed = {
    identity_hypotheses: output.identity_hypotheses.map((hypothesis) =>
      DiscoveryIdentityHypothesisSchema.parse(hypothesis),
    ),
  };
  const regionIds = new Set(plan.frozenEvidence.regions.map(({ id }) => id));
  const questionIds = new Set(
    plan.frozenEvidence.candidates.map(({ question_id }) => question_id),
  );
  for (const hypothesis of parsed.identity_hypotheses) {
    if (hypothesis.region_ids.some((id) => !regionIds.has(id))) {
      throw new Error("F1 identity hypothesis references an unknown region");
    }
    if (hypothesis.relevant_question_ids.some((id) => !questionIds.has(id))) {
      throw new Error("F1 identity hypothesis references an unknown question");
    }
    if (
      hypothesis.verification_would_help !==
      hypothesis.relevant_question_ids.length > 0
    ) {
      throw new Error(
        "F1 identity hypothesis verification flag and question references disagree",
      );
    }
  }
  return parsed;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumNullable(values: Array<number | null>): number | null {
  return values.every((value) => value !== null)
    ? values.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
}

export async function executeF1IdentityFormulationReplay(
  openai: F1IdentityFormulationClient,
  plan: F1IdentityFormulationPlan,
) {
  const experimentStarted = Date.now();
  const arms = [];
  for (const { arm, request } of createF1IdentityFormulationRequests(plan)) {
    const started = Date.now();
    const response = await openai.responses.create(request);
    const latencyMs = Date.now() - started;
    const validated = validateF1IdentityOutput(
      plan,
      JSON.parse(response.output_text),
    );
    const usage = {
      model: nonEmptyString(response.model, "F1 response lacks a model"),
      input_tokens: integer(response.usage?.input_tokens),
      cached_input_tokens: integer(
        response.usage?.input_tokens_details?.cached_tokens,
      ),
      output_tokens: integer(response.usage?.output_tokens),
      reasoning_tokens: integer(
        response.usage?.output_tokens_details?.reasoning_tokens,
      ),
      total_tokens: integer(response.usage?.total_tokens),
    };
    const cost = estimateModelCost(usage);
    arms.push({
      arm,
      identity_hypotheses: validated.identity_hypotheses,
      ...usage,
      latency_ms: latencyMs,
      model_token_cost_usd: cost.usd,
      web_search_calls: 0,
      tool_cost_usd: 0,
      total_known_cost_usd: cost.usd,
      cost_reason: cost.reason,
    });
  }
  const output = {
    replay_version: F1_IDENTITY_FORMULATION_REPLAY_VERSION,
    experiment: "F1 — Frozen-Evidence Joint Identity Formulation",
    source_retained_discovery_id: plan.input.sourceDiscoveryId,
    source_retained_engine_version: plan.input.sourceEngineVersion,
    frozen_evidence_sha256: plan.evidenceSha256,
    contamination_check: "passed" as const,
    selected_model: F1_IDENTITY_FORMULATION_MODEL,
    reasoning_effort: F1_IDENTITY_FORMULATION_REASONING_EFFORT,
    production_pipeline_involved: false,
    arms,
    total_model_token_cost_usd: sumNullable(
      arms.map((arm) => arm.model_token_cost_usd),
    ),
    total_tool_cost_usd: 0,
    total_known_cost_usd: sumNullable(
      arms.map((arm) => arm.total_known_cost_usd),
    ),
    total_latency_ms: Date.now() - experimentStarted,
    human_evaluation: F1_HUMAN_EVALUATION_RUBRIC,
    experiment_judgment: null,
  };
  assertSafeF1IdentityFormulationOutput(output);
  return output;
}

export function assertSafeF1IdentityFormulationOutput(value: unknown): void {
  const forbiddenKey =
    /(^|_)(api_key|authorization|cookie|environment|headers|instructions|messages|password|private_key|prompt|raw|request|secret|stack)(_|$)/i;
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (forbiddenKey.test(key)) {
        throw new Error("F1 output contains an internal-only field");
      }
      visit(child);
    }
  };
  visit(value);
  const serialized = JSON.stringify(value);
  if (/sk-[A-Za-z0-9_-]{20,}|OPENAI_API_KEY/i.test(serialized)) {
    throw new Error("F1 output contains a secret-like value");
  }
}

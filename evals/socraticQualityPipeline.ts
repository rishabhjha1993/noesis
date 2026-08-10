import { z } from "../artifacts/api-server/node_modules/zod";
import {
  ANALYSIS_MODEL,
  NoesisAnalysisSchema,
  runAnalysisPipelineDetailed,
  type NoesisAnalysisResult,
} from "../artifacts/api-server/src/lib/analysisPipeline";
import { computeEvidence } from "../artifacts/api-server/src/lib/computations";
import {
  VisualEvidence,
  VISUAL_EVIDENCE_JSON_SCHEMA,
  type ComputedEvidence,
} from "../artifacts/api-server/src/lib/evidence";
import {
  emptyModelUsage,
  normalizeChatUsage,
  type ModelUsageMetrics,
} from "../artifacts/api-server/src/lib/analysisMetrics";
import { estimateModelCost } from "../artifacts/api-server/src/lib/modelPricing";
import {
  createSocraticQualityPacket,
  serializedBytes,
  type SocraticQualityPacket,
} from "./qualityEvidence";

const SOL = ANALYSIS_MODEL;
const TERRA = "gpt-5.6-terra";
const LUNA = "gpt-5.6-luna";
type ProductionOpenAI = Parameters<typeof runAnalysisPipelineDetailed>[0];
type OpenAIClient = {
  chat: {
    completions: Pick<ProductionOpenAI["chat"]["completions"], "create">;
  };
};
type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail: "high" } };

type StageName =
  | "sol_evidence"
  | "deterministic_compute"
  | "socratic_packet"
  | "luna_questioner"
  | "terra_explanation"
  | "luna_critic"
  | "sol_synthesis"
  | "final_mapping";

const SocraticQuestionerOutput = z.object({
  questions: z
    .array(
      z.object({
        id: z.string(),
        starting_observation: z.string(),
        primary_question: z.string(),
        deeper_question: z.string(),
        why_this_question_matters: z.string(),
        supporting_fact_ids: z.array(z.string()),
        supporting_computation_ids: z.array(z.string()),
        region_ids: z.array(z.string()),
        priority: z.number(),
      }),
    )
    .max(8),
});

const ExplanationOutput = z.object({
  candidates: z
    .array(
      z.object({
        id: z.string(),
        observation: z.string(),
        explanation: z.string(),
        explanation_type: z.enum(["direct", "derived", "contextual"]),
        consequence: z.string(),
        supporting_fact_ids: z.array(z.string()),
        supporting_computation_ids: z.array(z.string()),
        region_ids: z.array(z.string()),
        confidence: z.number(),
        caveat: z.string().nullable(),
      }),
    )
    .max(8),
});

const CriticOutput = z.object({
  high_value_facts: z.array(z.string()).max(8),
  shallow_observations: z.array(z.string()).max(8),
  dangerous_inferences: z.array(z.string()).max(8),
  unanswered_why_questions: z.array(z.string()).max(8),
  missed_connections: z.array(z.string()).max(8),
  recommendations: z.array(z.string()).max(8),
});

const FinalRegion = z.object({
  primary_source_region_id: z.string(),
  alternate_source_region_ids: z.array(z.string()).max(3),
  label: z.string(),
  sequence_order: z.number(),
  explanation: z.string(),
  why_it_matters: z.string(),
  related_source_region_ids: z.array(z.string()),
  relationship_explanation: z.string(),
  confidence: z.number(),
  evidence_level: z.enum(["visual", "derived", "contextual"]),
  contextual_claim: z.string().nullable(),
  contextual_confidence: z.number().nullable(),
  context_appropriateness: z.string().nullable(),
});

const QualitySynthesisOutput = z.object({
  title: z.string(),
  image_type: z.string(),
  central_question: z.string(),
  overall_summary: z.string(),
  big_takeaway: z.string(),
  big_takeaway_evidence_level: z.enum(["visual", "derived", "contextual"]),
  big_takeaway_contextual_claim: z.string().nullable(),
  big_takeaway_contextual_confidence: z.number().nullable(),
  big_takeaway_context_appropriateness: z.string().nullable(),
  regions: z.array(FinalRegion).min(4).max(6),
});

export type SocraticQuestionerOutput = z.infer<typeof SocraticQuestionerOutput>;
export type ExplanationOutput = z.infer<typeof ExplanationOutput>;
export type CriticOutput = z.infer<typeof CriticOutput>;
export type QualitySynthesisOutput = z.infer<typeof QualitySynthesisOutput>;

const stringArray = {
  type: "array",
  items: { type: "string" },
  maxItems: 8,
} as const;

const QUESTIONER_JSON_SCHEMA = {
  name: "socratic_quality_questioner",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["questions"],
    properties: {
      questions: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "starting_observation",
            "primary_question",
            "deeper_question",
            "why_this_question_matters",
            "supporting_fact_ids",
            "supporting_computation_ids",
            "region_ids",
            "priority",
          ],
          properties: {
            id: { type: "string" },
            starting_observation: { type: "string" },
            primary_question: { type: "string" },
            deeper_question: { type: "string" },
            why_this_question_matters: { type: "string" },
            supporting_fact_ids: { type: "array", items: { type: "string" } },
            supporting_computation_ids: {
              type: "array",
              items: { type: "string" },
            },
            region_ids: { type: "array", items: { type: "string" } },
            priority: { type: "number" },
          },
        },
      },
    },
  },
} as const;

const EXPLANATION_JSON_SCHEMA = {
  name: "socratic_quality_explanation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["candidates"],
    properties: {
      candidates: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "observation",
            "explanation",
            "explanation_type",
            "consequence",
            "supporting_fact_ids",
            "supporting_computation_ids",
            "region_ids",
            "confidence",
            "caveat",
          ],
          properties: {
            id: { type: "string" },
            observation: { type: "string" },
            explanation: { type: "string" },
            explanation_type: {
              type: "string",
              enum: ["direct", "derived", "contextual"],
            },
            consequence: { type: "string" },
            supporting_fact_ids: { type: "array", items: { type: "string" } },
            supporting_computation_ids: {
              type: "array",
              items: { type: "string" },
            },
            region_ids: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
            caveat: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

const CRITIC_JSON_SCHEMA = {
  name: "socratic_quality_critic",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "high_value_facts",
      "shallow_observations",
      "dangerous_inferences",
      "unanswered_why_questions",
      "missed_connections",
      "recommendations",
    ],
    properties: {
      high_value_facts: stringArray,
      shallow_observations: stringArray,
      dangerous_inferences: stringArray,
      unanswered_why_questions: stringArray,
      missed_connections: stringArray,
      recommendations: stringArray,
    },
  },
} as const;

const FINAL_JSON_SCHEMA = {
  name: "socratic_quality_noesis_synthesis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "title",
      "image_type",
      "central_question",
      "overall_summary",
      "big_takeaway",
      "big_takeaway_evidence_level",
      "big_takeaway_contextual_claim",
      "big_takeaway_contextual_confidence",
      "big_takeaway_context_appropriateness",
      "regions",
    ],
    properties: {
      title: { type: "string" },
      image_type: { type: "string" },
      central_question: { type: "string" },
      overall_summary: { type: "string" },
      big_takeaway: { type: "string" },
      big_takeaway_evidence_level: {
        type: "string",
        enum: ["visual", "derived", "contextual"],
      },
      big_takeaway_contextual_claim: { type: ["string", "null"] },
      big_takeaway_contextual_confidence: { type: ["number", "null"] },
      big_takeaway_context_appropriateness: { type: ["string", "null"] },
      regions: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "primary_source_region_id",
            "alternate_source_region_ids",
            "label",
            "sequence_order",
            "explanation",
            "why_it_matters",
            "related_source_region_ids",
            "relationship_explanation",
            "confidence",
            "evidence_level",
            "contextual_claim",
            "contextual_confidence",
            "context_appropriateness",
          ],
          properties: {
            primary_source_region_id: { type: "string" },
            alternate_source_region_ids: {
              type: "array",
              items: { type: "string" },
              maxItems: 3,
            },
            label: { type: "string" },
            sequence_order: { type: "number" },
            explanation: { type: "string" },
            why_it_matters: { type: "string" },
            related_source_region_ids: {
              type: "array",
              items: { type: "string" },
            },
            relationship_explanation: { type: "string" },
            confidence: { type: "number" },
            evidence_level: {
              type: "string",
              enum: ["visual", "derived", "contextual"],
            },
            contextual_claim: { type: ["string", "null"] },
            contextual_confidence: { type: ["number", "null"] },
            context_appropriateness: { type: ["string", "null"] },
          },
        },
      },
    },
  },
} as const;

// This is intentionally identical to the current production PASS1_PROMPT.
// It is duplicated in eval code so V2 cannot alter or invoke production Pass 2.
export const V2_PASS1_PROMPT = `You are the evidence-extraction layer for Noesis.

Analyse the supplied visual as a source of evidence.

Do NOT produce polished explanations.
Do NOT generate the final walkthrough.
Do NOT decide what is interesting yet.

Extract what is clearly visible.

First identify:
- visual type
- apparent purpose
- overall visual structure

Then identify candidate regions that correspond to meaningful visual components, panels, flows, clusters, maps, charts, or system areas. Give each a normalized bounding box (x, y, width, height in 0-1, origin top-left).

Extract clearly legible numerical facts whenever possible. For every number preserve subject, value, unit, qualifier (e.g. year or scenario, else null), context, region_id (or null), and confidence 0-1.

For each numeric fact also set:
- comparison_group: a short id shared ONLY by facts this visual explicitly frames as directly comparable (same metric on the same axis, same panel, same series, parts of the same labelled flow or breakdown). Facts from different metrics, panels, populations, geographies or scales must NOT share a group even if their units match. Use null when a fact is not directly comparable with any other extracted fact.
- is_total: true only when the visual explicitly labels the value as the total or sum of other extracted facts in the same comparison_group; otherwise false.

Also extract:
- categorical states
- visible structural patterns
- flows
- clusters
- dense versus sparse areas
- divergence
- major nodes
- transitions
- comparisons represented by the visual
- explicit relationships (with supporting fact ids)

GROUNDING RULES:

Only extract what the image supports.
Never invent unreadable text.
Never estimate a precise number if it is not legible.
Never use external knowledge.
Never infer causality unless the visual explicitly represents it.
Prefer evidence recall and faithful structure over polished prose.
Coordinates must remain normalized from 0 to 1.`;

const QUESTIONER_PROMPT = `You are the Socratic Questioner in a quality-first visual-understanding experiment. You receive a text-only evidence packet, not the image. Do not write final user-facing insights.

Generate no more than 8 questions that the final system should answer. Start from the strongest visible facts, computations, relationships, and structural observations. For each ask: SO WHAT makes this important; WHY might the pattern exist; WHAT changes in the viewer's understanding; WHAT natural next question follows; WHAT comparison, asymmetry, dependency, exception, bottleneck, trade-off, hierarchy, concentration, or topology makes it meaningful; and WHAT the visual leaves unexplained.

Prefer depth over coverage. Aggressively reject questions that merely restate an observation. Use only supplied fact, computation, and region ids. Return strict structured output.`;

const EXPLANATION_PROMPT = `You are the independent Explanation and Context Reasoner in a quality-first visual-understanding experiment. You receive a text-only evidence packet and do not see the other analysts.

Find explanatory mechanisms for the most important observations: what visible relationship explains them, what system mechanism appears to produce them, what follows, and what broader context makes them understandable. Type every candidate as direct (explicitly shown), derived (logical interpretation of shown relationships), or contextual (high-confidence background/domain knowledge).

Context is allowed, but never claim it came from the image. Omit uncertain or fragile context; do not manufacture causality. State a caveat whenever warranted. Use only supplied ids for support. Return at most 8 strong candidates as strict structured output.`;

const CRITIC_PROMPT = `You are the independent Intellectual Critic in a quality-first visual-understanding experiment. You receive a text-only evidence packet and do not see the other analysts.

Identify where a seemingly intelligent analysis would still fail: facts that are accurate but trivial; claims that only rephrase the visual; unsupported causal or contextual inferences; important numbers that deserve deeper explanation; unanswered WHY questions; missed tensions, contradictions, trade-offs, relationships, or topology; spatial risks; and what a skeptical expert would challenge. Be concise and return strict structured output.`;

const FINAL_PROMPT = `You are the final Sol synthesizer in a quality-first Noesis visual-understanding experiment. You receive the original image, the complete original VisualEvidence, unchanged deterministic ComputedEvidence, and three independent Socratic outputs. The Socratic outputs are candidate reasoning material, not trusted facts.

SOURCE PRIORITY
1. The original image is the ultimate source of truth for visual claims.
2. Prefer deterministic computations for arithmetic.
3. Verify Stage 1 evidence against the image and discard anything wrong.
4. Distinguish visual claims, derived interpretations, and contextual knowledge.
5. Use contextual knowledge only when highly reliable, tied to visible evidence, and clearly calibrated. Never present it as image-proven. Discard weak or unsupported suggestions.

QUALITY TEST
For each candidate teaching step require WHAT is shown, SO WHAT changes in understanding, WHY a relationship/mechanism/context explains it when support exists, and EVIDENCE. A step answering only WHAT normally does not survive. Ask: if the user said 'So what?', is the answer already present? If they asked 'Why?', can the visual, its relationships, or high-confidence context answer? If not, do not fabricate.

FIELD RESPONSIBILITIES
- explanation: WHAT + WHERE + HOW TO READ, concise.
- why_it_matters: the most valuable SO WHAT, not another description.
- relationship_explanation: WHY, mechanism, cross-region relationship, or cautious context; do not repeat why_it_matters.
- big_takeaway: what the viewer now understands about the SYSTEM that the title alone did not teach.

Prefer quantitative + explanatory, then comparative + explanatory, structural + explanatory, non-obvious relationships, and only then orientation. Preserve strong numbers and add meaning. Adapt to the visual type. Do not force numeric claims into qualitative visuals.

SELF-CRITIQUE
Before returning JSON, test every step: Is the visual claim supported? Is every number correct? Does this answer so what? Does the WHY explain rather than restate? Is outside context reliable and clearly framed? Is a stronger insight available? Is this redundant? Would an expert find it useful rather than obvious? Reject and replace weak steps. Also test the big takeaway across multiple parts of the visual.

SPATIAL GROUNDING
Reuse Stage 1 candidate region ids and map coordinates deterministically; never generate coordinates. Each primary_source_region_id should be unique. For each step, provide up to 3 alternate_source_region_ids that would support the SAME semantic insight, ordered by suitability; these are deterministic fallbacks only if a primary duplicates or is invalid. Do not list an alternate that would change the meaning. Use related_source_region_ids for distant relationships. Never use a title/logo/source-only region. Return 4-6 spatially distinct teaching steps.

CONTEXT PROVENANCE
For each region and the big takeaway, label the strongest evidence level used. If contextual, record the exact contextual claim, confidence from 0 to 1, and why it is appropriate. Otherwise all three context metadata fields must be null.

Return only strict structured output. Keep the public-facing prose concise while preserving necessary evidence.`;

interface StructuredCallResult<T> {
  value: T;
  usage: ModelUsageMetrics;
}

class StageCallError extends Error {
  constructor(
    public readonly stage: StageName,
    public readonly usage: ModelUsageMetrics,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

async function structuredCall<T>(args: {
  openai: OpenAIClient;
  stage: StageName;
  model: string;
  effort: "low" | "medium" | "high";
  maxTokens: number;
  prompt: string;
  userContent: ContentPart[];
  jsonSchema: { name: string; strict: true; schema: Record<string, unknown> };
  parser: z.ZodType<T>;
}): Promise<StructuredCallResult<T>> {
  const started = Date.now();
  let usage = emptyModelUsage(args.model, args.effort);
  try {
    const response = await args.openai.chat.completions.create({
      model: args.model,
      reasoning_effort: args.effort,
      max_completion_tokens: args.maxTokens,
      response_format: { type: "json_schema", json_schema: args.jsonSchema },
      messages: [
        { role: "system", content: args.prompt },
        { role: "user", content: args.userContent },
      ],
    });
    usage = normalizeChatUsage(response, args.effort, Date.now() - started);
    const raw = response.choices[0]?.message?.content;
    if (!raw)
      throw new Error(
        `Empty response (${response.choices[0]?.finish_reason ?? "unknown"})`,
      );
    return { value: args.parser.parse(JSON.parse(raw)), usage };
  } catch (error) {
    if (usage.latency_ms === 0)
      usage = { ...usage, latency_ms: Date.now() - started };
    throw new StageCallError(args.stage, usage, error);
  }
}

export interface QualityContextUsage {
  target: string;
  claim: string;
  confidence: number;
  appropriateness: string;
}

export interface SocraticQualityMetrics {
  timestamp: string;
  success: boolean;
  failure_stage: StageName | null;
  sol_evidence: ModelUsageMetrics;
  deterministic_compute_latency_ms: number | null;
  luna_questioner: ModelUsageMetrics;
  terra_explanation: ModelUsageMetrics;
  luna_critic: ModelUsageMetrics;
  parallel_socratic_wall_latency_ms: number | null;
  sol_synthesis: ModelUsageMetrics;
  total_pipeline_latency_ms: number;
  total_calls: number;
  payloads: {
    socratic_packet_bytes: number;
    original_visual_evidence_bytes: number;
    computed_evidence_bytes: number;
    socratic_outputs_bytes: number;
    final_sol_total_input_tokens: number | null;
  };
  evidence: {
    numeric_facts: number;
    categorical_facts: number;
    structural_observations: number;
    relationships: number;
    computed_candidates: number;
    final_walkthrough_regions: number;
  };
  estimated_cost: {
    sol_evidence_usd: number | null;
    luna_questioner_usd: number | null;
    terra_explanation_usd: number | null;
    luna_critic_usd: number | null;
    sol_synthesis_usd: number | null;
    total_usd: number | null;
  };
}

export interface SocraticQualityResult {
  analysis: NoesisAnalysisResult;
  visualEvidence: VisualEvidence;
  computedEvidence: ComputedEvidence[];
  socraticPacket: SocraticQualityPacket;
  analystOutputs: {
    questioner: SocraticQuestionerOutput;
    explanation: ExplanationOutput;
    critic: CriticOutput;
  };
  synthesis: QualitySynthesisOutput;
  contextUsage: QualityContextUsage[];
  metrics: SocraticQualityMetrics;
}

export class SocraticQualityPipelineError extends Error {
  constructor(
    message: string,
    public readonly metrics: SocraticQualityMetrics,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SocraticQualityPipelineError";
  }
}

function textContent(value: unknown): ContentPart[] {
  return [{ type: "text", text: JSON.stringify(value) }];
}

export function mapQualitySynthesisToAnalysis(
  synthesis: QualitySynthesisOutput,
  evidence: VisualEvidence,
): { analysis: NoesisAnalysisResult; selectedSourceRegionIds: string[] } {
  const contextFieldsAreConsistent = (
    level: "visual" | "derived" | "contextual",
    claim: string | null,
    confidence: number | null,
    appropriateness: string | null,
  ): boolean =>
    level === "contextual"
      ? claim !== null && confidence !== null && appropriateness !== null
      : claim === null && confidence === null && appropriateness === null;
  if (
    !contextFieldsAreConsistent(
      synthesis.big_takeaway_evidence_level,
      synthesis.big_takeaway_contextual_claim,
      synthesis.big_takeaway_contextual_confidence,
      synthesis.big_takeaway_context_appropriateness,
    )
  ) {
    throw new Error("Inconsistent big-takeaway context provenance");
  }
  for (const step of synthesis.regions) {
    if (
      !contextFieldsAreConsistent(
        step.evidence_level,
        step.contextual_claim,
        step.contextual_confidence,
        step.context_appropriateness,
      )
    ) {
      throw new Error(
        `Inconsistent context provenance for step ${step.sequence_order}`,
      );
    }
  }
  const source = new Map(
    evidence.candidate_regions.map((region) => [region.id, region]),
  );
  const used = new Set<string>();
  const selectedSourceRegionIds = synthesis.regions.map((step) => {
    const candidates = [
      step.primary_source_region_id,
      ...step.alternate_source_region_ids,
    ];
    const selected = candidates.find((id) => source.has(id) && !used.has(id));
    if (!selected) {
      throw new Error(
        `No valid unique source region for step ${step.sequence_order}; candidates: ${candidates.join(", ")}`,
      );
    }
    used.add(selected);
    return selected;
  });
  const publicIds = new Map(
    selectedSourceRegionIds.map((id, index) => [id, String(index + 1)]),
  );
  const analysis = NoesisAnalysisSchema.parse({
    title: synthesis.title,
    image_type: synthesis.image_type,
    central_question: synthesis.central_question,
    overall_summary: synthesis.overall_summary,
    big_takeaway: synthesis.big_takeaway,
    regions: synthesis.regions.map((step, index) => {
      const sourceId = selectedSourceRegionIds[index]!;
      const region = source.get(sourceId)!;
      const x = Math.min(1, Math.max(0, region.x));
      const y = Math.min(1, Math.max(0, region.y));
      const width = Math.min(Math.min(1, Math.max(0, region.width)), 1 - x);
      const height = Math.min(Math.min(1, Math.max(0, region.height)), 1 - y);
      return {
        id: String(index + 1),
        label: step.label,
        x,
        y,
        width,
        height,
        sequence_order: index + 1,
        explanation: step.explanation,
        why_it_matters: step.why_it_matters,
        related_region_ids: step.related_source_region_ids
          .map((id) => publicIds.get(id))
          .filter(
            (id): id is string => id !== undefined && id !== String(index + 1),
          ),
        relationship_explanation: step.relationship_explanation,
        confidence: Math.min(
          1,
          Math.max(0, Math.min(step.confidence, region.confidence)),
        ),
      };
    }),
  });
  return { analysis, selectedSourceRegionIds };
}

function contextUsage(
  synthesis: QualitySynthesisOutput,
): QualityContextUsage[] {
  const usage: QualityContextUsage[] = [];
  if (
    synthesis.big_takeaway_evidence_level === "contextual" &&
    synthesis.big_takeaway_contextual_claim !== null &&
    synthesis.big_takeaway_contextual_confidence !== null &&
    synthesis.big_takeaway_context_appropriateness !== null
  ) {
    usage.push({
      target: "big_takeaway",
      claim: synthesis.big_takeaway_contextual_claim,
      confidence: synthesis.big_takeaway_contextual_confidence,
      appropriateness: synthesis.big_takeaway_context_appropriateness,
    });
  }
  synthesis.regions.forEach((region, index) => {
    if (
      region.evidence_level === "contextual" &&
      region.contextual_claim !== null &&
      region.contextual_confidence !== null &&
      region.context_appropriateness !== null
    ) {
      usage.push({
        target: `region_${index + 1}`,
        claim: region.contextual_claim,
        confidence: region.contextual_confidence,
        appropriateness: region.context_appropriateness,
      });
    }
  });
  return usage;
}

export async function runSocraticQualityPipeline(
  openai: OpenAIClient,
  imageDataUrl: string,
): Promise<SocraticQualityResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  let failureStage: StageName = "sol_evidence";
  let calls = 0;
  let solEvidence = emptyModelUsage(SOL, "low");
  let questionerUsage = emptyModelUsage(LUNA, "medium");
  let explanationUsage = emptyModelUsage(TERRA, "medium");
  let criticUsage = emptyModelUsage(LUNA, "medium");
  let synthesisUsage = emptyModelUsage(SOL, "high");
  let computeMs: number | null = null;
  let parallelMs: number | null = null;
  let evidence: VisualEvidence | null = null;
  let computed: ComputedEvidence[] = [];
  let packet: SocraticQualityPacket | null = null;
  let analystOutputBytes = 0;
  let finalRegions = 0;

  const metrics = (success: boolean): SocraticQualityMetrics => {
    const usages = [
      solEvidence,
      questionerUsage,
      explanationUsage,
      criticUsage,
      synthesisUsage,
    ];
    const costs = usages.map((usage) => estimateModelCost(usage).usd);
    return {
      timestamp,
      success,
      failure_stage: success ? null : failureStage,
      sol_evidence: solEvidence,
      deterministic_compute_latency_ms: computeMs,
      luna_questioner: questionerUsage,
      terra_explanation: explanationUsage,
      luna_critic: criticUsage,
      parallel_socratic_wall_latency_ms: parallelMs,
      sol_synthesis: synthesisUsage,
      total_pipeline_latency_ms: Date.now() - started,
      total_calls: calls,
      payloads: {
        socratic_packet_bytes: packet ? serializedBytes(packet) : 0,
        original_visual_evidence_bytes: evidence
          ? serializedBytes(evidence)
          : 0,
        computed_evidence_bytes: serializedBytes(computed),
        socratic_outputs_bytes: analystOutputBytes,
        final_sol_total_input_tokens: synthesisUsage.input_tokens,
      },
      evidence: {
        numeric_facts: evidence?.numeric_facts.length ?? 0,
        categorical_facts: evidence?.categorical_facts.length ?? 0,
        structural_observations: evidence?.structural_observations.length ?? 0,
        relationships: evidence?.relationships.length ?? 0,
        computed_candidates: computed.length,
        final_walkthrough_regions: finalRegions,
      },
      estimated_cost: {
        sol_evidence_usd: costs[0] ?? null,
        luna_questioner_usd: costs[1] ?? null,
        terra_explanation_usd: costs[2] ?? null,
        luna_critic_usd: costs[3] ?? null,
        sol_synthesis_usd: costs[4] ?? null,
        total_usd: costs.some((cost) => cost === null)
          ? null
          : (costs as number[]).reduce((sum, cost) => sum + cost, 0),
      },
    };
  };

  try {
    calls++;
    const evidenceResult = await structuredCall({
      openai,
      stage: "sol_evidence",
      model: SOL,
      effort: "low",
      maxTokens: 8000,
      prompt: V2_PASS1_PROMPT,
      userContent: [
        {
          type: "text",
          text: "Extract the structured visual evidence map from this image.",
        },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
      ],
      jsonSchema: VISUAL_EVIDENCE_JSON_SCHEMA,
      parser: VisualEvidence,
    });
    evidence = evidenceResult.value;
    solEvidence = evidenceResult.usage;

    failureStage = "deterministic_compute";
    const computeStarted = Date.now();
    computed = computeEvidence(evidence);
    computeMs = Date.now() - computeStarted;

    failureStage = "socratic_packet";
    packet = createSocraticQualityPacket(evidence, computed);

    const parallelStarted = Date.now();
    calls += 3;
    const analystCalls = [
      structuredCall({
        openai,
        stage: "luna_questioner",
        model: LUNA,
        effort: "medium",
        maxTokens: 5000,
        prompt: QUESTIONER_PROMPT,
        userContent: textContent(packet),
        jsonSchema: QUESTIONER_JSON_SCHEMA,
        parser: SocraticQuestionerOutput,
      }).then((result) => {
        questionerUsage = result.usage;
        return result;
      }),
      structuredCall({
        openai,
        stage: "terra_explanation",
        model: TERRA,
        effort: "medium",
        maxTokens: 5000,
        prompt: EXPLANATION_PROMPT,
        userContent: textContent(packet),
        jsonSchema: EXPLANATION_JSON_SCHEMA,
        parser: ExplanationOutput,
      }).then((result) => {
        explanationUsage = result.usage;
        return result;
      }),
      structuredCall({
        openai,
        stage: "luna_critic",
        model: LUNA,
        effort: "medium",
        maxTokens: 5000,
        prompt: CRITIC_PROMPT,
        userContent: textContent(packet),
        jsonSchema: CRITIC_JSON_SCHEMA,
        parser: CriticOutput,
      }).then((result) => {
        criticUsage = result.usage;
        return result;
      }),
    ] as const;
    const settled = await Promise.allSettled(analystCalls);
    parallelMs = Date.now() - parallelStarted;
    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;
    }
    const questioner = (
      settled[0] as PromiseFulfilledResult<
        StructuredCallResult<SocraticQuestionerOutput>
      >
    ).value;
    const explanation = (
      settled[1] as PromiseFulfilledResult<
        StructuredCallResult<ExplanationOutput>
      >
    ).value;
    const critic = (
      settled[2] as PromiseFulfilledResult<StructuredCallResult<CriticOutput>>
    ).value;
    const analystOutputs = {
      questioner: questioner.value,
      explanation: explanation.value,
      critic: critic.value,
    };
    analystOutputBytes = serializedBytes(analystOutputs);

    failureStage = "sol_synthesis";
    calls++;
    const synthesis = await structuredCall({
      openai,
      stage: "sol_synthesis",
      model: SOL,
      effort: "high",
      maxTokens: 16000,
      prompt: FINAL_PROMPT,
      userContent: [
        {
          type: "text",
          text: [
            "Create the final Noesis walkthrough from the original evidence and candidate reasoning below.",
            "",
            "ORIGINAL VISUAL EVIDENCE:",
            JSON.stringify(evidence),
            "",
            "ORIGINAL COMPUTED EVIDENCE:",
            JSON.stringify(computed),
            "",
            "SOCRATIC QUESTIONER OUTPUT:",
            JSON.stringify(questioner.value),
            "",
            "EXPLANATION / CONTEXT OUTPUT:",
            JSON.stringify(explanation.value),
            "",
            "INTELLECTUAL CRITIC OUTPUT:",
            JSON.stringify(critic.value),
          ].join("\n"),
        },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
      ],
      jsonSchema: FINAL_JSON_SCHEMA,
      parser: QualitySynthesisOutput,
    });
    synthesisUsage = synthesis.usage;

    failureStage = "final_mapping";
    const { analysis } = mapQualitySynthesisToAnalysis(
      synthesis.value,
      evidence,
    );
    finalRegions = analysis.regions.length;
    return {
      analysis,
      visualEvidence: evidence,
      computedEvidence: computed,
      socraticPacket: packet,
      analystOutputs,
      synthesis: synthesis.value,
      contextUsage: contextUsage(synthesis.value),
      metrics: metrics(true),
    };
  } catch (error) {
    if (error instanceof StageCallError) {
      failureStage = error.stage;
      if (error.stage === "sol_evidence") solEvidence = error.usage;
      if (error.stage === "luna_questioner") questionerUsage = error.usage;
      if (error.stage === "terra_explanation") explanationUsage = error.usage;
      if (error.stage === "luna_critic") criticUsage = error.usage;
      if (error.stage === "sol_synthesis") synthesisUsage = error.usage;
    }
    throw new SocraticQualityPipelineError(
      error instanceof Error
        ? error.message
        : "Socratic Quality V2 pipeline failed",
      metrics(false),
      { cause: error },
    );
  }
}

import { z } from "../artifacts/api-server/node_modules/zod";
import {
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
  compactEvidence,
  evidenceCompressionMetrics,
  type CompactEvidencePack,
} from "./compactEvidence";

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
  | "terra_evidence"
  | "deterministic_compute"
  | "compact_evidence"
  | "luna_so_what"
  | "luna_why_context"
  | "luna_skeptic"
  | "terra_synthesis";

const SoWhatOutput = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    observation: z.string(),
    so_what: z.string(),
    supporting_fact_ids: z.array(z.string()),
    supporting_computation_ids: z.array(z.string()),
    region_ids: z.array(z.string()),
    usefulness_score: z.number(),
    confidence: z.number(),
  })).max(8),
});

const WhyOutput = z.object({
  candidates: z.array(z.object({
    id: z.string(),
    classification: z.enum(["direct", "derived", "contextual"]),
    visible_pattern: z.string(),
    explanation: z.string(),
    consequence: z.string(),
    supporting_fact_ids: z.array(z.string()),
    supporting_computation_ids: z.array(z.string()),
    region_ids: z.array(z.string()),
    confidence: z.number(),
  })).max(8),
});

const SkepticOutput = z.object({
  strong_claims: z.array(z.string()),
  weak_claims: z.array(z.string()),
  forbidden_inferences: z.array(z.string()),
  high_value_evidence: z.array(z.string()),
  warnings: z.array(z.string()),
});

const SynthesisOutput = z.object({
  title: z.string(),
  image_type: z.string(),
  central_question: z.string(),
  overall_summary: z.string(),
  big_takeaway: z.string(),
  regions: z.array(z.object({
    source_region_id: z.string(),
    label: z.string(),
    sequence_order: z.number(),
    explanation: z.string(),
    why_it_matters: z.string(),
    related_source_region_ids: z.array(z.string()),
    relationship_explanation: z.string(),
    confidence: z.number(),
  })).min(4).max(6),
});

type SoWhatOutput = z.infer<typeof SoWhatOutput>;
type WhyOutput = z.infer<typeof WhyOutput>;
type SkepticOutput = z.infer<typeof SkepticOutput>;
type SynthesisOutput = z.infer<typeof SynthesisOutput>;

const insightItemProperties = {
  id: { type: "string" },
  observation: { type: "string" },
  so_what: { type: "string" },
  supporting_fact_ids: { type: "array", items: { type: "string" } },
  supporting_computation_ids: { type: "array", items: { type: "string" } },
  region_ids: { type: "array", items: { type: "string" } },
  usefulness_score: { type: "number" },
  confidence: { type: "number" },
};

const SO_WHAT_JSON_SCHEMA = {
  name: "socratic_so_what",
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
          required: Object.keys(insightItemProperties),
          properties: insightItemProperties,
        },
      },
    },
  },
} as const;

const WHY_JSON_SCHEMA = {
  name: "socratic_why_context",
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
          required: ["id", "classification", "visible_pattern", "explanation", "consequence", "supporting_fact_ids", "supporting_computation_ids", "region_ids", "confidence"],
          properties: {
            id: { type: "string" },
            classification: { type: "string", enum: ["direct", "derived", "contextual"] },
            visible_pattern: { type: "string" },
            explanation: { type: "string" },
            consequence: { type: "string" },
            supporting_fact_ids: { type: "array", items: { type: "string" } },
            supporting_computation_ids: { type: "array", items: { type: "string" } },
            region_ids: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
          },
        },
      },
    },
  },
} as const;

const SKEPTIC_JSON_SCHEMA = {
  name: "socratic_skeptic",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["strong_claims", "weak_claims", "forbidden_inferences", "high_value_evidence", "warnings"],
    properties: Object.fromEntries(
      ["strong_claims", "weak_claims", "forbidden_inferences", "high_value_evidence", "warnings"].map((key) => [key, { type: "array", items: { type: "string" }, maxItems: 8 }]),
    ),
  },
} as const;

const SYNTHESIS_JSON_SCHEMA = {
  name: "socratic_noesis_synthesis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "image_type", "central_question", "overall_summary", "big_takeaway", "regions"],
    properties: {
      title: { type: "string" },
      image_type: { type: "string" },
      central_question: { type: "string" },
      overall_summary: { type: "string" },
      big_takeaway: { type: "string" },
      regions: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["source_region_id", "label", "sequence_order", "explanation", "why_it_matters", "related_source_region_ids", "relationship_explanation", "confidence"],
          properties: {
            source_region_id: { type: "string" },
            label: { type: "string" },
            sequence_order: { type: "number" },
            explanation: { type: "string" },
            why_it_matters: { type: "string" },
            related_source_region_ids: { type: "array", items: { type: "string" } },
            relationship_explanation: { type: "string" },
            confidence: { type: "number" },
          },
        },
      },
    },
  },
} as const;

const EVIDENCE_PROMPT = `You are the evidence-mining layer for an experimental Noesis evaluation pipeline.

Inspect the supplied image and extract only what is actually visible. Do not generate final insights or polished teaching prose.

Identify the visual type, apparent purpose, overall structure, and meaningful candidate regions. Candidate regions own spatial grounding: provide normalized bounding boxes from 0 to 1 with origin at top-left.

Extract legible numeric facts with subject, value, unit, qualifier, context, region, comparison group, total status, and confidence. Extract categorical facts, structural observations, and explicit relationships with supporting fact ids.

Only facts explicitly framed as comparable may share a comparison_group. Never invent unreadable text, precise values, causal claims, or external knowledge. Prefer faithful evidence recall and useful spatial structure over prose.`;

const SO_WHAT_PROMPT = `You are the So-What analyst in a visual-understanding experiment. You receive only compact evidence extracted from an image.

Generate at most 8 candidate insights worth teaching. For each: state WHAT is observed and SO WHAT changes in the viewer's understanding. Prefer contrasts, ratios, asymmetry, hierarchy, concentration, divergence, thresholds, dependencies, exceptions, trade-offs, topology, and dominant contributors. Reject title restatements, formatting narration, and observations whose natural response is still "so what?". Use only supplied evidence ids and region ids. Return strict structured output.`;

const WHY_PROMPT = `You are the Why/Context analyst in a visual-understanding experiment. You receive only compact visual evidence.

Generate at most 8 concise explanations of why a visible pattern may exist, what mechanism or system structure explains it, and what consequence follows. Classify every candidate as direct (literally represented), derived (logical interpretation within the visual), or contextual (high-confidence background knowledge). Never imply that contextual knowledge is proven by the image. Avoid fragile precise facts, dates, uncertain context, and unsupported causality. Use only supplied evidence ids and region ids. Return strict structured output.`;

const SKEPTIC_PROMPT = `You are the independent skeptical analyst in a visual-understanding experiment. You receive only compact evidence.

Adversarially identify strong claims, tempting but unsupported claims, trivial observations, misleading comparisons, forbidden causal inferences, the highest-value evidence, contextual risks, and spatial/grounding warnings. Do not invent a final walkthrough. Return concise strict structured output.`;

const SYNTHESIS_PROMPT = `You are the final synthesizer in an experimental Noesis visual-understanding pipeline. You receive compact evidence plus three independent analyst outputs, but no image.

Reconcile the analysts and produce 4-6 teaching steps. Each substantive step should combine WHAT is visible, SO WHAT changes in understanding, WHY or what relationship/mechanism explains it, and concrete EVIDENCE. Reject weak claims and obey skeptic warnings. Contextual claims must be clearly qualified and never presented as image-proven facts.

Spatial rules are absolute: select source_region_id and related_source_region_ids only from the supplied Stage 1 regions. Never invent coordinates or region ids. Choose one primary region for a distant relationship and relate the others by id.

Field mapping: explanation = WHAT and where/how to read; why_it_matters = SO WHAT; relationship_explanation = WHY/mechanism/relationship with cautious context; big_takeaway = strongest system-level synthesis. Keep each prose field concise. Return strict structured output.`;

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
  effort: "low" | "medium";
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
    if (!raw) throw new Error(`Empty response (${response.choices[0]?.finish_reason ?? "unknown"})`);
    return { value: args.parser.parse(JSON.parse(raw)), usage };
  } catch (error) {
    if (usage.latency_ms === 0) usage = { ...usage, latency_ms: Date.now() - started };
    throw new StageCallError(args.stage, usage, error);
  }
}

export interface SocraticMetrics {
  timestamp: string;
  success: boolean;
  failure_stage: StageName | null;
  terra_evidence: ModelUsageMetrics;
  deterministic_compute_latency_ms: number | null;
  luna_so_what: ModelUsageMetrics;
  luna_why_context: ModelUsageMetrics;
  luna_skeptic: ModelUsageMetrics;
  parallel_luna_wall_latency_ms: number | null;
  terra_synthesis: ModelUsageMetrics;
  total_pipeline_latency_ms: number;
  total_calls: number;
  evidence: {
    full_evidence_bytes: number;
    compact_evidence_bytes: number;
    compression_ratio: number;
    numeric_facts: number;
    categorical_facts: number;
    structural_observations: number;
    relationships: number;
    computed_candidates: number;
    final_walkthrough_regions: number;
  };
  estimated_cost: {
    terra_evidence_usd: number | null;
    luna_so_what_usd: number | null;
    luna_why_context_usd: number | null;
    luna_skeptic_usd: number | null;
    terra_synthesis_usd: number | null;
    total_usd: number | null;
  };
}

export interface SocraticPipelineResult {
  analysis: NoesisAnalysisResult;
  visualEvidence: VisualEvidence;
  computedEvidence: ComputedEvidence[];
  compactEvidence: CompactEvidencePack;
  analystOutputs: {
    so_what: SoWhatOutput;
    why_context: WhyOutput;
    skeptic: SkepticOutput;
  };
  metrics: SocraticMetrics;
}

export class SocraticPipelineError extends Error {
  constructor(message: string, public readonly metrics: SocraticMetrics, options?: ErrorOptions) {
    super(message, options);
    this.name = "SocraticPipelineError";
  }
}

function textContent(value: unknown): ContentPart[] {
  return [{ type: "text", text: JSON.stringify(value) }];
}

function mapSynthesisToAnalysis(
  synthesis: SynthesisOutput,
  evidence: VisualEvidence,
): NoesisAnalysisResult {
  const source = new Map(evidence.candidate_regions.map((region) => [region.id, region]));
  const selectedIds = new Set<string>();
  for (const step of synthesis.regions) {
    if (!source.has(step.source_region_id)) throw new Error(`Unknown source region ${step.source_region_id}`);
    if (selectedIds.has(step.source_region_id)) throw new Error(`Duplicate source region ${step.source_region_id}`);
    selectedIds.add(step.source_region_id);
  }
  const publicIds = new Map(synthesis.regions.map((step, index) => [step.source_region_id, String(index + 1)]));
  return NoesisAnalysisSchema.parse({
    title: synthesis.title,
    image_type: synthesis.image_type,
    central_question: synthesis.central_question,
    overall_summary: synthesis.overall_summary,
    big_takeaway: synthesis.big_takeaway,
    regions: synthesis.regions.map((step, index) => {
      const region = source.get(step.source_region_id)!;
      return {
        id: String(index + 1),
        label: step.label,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        sequence_order: index + 1,
        explanation: step.explanation,
        why_it_matters: step.why_it_matters,
        related_region_ids: step.related_source_region_ids
          .map((id) => publicIds.get(id))
          .filter((id): id is string => id !== undefined && id !== String(index + 1)),
        relationship_explanation: step.relationship_explanation,
        confidence: Math.min(1, Math.max(0, Math.min(step.confidence, region.confidence))),
      };
    }),
  });
}

export async function runSocraticPipeline(
  openai: OpenAIClient,
  imageDataUrl: string,
): Promise<SocraticPipelineResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  let failureStage: StageName = "terra_evidence";
  let calls = 0;
  let terraEvidence = emptyModelUsage(TERRA, "low");
  let soWhatUsage = emptyModelUsage(LUNA, "medium");
  let whyUsage = emptyModelUsage(LUNA, "medium");
  let skepticUsage = emptyModelUsage(LUNA, "medium");
  let synthesisUsage = emptyModelUsage(TERRA, "medium");
  let computeMs: number | null = null;
  let parallelMs: number | null = null;
  let evidence: VisualEvidence | null = null;
  let computed: ComputedEvidence[] = [];
  let compact: CompactEvidencePack | null = null;
  let finalRegions = 0;

  const metrics = (success: boolean): SocraticMetrics => {
    const costs = [terraEvidence, soWhatUsage, whyUsage, skepticUsage, synthesisUsage].map(estimateModelCost);
    const values = costs.map((cost) => cost.usd);
    const compression = evidence && compact
      ? evidenceCompressionMetrics(evidence, computed, compact)
      : { full_evidence_bytes: 0, compact_evidence_bytes: 0, compression_ratio: 1 };
    return {
      timestamp,
      success,
      failure_stage: success ? null : failureStage,
      terra_evidence: terraEvidence,
      deterministic_compute_latency_ms: computeMs,
      luna_so_what: soWhatUsage,
      luna_why_context: whyUsage,
      luna_skeptic: skepticUsage,
      parallel_luna_wall_latency_ms: parallelMs,
      terra_synthesis: synthesisUsage,
      total_pipeline_latency_ms: Date.now() - started,
      total_calls: calls,
      evidence: {
        ...compression,
        numeric_facts: evidence?.numeric_facts.length ?? 0,
        categorical_facts: evidence?.categorical_facts.length ?? 0,
        structural_observations: evidence?.structural_observations.length ?? 0,
        relationships: evidence?.relationships.length ?? 0,
        computed_candidates: computed.length,
        final_walkthrough_regions: finalRegions,
      },
      estimated_cost: {
        terra_evidence_usd: values[0] ?? null,
        luna_so_what_usd: values[1] ?? null,
        luna_why_context_usd: values[2] ?? null,
        luna_skeptic_usd: values[3] ?? null,
        terra_synthesis_usd: values[4] ?? null,
        total_usd: values.some((value) => value === null)
          ? null
          : (values as number[]).reduce((sum, value) => sum + value, 0),
      },
    };
  };

  try {
    calls++;
    const evidenceResult = await structuredCall({
      openai,
      stage: "terra_evidence",
      model: TERRA,
      effort: "low",
      maxTokens: 8000,
      prompt: EVIDENCE_PROMPT,
      userContent: [
        { type: "text", text: "Extract the structured visual evidence map from this image." },
        { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
      ],
      jsonSchema: VISUAL_EVIDENCE_JSON_SCHEMA,
      parser: VisualEvidence,
    });
    evidence = evidenceResult.value;
    terraEvidence = evidenceResult.usage;

    failureStage = "deterministic_compute";
    const computeStarted = Date.now();
    computed = computeEvidence(evidence);
    computeMs = Date.now() - computeStarted;

    failureStage = "compact_evidence";
    compact = compactEvidence(evidence, computed);
    const compactText = JSON.stringify(compact);

    const parallelStarted = Date.now();
    calls += 3;
    const analystCalls = [
      structuredCall({ openai, stage: "luna_so_what", model: LUNA, effort: "medium", maxTokens: 5000, prompt: SO_WHAT_PROMPT, userContent: textContent(compact), jsonSchema: SO_WHAT_JSON_SCHEMA, parser: SoWhatOutput }).then((result) => { soWhatUsage = result.usage; return result; }),
      structuredCall({ openai, stage: "luna_why_context", model: LUNA, effort: "medium", maxTokens: 5000, prompt: WHY_PROMPT, userContent: textContent(compact), jsonSchema: WHY_JSON_SCHEMA, parser: WhyOutput }).then((result) => { whyUsage = result.usage; return result; }),
      structuredCall({ openai, stage: "luna_skeptic", model: LUNA, effort: "medium", maxTokens: 5000, prompt: SKEPTIC_PROMPT, userContent: textContent(compact), jsonSchema: SKEPTIC_JSON_SCHEMA, parser: SkepticOutput }).then((result) => { skepticUsage = result.usage; return result; }),
    ] as const;
    const settled = await Promise.allSettled(analystCalls);
    parallelMs = Date.now() - parallelStarted;
    for (const result of settled) {
      if (result.status === "rejected") throw result.reason;
    }
    const soWhat = (settled[0] as PromiseFulfilledResult<StructuredCallResult<SoWhatOutput>>).value;
    const why = (settled[1] as PromiseFulfilledResult<StructuredCallResult<WhyOutput>>).value;
    const skeptic = (settled[2] as PromiseFulfilledResult<StructuredCallResult<SkepticOutput>>).value;

    failureStage = "terra_synthesis";
    calls++;
    const synthesis = await structuredCall({
      openai,
      stage: "terra_synthesis",
      model: TERRA,
      effort: "medium",
      maxTokens: 8000,
      prompt: SYNTHESIS_PROMPT,
      userContent: textContent({
        compact_evidence: compact,
        so_what_analyst: soWhat.value,
        why_context_analyst: why.value,
        skeptic: skeptic.value,
      }),
      jsonSchema: SYNTHESIS_JSON_SCHEMA,
      parser: SynthesisOutput,
    });
    synthesisUsage = synthesis.usage;
    const analysis = mapSynthesisToAnalysis(synthesis.value, evidence);
    finalRegions = analysis.regions.length;
    return {
      analysis,
      visualEvidence: evidence,
      computedEvidence: computed,
      compactEvidence: compact,
      analystOutputs: {
        so_what: soWhat.value,
        why_context: why.value,
        skeptic: skeptic.value,
      },
      metrics: metrics(true),
    };
  } catch (error) {
    if (error instanceof StageCallError) {
      failureStage = error.stage;
      if (error.stage === "terra_evidence") terraEvidence = error.usage;
      if (error.stage === "luna_so_what") soWhatUsage = error.usage;
      if (error.stage === "luna_why_context") whyUsage = error.usage;
      if (error.stage === "luna_skeptic") skepticUsage = error.usage;
      if (error.stage === "terra_synthesis") synthesisUsage = error.usage;
    }
    throw new SocraticPipelineError(
      error instanceof Error ? error.message : "Socratic pipeline failed",
      metrics(false),
      { cause: error },
    );
  }
}

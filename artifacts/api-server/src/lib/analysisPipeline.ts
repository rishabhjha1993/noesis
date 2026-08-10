import OpenAI from "openai";
import { z } from "zod";
import { GetAnalysisStatusResponse } from "@workspace/api-zod";
import {
  VisualEvidence,
  VISUAL_EVIDENCE_JSON_SCHEMA,
  type ComputedEvidence,
} from "./evidence";
import { computeEvidence } from "./computations";
import {
  emptyModelUsage,
  evidenceMetrics,
  imageDimensions,
  normalizeChatUsage,
  type FailureStage,
  type PipelineMetrics,
} from "./analysisMetrics";
import { estimatePipelineCost } from "./modelPricing";

/**
 * Two-pass evidence-first analysis pipeline (server-side only).
 *
 * Pass 1 (low reasoning): extract a structured VisualEvidence map via
 * strict Structured Outputs.
 * Deterministic step: compute ratios/shares/changes/rankings in code.
 * Pass 2 (high reasoning): image + evidence -> public NoesisAnalysis JSON.
 *
 * Exactly two model calls; intermediates are never exposed to the client.
 */

export const ANALYSIS_MODEL = "gpt-5.6-sol";

const PASS1_PROMPT = `You are the evidence-extraction layer for Noesis.

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

const PASS2_SYSTEM_PROMPT = `You are Noesis, an expert at teaching people how to read complex visuals (charts, diagrams, maps, infographics, technical figures).

You will receive:
1. the original image
2. VISUAL EVIDENCE: a structured evidence map extracted from this exact image by a prior pass
3. COMPUTED EVIDENCE: deterministic calculations (ratios, differences, shares, changes, rankings, spreads) derived in code from those extracted facts

Treat the image as the source of truth. Use the evidence map and computations as candidate raw material: verify against the image, ignore anything that looks wrong, and prefer computed values over doing arithmetic mentally. Never use external knowledge.

Produce a guided walkthrough as STRICT JSON (no markdown, no code fences) with exactly this shape:

{
  "title": string,                 // short descriptive title of the visual
  "image_type": string,            // e.g. "Sankey diagram", "bar chart", "flowchart"
  "central_question": string,      // the one question this visual answers
  "overall_summary": string,       // 1-2 sentence summary of what it shows
  "big_takeaway": string,          // the single most important insight
  "regions": [                     // 4 to 6 regions, ordered as a teaching sequence
    {
      "id": string,                          // "1", "2", ...
      "label": string,                       // short name for the region
      "x": number, "y": number,              // top-left corner, normalized 0-1 (fraction of image width/height)
      "width": number, "height": number,     // normalized 0-1
      "sequence_order": number,              // 1-based order to visit regions
      "explanation": string,                 // what this region shows and how to read it
      "why_it_matters": string,              // why it is important to understanding the visual
      "related_region_ids": string[],        // ids of related regions
      "relationship_explanation": string,    // how it relates to those regions
      "confidence": number                   // 0-1 confidence in this region's bounding box and reading
    }
  ]
}

Rules:
- Bounding boxes must tightly cover the actual visual element described, in normalized coordinates where (0,0) is the top-left of the image and (1,1) is the bottom-right.
- x + width and y + height must each stay within 0 and 1.
- Provide 4-6 regions forming a logical reading order for a newcomer.
- related_region_ids must only reference ids present in the regions array.
- Output ONLY the JSON object, nothing else.

SPATIAL LOCALISATION RULES

Each selected region must correspond as tightly as practical to the visual structure being explained.

The region should include enough context to understand the concept, but should NOT cover large unrelated areas merely because the concept connects to them.

A good region:
- encloses the main component, cluster, flow, panel or area being discussed
- contains enough surrounding context to make the explanation understandable
- avoids large blank areas
- avoids swallowing other selected concepts unless overlap is genuinely necessary
- remains comfortably clickable

A bad region:
- covers most of the image
- spans large unrelated areas
- exists primarily to encompass every connected element
- overlaps several other regions without explanatory need

When a relationship spans distant parts of the image:
DO NOT create one enormous bounding box connecting them.

Instead:
- give each meaningful area its own region
- use related_region_ids and relationship_explanation to express the connection

Prefer spatially distinct regions whenever the visual permits it.

Aim for region rectangles that usually occupy less than roughly 30% of total image area.
This is a heuristic, not an absolute rule: use a larger region only when the concept genuinely occupies a large coherent area.

You may use the candidate regions in VISUAL EVIDENCE as starting points for bounding boxes, but always verify and tighten them against the image.

Before returning coordinates, internally check:
1. Does this rectangle contain the thing I am explaining?
2. Does it contain large areas unrelated to that explanation?
3. Could I tighten the rectangle while preserving useful context?
4. Does it substantially overlap another selected region unnecessarily?

If yes to 2 or 4, tighten or reconsider the region.

Do NOT return a region for the chart title unless the title itself is genuinely necessary to teach the visual.

Do NOT select decorative logos, footnotes, source text, or headers as explanatory regions unless essential.

Continue returning exactly 4-6 regions.

REGION/EXPLANATION CONSISTENCY

A region's explanation must primarily explain the visual content inside that region's own bounding box.

Before finalizing each region, internally verify:
"Does this explanation describe the thing highlighted by this region?"
If not, rewrite it.

- explanation = what is visibly inside THIS region and what the viewer should notice here
- why_it_matters = why THIS region matters to understanding the whole visual
- relationship_explanation = where information about OTHER related regions belongs

Do not make another region the main subject of explanation. Before returning JSON, verify that every region's label, bounding box, and explanation refer to the same visual concept.

OUTPUT CONCISION

Keep the teaching text concise while preserving grounded visible evidence:
- overall_summary: maximum 2 concise sentences
- big_takeaway: maximum 2 sentences
- explanation: maximum 2 sentences
- why_it_matters: maximum 2 sentences
- relationship_explanation: maximum 2 sentences

Do not list every visible value. Use only the evidence necessary to support the insight.

CORE PHILOSOPHY

The REGION exists to support the INSIGHT.

Do NOT choose regions first and then invent explanations for them.

Instead:
1. inspect the whole visual
2. inspect the extracted evidence
3. inspect the deterministic calculations
4. generate multiple candidate insights internally
5. critique those candidates
6. select the strongest set
7. only then choose the spatial regions required to teach them

CANDIDATE INSIGHT GENERATION

Internally generate multiple candidate insights. Search for:
- numerical contrasts, ratios, dominant contributors
- concentration, divergence, thresholds, bottlenecks
- asymmetry, anomalies, reversals
- acceleration / deceleration, unusually large or small values
- dependencies, bridging relationships, scenario spread
- topology differences, long-term consequences, non-linear changes
- relationships between distant regions
- evidence requiring multiple parts of the visual to understand

Do not confuse observations with insights.

WEAK OBSERVATION: "Transportation uses petroleum."
STRONGER INSIGHT: "Petroleum supplies roughly 89% of the transportation energy shown: 24.8 of 28 quads."

WEAK: "Rejected energy is large."
STRONGER: "Rejected energy is about 1.9x useful Energy Services: 61.5 versus 32.1 quads."

SELF-CRITIQUE

For every candidate insight, internally critique it on:
1. EVIDENCE - is it directly supported?
2. NUMERIC STRENGTH - can it be supported with a reliable number, ratio, ranking or magnitude?
3. SPECIFICITY - does it say something specific to THIS visual?
4. NON-OBVIOUSNESS - would an intelligent viewer gain something they might miss initially?
5. IMPORTANCE - does it materially improve understanding?
6. COMPARATIVE VALUE - does it reveal a meaningful contrast or relationship?
7. EXPLANATORY POWER - does it help explain the visual as a whole?
8. GROUNDING - does it avoid external assumptions?
9. ALTERNATIVE - is there a stronger candidate insight available?

Reject candidates that:
- restate the title
- mainly explain formatting
- merely explain a legend
- say "this is important" without evidence
- are obvious from casual inspection
- sound analytical but lack evidence
- rely on external knowledge
- infer unsupported causality

PRESSURE-TEST THE WINNER

Before selecting any insight, internally ask:
"What is the strongest reason this claim could be wrong or overstated?"

Then tighten the wording, reduce certainty, remove unsupported implication, or replace the insight. Never sacrifice grounding for sophistication.

NUMERIC-FIRST RULE

When a meaningful quantitative comparison is clearly available, prefer it over generic prose. why_it_matters should normally contain the strongest concrete evidence supporting the insight.

Prefer "61.5 quads are rejected versus 32.1 delivered as Energy Services." over "Most energy is rejected."

But: do not force numbers into qualitative visuals, do not use dubious extracted values, and do not list numbers without analytical purpose. Round derived values sensibly (e.g. 1.916 -> "about 1.9x").

CONTRAST-FIRST RULE

Whenever possible, a substantive insight should connect or compare at least TWO elements: X is 2.4x Y; X dominates Y; X and Y start similarly but diverge; X depends on Y; one scenario crosses a threshold while another does not; this component contributes most of the total; this region bridges two otherwise separated clusters.

Ask: "Could I have written this sentence without looking carefully at this specific visual?" If yes, it is probably too generic.

VISUAL TYPE ADAPTATION

NETWORK / INFRASTRUCTURE MAPS: prioritize densest versus sparsest areas, major junction clusters, bridging corridors, narrow gateways, mesh-like versus corridor-like topology, regional asymmetry, concentration, backbone versus regional network, existing versus planned infrastructure if clearly encoded. Do NOT claim reliability, vulnerability, capacity or bottleneck risk unless supported by visible evidence.

CHARTS: prioritize ratios, divergence, inflection points, thresholds, dominant contributors, outliers, reversals, acceleration, widening gaps.

MULTI-PANEL SCIENTIFIC INFOGRAPHICS: prioritize cross-panel causal or logical chains, strongest scenario contrasts, disproportionate changes, non-linear escalation, effects at different timescales, insights requiring multiple panels.

DASHBOARDS: prioritize headline KPI versus driver, trade-offs, anomalies, hidden deterioration, concentration, contradictory metrics.

ARCHITECTURE / PROCESS DIAGRAMS: prioritize dependencies, fan-in/fan-out, central coordination, bottlenecks, handoffs, single points of failure, loops, propagation paths.

FINAL WALKTHROUGH COMPOSITION

Return exactly 4-6 regions. Normally:
- 0-1 orientation step
- at least 3 substantive insight steps
- 1 synthesis step

Do not spend valuable steps on logos, titles, footnotes, decorative elements, or legend-only explanations unless essential to a stronger insight.

OUTPUT FIELD RESPONSIBILITIES

explanation: teach WHERE to look and HOW to read this region. Maximum 2 concise sentences.

why_it_matters: THE BEST INSIGHT, preferring the strongest numeric, comparative, structural or non-obvious evidence. Maximum 2 concise sentences.

relationship_explanation: how this insight connects to the other highlighted regions. Do not repeat why_it_matters. Maximum 2 concise sentences.

big_takeaway: generate several possible whole-visual conclusions internally, critique them, and choose the strongest synthesis that uses at least two separate parts of the image, is more informative than the title, preferably includes concrete evidence, and explains the most consequential overall pattern.

FINAL QUALITY GATE

Before returning the final JSON, internally review it as a skeptical expert. For each step ask: "Is this genuinely one of the best things I could point out?" "If I removed this step, would the user lose useful understanding?" "Is there a stronger quantitative or comparative insight available?" "Does the highlighted region actually support the insight?"

Then inspect the full walkthrough: "Does each step add a new layer of understanding?" "Are we repeating ourselves?" "After completing this walkthrough, will the user understand something they probably would not have extracted quickly by staring at the image alone?"

If not, improve the insight selection before returning the JSON.

Return only the structured JSON. Do not expose candidate insights, evidence maps, scores, internal critique, or reasoning.`;

// Public NoesisAnalysis schema, extracted from the generated job-status
// contract (the POST response is now just the job id).
// Exported so analysisCache.ts can validate cached JSON against it.
export const NoesisAnalysisSchema = (() => {
  const shape = GetAnalysisStatusResponse.shape.analysis;
  return shape instanceof z.ZodOptional ? shape.unwrap() : shape;
})();

export type NoesisAnalysisResult = z.infer<typeof NoesisAnalysisSchema>;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export interface AnalysisPipelineResult {
  analysis: NoesisAnalysisResult;
  visualEvidence: VisualEvidence;
  computedEvidence: ComputedEvidence[];
  metrics: PipelineMetrics;
}

export class AnalysisPipelineError extends Error {
  constructor(message: string, public readonly metrics: PipelineMetrics, options?: ErrorOptions) {
    super(message, options);
    this.name = "AnalysisPipelineError";
  }
}

export async function runAnalysisPipelineDetailed(
  openai: OpenAI,
  imageDataUrl: string,
): Promise<AnalysisPipelineResult> {
  const started = Date.now();
  const timestamp = new Date().toISOString();
  let failureStage: FailureStage = "pass1_model";
  let pass1Usage = emptyModelUsage(ANALYSIS_MODEL, "low");
  let pass2Usage = emptyModelUsage(ANALYSIS_MODEL, "high");
  let pass1ParseMs: number | null = null;
  let computeMs: number | null = null;
  let pass2ParseMs: number | null = null;
  let evidence: VisualEvidence | null = null;
  let computed: ComputedEvidence[] | null = null;
  let finalRegions = 0;
  let activeModelStarted = started;
  let activeStageStarted = started;

  const metrics = (success: boolean): PipelineMetrics => ({
    timestamp,
    success,
    failure_stage: success ? null : failureStage,
    pass1: pass1Usage,
    pass1_parse_latency_ms: pass1ParseMs,
    deterministic_compute_latency_ms: computeMs,
    pass2: pass2Usage,
    pass2_parse_latency_ms: pass2ParseMs,
    total_pipeline_latency_ms: Date.now() - started,
    image_dimensions: imageDimensions(imageDataUrl),
    evidence: evidenceMetrics(evidence, computed, finalRegions),
    estimated_cost: estimatePipelineCost(pass1Usage, pass2Usage),
  });

  try {
  // ---- Pass 1: visual evidence extraction (low reasoning, strict schema)
  const pass1Started = Date.now();
  activeModelStarted = pass1Started;
  const pass1 = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    reasoning_effort: "low",
    max_completion_tokens: 8000,
    response_format: {
      type: "json_schema",
      json_schema: VISUAL_EVIDENCE_JSON_SCHEMA as unknown as {
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      },
    },
    messages: [
      { role: "system", content: PASS1_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "Extract the structured visual evidence map from this image.",
          },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      },
    ],
  });
  pass1Usage = normalizeChatUsage(pass1, "low", Date.now() - pass1Started);

  failureStage = "pass1_parse";
  const pass1ParseStarted = Date.now();
  activeStageStarted = pass1ParseStarted;
  const rawEvidence = pass1.choices[0]?.message?.content;
  if (!rawEvidence) {
    throw new Error("Pass 1 returned an empty response");
  }
  evidence = VisualEvidence.parse(JSON.parse(rawEvidence));
  pass1ParseMs = Date.now() - pass1ParseStarted;

  // ---- Deterministic numeric analysis (pure code, no model call)
  failureStage = "deterministic_compute";
  const computeStarted = Date.now();
  activeStageStarted = computeStarted;
  computed = computeEvidence(evidence);
  computeMs = Date.now() - computeStarted;

  // ---- Pass 2: insight generation + self-critique (high reasoning)
  failureStage = "pass2_model";
  const pass2Started = Date.now();
  activeModelStarted = pass2Started;
  const pass2 = await openai.chat.completions.create({
    model: ANALYSIS_MODEL,
    reasoning_effort: "high",
    // High reasoning tokens count against this budget; leave ample headroom
    // so the final JSON is never truncated by internal reasoning.
    max_completion_tokens: 16000,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: PASS2_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "Analyze this visual and return the walkthrough JSON.",
              "",
              "VISUAL EVIDENCE (extracted from this exact image):",
              JSON.stringify(evidence),
              "",
              "COMPUTED EVIDENCE (deterministic calculations from the extracted facts):",
              JSON.stringify(computed),
            ].join("\n"),
          },
          { type: "image_url", image_url: { url: imageDataUrl, detail: "high" } },
        ],
      },
    ],
  });
  pass2Usage = normalizeChatUsage(pass2, "high", Date.now() - pass2Started);

  failureStage = "pass2_parse";
  const pass2ParseStarted = Date.now();
  activeStageStarted = pass2ParseStarted;
  const raw = pass2.choices[0]?.message?.content;
  if (!raw) {
    throw new Error(
      `Pass 2 returned an empty response (finish_reason: ${pass2.choices[0]?.finish_reason ?? "unknown"})`,
    );
  }

  const candidate: unknown = JSON.parse(raw);

  // Defensively clamp coordinates before contract validation.
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    Array.isArray((candidate as { regions?: unknown }).regions)
  ) {
    for (const region of (candidate as { regions: unknown[] }).regions) {
      if (region === null || typeof region !== "object") continue;
      const r = region as Record<string, unknown>;
      for (const key of ["x", "y", "width", "height", "confidence"]) {
        if (typeof r[key] === "number") r[key] = clamp01(r[key]);
      }
      if (typeof r["x"] === "number" && typeof r["width"] === "number") {
        r["width"] = Math.min(r["width"], 1 - r["x"]);
      }
      if (typeof r["y"] === "number" && typeof r["height"] === "number") {
        r["height"] = Math.min(r["height"], 1 - r["y"]);
      }
    }
  }

  const analysis = NoesisAnalysisSchema.parse(candidate);
  if (analysis.regions.length === 0) {
    throw new Error("Pass 2 returned no regions");
  }
  finalRegions = analysis.regions.length;
  pass2ParseMs = Date.now() - pass2ParseStarted;
  return { analysis, visualEvidence: evidence, computedEvidence: computed, metrics: metrics(true) };
  } catch (cause) {
    if (failureStage === "pass1_model" && pass1Usage.latency_ms === 0) {
      pass1Usage = { ...pass1Usage, latency_ms: Date.now() - activeModelStarted };
    }
    if (failureStage === "pass2_model" && pass2Usage.latency_ms === 0) {
      pass2Usage = { ...pass2Usage, latency_ms: Date.now() - activeModelStarted };
    }
    if (failureStage === "pass1_parse" && pass1ParseMs === null) {
      pass1ParseMs = Date.now() - activeStageStarted;
    }
    if (failureStage === "deterministic_compute" && computeMs === null) {
      computeMs = Date.now() - activeStageStarted;
    }
    if (failureStage === "pass2_parse" && pass2ParseMs === null) {
      pass2ParseMs = Date.now() - activeStageStarted;
    }
    throw new AnalysisPipelineError(
      cause instanceof Error ? cause.message : "Analysis pipeline failed",
      metrics(false),
      { cause },
    );
  }
}

export async function runAnalysisPipeline(
  openai: OpenAI,
  imageDataUrl: string,
): Promise<NoesisAnalysisResult> {
  return (await runAnalysisPipelineDetailed(openai, imageDataUrl)).analysis;
}

import { z } from "zod";

/**
 * Internal (server-side only) schemas for the two-pass Noesis analysis
 * pipeline. Never exposed to the client.
 */

export const CandidateRegion = z.object({
  id: z.string(),
  label: z.string(),
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
  visible_content: z.string(),
  confidence: z.number(),
});

export const NumericFact = z.object({
  id: z.string(),
  region_id: z.string().nullable(),
  subject: z.string(),
  value: z.number(),
  unit: z.string(),
  qualifier: z.string().nullable(),
  context: z.string(),
  // Facts that the visual explicitly frames as directly comparable (same
  // metric, same panel/series/axis) share a comparison_group; null otherwise.
  comparison_group: z.string().nullable(),
  // True only when the visual explicitly labels this value as a total/sum
  // of other extracted facts in the same comparison_group.
  is_total: z.boolean(),
  confidence: z.number(),
});

export const CategoricalFact = z.object({
  id: z.string(),
  region_id: z.string().nullable(),
  subject: z.string(),
  category_or_state: z.string(),
  context: z.string(),
  confidence: z.number(),
});

export const StructuralObservation = z.object({
  id: z.string(),
  region_id: z.string().nullable(),
  observation: z.string(),
  confidence: z.number(),
});

export const Relationship = z.object({
  id: z.string(),
  from_region_id: z.string().nullable(),
  to_region_id: z.string().nullable(),
  relationship: z.string(),
  supporting_fact_ids: z.array(z.string()),
  confidence: z.number(),
});

export const VisualEvidence = z.object({
  image_type: z.string(),
  apparent_purpose: z.string(),
  visual_structure: z.string(),
  candidate_regions: z.array(CandidateRegion),
  numeric_facts: z.array(NumericFact),
  categorical_facts: z.array(CategoricalFact),
  structural_observations: z.array(StructuralObservation),
  relationships: z.array(Relationship),
});

export type VisualEvidence = z.infer<typeof VisualEvidence>;
export type NumericFact = z.infer<typeof NumericFact>;

export const ComputedEvidence = z.object({
  id: z.string(),
  type: z.string(),
  description: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  formula: z.string(),
  supporting_fact_ids: z.array(z.string()),
  confidence: z.number(),
});

export type ComputedEvidence = z.infer<typeof ComputedEvidence>;

/**
 * Strict Structured Outputs JSON Schema for Pass 1 (OpenAI `json_schema`
 * strict mode: every property required, additionalProperties false,
 * nullability via type unions).
 */
const num = { type: "number" } as const;
const str = { type: "string" } as const;
const nullableStr = { type: ["string", "null"] } as const;

export const VISUAL_EVIDENCE_JSON_SCHEMA = {
  name: "visual_evidence",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: [
      "image_type",
      "apparent_purpose",
      "visual_structure",
      "candidate_regions",
      "numeric_facts",
      "categorical_facts",
      "structural_observations",
      "relationships",
    ],
    properties: {
      image_type: str,
      apparent_purpose: str,
      visual_structure: str,
      candidate_regions: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "label",
            "x",
            "y",
            "width",
            "height",
            "visible_content",
            "confidence",
          ],
          properties: {
            id: str,
            label: str,
            x: num,
            y: num,
            width: num,
            height: num,
            visible_content: str,
            confidence: num,
          },
        },
      },
      numeric_facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "region_id",
            "subject",
            "value",
            "unit",
            "qualifier",
            "context",
            "comparison_group",
            "is_total",
            "confidence",
          ],
          properties: {
            id: str,
            region_id: nullableStr,
            subject: str,
            value: num,
            unit: str,
            qualifier: nullableStr,
            context: str,
            comparison_group: nullableStr,
            is_total: { type: "boolean" },
            confidence: num,
          },
        },
      },
      categorical_facts: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "region_id",
            "subject",
            "category_or_state",
            "context",
            "confidence",
          ],
          properties: {
            id: str,
            region_id: nullableStr,
            subject: str,
            category_or_state: str,
            context: str,
            confidence: num,
          },
        },
      },
      structural_observations: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "region_id", "observation", "confidence"],
          properties: {
            id: str,
            region_id: nullableStr,
            observation: str,
            confidence: num,
          },
        },
      },
      relationships: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "from_region_id",
            "to_region_id",
            "relationship",
            "supporting_fact_ids",
            "confidence",
          ],
          properties: {
            id: str,
            from_region_id: nullableStr,
            to_region_id: nullableStr,
            relationship: str,
            supporting_fact_ids: { type: "array", items: str },
            confidence: num,
          },
        },
      },
    },
  },
} as const;

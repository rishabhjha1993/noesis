import { z } from "zod";

const NonEmptyText = z.string().trim().min(1);
const HttpUrl = z
  .string()
  .url()
  .refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  }, "Source URL must use http or https");

export const DiscoveryRegionSchema = z
  .object({
    id: NonEmptyText,
    description: NonEmptyText,
    scope: z.enum(["local", "global"]),
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    width: z.number().positive().max(1),
    height: z.number().positive().max(1),
  })
  .strict()
  .superRefine((region, context) => {
    if (region.x + region.width > 1 || region.y + region.height > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Region bounds must remain within the normalized image",
      });
    }
    if (
      region.scope === "global" &&
      (region.x !== 0 ||
        region.y !== 0 ||
        region.width !== 1 ||
        region.height !== 1)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Global regions must explicitly cover the full image",
      });
    }
  });

export const DiscoveryCandidateSchema = z
  .object({
    id: NonEmptyText,
    question_id: NonEmptyText,
    visual_trigger: NonEmptyText,
    observation: NonEmptyText,
    region_ids: z.array(NonEmptyText).min(1),
    investigation_question: NonEmptyText,
    research_needed: z.boolean(),
    research_rationale: z.string(),
  })
  .strict();

export const DiscoveryStage1Schema = z
  .object({
    image_summary: NonEmptyText,
    regions: z.array(DiscoveryRegionSchema).min(1).max(12),
    candidates: z.array(DiscoveryCandidateSchema).max(8),
  })
  .strict()
  .superRefine((stage1, context) => {
    const regionIds = new Set<string>();
    for (const region of stage1.regions) {
      if (regionIds.has(region.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate region id: ${region.id}`,
        });
      }
      regionIds.add(region.id);
    }

    const candidateIds = new Set<string>();
    const questionIds = new Set<string>();
    for (const candidate of stage1.candidates) {
      if (candidateIds.has(candidate.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate candidate id: ${candidate.id}`,
        });
      }
      if (questionIds.has(candidate.question_id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate question id: ${candidate.question_id}`,
        });
      }
      candidateIds.add(candidate.id);
      questionIds.add(candidate.question_id);
      for (const regionId of candidate.region_ids) {
        if (!regionIds.has(regionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Candidate ${candidate.id} references unknown region ${regionId}`,
          });
        }
      }
    }
  });

export const DiscoverySourceSchema = z
  .object({
    title: NonEmptyText,
    url: HttpUrl,
  })
  .strict();

export const DiscoveryResearchResultSchema = z
  .object({
    candidate_id: NonEmptyText,
    question_id: NonEmptyText,
    question: NonEmptyText,
    status: z.enum(["answered", "insufficient"]),
    finding: NonEmptyText,
    sources: z.array(DiscoverySourceSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "answered" && result.sources.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Answered research must include at least one validated citation",
      });
    }
  });

const DiscoveryProvenanceSchema = z.enum([
  "seen",
  "calculated",
  "derived",
  "researched",
]);

const DiscoveryFields = {
  id: NonEmptyText,
  type: z.enum(["local", "relational", "global"]),
  title: NonEmptyText,
  visual_trigger: NonEmptyText,
  observation: NonEmptyText,
  discovery: NonEmptyText,
  why_it_matters: NonEmptyText,
  explanation: NonEmptyText,
  reinterpretation: NonEmptyText,
  region_ids: z.array(NonEmptyText).min(1),
  provenance: DiscoveryProvenanceSchema,
  confidence: z.number().min(0).max(1),
  sources: z.array(DiscoverySourceSchema),
};

export const DiscoverySchema = z.object(DiscoveryFields).strict();

export const DiscoveryDraftSchema = z
  .object({
    ...DiscoveryFields,
    candidate_ids: z.array(NonEmptyText).min(1),
  })
  .strict();

export const DiscoveryStage3Schema = z
  .object({
    discoveries: z.array(DiscoveryDraftSchema).max(5),
  })
  .strict();

export type DiscoveryRegion = z.infer<typeof DiscoveryRegionSchema>;
export type DiscoveryCandidate = z.infer<typeof DiscoveryCandidateSchema>;
export type DiscoveryStage1 = z.infer<typeof DiscoveryStage1Schema>;
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;
export type DiscoveryResearchResult = z.infer<
  typeof DiscoveryResearchResultSchema
>;
export type Discovery = z.infer<typeof DiscoverySchema>;
export type DiscoveryDraft = z.infer<typeof DiscoveryDraftSchema>;

export interface DiscoveryInspection {
  stage1: DiscoveryStage1;
  research_results: DiscoveryResearchResult[];
  discovery_candidates: Record<string, string[]>;
}

export interface ValidatedDiscoveries {
  discoveries: Discovery[];
  discoveryCandidates: Record<string, string[]>;
}

export interface ResearchGateDecision {
  allowed: boolean;
  reasons: string[];
}

export function evaluateResearchGate(
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
): ResearchGateDecision {
  const reasons: string[] = [];
  const knownCandidate = stage1.candidates.find(
    (item) => item.id === candidate.id,
  );
  const regionIds = new Set(stage1.regions.map((region) => region.id));

  if (!knownCandidate || knownCandidate.question_id !== candidate.question_id) {
    reasons.push("candidate_not_generated_by_stage1");
  }
  if (candidate.visual_trigger.trim().length < 12) {
    reasons.push("missing_specific_visual_trigger");
  }
  if (
    candidate.region_ids.length === 0 ||
    candidate.region_ids.some((regionId) => !regionIds.has(regionId))
  ) {
    reasons.push("invalid_region_reference");
  }
  if (!candidate.research_needed) {
    reasons.push("research_not_requested");
  }
  if (candidate.investigation_question.trim().length < 12) {
    reasons.push("missing_investigation_question");
  }
  if (candidate.research_rationale.trim().length < 12) {
    reasons.push("research_would_not_materially_deepen_interpretation");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function validateResearchResults(
  stage1: DiscoveryStage1,
  input: unknown,
): DiscoveryResearchResult[] {
  const parsed = z.array(DiscoveryResearchResultSchema).parse(input);
  const candidates = new Map(
    stage1.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const seenCandidates = new Set<string>();

  for (const result of parsed) {
    const candidate = candidates.get(result.candidate_id);
    if (!candidate) {
      throw new Error(
        `Research result references unknown candidate ${result.candidate_id}`,
      );
    }
    if (
      result.question_id !== candidate.question_id ||
      result.question !== candidate.investigation_question
    ) {
      throw new Error(
        `Research result question does not match candidate ${result.candidate_id}`,
      );
    }
    if (seenCandidates.has(result.candidate_id)) {
      throw new Error(
        `Duplicate research result for candidate ${result.candidate_id}`,
      );
    }
    seenCandidates.add(result.candidate_id);
  }

  return parsed;
}

export function validateDiscoveryOutput(
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  input: unknown,
): ValidatedDiscoveries {
  const parsed = DiscoveryStage3Schema.parse(input);
  const regionIds = new Set(stage1.regions.map((region) => region.id));
  const candidates = new Map(
    stage1.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const research = new Map(
    researchResults.map((result) => [result.candidate_id, result]),
  );
  const discoveryIds = new Set<string>();
  const discoveryCandidates: Record<string, string[]> = {};
  const discoveries: Discovery[] = [];

  for (const draft of parsed.discoveries) {
    if (discoveryIds.has(draft.id)) {
      throw new Error(`Duplicate discovery id: ${draft.id}`);
    }
    discoveryIds.add(draft.id);

    for (const regionId of draft.region_ids) {
      if (!regionIds.has(regionId)) {
        throw new Error(
          `Discovery ${draft.id} references unknown region ${regionId}`,
        );
      }
    }

    for (const candidateId of draft.candidate_ids) {
      if (!candidates.has(candidateId)) {
        throw new Error(
          `Discovery ${draft.id} references unknown candidate ${candidateId}`,
        );
      }
    }

    const allowedSources = new Set<string>();
    for (const candidateId of draft.candidate_ids) {
      const result = research.get(candidateId);
      if (result?.status === "answered") {
        for (const source of result.sources) allowedSources.add(source.url);
      }
    }

    if (draft.provenance === "researched") {
      if (draft.sources.length === 0 || allowedSources.size === 0) {
        throw new Error(
          `Researched discovery ${draft.id} has no applicable validated research sources`,
        );
      }
      for (const source of draft.sources) {
        if (!allowedSources.has(source.url)) {
          throw new Error(
            `Discovery ${draft.id} includes an unvalidated source URL`,
          );
        }
      }
    } else if (draft.sources.length > 0) {
      throw new Error(
        `Non-researched discovery ${draft.id} must not include research sources`,
      );
    }

    const userFacingText = [
      draft.title,
      draft.visual_trigger,
      draft.observation,
      draft.discovery,
      draft.why_it_matters,
      draft.explanation,
      draft.reinterpretation,
    ].join("\n");
    for (const match of userFacingText.matchAll(/https?:\/\/[^\s)\]}>,]+/g)) {
      if (!allowedSources.has(match[0])) {
        throw new Error(
          `Discovery ${draft.id} includes an unvalidated URL outside its sources`,
        );
      }
    }

    const { candidate_ids, ...discovery } = draft;
    discoveries.push(DiscoverySchema.parse(discovery));
    discoveryCandidates[draft.id] = candidate_ids;
  }

  return { discoveries, discoveryCandidates };
}

const stringSchema = { type: "string", minLength: 1 } as const;
const regionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: stringSchema,
    description: stringSchema,
    scope: { type: "string", enum: ["local", "global"] },
    x: { type: "number", minimum: 0, maximum: 1 },
    y: { type: "number", minimum: 0, maximum: 1 },
    width: { type: "number", minimum: 0, maximum: 1 },
    height: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["id", "description", "scope", "x", "y", "width", "height"],
} as const;
const sourceSchema = {
  type: "object",
  additionalProperties: false,
  properties: { title: stringSchema, url: stringSchema },
  required: ["title", "url"],
} as const;

export const DISCOVERY_STAGE1_JSON_SCHEMA = {
  name: "noesis_discovery_stage1",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      image_summary: stringSchema,
      regions: {
        type: "array",
        minItems: 1,
        maxItems: 12,
        items: regionSchema,
      },
      candidates: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: stringSchema,
            question_id: stringSchema,
            visual_trigger: stringSchema,
            observation: stringSchema,
            region_ids: { type: "array", minItems: 1, items: stringSchema },
            investigation_question: stringSchema,
            research_needed: { type: "boolean" },
            research_rationale: { type: "string" },
          },
          required: [
            "id",
            "question_id",
            "visual_trigger",
            "observation",
            "region_ids",
            "investigation_question",
            "research_needed",
            "research_rationale",
          ],
        },
      },
    },
    required: ["image_summary", "regions", "candidates"],
  },
} as const;

export const DISCOVERY_STAGE3_JSON_SCHEMA = {
  name: "noesis_discovery_stage3",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      discoveries: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: stringSchema,
            type: { type: "string", enum: ["local", "relational", "global"] },
            title: stringSchema,
            visual_trigger: stringSchema,
            observation: stringSchema,
            discovery: stringSchema,
            why_it_matters: stringSchema,
            explanation: stringSchema,
            reinterpretation: stringSchema,
            region_ids: { type: "array", minItems: 1, items: stringSchema },
            provenance: {
              type: "string",
              enum: ["seen", "calculated", "derived", "researched"],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            sources: { type: "array", items: sourceSchema },
            candidate_ids: { type: "array", minItems: 1, items: stringSchema },
          },
          required: [
            "id",
            "type",
            "title",
            "visual_trigger",
            "observation",
            "discovery",
            "why_it_matters",
            "explanation",
            "reinterpretation",
            "region_ids",
            "provenance",
            "confidence",
            "sources",
            "candidate_ids",
          ],
        },
      },
    },
    required: ["discoveries"],
  },
} as const;

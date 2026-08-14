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
    identity_context_needed: z.boolean(),
  })
  .strict();

export const DiscoveryIdentityHypothesisSchema = z
  .object({
    id: NonEmptyText,
    proposed_identity: NonEmptyText,
    identity_type: z.enum([
      "place",
      "building",
      "object",
      "figure",
      "map",
      "artwork",
      "diagram",
      "other",
    ]),
    visible_evidence: z.array(z.string().trim().min(8)).min(1).max(8),
    observed_labels_or_numbers: z.array(NonEmptyText).max(12),
    region_ids: z.array(NonEmptyText).min(1),
    confidence: z.number().min(0).max(1),
    verification_would_help: z.boolean(),
    relevant_question_ids: z.array(NonEmptyText).max(8),
  })
  .strict();

export const DiscoveryStage1DraftSchema = z
  .object({
    image_summary: NonEmptyText,
    regions: z.array(DiscoveryRegionSchema).min(1).max(12),
    candidates: z.array(DiscoveryCandidateSchema).max(8),
    identity_hypotheses: z.array(DiscoveryIdentityHypothesisSchema).max(4),
  })
  .strict();

export const DiscoveryStage1Schema = DiscoveryStage1DraftSchema.superRefine(
  (stage1, context) => {
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

    const hypothesisIds = new Set<string>();
    for (const hypothesis of stage1.identity_hypotheses) {
      if (hypothesisIds.has(hypothesis.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Duplicate identity hypothesis id: ${hypothesis.id}`,
        });
      }
      hypothesisIds.add(hypothesis.id);
      for (const regionId of hypothesis.region_ids) {
        if (!regionIds.has(regionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Identity hypothesis ${hypothesis.id} references unknown region ${regionId}`,
          });
        }
      }
      for (const questionId of hypothesis.relevant_question_ids) {
        if (!questionIds.has(questionId)) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Identity hypothesis ${hypothesis.id} references unknown question ${questionId}`,
          });
        }
      }
      if (
        hypothesis.verification_would_help &&
        hypothesis.relevant_question_ids.length === 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Identity hypothesis ${hypothesis.id} must identify a relevant question`,
        });
      }
      if (
        !hypothesis.verification_would_help &&
        hypothesis.relevant_question_ids.length > 0
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Identity hypothesis ${hypothesis.id} cannot reference questions when verification would not help`,
        });
      }
    }
  },
);

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

export const DiscoveryIdentityMatchEvidenceSchema = z
  .object({
    basis: z.enum([
      "shared_label_or_typography",
      "generic_visual_similarity",
      "measurement",
      "geographic_configuration",
      "architectural_configuration",
      "source_explicit_identification",
      "provenance",
    ]),
    detail: z.string().trim().min(8),
  })
  .strict();

export const DiscoveryIdentityVerificationDraftSchema = z
  .object({
    status: z.enum(["verified", "unverified", "conflicted"]),
    hypothesis_id: NonEmptyText.nullable(),
    canonical_identity: NonEmptyText.nullable(),
    identity_type: z
      .enum([
        "place",
        "building",
        "object",
        "figure",
        "map",
        "artwork",
        "diagram",
        "other",
      ])
      .nullable(),
    location: NonEmptyText.nullable(),
    verification_basis: NonEmptyText,
    confidence: z.number().min(0).max(1),
    match_evidence: z.array(DiscoveryIdentityMatchEvidenceSchema).max(8),
  })
  .strict();

export const DiscoveryIdentityVerificationSchema =
  DiscoveryIdentityVerificationDraftSchema.extend({
    sources: z.array(DiscoverySourceSchema),
  })
    .strict()
    .superRefine((result, context) => {
      if (result.status === "verified") {
        if (!result.canonical_identity || !result.identity_type) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Verified identity requires a canonical identity and type",
          });
        }
        if (result.sources.length === 0) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Verified identity requires validated sources",
          });
        }
        const exactEvidence = result.match_evidence.some(
          (item) =>
            item.basis !== "shared_label_or_typography" &&
            item.basis !== "generic_visual_similarity",
        );
        if (!exactEvidence) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message:
              "Shared typography or generic similarity alone cannot verify identity",
          });
        }
      } else if (
        result.canonical_identity !== null ||
        result.identity_type !== null ||
        result.location !== null
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "Unverified or conflicted identity cannot expose a canonical identity",
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
export type DiscoveryIdentityHypothesis = z.infer<
  typeof DiscoveryIdentityHypothesisSchema
>;
export type DiscoveryStage1Draft = z.infer<typeof DiscoveryStage1DraftSchema>;
export type DiscoveryStage1 = z.infer<typeof DiscoveryStage1Schema>;
export type DiscoverySource = z.infer<typeof DiscoverySourceSchema>;
export type DiscoveryResearchResult = z.infer<
  typeof DiscoveryResearchResultSchema
>;
export type DiscoveryIdentityVerification = z.infer<
  typeof DiscoveryIdentityVerificationSchema
>;
export type Discovery = z.infer<typeof DiscoverySchema>;
export type DiscoveryDraft = z.infer<typeof DiscoveryDraftSchema>;

export interface DiscoveryInspection {
  stage1: DiscoveryStage1;
  stage1_reconciliation?: DiscoveryStage1ReconciliationDiagnostics;
  identity_verification: DiscoveryIdentityVerification | null;
  research_results: DiscoveryResearchResult[];
  discovery_candidates: Record<string, string[]>;
}

export interface DiscoveryStage1ReconciliationDiagnostics {
  applied: boolean;
  unknown_candidate_region_references_removed: number;
  candidate_ids_with_removed_region_references: string[];
  candidate_ids_dropped: string[];
  unknown_hypothesis_region_references_removed: number;
  hypothesis_ids_with_removed_region_references: string[];
  unknown_hypothesis_question_references_removed: number;
  hypothesis_ids_with_removed_question_references: string[];
  hypothesis_ids_dropped: string[];
}

export function reconcileDiscoveryStage1References(
  draft: DiscoveryStage1Draft,
): {
  stage1: DiscoveryStage1Draft;
  diagnostics: DiscoveryStage1ReconciliationDiagnostics;
} {
  const regionIds = new Set(draft.regions.map((region) => region.id));
  const candidateIdsWithRemovedRegionReferences: string[] = [];
  const candidateIdsDropped: string[] = [];
  let unknownCandidateRegionReferencesRemoved = 0;

  const candidates = draft.candidates.flatMap((candidate) => {
    const validRegionIds = candidate.region_ids.filter((regionId) =>
      regionIds.has(regionId),
    );
    const removed = candidate.region_ids.length - validRegionIds.length;
    if (removed > 0) {
      unknownCandidateRegionReferencesRemoved += removed;
      candidateIdsWithRemovedRegionReferences.push(candidate.id);
    }
    if (validRegionIds.length === 0) {
      candidateIdsDropped.push(candidate.id);
      return [];
    }
    return removed === 0
      ? [candidate]
      : [{ ...candidate, region_ids: validRegionIds }];
  });

  const survivingQuestionIds = new Set(
    candidates.map((candidate) => candidate.question_id),
  );
  const hypothesisIdsWithRemovedRegionReferences: string[] = [];
  const hypothesisIdsWithRemovedQuestionReferences: string[] = [];
  const hypothesisIdsDropped: string[] = [];
  let unknownHypothesisRegionReferencesRemoved = 0;
  let unknownHypothesisQuestionReferencesRemoved = 0;

  const identityHypotheses = draft.identity_hypotheses.flatMap((hypothesis) => {
    const validRegionIds = hypothesis.region_ids.filter((regionId) =>
      regionIds.has(regionId),
    );
    const removedRegions = hypothesis.region_ids.length - validRegionIds.length;
    if (removedRegions > 0) {
      unknownHypothesisRegionReferencesRemoved += removedRegions;
      hypothesisIdsWithRemovedRegionReferences.push(hypothesis.id);
    }

    const validQuestionIds = hypothesis.relevant_question_ids.filter(
      (questionId) => survivingQuestionIds.has(questionId),
    );
    const removedQuestions =
      hypothesis.relevant_question_ids.length - validQuestionIds.length;
    if (removedQuestions > 0) {
      unknownHypothesisQuestionReferencesRemoved += removedQuestions;
      hypothesisIdsWithRemovedQuestionReferences.push(hypothesis.id);
    }

    const violatesQuestionInvariant = hypothesis.verification_would_help
      ? validQuestionIds.length === 0
      : validQuestionIds.length > 0;
    if (validRegionIds.length === 0 || violatesQuestionInvariant) {
      hypothesisIdsDropped.push(hypothesis.id);
      return [];
    }

    return removedRegions === 0 && removedQuestions === 0
      ? [hypothesis]
      : [
          {
            ...hypothesis,
            region_ids: validRegionIds,
            relevant_question_ids: validQuestionIds,
          },
        ];
  });

  const diagnostics = {
    applied:
      unknownCandidateRegionReferencesRemoved > 0 ||
      candidateIdsDropped.length > 0 ||
      unknownHypothesisRegionReferencesRemoved > 0 ||
      unknownHypothesisQuestionReferencesRemoved > 0 ||
      hypothesisIdsDropped.length > 0,
    unknown_candidate_region_references_removed:
      unknownCandidateRegionReferencesRemoved,
    candidate_ids_with_removed_region_references:
      candidateIdsWithRemovedRegionReferences,
    candidate_ids_dropped: candidateIdsDropped,
    unknown_hypothesis_region_references_removed:
      unknownHypothesisRegionReferencesRemoved,
    hypothesis_ids_with_removed_region_references:
      hypothesisIdsWithRemovedRegionReferences,
    unknown_hypothesis_question_references_removed:
      unknownHypothesisQuestionReferencesRemoved,
    hypothesis_ids_with_removed_question_references:
      hypothesisIdsWithRemovedQuestionReferences,
    hypothesis_ids_dropped: hypothesisIdsDropped,
  } satisfies DiscoveryStage1ReconciliationDiagnostics;

  return {
    stage1: {
      ...draft,
      candidates,
      identity_hypotheses: identityHypotheses,
    },
    diagnostics,
  };
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

export function validateIdentityVerification(
  stage1: DiscoveryStage1,
  input: unknown,
  sources: DiscoverySource[],
): DiscoveryIdentityVerification {
  const draft = DiscoveryIdentityVerificationDraftSchema.parse(input);
  if (
    draft.hypothesis_id !== null &&
    !stage1.identity_hypotheses.some(
      (hypothesis) => hypothesis.id === draft.hypothesis_id,
    )
  ) {
    throw new Error(
      `Identity verification references unknown hypothesis ${draft.hypothesis_id}`,
    );
  }
  return DiscoveryIdentityVerificationSchema.parse({
    ...draft,
    sources: z.array(DiscoverySourceSchema).parse(sources),
  });
}

export function identityApplicableCandidateIds(
  stage1: DiscoveryStage1,
  identityVerification: DiscoveryIdentityVerification | null,
): string[] {
  if (identityVerification?.status !== "verified") return [];
  return stage1.candidates
    .filter((candidate) => candidate.identity_context_needed)
    .map((candidate) => candidate.id);
}

export function validateDiscoveryOutput(
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  input: unknown,
  identityVerification: DiscoveryIdentityVerification | null = null,
  identityApplicableCandidateIdsOverride?: string[],
): ValidatedDiscoveries {
  const parsed = DiscoveryStage3Schema.parse(input);
  const regionIds = new Set(stage1.regions.map((region) => region.id));
  const candidates = new Map(
    stage1.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const research = new Map(
    researchResults.map((result) => [result.candidate_id, result]),
  );
  const identityApplicableCandidates = new Set(
    identityApplicableCandidateIdsOverride ??
      identityApplicableCandidateIds(stage1, identityVerification),
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
    if (identityVerification?.status === "verified") {
      const identityIsRelevant = draft.candidate_ids.some((candidateId) =>
        identityApplicableCandidates.has(candidateId),
      );
      if (identityIsRelevant) {
        for (const source of identityVerification.sources) {
          allowedSources.add(source.url);
        }
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
            identity_context_needed: { type: "boolean" },
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
            "identity_context_needed",
          ],
        },
      },
      identity_hypotheses: {
        type: "array",
        maxItems: 4,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: stringSchema,
            proposed_identity: stringSchema,
            identity_type: {
              type: "string",
              enum: [
                "place",
                "building",
                "object",
                "figure",
                "map",
                "artwork",
                "diagram",
                "other",
              ],
            },
            visible_evidence: {
              type: "array",
              minItems: 1,
              maxItems: 8,
              items: { type: "string", minLength: 8 },
            },
            observed_labels_or_numbers: {
              type: "array",
              maxItems: 12,
              items: stringSchema,
            },
            region_ids: { type: "array", minItems: 1, items: stringSchema },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            verification_would_help: { type: "boolean" },
            relevant_question_ids: {
              type: "array",
              maxItems: 8,
              items: stringSchema,
            },
          },
          required: [
            "id",
            "proposed_identity",
            "identity_type",
            "visible_evidence",
            "observed_labels_or_numbers",
            "region_ids",
            "confidence",
            "verification_would_help",
            "relevant_question_ids",
          ],
        },
      },
    },
    required: ["image_summary", "regions", "candidates", "identity_hypotheses"],
  },
} as const;

export const DISCOVERY_IDENTITY_VERIFICATION_JSON_SCHEMA = {
  type: "json_schema",
  name: "noesis_discovery_identity_verification",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["verified", "unverified", "conflicted"],
      },
      hypothesis_id: { type: ["string", "null"], minLength: 1 },
      canonical_identity: { type: ["string", "null"], minLength: 1 },
      identity_type: {
        type: ["string", "null"],
        enum: [
          "place",
          "building",
          "object",
          "figure",
          "map",
          "artwork",
          "diagram",
          "other",
          null,
        ],
      },
      location: { type: ["string", "null"], minLength: 1 },
      verification_basis: stringSchema,
      confidence: { type: "number", minimum: 0, maximum: 1 },
      match_evidence: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            basis: {
              type: "string",
              enum: [
                "shared_label_or_typography",
                "generic_visual_similarity",
                "measurement",
                "geographic_configuration",
                "architectural_configuration",
                "source_explicit_identification",
                "provenance",
              ],
            },
            detail: { type: "string", minLength: 8 },
          },
          required: ["basis", "detail"],
        },
      },
    },
    required: [
      "status",
      "hypothesis_id",
      "canonical_identity",
      "identity_type",
      "location",
      "verification_basis",
      "confidence",
      "match_evidence",
    ],
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

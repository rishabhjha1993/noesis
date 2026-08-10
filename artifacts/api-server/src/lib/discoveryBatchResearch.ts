import { z } from "zod";
import {
  DiscoverySourceSchema,
  validateResearchResults,
  type DiscoveryCandidate,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoverySource,
  type DiscoveryStage1,
} from "./discoveryContracts";

const NonEmptyText = z.string().trim().min(1);

const BatchedResearchDraftSchema = z
  .object({
    candidate_id: NonEmptyText,
    question_id: NonEmptyText,
    status: z.enum(["answered", "insufficient"]),
    finding: NonEmptyText,
    sources: z.array(DiscoverySourceSchema),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "answered" && result.sources.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Answered research must include a validated source",
      });
    }
  });

const BatchedResearchEnvelopeSchema = z
  .object({ results: z.array(z.unknown()).max(8) })
  .strict();

export const DISCOVERY_BATCHED_RESEARCH_JSON_SCHEMA = {
  type: "json_schema",
  name: "noesis_discovery_batched_research",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      results: {
        type: "array",
        maxItems: 8,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            candidate_id: { type: "string", minLength: 1 },
            question_id: { type: "string", minLength: 1 },
            status: {
              type: "string",
              enum: ["answered", "insufficient"],
            },
            finding: { type: "string", minLength: 1 },
            sources: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  title: { type: "string", minLength: 1 },
                  url: { type: "string", minLength: 1 },
                },
                required: ["title", "url"],
              },
            },
          },
          required: [
            "candidate_id",
            "question_id",
            "status",
            "finding",
            "sources",
          ],
        },
      },
    },
    required: ["results"],
  },
} as const;

export interface DiscoveryBatchIdentityMapping {
  candidate_id: string;
  question_id: string;
  used_verified_identity_context: boolean;
  identity_hypothesis_id: string | null;
}

export interface DiscoveryBatchCandidateContext {
  candidate_id: string;
  question_id: string;
  investigation_question: string;
  visual_trigger: string;
  observation: string;
  observed_labels_or_numbers: string[];
  relevant_regions: Array<{
    id: string;
    description: string;
    scope: "local" | "global";
  }>;
  verified_identity: {
    canonical_identity: string | null;
    identity_type: string | null;
    location: string | null;
    verification_basis: string;
  } | null;
}

export interface DiscoveryBatchContext {
  candidates: DiscoveryBatchCandidateContext[];
  identity_context_mappings: DiscoveryBatchIdentityMapping[];
}

export type DiscoveryBatchFailureScope =
  "batch_api" | "batch_schema" | "candidate_validation";

export class DiscoveryBatchValidationError extends Error {
  readonly scope: DiscoveryBatchFailureScope;
  readonly candidateId?: string;
  readonly questionId?: string;

  constructor(
    message: string,
    scope: DiscoveryBatchFailureScope,
    candidate?: DiscoveryCandidate,
  ) {
    super(message);
    this.name = "DiscoveryBatchValidationError";
    this.scope = scope;
    this.candidateId = candidate?.id;
    this.questionId = candidate?.question_id;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildDiscoveryBatchContext(
  stage1: DiscoveryStage1,
  candidates: DiscoveryCandidate[],
  identityVerification: DiscoveryIdentityVerification | null,
): DiscoveryBatchContext {
  const verifiedHypothesis =
    identityVerification?.status === "verified"
      ? stage1.identity_hypotheses.find(
          (hypothesis) => hypothesis.id === identityVerification.hypothesis_id,
        )
      : undefined;
  const regions = new Map(stage1.regions.map((region) => [region.id, region]));

  const identity_context_mappings = candidates.map((candidate) => {
    const usedVerifiedIdentityContext = Boolean(
      candidate.identity_context_needed &&
      verifiedHypothesis?.verification_would_help &&
      verifiedHypothesis.relevant_question_ids.includes(candidate.question_id),
    );
    return {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      used_verified_identity_context: usedVerifiedIdentityContext,
      identity_hypothesis_id: usedVerifiedIdentityContext
        ? (verifiedHypothesis?.id ?? null)
        : null,
    };
  });

  return {
    candidates: candidates.map((candidate, index) => {
      const identityMapping = identity_context_mappings[index]!;
      const relevantHypotheses = stage1.identity_hypotheses.filter(
        (hypothesis) =>
          hypothesis.relevant_question_ids.includes(candidate.question_id),
      );
      return {
        candidate_id: candidate.id,
        question_id: candidate.question_id,
        investigation_question: candidate.investigation_question,
        visual_trigger: candidate.visual_trigger,
        observation: candidate.observation,
        observed_labels_or_numbers: unique(
          relevantHypotheses.flatMap(
            (hypothesis) => hypothesis.observed_labels_or_numbers,
          ),
        ),
        relevant_regions: candidate.region_ids.flatMap((regionId) => {
          const region = regions.get(regionId);
          return region
            ? [
                {
                  id: region.id,
                  description: region.description,
                  scope: region.scope,
                },
              ]
            : [];
        }),
        verified_identity: identityMapping.used_verified_identity_context
          ? {
              canonical_identity:
                identityVerification?.canonical_identity ?? null,
              identity_type: identityVerification?.identity_type ?? null,
              location: identityVerification?.location ?? null,
              verification_basis:
                identityVerification?.verification_basis ?? "",
            }
          : null,
      };
    }),
    identity_context_mappings,
  };
}

function insufficientResult(
  candidate: DiscoveryCandidate,
  reason: string,
): DiscoveryResearchResult {
  return {
    candidate_id: candidate.id,
    question_id: candidate.question_id,
    question: candidate.investigation_question,
    status: "insufficient",
    finding: reason,
    sources: [],
  };
}

export interface ValidatedDiscoveryBatch {
  results: DiscoveryResearchResult[];
  invalid_candidate_ids: string[];
  missing_candidate_ids: string[];
}

export function validateDiscoveryBatchResults(
  stage1: DiscoveryStage1,
  candidates: DiscoveryCandidate[],
  input: unknown,
  citedSources: DiscoverySource[],
): ValidatedDiscoveryBatch {
  let envelope: z.infer<typeof BatchedResearchEnvelopeSchema>;
  try {
    envelope = BatchedResearchEnvelopeSchema.parse(input);
  } catch {
    throw new DiscoveryBatchValidationError(
      "Batched research returned an invalid result envelope",
      "batch_schema",
    );
  }

  const allowedCandidates = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const citedByUrl = new Map(
    citedSources.map((source) => [source.url, source]),
  );
  const seen = new Set<string>();
  const validByCandidate = new Map<string, DiscoveryResearchResult>();
  const invalidCandidateIds = new Set<string>();

  for (const rawResult of envelope.results) {
    const identity = z
      .object({
        candidate_id: NonEmptyText,
        question_id: NonEmptyText,
      })
      .passthrough()
      .safeParse(rawResult);
    if (!identity.success) {
      throw new DiscoveryBatchValidationError(
        "Batched research returned a result without stable ids",
        "batch_schema",
      );
    }
    const candidate = allowedCandidates.get(identity.data.candidate_id);
    if (!candidate) {
      throw new DiscoveryBatchValidationError(
        "Batched research returned an unknown candidate",
        "candidate_validation",
      );
    }
    if (identity.data.question_id !== candidate.question_id) {
      throw new DiscoveryBatchValidationError(
        "Batched research changed an approved question id",
        "candidate_validation",
        candidate,
      );
    }
    if (seen.has(candidate.id)) {
      throw new DiscoveryBatchValidationError(
        "Batched research duplicated a candidate result",
        "candidate_validation",
        candidate,
      );
    }
    seen.add(candidate.id);

    const parsed = BatchedResearchDraftSchema.safeParse(rawResult);
    if (!parsed.success) {
      invalidCandidateIds.add(candidate.id);
      continue;
    }
    const validatedSources: DiscoverySource[] = [];
    let sourceInvalid = false;
    for (const source of parsed.data.sources) {
      const cited = citedByUrl.get(source.url);
      if (!cited) {
        sourceInvalid = true;
        break;
      }
      validatedSources.push(cited);
    }
    if (sourceInvalid) {
      invalidCandidateIds.add(candidate.id);
      continue;
    }
    validByCandidate.set(candidate.id, {
      candidate_id: candidate.id,
      question_id: candidate.question_id,
      question: candidate.investigation_question,
      status: parsed.data.status,
      finding: parsed.data.finding,
      sources: validatedSources,
    });
  }

  const missingCandidateIds = candidates
    .filter((candidate) => !seen.has(candidate.id))
    .map((candidate) => candidate.id);
  const results = candidates.map(
    (candidate) =>
      validByCandidate.get(candidate.id) ??
      insufficientResult(
        candidate,
        invalidCandidateIds.has(candidate.id)
          ? "The candidate research result failed validation."
          : "The batch did not return a result for this candidate.",
      ),
  );

  return {
    results: validateResearchResults(stage1, results),
    invalid_candidate_ids: [...invalidCandidateIds],
    missing_candidate_ids: missingCandidateIds,
  };
}

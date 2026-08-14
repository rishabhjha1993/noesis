import {
  type DiscoveryCandidate,
  type DiscoveryIdentityVerification,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "./discoveryContracts";

// DO NOT MODIFY: frozen V1 reference from 3a0bca12ff5a3c63de5f6d2442ccd5f51a8627e2.
// Changes to experimental Discovery intelligence belong in another variant.
export const FROZEN_V1_SOURCE_COMMIT =
  "3a0bca12ff5a3c63de5f6d2442ccd5f51a8627e2";
export const FROZEN_V1_ENGINE_VERSION = "discovery-engine-v1-frozen-3a0bca12";
export const FROZEN_V1_CACHE_REVISION = "v1-frozen-3a0bca12";
export const FROZEN_V1_STAGE1_MODEL = "gpt-5.6-sol";
export const FROZEN_V1_STAGE2_MODEL = "gpt-5.6-terra";
export const FROZEN_V1_STAGE3_MODEL = "gpt-5.6-sol";
export const FROZEN_V1_REASONING_EFFORT = "medium";

export const FROZEN_V1_STAGE1_PROMPT = `You are Stage 1 of Noesis Discovery Engine V1: SEE → QUESTION.

Inspect the supplied image itself. Do not provide a generic description and do not use external knowledge.

Find a small set of visible features, relationships, patterns, contrasts, anomalies, labels, numbers, structures, or apparent contradictions that may materially change how a careful viewer understands this specific image. Every candidate must originate in concrete visible evidence.

Create highlightable regions with normalized coordinates (0-1, origin top-left). Use local regions for bounded visual features. For a genuinely whole-image trigger, create an explicit global region with x=0, y=0, width=1, height=1. Relational candidates may reference multiple regions; never create one huge box just to connect distant features.

For each candidate:
- use stable unique candidate and question ids;
- state the exact visual trigger and grounded observation;
- reference only declared region ids;
- ask one specific question that could deepen interpretation of this image;
- mark research_needed true only if external facts could materially explain, verify, surprise, reinterpret, or overturn the reading of the visible feature;
- explain that material value in research_rationale when research is needed;
- mark identity_context_needed true only when verified place, building, object, figure, map, artwork, diagram, or other identity is materially needed to answer the question safely.

Optionally propose a small set of identity_hypotheses. These are visual hypotheses, never verified facts. Each must include concrete visible evidence, supporting regions, any observed labels or numbers, confidence, and the exact question ids that verified identity would materially help. Return an empty identity_hypotheses array when the image does not support a useful hypothesis. Do not identify an image merely because naming the subject might be interesting.

Candidates may require no research. Reject broad topic questions, generic history, and trivia that could be generated from the subject alone. Do not expose chain-of-thought; return only concise structured grounding artifacts.`;

export const FROZEN_V1_IDENTITY_VERIFICATION_INSTRUCTIONS = `You are the conditional identity-verification substep inside Stage 2 of Noesis Discovery Engine V1.

You receive text-only visual identity hypotheses from Stage 1, their concise visible evidence, observed labels or numbers, and relevant region descriptions. You do not receive the image. Use web search to verify, reject, or identify conflict in the proposed identity. Identity is useful only as context for already-approved image-triggered questions.

Return verified only when external evidence establishes the exact place, building, object, figure, map, artwork, diagram, or other identity. A shared word, typography style, visual motif, generic structure, or partial characteristic is not enough. Evidence about a general convention is not evidence that a source depicts the exact same object or figure. In particular, another plate containing similar wording does not establish that it is the uploaded plate. Prefer unverified or conflicted over a convenient nearest match. Cite supporting claims only through web-search citations; never invent source URLs. Return only the strict JSON result.`;

export const FROZEN_V1_RESEARCH_INSTRUCTIONS = `You are Stage 2 of Noesis Discovery Engine V1: selectively RESEARCH.

You receive one question approved by the visual Stage 1 gate. You do not receive the image and may not choose a broader topic. Use web search only to answer the exact supplied question as narrowly and accurately as possible. Remain tied to the supplied visual trigger and observation. Do not write a topic report or add adjacent trivia. Verified identity context, when supplied, is search context only and never permission for general facts about the identified subject.

Never silently substitute a similar place, building, object, image, or figure. A shared word, typography style, motif, or generic structure does not show that an external source depicts the same object. Clearly distinguish evidence about a general convention from evidence about the exact uploaded subject. If exact identity is needed but was not verified, prefer INSUFFICIENT over a plausible unsupported match.

Begin with ANSWERED: when trustworthy sources materially answer the question. Begin with INSUFFICIENT: when reliable research cannot answer it. Keep the finding concise. Cite claims using the web-search citations supplied by the API. Never invent or type source URLs yourself.`;

export const FROZEN_V1_STAGE3_PROMPT = `You are Stage 3 of Noesis Discovery Engine V1: DISCOVER → RETURN TO IMAGE.

You receive text-only structured visual grounding, approved investigation candidates, optional narrowly scoped research findings, validated source metadata, and any deterministic calculations. You do not receive the image.

Act as an aggressive editor and ranker. Select only findings that genuinely cause the user to understand this image differently. Four exceptional discoveries are better than five mediocre ones; fewer than three, including zero, is valid.

For every discovery enforce:
A. VISUAL ORIGIN — identify exactly what visible evidence caused the investigation. Reject discoveries without a concrete answer.
B. IMAGE DEPENDENCE — reject external facts that remain equally interesting without the image unless they materially explain, surprise, reinterpret, verify, or overturn the reading of something visible.

Rank by accuracy, visual dependence, surprise, explanatory depth, specificity, consequential understanding, and reinterpretation. Do not summarize the inputs or pad the count.

Rules:
- candidate_ids must reference the exact Stage 1 candidates supporting the discovery.
- region_ids must reference only Stage 1 regions and should include every region needed to return attention to the image.
- provenance is researched only when an answered research result or verified identity result materially contributes.
- researched discoveries may copy only source objects present in the supplied research or verified identity results.
- never present an unverified or conflicted identity hypothesis as fact; verified identity is not itself a discovery and may appear only when it materially explains or reinterprets something visible.
- all other discoveries must have an empty sources array.
- reinterpretation must explicitly tell the viewer what to notice or understand differently when looking back at the image.
- explanation is concise and user-facing; never expose private chain-of-thought.

Return only the strict JSON object.`;

export const FROZEN_V1_IDENTITY_VERIFICATION_JSON_SCHEMA = {
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
      hypothesis_id: { type: "string", minLength: 1 },
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
      verification_basis: { type: "string", minLength: 1 },
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

export function frozenV1ApplicableCandidateIds(
  stage1: DiscoveryStage1,
  identityVerification: DiscoveryIdentityVerification | null,
): string[] {
  if (
    identityVerification?.status !== "verified" ||
    identityVerification.hypothesis_id === null
  ) {
    return [];
  }
  const hypothesis = stage1.identity_hypotheses.find(
    (item) => item.id === identityVerification.hypothesis_id,
  );
  if (!hypothesis?.verification_would_help) return [];
  const relevantQuestionIds = new Set(hypothesis.relevant_question_ids);
  return stage1.candidates
    .filter(
      (candidate) =>
        candidate.identity_context_needed &&
        relevantQuestionIds.has(candidate.question_id),
    )
    .map((candidate) => candidate.id);
}

export function buildFrozenV1IdentityInput(
  stage1: DiscoveryStage1,
  gatedCandidates: DiscoveryCandidate[],
): {
  hypotheses: DiscoveryStage1["identity_hypotheses"];
  input: string;
} | null {
  const identityQuestionIds = new Set(
    gatedCandidates
      .filter((candidate) => candidate.identity_context_needed)
      .map((candidate) => candidate.question_id),
  );
  if (identityQuestionIds.size === 0) return null;

  const hypotheses = stage1.identity_hypotheses.filter(
    (hypothesis) =>
      hypothesis.verification_would_help &&
      hypothesis.relevant_question_ids.some((questionId) =>
        identityQuestionIds.has(questionId),
      ),
  );
  if (hypotheses.length === 0) return null;

  const relevantRegionIds = new Set(
    hypotheses.flatMap((hypothesis) => hypothesis.region_ids),
  );
  const relevantCandidates = gatedCandidates.filter(
    (candidate) => candidate.identity_context_needed,
  );

  return {
    hypotheses,
    input: [
      "STAGE 1 IDENTITY HYPOTHESES:",
      JSON.stringify(hypotheses),
      "",
      "RELEVANT VISIBLE REGION DESCRIPTIONS:",
      JSON.stringify(
        stage1.regions.filter((region) => relevantRegionIds.has(region.id)),
      ),
      "",
      "APPROVED QUESTIONS THAT MAY NEED IDENTITY:",
      JSON.stringify(
        relevantCandidates.map((candidate) => ({
          question_id: candidate.question_id,
          visual_trigger: candidate.visual_trigger,
          observation: candidate.observation,
          investigation_question: candidate.investigation_question,
          identity_context_needed: candidate.identity_context_needed,
        })),
      ),
    ].join("\n"),
  };
}

export function buildFrozenV1ResearchRequest(
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
  identityVerification: DiscoveryIdentityVerification | null,
) {
  const usedVerifiedIdentityContext = frozenV1ApplicableCandidateIds(
    stage1,
    identityVerification,
  ).includes(candidate.id);
  const identityContext = usedVerifiedIdentityContext
    ? [
        "VERIFIED IDENTITY CONTEXT (search context only):",
        JSON.stringify({
          canonical_identity: identityVerification?.canonical_identity,
          identity_type: identityVerification?.identity_type,
          location: identityVerification?.location,
          verification_basis: identityVerification?.verification_basis,
        }),
      ]
    : candidate.identity_context_needed
      ? [
          `IDENTITY VERIFICATION STATUS: ${identityVerification?.status ?? "not_run"}.`,
          "No verified identity context is available. Do not treat a hypothesis or similar object as the uploaded subject.",
        ]
      : ["IDENTITY CONTEXT: not needed for this question."];

  return {
    usedVerifiedIdentityContext,
    request: {
      model: FROZEN_V1_STAGE2_MODEL,
      reasoning: { effort: FROZEN_V1_REASONING_EFFORT as "medium" },
      tools: [
        {
          type: "web_search" as const,
          search_context_size: "medium" as const,
        },
      ],
      tool_choice: "required" as const,
      include: ["web_search_call.action.sources" as const],
      store: false,
      max_output_tokens: 3000,
      instructions: FROZEN_V1_RESEARCH_INSTRUCTIONS,
      input: [
        `CANDIDATE ID: ${candidate.id}`,
        `QUESTION ID: ${candidate.question_id}`,
        `VISIBLE TRIGGER: ${candidate.visual_trigger}`,
        `GROUNDED OBSERVATION: ${candidate.observation}`,
        `APPROVED QUESTION: ${candidate.investigation_question}`,
        `WHY RESEARCH MAY DEEPEN THE IMAGE: ${candidate.research_rationale}`,
        ...identityContext,
        "Answer only the APPROVED QUESTION above.",
      ].join("\n"),
    },
  };
}

export function buildFrozenV1Stage3Context(
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
  identityVerification: DiscoveryIdentityVerification | null,
) {
  const identityContext =
    identityVerification?.status === "verified"
      ? identityVerification
      : identityVerification
        ? { status: identityVerification.status }
        : null;
  const grounding = {
    ...stage1,
    identity_hypotheses:
      identityVerification?.status === "verified"
        ? stage1.identity_hypotheses.filter(
            (hypothesis) =>
              hypothesis.id === identityVerification.hypothesis_id,
          )
        : [],
  };

  return {
    grounding,
    researchResults,
    identityContext,
  };
}

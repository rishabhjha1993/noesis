import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import {
  DISCOVERY_STAGE3_JSON_SCHEMA,
  type DiscoveryCandidate,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "./discoveryContracts";
import {
  FROZEN_V1_REASONING_EFFORT,
  FROZEN_V1_RESEARCH_INSTRUCTIONS,
  FROZEN_V1_STAGE1_MODEL,
  FROZEN_V1_STAGE1_PROMPT,
  FROZEN_V1_STAGE3_MODEL,
  buildFrozenV1ResearchRequest,
} from "./discoveryFrozenV1";

export const V2_HYBRID_VARIANT = "v2-hybrid";
export const V2_HYBRID_ENGINE_VERSION = "discovery-engine-v2-hybrid";
export const V2_HYBRID_CACHE_REVISION = "v2-hybrid-v4";
export const V2_HYBRID_STAGE1_MODEL = FROZEN_V1_STAGE1_MODEL;
export const V2_HYBRID_RESEARCH_MODEL = "gpt-5.6-luna";
export const V2_HYBRID_STAGE3_MODEL = FROZEN_V1_STAGE3_MODEL;
export const V2_HYBRID_REASONING_EFFORT = FROZEN_V1_REASONING_EFFORT;
export const V2_HYBRID_RESEARCH_MAX_CONCURRENCY = 3;

// The frozen V1 Stage-1 prompt's single conservative identity paragraph, replaced
// verbatim below so the rest of the vision/region/candidate contract stays byte-identical
// with the immutable frozen reference.
const FROZEN_V1_STAGE1_IDENTITY_PARAGRAPH = `Optionally propose a small set of identity_hypotheses. These are visual hypotheses, never verified facts. Each must include concrete visible evidence, supporting regions, any observed labels or numbers, confidence, and the exact question ids that verified identity would materially help. Return an empty identity_hypotheses array when the image does not support a useful hypothesis. Do not identify an image merely because naming the subject might be interesting.`;

const V2_HYBRID_STAGE1_IDENTITY_PARAGRAPH = `After forming candidates, review every candidate you marked identity_context_needed and ask: does the visible evidence suggest a plausible exact place, building, object, figure, map, artwork, diagram, or instrument identity that would materially help investigate this candidate? When it does, propose that single best identity as an UNVERIFIED VISUAL LEAD, even at moderate confidence. Downstream research will attempt to establish or reject each lead, so surface a plausible lead rather than omit it merely because you are uncertain; uncertainty is expected and is not a reason to return nothing. Each identity_hypothesis is a visual hypothesis, never a verified fact, and must include concrete visible evidence, supporting regions, any observed labels or numbers, a calibrated confidence, verification_would_help set true, and the exact question ids that establishing the identity would materially help. Combine multiple independent, discriminative visible clues — coastline or boundary form, distinctive geometry, topology, spatial relationships, labels, numbers — when they jointly narrow the identity, and state the most specific falsifiable identity those clues justify without adding specificity they do not support. Propose at most one best hypothesis per distinct subject; do not list speculative alternatives hoping one is right. Return an empty identity_hypotheses array when the visible evidence supports no plausible specific identity, and never dress a generic category (for example "an integrated circuit" or "a satellite image") up as an exact identity or name a subject merely because naming it might be interesting.`;

export const V2_HYBRID_STAGE1_PROMPT = FROZEN_V1_STAGE1_PROMPT.replace(
  FROZEN_V1_STAGE1_IDENTITY_PARAGRAPH,
  V2_HYBRID_STAGE1_IDENTITY_PARAGRAPH,
);

export const V2_HYBRID_RESEARCH_INSTRUCTIONS = `${FROZEN_V1_RESEARCH_INSTRUCTIONS}

Stage-1 identity hypotheses, when supplied, are UNVERIFIED VISUAL SEARCH LEADS, not established facts. You may use a relevant lead to formulate searches, but you must never assume it is correct. When a relevant hypothesis is supplied for this candidate, your first responsibility is to establish or reject that exact identity before answering the approved question: search for evidence that connects this candidate's own visible clues (labels, numbers, geographic or object morphology) to the proposed identity, and for evidence that distinguishes it from plausible lookalikes. Reach one of three conclusions and let it govern your finding: ESTABLISHED — state plainly that the identity is established, cite the evidence that establishes it, then use that exact identity to answer the approved question; UNRESOLVED — do not promote the hypothesis to fact, answer only at the level genuinely supported by evidence, or return INSUFFICIENT if exact identity is necessary to answer safely; CONTRADICTED — explicitly reject the proposed identity, never use it in your answer, and continue only if the question can still be meaningfully answered without it, otherwise return INSUFFICIENT. "Looks similar to X" or a source that merely discusses X in general is never enough to establish X; you need evidence tying this candidate's specific visible clues to that exact identity, preferring authoritative or first-party sources when practical. If trustworthy external evidence establishes the identity sufficiently to answer this exact candidate, the finding may state that identity and must remain supported by this candidate's validated citations. If exact identity cannot be established but the question can be answered safely at a more general level, answer only at that supported level. If exact identity is necessary and cannot be established, return INSUFFICIENT. Never silently substitute a visually similar subject, and do not turn this candidate operation into a general identity report.

CRITICAL: you do NOT receive the image. You only have Stage 1's text description of what is visible. You therefore CANNOT confirm that any external source depicts THIS exact object, and you must never assert "this image is X" as a settled fact. Your identity conclusion here is PROVISIONAL and advisory; the authoritative identity determination is made by the final image-holding stage, not by you. Your job is to gather evidence and, above all, the DISCRIMINATING ATTRIBUTES that stage will need.

Same-object support requires an EXPLICIT BRIDGE present in the evidence you actually have — a concrete correspondence that ties an external source to THIS candidate's Stage-1-recorded observations, such as a matching recorded part number, label, serial, or inscription; a source that states a specific distinguishing feature Stage 1 explicitly recorded as present; or matching provenance. A source merely ABOUT the hypothesized subject — even a dedicated single-subject die-shot, gallery, archive, category, list, index, or search-result page — is NOT a bridge: it does not identify THIS depicted object, and treating it as same-object proof is exactly the error to avoid. Resemblance or family membership is plausibility, not identification.

For the proposed identity AND its closest plausible alternative(s), report the concrete, IMAGE-CHECKABLE DISCRIMINATING ATTRIBUTES that would separate them — the specific visible features (counts, arrangements, proportions, shapes, labels) that differ between them — each backed by a trustworthy source. Provide these discriminating attributes even when you cannot establish the identity yourself; they are the payload the final image-holding stage uses to adjudicate. Do this as a sourced ANSWERED finding rather than withholding it.

Reach a provisional conclusion and state it as such: PROVISIONAL ESTABLISHED only when an explicit in-context bridge exists; CONTRADICTED when reliable evidence positively identifies the object as something other than the proposed identity, or a discriminating attribute clearly fails; otherwise UNRESOLVED (absence of proof is UNRESOLVED, not CONTRADICTED). Generic architectural or topical facts may answer parts of the question only conditionally (for example, "if this were the proposed part, the regular region could be its cache") and may never promote the identity to fact.`;

export function buildV2HybridResearchRequest(
  stage1: DiscoveryStage1,
  candidate: DiscoveryCandidate,
): {
  usedVerifiedIdentityContext: false;
  relevantIdentityHypothesisIds: string[];
  request: ResponseCreateParamsNonStreaming;
} {
  const frozen = buildFrozenV1ResearchRequest(stage1, candidate, null);
  const regionsById = new Map(
    stage1.regions.map((region) => [region.id, region]),
  );
  const relevantHypotheses = stage1.identity_hypotheses.filter(
    (hypothesis) =>
      hypothesis.verification_would_help &&
      hypothesis.relevant_question_ids.includes(candidate.question_id),
  );
  const unverifiedLeadContext =
    relevantHypotheses.length > 0
      ? [
          "UNVERIFIED VISUAL IDENTITY HYPOTHESES — search leads only:",
          JSON.stringify(
            relevantHypotheses.map((hypothesis) => ({
              id: hypothesis.id,
              proposed_identity: hypothesis.proposed_identity,
              identity_type: hypothesis.identity_type,
              visible_evidence: hypothesis.visible_evidence,
              observed_labels_or_numbers: hypothesis.observed_labels_or_numbers,
              confidence: hypothesis.confidence,
              relevant_question_ids: hypothesis.relevant_question_ids,
              region_ids: hypothesis.region_ids,
              relevant_regions: hypothesis.region_ids.flatMap((regionId) => {
                const region = regionsById.get(regionId);
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
            })),
          ),
          "These hypotheses are not verified facts. Before answering the APPROVED QUESTION, first establish or reject the exact identity above using this candidate's own trustworthy search evidence, then use that ESTABLISHED / UNRESOLVED / CONTRADICTED conclusion to decide how to answer.",
        ]
      : candidate.identity_context_needed
        ? [
            "UNVERIFIED VISUAL IDENTITY HYPOTHESES: none apply to this question.",
            "If exact identity is necessary and cannot be established from trustworthy research, return INSUFFICIENT.",
          ]
        : ["IDENTITY CONTEXT: not needed for this question."];

  return {
    usedVerifiedIdentityContext: false,
    relevantIdentityHypothesisIds: relevantHypotheses.map(
      (hypothesis) => hypothesis.id,
    ),
    request: {
      ...frozen.request,
      model: V2_HYBRID_RESEARCH_MODEL,
      reasoning: { effort: V2_HYBRID_REASONING_EFFORT },
      instructions: V2_HYBRID_RESEARCH_INSTRUCTIONS,
      input: [
        `CANDIDATE ID: ${candidate.id}`,
        `QUESTION ID: ${candidate.question_id}`,
        `VISIBLE TRIGGER: ${candidate.visual_trigger}`,
        `GROUNDED OBSERVATION: ${candidate.observation}`,
        `APPROVED QUESTION: ${candidate.investigation_question}`,
        `WHY RESEARCH MAY DEEPEN THE IMAGE: ${candidate.research_rationale}`,
        ...unverifiedLeadContext,
        "Answer only the APPROVED QUESTION above.",
      ].join("\n"),
    },
  };
}

export const V2_HYBRID_FINAL_PROMPT = `You are the final Discovery stage of Noesis V2 Hybrid: DISCOVER → RETURN TO IMAGE.

You receive the original image again at high detail, validated Stage-1 visual grounding, approved candidates, safe candidate-local Luna research results, candidate statuses, and Stage-1 identity hypotheses clearly labelled as unverified. Look at the image itself while deciding what the evidence means for this specific visual.

Act as an aggressive editor and ranker. Select only discoveries that genuinely change how a user understands this image. Fewer excellent discoveries are better than padded output; zero is valid. Do not summarize all research.

You are the AUTHORITATIVE identity adjudicator. The candidate research did NOT see the image; its identity conclusions are provisional advice, not fact. You alone hold the original image, so you decide identity by checking the discriminating attributes research supplied against what you can actually see. An exact identity may become factual ONLY when both hold:
1. you can POSITIVELY corroborate, in the visible image, a discriminating attribute that separates the proposed identity from its closest plausible alternative (for example, actually count the array blocks or confirm the distinguishing shape) — a research finding that merely asserts the identity is not enough on its own; and
2. NO candidate returned CONTRADICTED evidence for that identity.
An UNRESOLVED candidate is only absence of proof and must NOT veto an identity you can positively corroborate. If you cannot visibly corroborate a distinguishing attribute, or any candidate contradicted the identity, keep the identity unresolved and answer generically — never promote a provisional or merely-plausible identity to fact.

For every discovery:
- begin from concrete visible evidence in the image;
- use only declared candidate_ids and region_ids;
- reject generic facts that cannot be visibly reconnected to this image;
- never present a Stage-1 identity hypothesis, or a candidate's provisional identity conclusion, as fact unless you have adjudicated it established under the rule above;
- an identity may become factual only when you corroborated it from the image AND an applicable answered candidate finding supports it with that candidate's validated sources;
- use researched provenance only when an answered candidate result materially contributes;
- copy sources only from the applicable candidate-local validated research evidence;
- otherwise use non-researched provenance with an empty sources array;
- make reinterpretation tell the viewer what to notice or understand differently when looking back at the image.

Research may deepen the image. Research may never leave the image behind. Do not expose chain-of-thought. Return only the strict JSON object.`;

export function buildV2HybridFinalRequest(
  imageDataUrl: string,
  stage1: DiscoveryStage1,
  researchResults: DiscoveryResearchResult[],
): ChatCompletionCreateParamsNonStreaming {
  const candidateStatuses = researchResults.map((result) => ({
    candidate_id: result.candidate_id,
    question_id: result.question_id,
    status: result.status,
  }));

  return {
    model: V2_HYBRID_STAGE3_MODEL,
    reasoning_effort: V2_HYBRID_REASONING_EFFORT,
    max_completion_tokens: 10000,
    response_format: {
      type: "json_schema",
      json_schema: DISCOVERY_STAGE3_JSON_SCHEMA as unknown as {
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
      },
    },
    messages: [
      { role: "system", content: V2_HYBRID_FINAL_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "VALIDATED STAGE 1 GROUNDING:",
              JSON.stringify(stage1),
              "",
              "SAFE LUNA CANDIDATE RESEARCH RESULTS:",
              JSON.stringify(researchResults),
              "",
              "CANDIDATE RESEARCH STATUSES:",
              JSON.stringify(candidateStatuses),
              "",
              "UNVERIFIED STAGE-1 VISUAL IDENTITY HYPOTHESES — context only, never facts without applicable answered research:",
              JSON.stringify(stage1.identity_hypotheses),
              "",
              "Return only discoveries that materially change how this original image is understood.",
            ].join("\n"),
          },
          {
            type: "image_url",
            image_url: { url: imageDataUrl, detail: "high" },
          },
        ],
      },
    ],
  };
}

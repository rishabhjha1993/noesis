import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscoveryStage1Schema,
  validateDiscoveryOutput,
  validateIdentityVerification,
  type DiscoveryDraft,
  type DiscoveryIdentityVerification,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import {
  runDiscoveryPipeline,
  runSelectiveResearch,
} from "../../artifacts/api-server/src/lib/discoveryPipeline";

const identityStage1: DiscoveryStage1 = {
  image_summary:
    "A geometric reclaimed landscape with an isolated circular feature.",
  regions: [
    {
      id: "r1",
      description: "The engineered agricultural landscape",
      scope: "global",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
    {
      id: "r2",
      description: "The isolated circular structure by the waterway",
      scope: "local",
      x: 0.62,
      y: 0.7,
      width: 0.12,
      height: 0.12,
    },
  ],
  candidates: [
    {
      id: "c1",
      question_id: "q1",
      visual_trigger:
        "An isolated near-perfect circle sits beside a southern waterway.",
      observation:
        "The circle breaks the surrounding rectilinear parcel geometry.",
      region_ids: ["r2"],
      investigation_question:
        "What is the isolated circular structure and what is its function?",
      research_needed: true,
      research_rationale:
        "Verified place context could distinguish infrastructure from a landscape artifact.",
      identity_context_needed: true,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger:
        "Straight water-facing boundaries enclose differently oriented parcels.",
      observation:
        "The parcel geometry changes abruptly across engineered boundaries.",
      region_ids: ["r1"],
      investigation_question:
        "Why do the parcel orientations change across the visible boundaries?",
      research_needed: true,
      research_rationale:
        "Verified location context could explain the conflicting engineered geometries.",
      identity_context_needed: true,
    },
  ],
  identity_hypotheses: [
    {
      id: "ih1",
      proposed_identity: "Noordoostpolder, Netherlands",
      identity_type: "place",
      visible_evidence: [
        "A huge geometrically enclosed agricultural landscape meets open water.",
        "Straight water boundaries contain strongly rectilinear reclaimed parcels.",
      ],
      observed_labels_or_numbers: [],
      region_ids: ["r1", "r2"],
      confidence: 0.78,
      verification_would_help: true,
      relevant_question_ids: ["q1", "q2"],
    },
  ],
};

const verifiedDraft = {
  status: "verified" as const,
  hypothesis_id: "ih1",
  canonical_identity: "Noordoostpolder",
  identity_type: "place" as const,
  location: "Flevoland, Netherlands",
  verification_basis:
    "Authoritative geographic sources match the enclosing water geometry and polder layout.",
  confidence: 0.94,
  match_evidence: [
    {
      basis: "geographic_configuration" as const,
      detail:
        "The enclosing waterways and rectilinear polder configuration match the named place.",
    },
  ],
};

function unresolvedDraft(status: "unverified" | "conflicted") {
  return {
    status,
    hypothesis_id: "ih1",
    canonical_identity: null,
    identity_type: null,
    location: null,
    verification_basis:
      status === "conflicted"
        ? "Sources support multiple incompatible locations."
        : "The visible evidence did not establish an exact place.",
    confidence: 0.25,
    match_evidence: [
      {
        basis: "generic_visual_similarity" as const,
        detail: "Several reclaimed landscapes share similar parcel geometry.",
      },
    ],
  };
}

interface CapturedRequest {
  input?: unknown;
  text?: unknown;
  instructions?: unknown;
}

function response(outputText: string, sourceUrl?: string) {
  return {
    model: "gpt-5.6-terra",
    output_text: outputText,
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: outputText,
            annotations: sourceUrl
              ? [
                  {
                    type: "url_citation",
                    title: "Authoritative source",
                    url: sourceUrl,
                    start_index: 0,
                    end_index: 10,
                  },
                ]
              : [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
      output_tokens: 20,
      output_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    },
  };
}

function chatResponse(content: unknown) {
  return {
    model: "gpt-5.6-sol",
    choices: [{ message: { content: JSON.stringify(content) } }],
    usage: {
      prompt_tokens: 100,
      prompt_tokens_details: { cached_tokens: 0 },
      completion_tokens: 20,
      completion_tokens_details: { reasoning_tokens: 5 },
      total_tokens: 120,
    },
  };
}

function fakeResearchClient(
  requests: CapturedRequest[],
  identityResult?: typeof verifiedDraft | ReturnType<typeof unresolvedDraft>,
) {
  return {
    responses: {
      create: async (request: CapturedRequest) => {
        requests.push(request);
        if (request.text) {
          assert.ok(identityResult, "Unexpected identity verification call");
          return response(
            JSON.stringify(identityResult),
            identityResult.status === "verified"
              ? "https://example.com/identity"
              : undefined,
          );
        }
        return response(
          "ANSWERED: The approved visual question has a supported answer.",
          "https://example.com/research",
        );
      },
    },
  } as unknown as Parameters<typeof runSelectiveResearch>[0];
}

test("Stage 1 can return no identity hypothesis", () => {
  const noIdentity = structuredClone(identityStage1);
  noIdentity.identity_hypotheses = [];
  noIdentity.candidates.forEach(
    (candidate) => (candidate.identity_context_needed = false),
  );
  assert.equal(
    DiscoveryStage1Schema.parse(noIdentity).identity_hypotheses.length,
    0,
  );
});

test("identity hypotheses require concrete visible evidence", () => {
  const invalid = structuredClone(identityStage1);
  invalid.identity_hypotheses[0]!.visible_evidence = ["circle"];
  assert.equal(DiscoveryStage1Schema.safeParse(invalid).success, false);
});

test("identity hypotheses must reference declared regions and questions", () => {
  const badRegion = structuredClone(identityStage1);
  badRegion.identity_hypotheses[0]!.region_ids = ["missing"];
  assert.equal(DiscoveryStage1Schema.safeParse(badRegion).success, false);

  const badQuestion = structuredClone(identityStage1);
  badQuestion.identity_hypotheses[0]!.relevant_question_ids = ["missing"];
  assert.equal(DiscoveryStage1Schema.safeParse(badQuestion).success, false);
});

test("a research candidate can declare identity context as materially needed", () => {
  const parsed = DiscoveryStage1Schema.parse(identityStage1);
  assert.equal(parsed.candidates[0]!.identity_context_needed, true);
});

test("identity verification does not run when no gated candidate needs it", async () => {
  const stage1 = structuredClone(identityStage1);
  stage1.candidates.forEach(
    (candidate) => (candidate.identity_context_needed = false),
  );
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests),
    stage1,
  );
  assert.equal(result.identityVerification.metrics.ran, false);
  assert.equal(requests.filter((request) => request.text).length, 0);
});

test("identity verification runs at most once per Discovery run", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, verifiedDraft),
    identityStage1,
  );
  assert.equal(requests.filter((request) => request.text).length, 1);
  assert.equal(result.calls.length, 2);
});

test("identity generation contract states the status-dependent null invariant", async () => {
  const requests: CapturedRequest[] = [];
  await runSelectiveResearch(
    fakeResearchClient(requests, unresolvedDraft("unverified")),
    identityStage1,
  );
  const identityRequest = requests.find((request) => request.text);
  assert.ok(identityRequest);
  assert.match(
    String(identityRequest.instructions),
    /When status is verified, canonical_identity and identity_type must be populated\./,
  );
  assert.match(
    String(identityRequest.instructions),
    /When status is unverified or conflicted, canonical_identity, identity_type, and location must all be null/,
  );
  assert.match(
    String(identityRequest.instructions),
    /tentative, rejected, or conflicting possibilities only in verification_basis and match_evidence/,
  );
});

test("identity verification receives only gated identity-dependent questions", async () => {
  const stage1 = structuredClone(identityStage1);
  stage1.candidates[1]!.identity_context_needed = false;
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, verifiedDraft),
    stage1,
  );
  const verificationInput = String(
    requests.find((request) => request.text)!.input,
  );
  assert.match(verificationInput, /"question_id":"q1"/);
  assert.doesNotMatch(verificationInput, /"question_id":"q2"/);
  assert.equal(result.calls[0]!.used_verified_identity_context, true);
  assert.equal(result.calls[1]!.used_verified_identity_context, false);
});

test("unverified identity is never supplied downstream as verified fact", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, unresolvedDraft("unverified")),
    identityStage1,
  );
  const candidateInputs = requests
    .filter((request) => !request.text)
    .map((request) => String(request.input));
  assert.equal(result.identityVerification.metrics.status, "unverified");
  assert.equal(
    result.calls.every((call) => !call.used_verified_identity_context),
    true,
  );
  assert.equal(
    candidateInputs.every(
      (input) =>
        !input.includes("VERIFIED IDENTITY CONTEXT") &&
        !input.includes("Noordoostpolder, Netherlands"),
    ),
    true,
  );
});

test("conflicting identity result fails safely without identity reuse", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, unresolvedDraft("conflicted")),
    identityStage1,
  );
  assert.equal(result.identityVerification.metrics.status, "conflicted");
  assert.equal(
    result.calls.every((call) => !call.used_verified_identity_context),
    true,
  );
  assert.match(
    String(requests[1]!.input),
    /IDENTITY VERIFICATION STATUS: conflicted/,
  );
});

test("one verified identity is reused across multiple relevant candidate calls", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, verifiedDraft),
    identityStage1,
  );
  const candidateInputs = requests
    .filter((request) => !request.text)
    .map((request) => String(request.input));
  assert.equal(result.calls.length, 2);
  assert.equal(
    result.calls.every((call) => call.used_verified_identity_context),
    true,
  );
  assert.equal(
    candidateInputs.every((input) => input.includes("Noordoostpolder")),
    true,
  );
});

test("candidate research remains restricted to its original Stage 1 question", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, verifiedDraft),
    identityStage1,
  );
  const candidateRequests = requests.filter((request) => !request.text);
  assert.match(
    String(candidateRequests[0]!.input),
    new RegExp(
      identityStage1.candidates[0]!.investigation_question.replace("?", "\\?"),
    ),
  );
  assert.doesNotMatch(
    String(candidateRequests[0]!.input),
    new RegExp(
      identityStage1.candidates[1]!.investigation_question.replace("?", "\\?"),
    ),
  );
  assert.match(
    String(candidateRequests[0]!.input),
    /Answer only the APPROVED QUESTION/,
  );
  assert.deepEqual(
    result.results.map((item) => item.question),
    identityStage1.candidates.map(
      (candidate) => candidate.investigation_question,
    ),
  );
});

test("shared typography or generic similarity alone cannot verify an exact identity", () => {
  assert.throws(() =>
    validateIdentityVerification(
      identityStage1,
      {
        ...verifiedDraft,
        match_evidence: [
          {
            basis: "shared_label_or_typography",
            detail:
              "Another plate uses the same COVPE LONGITVDINALE lettering.",
          },
        ],
      },
      [{ title: "Similar plate", url: "https://example.com/similar" }],
    ),
  );
});

test("identity-derived discoveries remain tied to Stage 1 candidates and regions", () => {
  const identity = validateIdentityVerification(identityStage1, verifiedDraft, [
    { title: "Identity source", url: "https://example.com/identity" },
  ]);
  const draft: { discoveries: DiscoveryDraft[] } = {
    discoveries: [
      {
        id: "d1",
        type: "local",
        title: "The circle belongs to the polder system",
        visual_trigger: "The isolated circular feature beside the waterway.",
        observation: "The circle contrasts with the rectangular parcels.",
        discovery: "Verified place context makes the circle interpretable.",
        why_it_matters:
          "It changes the feature from anomaly to infrastructure.",
        explanation:
          "The verified identity narrows the visible feature's context.",
        reinterpretation:
          "Look back at the circle in relation to the waterway.",
        region_ids: ["r2"],
        provenance: "researched",
        confidence: 0.82,
        sources: identity.sources,
        candidate_ids: ["c1"],
      },
    ],
  };
  assert.equal(
    validateDiscoveryOutput(identityStage1, [], draft, identity).discoveries
      .length,
    1,
  );

  const badRegion = structuredClone(draft);
  badRegion.discoveries[0]!.region_ids = ["missing"];
  assert.throws(() =>
    validateDiscoveryOutput(identityStage1, [], badRegion, identity),
  );

  const badCandidate = structuredClone(draft);
  badCandidate.discoveries[0]!.candidate_ids = ["missing"];
  assert.throws(() =>
    validateDiscoveryOutput(identityStage1, [], badCandidate, identity),
  );
});

test("identity verification sources use the existing URL safety validation", () => {
  assert.throws(() =>
    validateIdentityVerification(identityStage1, verifiedDraft, [
      { title: "Unsafe", url: "javascript:alert(1)" },
    ]),
  );
});

test("identity verification metrics record status, usage, cost, and reuse count", async () => {
  const requests: CapturedRequest[] = [];
  const result = await runSelectiveResearch(
    fakeResearchClient(requests, verifiedDraft),
    identityStage1,
  );
  assert.equal(result.identityVerification.metrics.ran, true);
  assert.equal(result.identityVerification.metrics.status, "verified");
  assert.equal(
    result.identityVerification.metrics.usage?.model,
    "gpt-5.6-terra",
  );
  assert.equal(typeof result.identityVerification.metrics.cost_usd, "number");
  assert.equal(
    result.calls.filter((call) => call.used_verified_identity_context).length,
    2,
  );
});

test("verified identity requires canonical identity and type", () => {
  for (const field of ["canonical_identity", "identity_type"] as const) {
    assert.throws(() =>
      validateIdentityVerification(
        identityStage1,
        { ...verifiedDraft, [field]: null },
        [{ title: "Identity", url: "https://example.com/identity" }],
      ),
    );
  }
});

test("unverified and conflicted identities pass only with null identity fields", () => {
  for (const status of ["unverified", "conflicted"] as const) {
    assert.equal(
      validateIdentityVerification(identityStage1, unresolvedDraft(status), [])
        .status,
      status,
    );
  }
});

test("unverified and conflicted identities reject each populated identity field", () => {
  const populatedValues = {
    canonical_identity: "Convenient nearest match",
    identity_type: "place" as const,
    location: "Tentative location",
  };
  for (const status of ["unverified", "conflicted"] as const) {
    for (const field of Object.keys(populatedValues) as Array<
      keyof typeof populatedValues
    >) {
      assert.throws(() =>
        validateIdentityVerification(
          identityStage1,
          {
            ...unresolvedDraft(status),
            [field]: populatedValues[field],
          },
          [],
        ),
      );
    }
  }
});

test("the full pipeline withholds unverified hypotheses from Stage 3", async () => {
  const responseRequests: CapturedRequest[] = [];
  const researchClient = fakeResearchClient(
    responseRequests,
    unresolvedDraft("unverified"),
  ) as unknown as {
    responses: { create: (request: CapturedRequest) => Promise<unknown> };
  };
  const chatRequests: Array<{ messages?: unknown }> = [];
  let chatCall = 0;
  const fakeOpenAI = {
    responses: researchClient.responses,
    chat: {
      completions: {
        create: async (request: { messages?: unknown }) => {
          chatRequests.push(request);
          chatCall += 1;
          return chatCall === 1
            ? chatResponse(identityStage1)
            : chatResponse({ discoveries: [] });
        },
      },
    },
  } as unknown as Parameters<typeof runDiscoveryPipeline>[0];

  const result = await runDiscoveryPipeline(
    fakeOpenAI,
    "data:image/png;base64,YWJj",
  );
  const stage3Request = JSON.stringify(chatRequests[1]);
  assert.equal(result.version, "discovery-engine-v1");
  assert.equal(result.inspection.identity_verification?.status, "unverified");
  assert.equal(result.inspection.stage1.identity_hypotheses.length, 1);
  assert.doesNotMatch(stage3Request, /Noordoostpolder/);
  assert.match(stage3Request, /IDENTITY VERIFICATION RESULT/);
  assert.match(stage3Request, /unverified/);
});

test("verified identity sources cannot support an unrelated candidate", () => {
  const identity = validateIdentityVerification(identityStage1, verifiedDraft, [
    { title: "Identity source", url: "https://example.com/identity" },
  ]) as DiscoveryIdentityVerification;
  const stage1 = structuredClone(identityStage1);
  stage1.candidates[1]!.identity_context_needed = false;
  const draft: { discoveries: DiscoveryDraft[] } = {
    discoveries: [
      {
        id: "d2",
        type: "global",
        title: "Unrelated identity claim",
        visual_trigger: "The parcel boundaries change direction.",
        observation: "Two parcel systems meet.",
        discovery: "An identity source is incorrectly attached.",
        why_it_matters: "It would improperly broaden the evidence.",
        explanation: "This must be rejected.",
        reinterpretation: "Look at the parcel boundary only.",
        region_ids: ["r1"],
        provenance: "researched",
        confidence: 0.5,
        sources: identity.sources,
        candidate_ids: ["c2"],
      },
    ],
  };
  assert.throws(() => validateDiscoveryOutput(stage1, [], draft, identity));
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  DiscoveryResearchResultSchema,
  DiscoveryStage1Schema,
  DiscoveryStage3Schema,
  evaluateResearchGate,
  validateDiscoveryOutput,
  validateResearchResults,
  type DiscoveryDraft,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";
import { runSelectiveResearch } from "../../artifacts/api-server/src/lib/discoveryPipeline";
import { computeDiscoveryCacheKey } from "../../artifacts/api-server/src/lib/discoveryCache";
import { computeCacheKey } from "../../artifacts/api-server/src/lib/analysisCache";
import {
  DISCOVERY_LAB_PATH,
  LEGACY_APP_PATH,
  isDiscoveryLabPath,
} from "../../artifacts/noesis/src/lib/appRoutes";

const stage1Fixture: DiscoveryStage1 = {
  image_summary: "A chart with a visible late-series reversal.",
  regions: [
    {
      id: "r1",
      description: "The final two plotted points",
      scope: "local",
      x: 0.65,
      y: 0.2,
      width: 0.3,
      height: 0.5,
    },
  ],
  candidates: [
    {
      id: "c1",
      question_id: "q1",
      visual_trigger: "The final line segment reverses sharply upward.",
      observation: "The plotted series changes direction at the last point.",
      region_ids: ["r1"],
      investigation_question:
        "Did a documented event cause the visible reversal at the final point?",
      research_needed: true,
      research_rationale:
        "A verified event could explain why the visible series changes direction.",
      identity_context_needed: false,
    },
    {
      id: "c2",
      question_id: "q2",
      visual_trigger:
        "The last point is visibly higher than the previous point.",
      observation:
        "The comparison can be made directly from the plotted positions.",
      region_ids: ["r1"],
      investigation_question:
        "How large is the visible difference between the final two points?",
      research_needed: false,
      research_rationale: "The image itself is sufficient for this comparison.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [],
};

const researchedResult = {
  candidate_id: "c1",
  question_id: "q1",
  question: stage1Fixture.candidates[0]!.investigation_question,
  status: "answered" as const,
  finding: "A documented event coincided with the reversal.",
  sources: [{ title: "Primary source", url: "https://example.com/source" }],
};

const derivedDraft: { discoveries: DiscoveryDraft[] } = {
  discoveries: [
    {
      id: "d1",
      type: "local" as const,
      title: "The ending breaks the prior direction",
      visual_trigger: "The final line segment turns upward.",
      observation: "The last point is above the preceding point.",
      discovery: "The series ends with a reversal rather than a continuation.",
      why_it_matters: "The endpoint changes the apparent trajectory.",
      explanation:
        "Compare the direction of the last segment with the one before it.",
      reinterpretation:
        "Look back at the final bend instead of reading the line as one trend.",
      region_ids: ["r1"],
      provenance: "derived" as const,
      confidence: 0.9,
      sources: [],
      candidate_ids: ["c2"],
    },
  ],
};

test("valid Discovery Stage 1 output passes strict validation", () => {
  assert.equal(DiscoveryStage1Schema.parse(stage1Fixture).candidates.length, 2);
});

test("malformed Discovery Stage 1 output fails validation", () => {
  const malformed = structuredClone(stage1Fixture);
  malformed.candidates[0]!.region_ids = ["missing"];
  assert.equal(DiscoveryStage1Schema.safeParse(malformed).success, false);
});

test("a candidate without a specific visual trigger cannot trigger research", () => {
  const candidate = {
    ...stage1Fixture.candidates[0]!,
    visual_trigger: "short",
  };
  assert.equal(evaluateResearchGate(stage1Fixture, candidate).allowed, false);
});

test("a candidate marked as not needing research does not trigger research", () => {
  assert.equal(
    evaluateResearchGate(stage1Fixture, stage1Fixture.candidates[1]!).allowed,
    false,
  );
});

test("only Stage 1-generated approved questions reach Stage 2", async () => {
  const requests: Array<{ input?: unknown }> = [];
  const fakeOpenAI = {
    responses: {
      create: async (request: { input?: unknown }) => {
        requests.push(request);
        return {
          model: "gpt-5.6-terra",
          output_text:
            "ANSWERED: A documented event coincided with the reversal.",
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: "A documented event coincided with the reversal.",
                  annotations: [
                    {
                      type: "url_citation",
                      title: "Primary source",
                      url: "https://example.com/source",
                      start_index: 0,
                      end_index: 10,
                    },
                  ],
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
      },
    },
  } as unknown as Parameters<typeof runSelectiveResearch>[0];

  const result = await runSelectiveResearch(fakeOpenAI, stage1Fixture);
  assert.equal(requests.length, 1);
  assert.match(
    String(requests[0]!.input),
    new RegExp(
      stage1Fixture.candidates[0]!.investigation_question.replace(
        /[?]/g,
        "\\?",
      ),
    ),
  );
  assert.doesNotMatch(
    String(requests[0]!.input),
    new RegExp(
      stage1Fixture.candidates[1]!.investigation_question.replace(
        /[?]/g,
        "\\?",
      ),
    ),
  );
  assert.equal(result.results[0]!.candidate_id, "c1");
});

test("Stage 2 makes zero calls when no candidate passes the research gate", async () => {
  const noResearch: DiscoveryStage1 = {
    ...stage1Fixture,
    candidates: [stage1Fixture.candidates[1]!],
  };
  const fakeOpenAI = {
    responses: {
      create: async () => {
        throw new Error("Responses API must not be called");
      },
    },
  } as unknown as Parameters<typeof runSelectiveResearch>[0];
  const result = await runSelectiveResearch(fakeOpenAI, noResearch);
  assert.deepEqual(result, {
    results: [],
    calls: [],
    identityVerification: {
      result: null,
      metrics: {
        ran: false,
        status: "not_run",
        usage: null,
        web_search_calls: 0,
        model_token_cost_usd: null,
        tool_cost_usd: 0,
        total_known_cost_usd: null,
        cost_usd: null,
        cost_reason: null,
      },
    },
  });
});

test("research result ids and questions must match a Stage 1 candidate", () => {
  assert.throws(() =>
    validateResearchResults(stage1Fixture, [
      { ...researchedResult, question_id: "other" },
    ]),
  );
});

test("fabricated or invalid source URL data is rejected", () => {
  assert.equal(
    DiscoveryResearchResultSchema.safeParse({
      ...researchedResult,
      sources: [{ title: "Bad", url: "javascript:alert(1)" }],
    }).success,
    false,
  );
  const finalWithUnvalidatedUrl = structuredClone(derivedDraft);
  finalWithUnvalidatedUrl.discoveries[0]!.explanation =
    "A claim appears at https://unvalidated.example/path";
  assert.throws(() =>
    validateDiscoveryOutput(stage1Fixture, [], finalWithUnvalidatedUrl),
  );
});

test("final discoveries must reference valid Stage 1 regions", () => {
  const invalid = structuredClone(derivedDraft);
  invalid.discoveries[0]!.region_ids = ["missing"];
  assert.throws(() => validateDiscoveryOutput(stage1Fixture, [], invalid));
});

test("researched discoveries can carry only validated matching sources", () => {
  const researched = structuredClone(derivedDraft);
  researched.discoveries[0] = {
    ...researched.discoveries[0]!,
    provenance: "researched",
    sources: researchedResult.sources,
    candidate_ids: ["c1"],
  };
  const result = validateDiscoveryOutput(
    stage1Fixture,
    [researchedResult],
    researched,
  );
  assert.deepEqual(result.discoveries[0]!.sources, researchedResult.sources);
});

test("non-researched discoveries cannot acquire research sources", () => {
  const invalid = structuredClone(derivedDraft);
  invalid.discoveries[0]!.sources = researchedResult.sources;
  assert.throws(() =>
    validateDiscoveryOutput(stage1Fixture, [researchedResult], invalid),
  );
});

test("the strict final Discovery output schema validates", () => {
  assert.equal(DiscoveryStage3Schema.safeParse(derivedDraft).success, true);
  assert.equal(
    validateDiscoveryOutput(stage1Fixture, [], derivedDraft).discoveries.length,
    1,
  );
});

test("Discovery lab routing remains distinct from the legacy root", () => {
  assert.equal(LEGACY_APP_PATH, "/");
  assert.equal(DISCOVERY_LAB_PATH, "/discovery-lab");
  assert.equal(isDiscoveryLabPath(LEGACY_APP_PATH), false);
  assert.equal(isDiscoveryLabPath(DISCOVERY_LAB_PATH), true);
});

test("Discovery V1 uses a cache identity distinct from V0 and legacy analysis", () => {
  const image = "data:image/png;base64,YWJj";
  const discovery = computeDiscoveryCacheKey(image).cacheKey;
  const legacy = computeCacheKey(image).cacheKey;
  assert.match(discovery, /^discovery-engine-v1:/);
  assert.notEqual(discovery, discovery.replace("v1", "v0"));
  assert.notEqual(discovery, legacy);
});

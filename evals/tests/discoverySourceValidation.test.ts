import assert from "node:assert/strict";
import test from "node:test";
import {
  DiscoverySourceValidationError,
  canonicalSourceUrl,
  safeSourceLocation,
  validateDiscoveryOutput,
  type DiscoveryResearchResult,
  type DiscoveryStage1,
} from "../../artifacts/api-server/src/lib/discoveryContracts";

// Minimal Stage 1 with two candidates and one region.
const stage1: DiscoveryStage1 = {
  image_summary: "A landscape with two independent visible anomalies.",
  regions: [
    {
      id: "r1",
      description: "The complete landscape",
      scope: "global",
      x: 0,
      y: 0,
      width: 1,
      height: 1,
    },
  ],
  candidates: [
    {
      id: "cand_A",
      question_id: "q_A",
      visual_trigger: "A circular feature interrupts the grid.",
      observation: "The circle is isolated beside a channel.",
      region_ids: ["r1"],
      investigation_question: "What function does the circular feature serve?",
      research_needed: true,
      research_rationale:
        "External evidence could explain the visible anomaly.",
      identity_context_needed: false,
    },
    {
      id: "cand_B",
      question_id: "q_B",
      visual_trigger: "A straight boundary divides two orientations.",
      observation: "The field axes change abruptly at the boundary.",
      region_ids: ["r1"],
      investigation_question: "Why do the orientations change here?",
      research_needed: true,
      research_rationale: "Planning history could explain the boundary.",
      identity_context_needed: false,
    },
  ],
  identity_hypotheses: [],
};

function answered(
  candidateId: string,
  questionId: string,
  urls: string[],
): DiscoveryResearchResult {
  return {
    candidate_id: candidateId,
    question_id: questionId,
    question:
      candidateId === "cand_A"
        ? "What function does the circular feature serve?"
        : "Why do the orientations change here?",
    status: "answered",
    finding: "Trustworthy evidence answers the question.",
    sources: urls.map((url) => ({ title: `Source ${url}`, url })),
  };
}

function insufficient(
  candidateId: string,
  questionId: string,
): DiscoveryResearchResult {
  return {
    candidate_id: candidateId,
    question_id: questionId,
    question:
      candidateId === "cand_A"
        ? "What function does the circular feature serve?"
        : "Why do the orientations change here?",
    status: "insufficient",
    finding: "Reliable research did not return a usable answer.",
    sources: [],
  };
}

function discovery(options: {
  candidateIds: string[];
  sourceUrls: string[];
  provenance?: "researched" | "seen" | "derived";
}) {
  return {
    discoveries: [
      {
        id: "d1",
        type: "local",
        title: "The circle is functional infrastructure",
        visual_trigger: "The isolated circular feature beside the channel.",
        observation: "It interrupts the rectilinear field pattern.",
        discovery: "Candidate-local research explains the feature's function.",
        why_it_matters: "The anomaly belongs to the engineered system.",
        explanation: "Its unusual geometry follows from that function.",
        reinterpretation: "Look back at the circle as working infrastructure.",
        region_ids: ["r1"],
        candidate_ids: options.candidateIds,
        provenance: options.provenance ?? "researched",
        confidence: 0.9,
        sources: options.sourceUrls.map((url) => ({
          title: `Source ${url}`,
          url,
        })),
      },
    ],
  };
}

function run(
  research: DiscoveryResearchResult[],
  draft: ReturnType<typeof discovery>,
) {
  return validateDiscoveryOutput(stage1, research, draft);
}

// --- canonicalSourceUrl unit semantics ---

test("canonicalSourceUrl: http/https only, strips fragment + chatgpt utm, sorts params", () => {
  assert.equal(
    canonicalSourceUrl("https://example.com/page"),
    "https://example.com/page",
  );
  // fragment dropped
  assert.equal(
    canonicalSourceUrl("https://example.com/page#section"),
    canonicalSourceUrl("https://example.com/page"),
  );
  // utm_source=chatgpt.com removed, but only that exact decoration
  assert.equal(
    canonicalSourceUrl("https://example.com/page?utm_source=chatgpt.com"),
    canonicalSourceUrl("https://example.com/page"),
  );
  assert.notEqual(
    canonicalSourceUrl("https://example.com/page?utm_source=elsewhere"),
    canonicalSourceUrl("https://example.com/page"),
  );
  // param order normalized
  assert.equal(
    canonicalSourceUrl("https://example.com/page?b=2&a=1"),
    canonicalSourceUrl("https://example.com/page?a=1&b=2"),
  );
  // meaningful value difference preserved
  assert.notEqual(
    canonicalSourceUrl("https://example.com/page?id=1"),
    canonicalSourceUrl("https://example.com/page?id=2"),
  );
  // non-http(s) rejected
  assert.equal(canonicalSourceUrl("ftp://example.com/x"), null);
  assert.equal(canonicalSourceUrl("javascript:alert(1)"), null);
  assert.equal(canonicalSourceUrl("not a url"), null);
});

// --- validateDiscoveryOutput ownership (canonicalized) ---

test("1. exact match passes", () => {
  const result = run(
    [answered("cand_A", "q_A", ["https://example.com/page"])],
    discovery({
      candidateIds: ["cand_A"],
      sourceUrls: ["https://example.com/page"],
    }),
  );
  assert.equal(result.discoveries.length, 1);
});

test("2. chatgpt utm decoration parity passes both directions", () => {
  // validated decorated, emitted clean
  assert.equal(
    run(
      [
        answered("cand_A", "q_A", [
          "https://example.com/page?utm_source=chatgpt.com",
        ]),
      ],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: ["https://example.com/page"],
      }),
    ).discoveries.length,
    1,
  );
  // validated clean, emitted decorated
  assert.equal(
    run(
      [answered("cand_A", "q_A", ["https://example.com/page"])],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: ["https://example.com/page?utm_source=chatgpt.com"],
      }),
    ).discoveries.length,
    1,
  );
});

test("3. fragment-only difference passes", () => {
  assert.equal(
    run(
      [answered("cand_A", "q_A", ["https://example.com/page#s"])],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: ["https://example.com/page"],
      }),
    ).discoveries.length,
    1,
  );
});

test("4. query parameter order difference passes", () => {
  assert.equal(
    run(
      [answered("cand_A", "q_A", ["https://example.com/page?b=2&a=1"])],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: ["https://example.com/page?a=1&b=2"],
      }),
    ).discoveries.length,
    1,
  );
});

test("5. meaningful query value difference fails as UNKNOWN_SOURCE", () => {
  assert.throws(
    () =>
      run(
        [answered("cand_A", "q_A", ["https://example.com/page?id=1"])],
        discovery({
          candidateIds: ["cand_A"],
          sourceUrls: ["https://example.com/page?id=2"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoverySourceValidationError);
      assert.equal(error.detail.reason, "UNKNOWN_SOURCE");
      assert.equal(error.detail.canonical_equivalent_exists, false);
      return true;
    },
  );
});

test("6. invented / foreign URL fails as UNKNOWN_SOURCE", () => {
  assert.throws(
    () =>
      run(
        [answered("cand_A", "q_A", ["https://example.com/a"])],
        discovery({
          candidateIds: ["cand_A"],
          sourceUrls: ["https://other.example/b"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoverySourceValidationError);
      assert.equal(error.detail.reason, "UNKNOWN_SOURCE");
      return true;
    },
  );
});

test("7. cross-candidate ownership STILL fails (no shared-evidence leakage) and classifies the owner", () => {
  assert.throws(
    () =>
      run(
        [
          answered("cand_A", "q_A", ["https://example.com/a"]),
          answered("cand_B", "q_B", ["https://example.com/b"]),
        ],
        // declares only cand_A but cites cand_B's source
        discovery({
          candidateIds: ["cand_A"],
          sourceUrls: ["https://example.com/b"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoverySourceValidationError);
      assert.equal(error.detail.reason, "CROSS_CANDIDATE_SOURCE");
      assert.equal(error.detail.canonical_equivalent_exists, true);
      assert.deepEqual(error.detail.owning_candidate_ids, ["cand_B"]);
      assert.equal(error.detail.owner_declared, false);
      assert.deepEqual(error.detail.declared_candidate_ids, ["cand_A"]);
      return true;
    },
  );
});

test("7b. cross-candidate parity: utm-decorated sibling source is still cross-candidate, not allowed", () => {
  assert.throws(
    () =>
      run(
        [
          answered("cand_A", "q_A", ["https://example.com/a"]),
          answered("cand_B", "q_B", [
            "https://example.com/b?utm_source=chatgpt.com",
          ]),
        ],
        discovery({
          candidateIds: ["cand_A"],
          sourceUrls: ["https://example.com/b"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoverySourceValidationError);
      assert.equal(error.detail.reason, "CROSS_CANDIDATE_SOURCE");
      assert.deepEqual(error.detail.owning_candidate_ids, ["cand_B"]);
      return true;
    },
  );
});

test("8. insufficient candidate's source cannot become allowed", () => {
  // cand_B insufficient: its source is not part of any answered result.
  assert.throws(
    () =>
      run(
        [
          answered("cand_A", "q_A", ["https://example.com/a"]),
          insufficient("cand_B", "q_B"),
        ],
        discovery({
          candidateIds: ["cand_A", "cand_B"],
          sourceUrls: ["https://example.com/only-cand-b-would-have-had-this"],
        }),
      ),
    (error: unknown) => {
      assert.ok(error instanceof DiscoverySourceValidationError);
      // No answered candidate owns it anywhere -> UNKNOWN_SOURCE.
      assert.equal(error.detail.reason, "UNKNOWN_SOURCE");
      return true;
    },
  );
});

test("9. invalid / non-http URL is safely rejected", () => {
  // A non-http(s) source URL is rejected by the strict Stage-3 schema (HttpUrl) before
  // ownership classification is reached — defense in depth. The INVALID_URL classifier
  // branch remains as a defensive fallback and is exercised at the helper level by the
  // canonicalSourceUrl / safeSourceLocation null cases above.
  assert.throws(() =>
    run(
      [answered("cand_A", "q_A", ["https://example.com/a"])],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: ["ftp://example.com/a"],
      }),
    ),
  );
});

test("10. safe diagnostic exposes location structure but never query VALUES", () => {
  let captured: DiscoverySourceValidationError | null = null;
  try {
    run(
      [answered("cand_A", "q_A", ["https://example.com/a"])],
      discovery({
        candidateIds: ["cand_A"],
        sourceUrls: [
          "https://leak.example/secret-path?token=SECRETVALUE&id=42",
        ],
      }),
    );
  } catch (error) {
    captured = error as DiscoverySourceValidationError;
  }
  assert.ok(captured instanceof DiscoverySourceValidationError);
  const detail = captured.detail;
  assert.equal(detail.discovery_id, "d1");
  assert.equal(detail.location.valid, true);
  assert.equal(detail.location.origin, "https://leak.example");
  assert.equal(detail.location.pathname, "/secret-path");
  // Query KEYS only, never values.
  assert.deepEqual(detail.location.query_keys, ["id", "token"]);
  // The sensitive value must appear nowhere in the serialized diagnostic.
  const serialized = JSON.stringify(detail);
  assert.doesNotMatch(serialized, /SECRETVALUE/);
  assert.doesNotMatch(serialized, /token=/);
  assert.equal(detail.applicable_allowed_source_count, 1);
});

test("safeSourceLocation never emits query values and rejects non-http", () => {
  const loc = safeSourceLocation("https://h.example/p?a=SECRET&b=2");
  assert.equal(loc.valid, true);
  assert.equal(loc.origin, "https://h.example");
  assert.equal(loc.pathname, "/p");
  assert.deepEqual(loc.query_keys, ["a", "b"]);
  assert.doesNotMatch(JSON.stringify(loc), /SECRET/);
  assert.equal(safeSourceLocation("mailto:x@y.com").valid, false);
});

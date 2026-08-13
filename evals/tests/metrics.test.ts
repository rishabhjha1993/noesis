import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeChatUsage,
  imageDimensions,
} from "../../artifacts/api-server/src/lib/analysisMetrics";
import { estimateModelCost } from "../../artifacts/api-server/src/lib/modelPricing";

test("normalizes Chat Completions usage details without inventing values", () => {
  const response = {
    model: "test-model",
    usage: {
      prompt_tokens: 100,
      completion_tokens: 40,
      total_tokens: 140,
      prompt_tokens_details: { cached_tokens: 25 },
      completion_tokens_details: { reasoning_tokens: 30 },
    },
  } as any;
  const result = normalizeChatUsage(response, "high", 123);
  assert.equal(result.input_tokens, 100);
  assert.equal(result.cached_input_tokens, 25);
  assert.equal(result.output_tokens, 40);
  assert.equal(result.reasoning_tokens, 30);
  assert.equal(result.total_tokens, 140);
  assert.equal(result.latency_ms, 123);
});

test("unknown model pricing is explicit and non-fatal", () => {
  assert.deepEqual(
    estimateModelCost({
      model: "unknown",
      input_tokens: 10,
      cached_input_tokens: 0,
      output_tokens: 5,
    }),
    { usd: null, reason: "No pricing configured for unknown" },
  );
});

test("prices uncached and cached Sol tokens at the configured rates", () => {
  const result = estimateModelCost({
    model: "gpt-5.6-sol",
    input_tokens: 1_000_000,
    cached_input_tokens: 200_000,
    output_tokens: 100_000,
  });
  // 800k * $5/M + 200k * $0.50/M + 100k * $30/M
  assert.deepEqual(result, { usd: 7.1, reason: null });
});

test("uses the supplied Terra and Luna rates", () => {
  assert.equal(
    estimateModelCost({
      model: "gpt-5.6-terra",
      input_tokens: 1_000_000,
      cached_input_tokens: 0,
      output_tokens: 1_000_000,
    }).usd,
    17.5,
  );
  assert.equal(
    estimateModelCost({
      model: "gpt-5.6-luna",
      input_tokens: 1_000_000,
      cached_input_tokens: 0,
      output_tokens: 1_000_000,
    }).usd,
    1.4,
  );
});

test("Luna static same-token counterfactual uses current documented rates", () => {
  const tokens = {
    input_tokens: 1_000,
    cached_input_tokens: 200,
    output_tokens: 500,
  };
  assert.equal(
    estimateModelCost({ model: "gpt-5.6-luna", ...tokens }).usd,
    0.000764,
  );
});

test("reads PNG dimensions from the image header", () => {
  const header = Buffer.alloc(24);
  header.write("\u0089PNG", 0, "latin1");
  header.writeUInt32BE(640, 16);
  header.writeUInt32BE(480, 20);
  assert.deepEqual(
    imageDimensions(`data:image/png;base64,${header.toString("base64")}`),
    { width: 640, height: 480 },
  );
});

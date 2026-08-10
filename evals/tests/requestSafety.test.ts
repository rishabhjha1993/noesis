import test from "node:test";
import assert from "node:assert/strict";
import {
  decodedImageBytes,
  FixedWindowRateLimiter,
} from "../../artifacts/api-server/src/lib/requestSafety";

test("decoded image size validates base64 and accounts for padding", () => {
  assert.equal(decodedImageBytes("data:image/png;base64,YQ=="), 1);
  assert.equal(decodedImageBytes("data:image/png;base64,YWI="), 2);
  assert.equal(decodedImageBytes("data:image/png;base64,YWJj"), 3);
  assert.equal(decodedImageBytes("data:image/png;base64,not valid"), null);
  assert.equal(decodedImageBytes("missing-comma"), null);
});

test("fixed-window limiter rejects excess requests and resets", () => {
  const limiter = new FixedWindowRateLimiter(2, 1_000);
  assert.deepEqual(limiter.consume("ip", 100), {
    allowed: true,
    remaining: 1,
    resetAt: 1_100,
  });
  assert.equal(limiter.consume("ip", 200).allowed, true);
  assert.equal(limiter.consume("ip", 300).allowed, false);
  assert.deepEqual(limiter.consume("ip", 1_100), {
    allowed: true,
    remaining: 1,
    resetAt: 2_100,
  });
});

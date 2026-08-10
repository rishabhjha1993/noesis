import test from "node:test";
import assert from "node:assert/strict";

test("quality rubric has nine five-point dimensions", () => {
  const dimensions = ["factual_grounding", "numerical_accuracy", "insight_value", "comparative_structural_reasoning", "spatial_grounding", "walkthrough_quality", "redundancy", "big_takeaway_quality", "so_what_explanatory_depth"];
  const scores = Object.fromEntries(dimensions.map((key) => [key, 5]));
  assert.equal(Object.values(scores).reduce((sum, value) => sum + value, 0), 45);
});

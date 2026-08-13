/**
 * Model prices in USD per one million tokens.
 *
 * Update this table only from an authoritative price source. Unknown models are
 * intentionally not estimated: a plausible-looking guess is worse than null in
 * a baseline. Cached input tokens may have a distinct rate when configured.
 */
export interface ModelPrice {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

export const MODEL_PRICING: Readonly<Record<string, ModelPrice>> = {
  // Official OpenAI model documentation, current as of August 2026.
  "gpt-5.6-sol": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.2,
    outputPerMillion: 12,
  },
  "gpt-5.6-luna": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1.2,
  },
};

// Official OpenAI pricing: $10 per 1,000 web-search calls.
export const WEB_SEARCH_TOOL_CALL_COST_USD = 0.01;

export function estimateWebSearchToolCost(callCount: number): number {
  if (!Number.isSafeInteger(callCount) || callCount < 0) {
    throw new Error("Web-search call count must be a non-negative integer");
  }
  return callCount * WEB_SEARCH_TOOL_CALL_COST_USD;
}

export interface UsageForCost {
  model: string;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
}

export interface PassCostEstimate {
  usd: number | null;
  reason: string | null;
}

export interface CostEstimate {
  pass1_usd: number | null;
  pass2_usd: number | null;
  total_usd: number | null;
  pass1_reason: string | null;
  pass2_reason: string | null;
}

export function estimateModelCost(usage: UsageForCost): PassCostEstimate {
  const price = MODEL_PRICING[usage.model];
  if (!price)
    return { usd: null, reason: `No pricing configured for ${usage.model}` };
  if (usage.input_tokens === null || usage.output_tokens === null) {
    return {
      usd: null,
      reason: "Required token usage was not returned by the API",
    };
  }
  const cached = usage.cached_input_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached);
  // The API's completion_tokens already includes reasoning tokens. Price the
  // completion total once; reasoning_tokens is diagnostic and is not added.
  const usd =
    (uncached * price.inputPerMillion +
      cached * price.cachedInputPerMillion +
      usage.output_tokens * price.outputPerMillion) /
    1_000_000;
  return { usd, reason: null };
}

export function estimatePipelineCost(
  pass1: UsageForCost,
  pass2: UsageForCost,
): CostEstimate {
  const first = estimateModelCost(pass1);
  const second = estimateModelCost(pass2);
  return {
    pass1_usd: first.usd,
    pass2_usd: second.usd,
    total_usd:
      first.usd === null || second.usd === null ? null : first.usd + second.usd,
    pass1_reason: first.reason,
    pass2_reason: second.reason,
  };
}

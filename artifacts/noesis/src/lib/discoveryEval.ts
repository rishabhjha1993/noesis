import type { DiscoveryRunResult } from "@workspace/api-client-react";
import type { DiscoveryBatchValidationIssue } from "@workspace/api-client-react";

const UNSAFE_EVAL_FIELD =
  /(^|_)(api_key|authorization|cookie|environment|env|headers|password|private_key|raw_usage|request|secret|stack|stack_trace)(_|$)/i;

export interface DiscoveryEvalContext {
  result: DiscoveryRunResult;
  discoveryId: string;
  cacheHit: boolean;
}

export function getBatchValidationIssues(
  result: DiscoveryRunResult,
): DiscoveryBatchValidationIssue[] {
  const metricIssues = result.metrics.stage2.batch?.validation_issues;
  if (Array.isArray(metricIssues)) return metricIssues;
  const inspectionIssues = result.inspection.research_batch?.validation_issues;
  return Array.isArray(inspectionIssues) ? inspectionIssues : [];
}

export function findUnsafeEvalFieldPaths(value: unknown): string[] {
  const unsafe: string[] = [];
  const visit = (candidate: unknown, path: string): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!candidate || typeof candidate !== "object") return;
    for (const [key, child] of Object.entries(candidate)) {
      const childPath = path ? `${path}.${key}` : key;
      if (UNSAFE_EVAL_FIELD.test(key)) unsafe.push(childPath);
      visit(child, childPath);
    }
  };
  visit(value, "");
  return unsafe;
}

export function createDiscoveryEvalPayload({
  result,
  discoveryId,
  cacheHit,
}: DiscoveryEvalContext) {
  const structuredRun = {
    discovery_id: discoveryId,
    version: result.version,
    regions: result.regions,
    inspection: result.inspection,
    discoveries: result.discoveries,
    metrics: result.metrics,
    cache_hit: cacheHit,
  };
  const unsafe = findUnsafeEvalFieldPaths(structuredRun);
  if (unsafe.length > 0) {
    throw new Error("The eval payload contains internal-only fields");
  }
  return JSON.parse(
    JSON.stringify(structuredRun, (key, value) =>
      key === "reasoning_tokens" ? undefined : value,
    ),
  ) as typeof structuredRun;
}

export function serializeDiscoveryEvalPayload(
  context: DiscoveryEvalContext,
): string {
  return JSON.stringify(createDiscoveryEvalPayload(context), null, 2);
}

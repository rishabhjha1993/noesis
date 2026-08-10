import type {
  DiscoveryBatchInspection,
  DiscoveryBatchResearchMetrics,
  DiscoveryPipelineResult,
} from "./discoveryPipeline";
import {
  DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
  type DiscoveryBatchValidationIssue,
} from "./discoveryBatchResearch";

export { DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION };

type LegacyBatchDiagnostics = {
  validation_issues?: DiscoveryBatchValidationIssue[];
};

function recordedValidationIssues(
  inspection: (DiscoveryBatchInspection & LegacyBatchDiagnostics) | undefined,
  metrics: (DiscoveryBatchResearchMetrics & LegacyBatchDiagnostics) | null,
): DiscoveryBatchValidationIssue[] {
  if (Array.isArray(inspection?.validation_issues)) {
    return inspection.validation_issues;
  }
  if (Array.isArray(metrics?.validation_issues)) {
    return metrics.validation_issues;
  }

  const invalidCandidateIds =
    inspection?.invalid_candidate_ids ?? metrics?.invalid_candidate_ids ?? [];
  const candidates = inspection?.candidates ?? [];
  return invalidCandidateIds.map((candidateId) => ({
    candidate_id: candidateId,
    question_id:
      candidates.find((candidate) => candidate.candidate_id === candidateId)
        ?.question_id ?? "unknown",
    validation_category: "unknown",
    safe_message:
      "The stored result marked this candidate invalid but did not record a candidate-level validation reason.",
  }));
}

/**
 * Establishes the API/persistence diagnostics contract without changing research
 * validation. The fallback exists only for results created by older runtimes.
 */
export function normalizeDiscoveryValidationDiagnostics(
  result: DiscoveryPipelineResult,
): DiscoveryPipelineResult {
  const inspectionBatch = result.inspection.research_batch;
  const metricsBatch = result.metrics.stage2.batch;
  if (!inspectionBatch && !metricsBatch) return result;

  const validationIssues = recordedValidationIssues(
    inspectionBatch,
    metricsBatch,
  );

  return {
    ...result,
    inspection: {
      ...result.inspection,
      ...(inspectionBatch
        ? {
            research_batch: {
              ...inspectionBatch,
              validation_diagnostics_version:
                DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
              validation_issues: validationIssues,
            },
          }
        : {}),
    },
    metrics: {
      ...result.metrics,
      stage2: {
        ...result.metrics.stage2,
        batch: metricsBatch
          ? {
              ...metricsBatch,
              validation_diagnostics_version:
                DISCOVERY_VALIDATION_DIAGNOSTICS_VERSION,
              validation_issues: validationIssues,
            }
          : null,
      },
    },
  };
}

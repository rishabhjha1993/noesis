import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  computeDiscoveryCacheKey,
  getOrComputeDiscovery,
} from "./discoveryCache";
import {
  DEFAULT_DISCOVERY_ENGINE_VARIANT,
  createUnknownDiscoveryFailureDiagnostic,
  discoveryEngineVersionForVariant,
  getDiscoveryFailureDiagnostic,
  runDiscoveryPipeline,
  type DiscoveryEngineVariant,
  type DiscoveryFailureDiagnostic,
  type DiscoveryPipelineResult,
} from "./discoveryPipeline";
import { logger } from "./logger";
import { normalizeDiscoveryValidationDiagnostics } from "./discoveryDiagnostics";

export type DiscoveryJob =
  | { status: "pending"; createdAt: number }
  | {
      status: "done";
      createdAt: number;
      result: DiscoveryPipelineResult;
      cacheHit: boolean;
    }
  | {
      status: "error";
      createdAt: number;
      error: string;
      diagnostic: DiscoveryFailureDiagnostic;
    };

const jobs = new Map<string, DiscoveryJob>();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_DISCOVERY_JOBS = 2;

function sanitizeLogText(value: string): string {
  return value
    .replace(
      /data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi,
      "[image omitted]",
    )
    .replace(/\bsk-[a-z0-9_-]+\b/gi, "[secret omitted]")
    .replace(
      /((?:openai_)?api[_-]?key\s*[:=]\s*["']?)[^\s,"';}]+/gi,
      "$1[secret omitted]",
    )
    .replace(
      /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
      "$1[secret omitted]",
    )
    .slice(0, 8_000);
}

export function discoveryErrorLogDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  const underlying =
    error instanceof Error && error.cause instanceof Error
      ? error.cause
      : error;
  if (!(underlying instanceof Error)) {
    return { name: "UnknownError", message: "Non-Error failure value" };
  }
  return {
    name: underlying.name,
    message: sanitizeLogText(underlying.message).slice(0, 2_000),
    ...(underlying.stack ? { stack: sanitizeLogText(underlying.stack) } : {}),
  };
}

export function createDiscoveryErrorJob(
  error: unknown,
  startedAt: number,
  engineVersion?: string,
): Extract<DiscoveryJob, { status: "error" }> {
  return {
    status: "error",
    createdAt: Date.now(),
    error: "Discovery failed. Please try again or choose another image.",
    diagnostic:
      getDiscoveryFailureDiagnostic(error) ??
      createUnknownDiscoveryFailureDiagnostic(error, startedAt, engineVersion),
  };
}

export function createDiscoveryDoneJob(
  result: DiscoveryPipelineResult,
  cacheHit: boolean,
): Extract<DiscoveryJob, { status: "done" }> {
  return {
    status: "done",
    createdAt: Date.now(),
    result: normalizeDiscoveryValidationDiagnostics(result),
    cacheHit,
  };
}

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function pendingCount(): number {
  let count = 0;
  for (const job of jobs.values()) {
    if (job.status === "pending") count += 1;
  }
  return count;
}

export function startDiscoveryJob(
  apiKey: string,
  imageDataUrl: string,
  variant: DiscoveryEngineVariant = DEFAULT_DISCOVERY_ENGINE_VARIANT,
): { discoveryId: string } | { busy: true } {
  sweep();
  if (pendingCount() >= MAX_CONCURRENT_DISCOVERY_JOBS) return { busy: true };

  const discoveryId = randomUUID();
  const jobStartedAt = Date.now();
  jobs.set(discoveryId, { status: "pending", createdAt: jobStartedAt });
  const engineVersion = discoveryEngineVersionForVariant(variant);
  const { cacheKey, imageHash } = computeDiscoveryCacheKey(
    imageDataUrl,
    engineVersion,
  );
  const cacheIdentifier = imageHash.slice(0, 12);
  const openai = new OpenAI({ apiKey });

  logger.info(
    {
      discovery_id: discoveryId,
      discovery_version: cacheKey.split(":", 1)[0],
      cache_identifier: cacheIdentifier,
    },
    "[Noesis Discovery] job accepted",
  );

  void getOrComputeDiscovery(cacheKey, async () => {
    const result = await runDiscoveryPipeline(openai, imageDataUrl, {
      variant,
    });
    logger.info(
      { cache_identifier: cacheIdentifier, ...result.metrics },
      "[Noesis Discovery] cold run metrics",
    );
    return result;
  })
    .then(({ result, cacheHit }) => {
      if (!jobs.has(discoveryId)) return;
      jobs.set(discoveryId, createDiscoveryDoneJob(result, cacheHit));
      logger.info(
        { discovery_id: discoveryId, cache_hit: cacheHit, success: true },
        "[Noesis Discovery] job completed",
      );
    })
    .catch((error: unknown) => {
      const failedJob = createDiscoveryErrorJob(
        error,
        jobStartedAt,
        engineVersion,
      );
      logger.error(
        {
          discovery_id: discoveryId,
          success: false,
          failure: failedJob.diagnostic,
          error_detail: discoveryErrorLogDetails(error),
        },
        "[Noesis Discovery] job failed",
      );
      if (!jobs.has(discoveryId)) return;
      jobs.set(discoveryId, failedJob);
    });

  return { discoveryId };
}

export function getDiscoveryJob(discoveryId: string): DiscoveryJob | undefined {
  sweep();
  return jobs.get(discoveryId);
}

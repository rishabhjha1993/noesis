import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import {
  computeDiscoveryCacheKey,
  getOrComputeDiscovery,
} from "./discoveryCache";
import {
  runDiscoveryPipeline,
  type DiscoveryPipelineResult,
} from "./discoveryPipeline";
import { logger } from "./logger";

export type DiscoveryJob =
  | { status: "pending"; createdAt: number }
  | {
      status: "done";
      createdAt: number;
      result: DiscoveryPipelineResult;
      cacheHit: boolean;
    }
  | { status: "error"; createdAt: number; error: string };

const jobs = new Map<string, DiscoveryJob>();
const JOB_TTL_MS = 30 * 60 * 1000;
const MAX_CONCURRENT_DISCOVERY_JOBS = 2;

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
): { discoveryId: string } | { busy: true } {
  sweep();
  if (pendingCount() >= MAX_CONCURRENT_DISCOVERY_JOBS) return { busy: true };

  const discoveryId = randomUUID();
  jobs.set(discoveryId, { status: "pending", createdAt: Date.now() });
  const { cacheKey, imageHash } = computeDiscoveryCacheKey(imageDataUrl);
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
    const result = await runDiscoveryPipeline(openai, imageDataUrl);
    logger.info(
      { cache_identifier: cacheIdentifier, ...result.metrics },
      "[Noesis Discovery] cold run metrics",
    );
    return result;
  })
    .then(({ result, cacheHit }) => {
      if (!jobs.has(discoveryId)) return;
      jobs.set(discoveryId, {
        status: "done",
        createdAt: Date.now(),
        result,
        cacheHit,
      });
      logger.info(
        { discovery_id: discoveryId, cache_hit: cacheHit, success: true },
        "[Noesis Discovery] job completed",
      );
    })
    .catch((error: unknown) => {
      logger.error(
        { error, discovery_id: discoveryId, success: false },
        "[Noesis Discovery] job failed",
      );
      if (!jobs.has(discoveryId)) return;
      jobs.set(discoveryId, {
        status: "error",
        createdAt: Date.now(),
        error: "Discovery failed. Please try again or choose another image.",
      });
    });

  return { discoveryId };
}

export function getDiscoveryJob(discoveryId: string): DiscoveryJob | undefined {
  sweep();
  return jobs.get(discoveryId);
}

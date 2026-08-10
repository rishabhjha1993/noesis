import { createHash } from "node:crypto";
import { db, analysisCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  NoesisAnalysisSchema,
  type NoesisAnalysisResult,
} from "./analysisPipeline";
import { logger } from "./logger";

// Bump ANALYSIS_CACHE_VERSION whenever a material change is made to:
// - analysis prompts
// - model/reasoning configuration
// - evidence extraction
// - deterministic computation logic
// - final analysis behavior
const ANALYSIS_CACHE_VERSION = "noesis-v2.1";

/**
 * Compute a deterministic versioned cache key from the image data URL.
 * Only the image bytes are hashed — filename and MIME type are excluded.
 */
export function computeCacheKey(imageDataUrl: string): {
  cacheKey: string;
  imageHash: string;
} {
  const commaIdx = imageDataUrl.indexOf(",");
  const base64 =
    commaIdx >= 0 ? imageDataUrl.slice(commaIdx + 1) : imageDataUrl;
  const imageHash = createHash("sha256")
    .update(Buffer.from(base64, "base64"))
    .digest("hex");
  const cacheKey = `${ANALYSIS_CACHE_VERSION}:${imageHash}`;
  return { cacheKey, imageHash };
}

// In-memory single-flight: deduplicates concurrent requests for the same
// uncached image so only ONE pipeline run occurs per cache key at a time.
const inFlight = new Map<string, Promise<NoesisAnalysisResult>>();
let missingDatabaseWarningLogged = false;

export interface CacheMetrics {
  cache_identifier: string;
  cache_hit: boolean;
  cache_lookup_latency_ms: number;
  cache_write_latency_ms: number | null;
}

/**
 * Return a cached analysis if one exists and is valid; otherwise run
 * `compute()`, persist the result, and return it.
 *
 * Single-flight: if two requests arrive for the same uncached key at the
 * same time, the second awaits the first's pipeline instead of forking a
 * duplicate model run.
 */
export async function getOrComputeAnalysis(
  cacheKey: string,
  imageHash: string,
  compute: () => Promise<NoesisAnalysisResult>,
): Promise<{
  result: NoesisAnalysisResult;
  cacheHit: boolean;
  metrics: CacheMetrics;
}> {
  const shortHash = imageHash.slice(0, 12);
  const t0 = Date.now();
  const database = db;

  // --- Persistent cache lookup ---
  let rows: Array<typeof analysisCacheTable.$inferSelect> = [];
  if (database) {
    try {
      rows = await database
        .select()
        .from(analysisCacheTable)
        .where(eq(analysisCacheTable.cacheKey, cacheKey))
        .limit(1);
    } catch (err) {
      logger.error(
        {
          err,
          cache_identifier: shortHash,
          success: false,
          failure_stage: "cache_lookup",
          cache_lookup_latency_ms: Date.now() - t0,
        },
        "[Noesis] cache lookup failed",
      );
      throw err;
    }
  } else if (!missingDatabaseWarningLogged) {
    missingDatabaseWarningLogged = true;
    logger.warn(
      "[Noesis] DATABASE_URL is not set; persistent analysis cache is disabled",
    );
  }

  const cached = rows[0] ?? null;

  if (cached && database) {
    const parsed = NoesisAnalysisSchema.safeParse(cached.analysisJson);
    if (parsed.success) {
      const lookupMs = Date.now() - t0;
      logger.info(
        {
          cache_identifier: shortHash,
          cache_hit: true,
          cache_lookup_latency_ms: lookupMs,
        },
        "[Noesis] cache lookup",
      );
      // Touch last_accessed_at asynchronously — not critical path.
      void database
        .update(analysisCacheTable)
        .set({ lastAccessedAt: new Date() })
        .where(eq(analysisCacheTable.cacheKey, cacheKey))
        .catch((err: unknown) => {
          logger.warn({ err }, "[Noesis] failed to update last_accessed_at");
        });
      return {
        result: parsed.data,
        cacheHit: true,
        metrics: {
          cache_identifier: shortHash,
          cache_hit: true,
          cache_lookup_latency_ms: lookupMs,
          cache_write_latency_ms: null,
        },
      };
    }
    // Cached value is structurally invalid — delete and fall through.
    logger.warn(
      `[Noesis] cache INVALID ${shortHash} — deleting and recomputing`,
    );
    void database
      .delete(analysisCacheTable)
      .where(eq(analysisCacheTable.cacheKey, cacheKey))
      .catch((err: unknown) => {
        logger.warn({ err }, "[Noesis] failed to delete invalid cache row");
      });
  }

  const lookupMs = Date.now() - t0;
  logger.info(
    {
      cache_identifier: shortHash,
      cache_hit: false,
      cache_lookup_latency_ms: lookupMs,
    },
    "[Noesis] cache lookup",
  );

  // --- Single-flight: attach to an already-running pipeline if present ---
  const existing = inFlight.get(cacheKey);
  if (existing) {
    logger.info(`[Noesis] single-flight attach ${shortHash}`);
    const result = await existing;
    return {
      result,
      cacheHit: false,
      metrics: {
        cache_identifier: shortHash,
        cache_hit: false,
        cache_lookup_latency_ms: lookupMs,
        cache_write_latency_ms: null,
      },
    };
  }

  // --- Run the pipeline and persist the result ---
  let cacheWriteMs: number | null = null;
  const promise = compute().then(async (analysis) => {
    if (database) {
      const writeStarted = Date.now();
      try {
        await database
          .insert(analysisCacheTable)
          .values({
            cacheKey,
            imageHash,
            analysisVersion: ANALYSIS_CACHE_VERSION,
            analysisJson: analysis,
            createdAt: new Date(),
          })
          .onConflictDoNothing();
      } catch (err: unknown) {
        // Cache write failure is non-fatal; the result is still returned.
        logger.warn(
          {
            err,
            cache_identifier: shortHash,
            success: false,
            failure_stage: "cache_write",
          },
          "[Noesis] failed to write cache",
        );
      }
      cacheWriteMs = Date.now() - writeStarted;
    }
    logger.info(
      {
        cache_identifier: shortHash,
        cache_write_latency_ms: cacheWriteMs,
        total_pipeline_latency_ms: Date.now() - t0,
      },
      "[Noesis] analysis completed",
    );
    return analysis;
  });

  // Register before awaiting so concurrent requests can attach.
  inFlight.set(cacheKey, promise);

  try {
    const result = await promise;
    return {
      result,
      cacheHit: false,
      metrics: {
        cache_identifier: shortHash,
        cache_hit: false,
        cache_lookup_latency_ms: lookupMs,
        cache_write_latency_ms: cacheWriteMs,
      },
    };
  } finally {
    inFlight.delete(cacheKey);
  }
}

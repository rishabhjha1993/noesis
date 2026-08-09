import { randomUUID } from "node:crypto";
import OpenAI from "openai";
import { runAnalysisPipeline, type NoesisAnalysisResult } from "./analysisPipeline";
import { computeCacheKey, getOrComputeAnalysis } from "./analysisCache";
import { logger } from "./logger";

/**
 * In-memory analysis job store. Analyses take ~2 minutes (two sequential
 * model passes), which exceeds the ~120s proxy limit on browser requests,
 * so the route returns a job id immediately and the client polls.
 *
 * On each job start, the cache is checked first via analysisCache.ts.
 * A cache hit completes the job in milliseconds without model calls.
 */

type AnalysisJob =
  | { status: "pending"; createdAt: number }
  | { status: "done"; createdAt: number; analysis: NoesisAnalysisResult; cacheHit: boolean }
  | { status: "error"; createdAt: number; error: string };

const jobs = new Map<string, AnalysisJob>();

// Jobs are single-consumer and short-lived; expire them after 15 minutes.
const JOB_TTL_MS = 15 * 60 * 1000;
const MAX_CONCURRENT_PENDING = 5;

function sweep(): void {
  const now = Date.now();
  for (const [id, job] of jobs) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}

function pendingCount(): number {
  let n = 0;
  for (const job of jobs.values()) if (job.status === "pending") n++;
  return n;
}

export function startAnalysisJob(
  apiKey: string,
  imageDataUrl: string,
): { analysisId: string } | { busy: true } {
  sweep();
  if (pendingCount() >= MAX_CONCURRENT_PENDING) {
    return { busy: true };
  }
  const analysisId = randomUUID();
  jobs.set(analysisId, { status: "pending", createdAt: Date.now() });

  const { cacheKey, imageHash } = computeCacheKey(imageDataUrl);
  const openai = new OpenAI({ apiKey });

  void getOrComputeAnalysis(cacheKey, imageHash, () =>
    runAnalysisPipeline(openai, imageDataUrl),
  )
    .then(({ result: analysis, cacheHit }) => {
      if (!jobs.has(analysisId)) return; // expired meanwhile
      jobs.set(analysisId, {
        status: "done",
        createdAt: Date.now(),
        analysis,
        cacheHit,
      });
    })
    .catch((err: unknown) => {
      logger.error({ err, analysisId }, "Image analysis failed");
      if (!jobs.has(analysisId)) return;
      jobs.set(analysisId, {
        status: "error",
        createdAt: Date.now(),
        error: "The analysis failed. Please try again or pick another image.",
      });
    });

  return { analysisId };
}

export function getAnalysisJob(analysisId: string): AnalysisJob | undefined {
  sweep();
  return jobs.get(analysisId);
}

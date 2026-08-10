import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  AnalysisPipelineError,
  runAnalysisPipelineDetailed,
} from "../artifacts/api-server/src/lib/analysisPipeline";
import { SocraticPipelineError, runSocraticPipeline } from "./socraticPipeline";
import {
  SocraticQualityPipelineError,
  runSocraticQualityPipeline,
} from "./socraticQualityPipeline";

const evalDir = __dirname;
const repoRoot = path.resolve(evalDir, "..");
const apiRequire = createRequire(
  path.join(repoRoot, "artifacts/api-server/package.json"),
);
type ProductionOpenAI = Parameters<typeof runAnalysisPipelineDetailed>[0];
const OpenAI = apiRequire("openai").default as new (options: {
  apiKey: string;
}) => ProductionOpenAI;

type Benchmark = {
  id: string;
  path: string;
  visual_type: string;
  difficulty: string;
  tags: string[];
  expected_capabilities: string[];
};
type Manifest = { version: number; benchmarks: Benchmark[] };

function option(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const manifestPath = path.resolve(
    repoRoot,
    option("--manifest") ?? "evals/benchmark.json",
  );
  const mode = option("--mode") ?? "cold";
  if (
    mode !== "cold" &&
    mode !== "cached" &&
    mode !== "socratic" &&
    mode !== "socratic-quality-v2"
  ) {
    throw new Error(
      "--mode must be cold, cached, socratic, or socratic-quality-v2",
    );
  }
  const only = new Set((option("--ids") ?? "").split(",").filter(Boolean));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");
  if (mode === "cached" && !process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is required for cached mode");

  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
  const selected = manifest.benchmarks.filter(
    (item) => only.size === 0 || only.has(item.id),
  );
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(repoRoot, "evals", "results", runId);
  await mkdir(outputDir, { recursive: true });
  const openai = new OpenAI({ apiKey });
  const records: unknown[] = [];

  for (const benchmark of selected) {
    const imagePath = path.resolve(path.dirname(manifestPath), benchmark.path);
    const bytes = await readFile(imagePath);
    const extension = path.extname(imagePath).toLowerCase();
    const mime =
      extension === ".jpg" || extension === ".jpeg"
        ? "image/jpeg"
        : extension === ".webp"
          ? "image/webp"
          : extension === ".gif"
            ? "image/gif"
            : "image/png";
    const imageDataUrl = `data:${mime};base64,${bytes.toString("base64")}`;
    const imageHash = createHash("sha256").update(bytes).digest("hex");
    const cacheIdentifier = imageHash.slice(0, 12);
    const started = Date.now();
    let detailed: Awaited<
      ReturnType<typeof runAnalysisPipelineDetailed>
    > | null = null;
    let cache = {
      cache_identifier: cacheIdentifier,
      cache_hit: false,
      cache_lookup_latency_ms: 0,
      cache_write_latency_ms: null as number | null,
    };
    try {
      if (mode === "socratic-quality-v2") {
        const quality = await runSocraticQualityPipeline(openai, imageDataUrl);
        const record = {
          benchmark,
          mode,
          cache,
          success: true,
          analysis: quality.analysis,
          pipeline: quality.metrics,
          visual_evidence: quality.visualEvidence,
          computed_evidence: quality.computedEvidence,
          socratic_packet: quality.socraticPacket,
          analyst_outputs: quality.analystOutputs,
          synthesis: quality.synthesis,
          context_usage: quality.contextUsage,
        };
        records.push(record);
        await writeFile(
          path.join(outputDir, `${benchmark.id}.json`),
          JSON.stringify(record, null, 2),
        );
        continue;
      } else if (mode === "socratic") {
        const socratic = await runSocraticPipeline(openai, imageDataUrl);
        const record = {
          benchmark,
          mode,
          cache,
          success: true,
          analysis: socratic.analysis,
          pipeline: socratic.metrics,
          visual_evidence: socratic.visualEvidence,
          computed_evidence: socratic.computedEvidence,
          compact_evidence: socratic.compactEvidence,
          analyst_outputs: socratic.analystOutputs,
        };
        records.push(record);
        await writeFile(
          path.join(outputDir, `${benchmark.id}.json`),
          JSON.stringify(record, null, 2),
        );
        continue;
      } else if (mode === "cold") {
        detailed = await runAnalysisPipelineDetailed(openai, imageDataUrl);
      } else {
        const { computeCacheKey, getOrComputeAnalysis } =
          await import("../artifacts/api-server/src/lib/analysisCache");
        const { cacheKey } = computeCacheKey(imageDataUrl);
        const result = await getOrComputeAnalysis(
          cacheKey,
          imageHash,
          async () => {
            detailed = await runAnalysisPipelineDetailed(openai, imageDataUrl);
            return detailed.analysis;
          },
        );
        cache = result.metrics;
        if (!detailed) {
          const record = {
            benchmark,
            mode,
            cache,
            success: true,
            analysis: result.result,
            pipeline: null,
            visual_evidence: null,
            computed_evidence: null,
            note: "Intermediates and model metrics are unavailable on a production cache hit.",
          };
          records.push(record);
          await writeFile(
            path.join(outputDir, `${benchmark.id}.json`),
            JSON.stringify(record, null, 2),
          );
          continue;
        }
      }
      const record = {
        benchmark,
        mode,
        cache,
        success: true,
        analysis: detailed.analysis,
        pipeline: detailed.metrics,
        visual_evidence: detailed.visualEvidence,
        computed_evidence: detailed.computedEvidence,
      };
      records.push(record);
      await writeFile(
        path.join(outputDir, `${benchmark.id}.json`),
        JSON.stringify(record, null, 2),
      );
    } catch (error) {
      const record = {
        benchmark,
        mode,
        cache,
        success: false,
        elapsed_ms: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
        pipeline:
          error instanceof AnalysisPipelineError ||
          error instanceof SocraticPipelineError ||
          error instanceof SocraticQualityPipelineError
            ? error.metrics
            : null,
      };
      records.push(record);
      await writeFile(
        path.join(outputDir, `${benchmark.id}.json`),
        JSON.stringify(record, null, 2),
      );
    }
  }

  const successful = records.filter(
    (r) => (r as { success: boolean }).success,
  ).length;
  const summary = {
    run_id: runId,
    timestamp: new Date().toISOString(),
    mode,
    manifest: path.relative(repoRoot, manifestPath),
    benchmarks_requested: selected.length,
    successes: successful,
    failures: selected.length - successful,
    results: records,
  };
  await writeFile(
    path.join(outputDir, "run-summary.json"),
    JSON.stringify(summary, null, 2),
  );
  console.log(
    `Noesis eval complete: ${successful}/${selected.length} succeeded\n${outputDir}`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

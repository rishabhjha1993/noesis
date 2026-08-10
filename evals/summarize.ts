import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

async function main(): Promise<void> {
  const [runFile, scoreFile] = process.argv
    .slice(2)
    .filter((arg) => arg !== "--");
  if (!runFile)
    throw new Error(
      "Usage: pnpm eval:noesis:summarize -- <run-summary.json> [scores.json]",
    );
  const repoRoot = path.resolve(__dirname, "..");
  const resolvedRunFile = path.resolve(repoRoot, runFile);
  const run = JSON.parse(await readFile(resolvedRunFile, "utf8"));
  const scores = scoreFile
    ? JSON.parse(await readFile(path.resolve(repoRoot, scoreFile), "utf8"))
    : {};
  const rows = run.results.map((record: any) => {
    const human = scores[record.benchmark.id] ?? null;
    const scoreValues = human
      ? Object.entries(human)
          .filter(
            ([key, value]) => key !== "notes" && typeof value === "number",
          )
          .map(([, value]) => value as number)
      : [];
    const firstModel =
      record.pipeline?.pass1 ??
      record.pipeline?.sol_evidence ??
      record.pipeline?.terra_evidence;
    const finalModel =
      record.pipeline?.pass2 ??
      record.pipeline?.sol_synthesis ??
      record.pipeline?.terra_synthesis;
    return {
      benchmark: record.benchmark.id,
      success: record.success,
      cache_hit: record.cache?.cache_hit ?? null,
      pass1_latency_ms: firstModel?.latency_ms ?? null,
      deterministic_latency_ms:
        record.pipeline?.deterministic_compute_latency_ms ?? null,
      pass2_latency_ms: finalModel?.latency_ms ?? null,
      total_latency_ms: record.pipeline?.total_pipeline_latency_ms ?? null,
      pass1_tokens: firstModel?.total_tokens ?? null,
      pass2_tokens: finalModel?.total_tokens ?? null,
      estimated_cost_usd: record.pipeline?.estimated_cost?.total_usd ?? null,
      human_score: scoreValues.length
        ? scoreValues.reduce((a, b) => a + b, 0)
        : null,
      human_score_max: scoreValues.length ? scoreValues.length * 5 : null,
    };
  });
  const output = { run_id: run.run_id, rows };
  const outputPath = path.join(
    path.dirname(resolvedRunFile),
    "comparison-summary.json",
  );
  await writeFile(outputPath, JSON.stringify(output, null, 2));
  console.table(rows);
  console.log(outputPath);
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import {
  createDiscoveryResearchReplayDryRun,
  createDiscoveryResearchReplayPlan,
  executeDiscoveryResearchReplay,
  isDiscoveryCandidateResearchModel,
  loadRetainedDiscoveryReplayInput,
} from "./discoveryResearchReplay";

function option(name: string): string | undefined {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const inputPath = path.resolve(requiredOption("--input"));
  const sourceDiscoveryId = requiredOption("--source-discovery-id");
  const model = requiredOption("--model");
  if (!isDiscoveryCandidateResearchModel(model)) {
    throw new Error("--model must be gpt-5.6-terra or gpt-5.6-luna");
  }
  const outputOption = option("--output");
  const outputPath = outputOption ? path.resolve(outputOption) : undefined;
  const retained = await loadRetainedDiscoveryReplayInput(
    inputPath,
    sourceDiscoveryId,
  );
  const plan = createDiscoveryResearchReplayPlan(retained, model, outputPath);
  const execute = process.argv.includes("--execute");
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify(createDiscoveryResearchReplayDryRun(plan), null, 2)}\n`,
    );
    return;
  }
  if (!outputPath) throw new Error("--output is required with --execute");
  const repoRoot = path.resolve(__dirname, "..");
  if (!process.env.OPENAI_API_KEY) {
    try {
      loadEnvFile(path.join(repoRoot, ".env.local"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required with --execute");
  const apiRequire = createRequire(
    path.join(repoRoot, "artifacts/api-server/package.json"),
  );
  const OpenAI = apiRequire("openai").default as new (options: {
    apiKey: string;
  }) => Parameters<typeof executeDiscoveryResearchReplay>[0];
  const result = await executeDiscoveryResearchReplay(
    new OpenAI({ apiKey }),
    plan,
  );
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  process.stdout.write(
    `${JSON.stringify({ status: "completed", output_path: outputPath }, null, 2)}\n`,
  );
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

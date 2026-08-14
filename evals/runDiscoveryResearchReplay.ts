import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { loadEnvFile } from "node:process";
import {
  createDiscoveryResearchImageAccessExperimentDryRun,
  createDiscoveryResearchImageAccessExperimentPlan,
  executeDiscoveryResearchImageAccessExperiment,
  isDiscoveryResearchImageAccessMode,
  loadDiscoveryResearchReplayImage,
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
  const baselineOption = option("--baseline-json") ?? option("--input");
  if (!baselineOption) throw new Error("--baseline-json is required");
  const inputPath = path.resolve(baselineOption);
  const sourceDiscoveryId = requiredOption("--source-discovery-id");
  const imageAccess = requiredOption("--image-access");
  if (!isDiscoveryResearchImageAccessMode(imageAccess)) {
    throw new Error("--image-access must be text-only or original-image");
  }
  const suppliedModel = option("--model");
  if (suppliedModel && suppliedModel !== "gpt-5.6-luna") {
    throw new Error(
      "The image-access experiment model is fixed at gpt-5.6-luna",
    );
  }
  const repeat = Number(option("--repeat") ?? "1");
  const imageOption = option("--image");
  const imagePath = imageOption ? path.resolve(imageOption) : undefined;
  const outputOption = option("--output");
  const outputPath = outputOption ? path.resolve(outputOption) : undefined;
  const retained = await loadRetainedDiscoveryReplayInput(
    inputPath,
    sourceDiscoveryId,
  );
  const plan = createDiscoveryResearchImageAccessExperimentPlan(retained, {
    imageAccess,
    repeat,
    imagePath,
    outputPath,
  });
  const image =
    imageAccess === "original-image"
      ? await loadDiscoveryResearchReplayImage(plan.imagePath!)
      : null;
  const execute = process.argv.includes("--execute");
  if (!execute) {
    process.stdout.write(
      `${JSON.stringify(createDiscoveryResearchImageAccessExperimentDryRun(plan), null, 2)}\n`,
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
  }) => Parameters<typeof executeDiscoveryResearchImageAccessExperiment>[0];
  const result = await executeDiscoveryResearchImageAccessExperiment(
    new OpenAI({ apiKey }),
    plan,
    image,
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
